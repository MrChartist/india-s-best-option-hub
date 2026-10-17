/**
 * Sample session: a deterministic, clearly labelled simulation of one trading session built
 * backwards from a (sample) chain, so the flow tape and Premium Tide have something to show when
 * no live source is reachable. The UI must label anything built from this as "Sample data".
 *
 * The final snapshot equals the given chain (volume, OI and LTP), and earlier snapshots replay a
 * plausible intraday path: U-shaped volume, a random-walk spot and LTPs moved by delta.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { isTradingDay, istDateString, nowIST, previousTradingDay, toISTDate } from "@/lib/options";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The session the simulation covers: today once 09:15 IST has passed on a trading day, else the previous trading day. */
export function sampleSessionWindow(now: Date = new Date()): { date: string; start: number; end: number } {
  const t = nowIST(now);
  const today = istDateString(now);
  const afterOpen = isTradingDay(today) && t.hh * 60 + t.mm >= 9 * 60 + 20;
  const date = afterOpen ? today : previousTradingDay(today) || today;
  const start = toISTDate(date, "09:15").getTime();
  const close = toISTDate(date, "15:30").getTime();
  const end = afterOpen ? Math.min(now.getTime(), close) : close;
  return { date, start, end };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface SampleSessionInput {
  symbol: string;
  expiry: string;
  spot: number;
  chain: OptionData[];
  now?: Date;
  /** Minutes between simulated snapshots. Default 5. */
  stepMin?: number;
}

export function simulateSession(o: SampleSessionInput): ChainSnapshot[] {
  const chain = (Array.isArray(o.chain) ? o.chain : []).filter((r) => r && r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
  if (chain.length === 0 || !(o.spot > 0)) return [];
  const { start, end } = sampleSessionWindow(o.now ?? new Date());
  const stepMs = Math.max(1, o.stepMin ?? 5) * 60_000;
  const n = Math.max(2, Math.floor((end - start) / stepMs) + 1);
  const rand = rng(hashString(`${o.symbol}|${o.expiry}|${Math.round(o.spot)}`));

  // Market-wide volume weights: U-shaped (busy open and close), with noise.
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 1;
    w.push((0.35 + 1.6 * (u - 0.5) ** 2 * 4) * (0.6 + 0.8 * rand()));
  }
  // Spot path: random walk that ends at the given spot.
  const vol = 0.0009;
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] + (rand() - 0.5) * 2 * vol);
  const shift = walk[n - 1];
  const spots = walk.map((x) => o.spot * Math.exp(x - shift));

  type Path = { strike: number; side: "CE" | "PE"; leg: OptionLegData; delta: number; cumW: number[]; oiW: number[] };
  const paths: Path[] = [];
  for (const r of chain) {
    for (const side of ["CE", "PE"] as const) {
      const leg = side === "CE" ? r.ce : r.pe;
      if (!leg || !(leg.ltp > 0)) continue;
      const delta = Number.isFinite(leg.delta) && leg.delta !== 0 ? leg.delta : side === "CE" ? (r.strikePrice < o.spot ? 0.7 : 0.3) : r.strikePrice > o.spot ? -0.7 : -0.3;
      const raw = w.map((x) => x * (0.4 + 1.2 * rand() ** 2));
      const total = raw.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      const cumW = raw.map((x) => (acc += x) / total);
      const rawOi = w.map(() => rand());
      const totOi = rawOi.reduce((a, b) => a + b, 0) || 1;
      let accOi = 0;
      const oiW = rawOi.map((x) => (accOi += x) / totOi);
      paths.push({ strike: r.strikePrice, side, leg, delta, cumW, oiW });
    }
  }

  const snaps: ChainSnapshot[] = [];
  const prevLtp = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const ts = i === n - 1 ? end : start + i * stepMs;
    const rows: StrikeSnap[] = [];
    for (const p of paths) {
      const last = i === n - 1;
      const volume = last ? p.leg.volume : Math.round(p.leg.volume * p.cumW[i]);
      const oiPrev = p.leg.oi - (p.leg.oiChange || 0);
      const oi = last ? p.leg.oi : Math.max(0, Math.round(oiPrev + (p.leg.oiChange || 0) * p.oiW[i]));
      const ltp = last ? p.leg.ltp : Math.max(0.05, r2(p.leg.ltp + p.delta * (spots[i] - o.spot)));
      const key = `${p.strike}|${p.side}`;
      const before = prevLtp.get(key) ?? ltp;
      prevLtp.set(key, ltp);
      const spread = Math.max(0.05, r2(ltp * 0.006));
      const lean = Math.max(0, Math.min(1, 0.5 + (ltp > before ? 0.45 : ltp < before ? -0.45 : 0) + (rand() - 0.5) * 0.3));
      const bid = Math.max(0.05, r2(ltp - lean * spread));
      rows.push({ strike: p.strike, side: p.side, ltp, oi, vol: Math.max(0, volume), iv: p.leg.iv || 0, bid, ask: r2(bid + spread) });
    }
    snaps.push({ id: `${o.symbol}|${o.expiry}|${ts}|sample`, symbol: o.symbol.toUpperCase(), expiry: o.expiry, ts, spot: r2(spots[i]), rows });
  }
  return snaps;
}
