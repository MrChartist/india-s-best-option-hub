/**
 * Sample expiry session: a deterministic, clearly labelled simulation of one trading session for
 * the expiry-day page when no live or recorded snapshots exist. Unlike the flow stream's sample
 * session, prices here are re-priced with Black-76 at every step, so the straddle genuinely decays
 * towards 15:30. The UI must badge anything built from this as "Sample data".
 */
import type { OptionData } from "@/lib/mockData";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { sampleSessionWindow } from "@/lib/flow";
import { atmIV, black76Price, forwardFromSpot, timeToExpiryYears } from "@/lib/options";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Standard normal draw (Box-Muller). */
function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const tick = (v: number) => Math.max(0.05, Math.round(v * 20) / 20);

export interface ExpirySampleInput {
  symbol: string;
  expiry: string;
  spot: number;
  /** Base chain: strikes, IVs (percent) and closing volume/OI. */
  chain: OptionData[];
  now?: Date;
  r?: number;
  q?: number;
  /** Minutes between simulated snapshots (default 3). */
  stepMin?: number;
  /** Strikes kept on each side of ATM (default 24). */
  wings?: number;
}

/** Simulated snapshots over the session window (today after 09:20 IST on a trading day, else the previous session). */
export function simulateExpirySession(o: ExpirySampleInput): ChainSnapshot[] {
  const rowsAll = (Array.isArray(o.chain) ? o.chain : []).filter((r) => r && r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
  if (rowsAll.length === 0 || !(o.spot > 0) || !o.expiry) return [];
  const r = o.r ?? 0.065;
  const q = o.q ?? 0;
  const { start, end } = sampleSessionWindow(o.now ?? new Date());
  if (!(end > start)) return [];
  const stepMs = Math.max(1, o.stepMin ?? 3) * 60_000;
  const n = Math.max(2, Math.floor((end - start) / stepMs) + 1);
  const rand = mulberry32(hash(`${o.symbol}|${o.expiry}|${Math.round(o.spot)}|${start}`));

  // Keep strikes around ATM.
  let atmIdx = 0;
  for (let i = 0; i < rowsAll.length; i++) if (Math.abs(rowsAll[i].strikePrice - o.spot) < Math.abs(rowsAll[atmIdx].strikePrice - o.spot)) atmIdx = i;
  const wings = Math.max(4, o.wings ?? 24);
  const rows = rowsAll.slice(Math.max(0, atmIdx - wings), atmIdx + wings + 1);

  const ivAtmPct = atmIV(rows, o.spot);
  const baseIv = Number.isFinite(ivAtmPct) && ivAtmPct > 0 ? ivAtmPct / 100 : 0.13;

  // Spot path: random walk in trading time ending at the given spot, with mild mean reversion.
  const sdStep = baseIv * Math.sqrt(stepMs / 60_000 / (252 * 375));
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] * 0.985 + gauss(rand) * sdStep);
  const shift = walk[n - 1];
  const spots = walk.map((x) => o.spot * Math.exp(x - shift));
  // IV drifts a little through the day (crush into the close on expiry day).
  const ivDrift = walk.map((_, i) => 1 + 0.06 * (0.5 - i / Math.max(1, n - 1)) + gauss(rand) * 0.01);

  // U-shaped cumulative volume weights.
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 1;
    w.push((0.4 + 6 * (u - 0.5) ** 2) * (0.7 + 0.6 * rand()));
  }
  const totW = w.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const cumW = w.map((x) => (acc += x) / totW);

  const snaps: ChainSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    const ts = i === n - 1 ? end : start + i * stepMs;
    const T = timeToExpiryYears(o.expiry, new Date(ts), { mode: "trading" });
    const S = spots[i];
    const F = forwardFromSpot(S, T, r, q);
    const out: StrikeSnap[] = [];
    for (const row of rows) {
      const K = row.strikePrice;
      for (const side of ["CE", "PE"] as const) {
        const leg = side === "CE" ? row.ce : row.pe;
        const legIv = leg && leg.iv > 0 ? leg.iv / 100 : baseIv * (1 + 0.6 * Math.abs(Math.log(K / o.spot)) * 10);
        const sigma = Math.max(0.03, legIv * ivDrift[i]);
        const price = black76Price({ F, K, T, r, sigma, type: side });
        const ltp = tick(price * (1 + gauss(rand) * 0.004));
        const dist = Math.abs(K - o.spot) / o.spot;
        const finalVol = leg && leg.volume > 0 ? leg.volume : Math.round(400_000 * Math.exp(-dist * 120) + 2_000);
        const vol = Math.round(finalVol * cumW[i]);
        const finalOi = leg && leg.oi > 0 ? leg.oi : Math.round(120_000 * Math.exp(-dist * 60) + 5_000);
        const oiChange = leg && Number.isFinite(leg.oiChange) ? leg.oiChange : 0;
        const oi = Math.max(0, Math.round(finalOi - oiChange * (1 - cumW[i])));
        const spread = Math.max(0.05, tick(ltp * 0.008));
        const bid = tick(ltp - spread / 2);
        out.push({ strike: K, side, ltp, oi, vol, iv: Math.round(sigma * 10000) / 100, bid, ask: Math.round((bid + spread) * 100) / 100 });
      }
    }
    snaps.push({ id: `${o.symbol}|${o.expiry}|${ts}|sample`, symbol: o.symbol.toUpperCase(), expiry: o.expiry, ts, spot: Math.round(S * 100) / 100, rows: out });
  }
  return snaps;
}
