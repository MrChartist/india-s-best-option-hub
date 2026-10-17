/**
 * SAMPLE intraday OI session for a whole option chain (always labelled "Sample session").
 *
 * Deterministic for a given symbol, expiry, spot and session window: the same inputs always draw
 * the same day. The session is anchored to generateSampleChain at `now`, so the last snapshot is
 * exactly the sample chain the rest of the page shows (same OI per strike), and each leg opens the
 * day at its previous close (OI minus the day's OI change). In between, every leg builds its
 * change along its own S-curve with a little noise, and spot follows a Brownian bridge into the
 * anchor spot. Used only when this browser has not recorded a real session yet.
 *
 * Never present anything built here as market data.
 */
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { sampleContractWindow } from "@/lib/history/sampleSession";
import { gaussianSource, generateSampleChain, mulberry32, sampleSeed, timeToExpiryYears } from "@/lib/options";

export interface SampleOiSessionInput {
  symbol: string;
  expiry: string;
  spot: number;
  now?: Date;
  /** Minutes between snapshots (default 5). */
  stepMin?: number;
  /** Strikes in the anchor chain (default 41, as on the sample option chain). */
  strikes?: number;
}

const TICK = 0.05;
const r2 = (x: number) => Math.round(x * 100) / 100;
const roundTick = (x: number) => Math.max(TICK, Math.round(x / TICK) * TICK);
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Sample snapshots for the session (oldest first). Empty when the inputs are unusable (no spot,
 * no expiry, or the contract had already expired when the session opened).
 */
export function buildSampleOiSession(o: SampleOiSessionInput): ChainSnapshot[] {
  const symbol = String(o?.symbol || "").trim().toUpperCase();
  const spot = Number(o?.spot);
  if (!symbol || !(spot > 0) || !o.expiry) return [];
  const now = o.now ?? new Date();
  const { start, end } = sampleContractWindow(now);
  if (!(timeToExpiryYears(o.expiry, new Date(start)) > 0)) return [];

  const { chain } = generateSampleChain({ symbol, spot, expiry: o.expiry, now, strikes: o.strikes ?? 41 });
  if (chain.length === 0) return [];

  const stepMs = Math.max(1, Math.round(o.stepMin ?? 5)) * 60_000;
  const times: number[] = [];
  for (let t = start; t < end; t += stepMs) times.push(t);
  if (times[times.length - 1] !== end) times.push(end);
  const n = times.length;

  const rand = mulberry32(sampleSeed(symbol, o.expiry, start / 60_000));
  const gauss = gaussianSource(rand);

  // Spot: an opening gap that a Brownian bridge walks back into the anchor spot.
  const sessionVol = 0.14 * Math.sqrt(1 / 252);
  const gap = gauss() * sessionVol * 0.6;
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] + gauss() * sessionVol * Math.sqrt(1 / Math.max(1, n - 1)));
  const spots = times.map((_, i) => {
    const w = n > 1 ? i / (n - 1) : 1;
    return r2(spot * Math.exp(gap * (1 - w) + (walk[i] - walk[n - 1] * w)));
  });
  spots[n - 1] = spot;

  // U-shaped trading intensity for cumulative volume.
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? i / (n - 1) : 1;
    acc += 0.35 + 8.8 * (x - 0.5) ** 2 + 0.25 * rand();
    cum.push(acc);
  }
  const total = acc || 1;

  type LegPath = { strike: number; side: "CE" | "PE"; oi: number[]; ltp: number[]; vol: number[]; iv: number; bid: number; ask: number };
  const legs: LegPath[] = [];
  for (const row of chain) {
    for (const side of ["CE", "PE"] as const) {
      const leg = side === "CE" ? row.ce : row.pe;
      const finalOi = Math.max(0, Math.round(leg.oi));
      const openOi = Math.max(0, finalOi - Math.round(leg.oiChange));
      // Each leg does most of its writing at a different time of day.
      const centre = 0.2 + 0.55 * rand();
      const steep = 5 + 7 * rand();
      const f0 = logistic(-steep * centre);
      const f1 = logistic(steep * (1 - centre));
      let noise = 0;
      const oi: number[] = [];
      const ltp: number[] = [];
      const vol: number[] = [];
      for (let i = 0; i < n; i++) {
        const w = n > 1 ? i / (n - 1) : 1;
        const frac = (logistic(steep * (w - centre)) - f0) / (f1 - f0 || 1);
        noise = noise * 0.8 + gauss() * 0.01;
        const change = (finalOi - openOi) * frac;
        const wobble = Math.abs(finalOi - openOi) * noise * w * (1 - w) * 4;
        oi.push(i === n - 1 ? finalOi : Math.max(0, Math.round(openOi + change + wobble)));
        // Premium moves with spot through the leg's delta (first order is enough for a replay).
        const p = leg.ltp + (Number.isFinite(leg.delta) ? leg.delta : 0) * (spots[i] - spot);
        ltp.push(i === n - 1 ? leg.ltp : r2(roundTick(p)));
        vol.push(i === n - 1 ? Math.round(leg.volume) : Math.round((leg.volume * cum[i]) / total));
      }
      legs.push({ strike: row.strikePrice, side, oi, ltp, vol, iv: leg.iv, bid: leg.bidPrice, ask: leg.askPrice });
    }
  }

  return times.map((ts, i) => {
    const rows: StrikeSnap[] = legs.map((l) => {
      const last = i === n - 1;
      const spread = Math.max(TICK, l.ask - l.bid);
      const bid = last ? l.bid : r2(Math.max(TICK, roundTick(l.ltp[i] - spread / 2)));
      return { strike: l.strike, side: l.side, ltp: l.ltp[i], oi: l.oi[i], vol: l.vol[i], iv: l.iv, bid, ask: last ? l.ask : r2(roundTick(bid + spread)) };
    });
    return { id: `sample|${symbol}|${o.expiry}|${ts}`, symbol, expiry: o.expiry, ts, spot: spots[i], rows };
  });
}
