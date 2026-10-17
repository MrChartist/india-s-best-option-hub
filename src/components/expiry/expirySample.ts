/**
 * Sample expiry session: a deterministic, clearly labelled simulation of one trading session for
 * the expiry-day and straddle pages when no live or recorded snapshots exist.
 *
 * The session is anchored to generateSampleChain for the same symbol, expiry and `now`: the last
 * snapshot carries that chain's LTP, bid/ask, IV, OI and volume for every strike, so the straddle
 * at "now" equals the sample option chain's ATM straddle. Earlier snapshots replay a plausible day:
 * a spot path into the anchor spot, an ATM IV that opens a little richer than the chain's ATM IV and
 * eases into it, Black-76 prices on the sample smile (calendar time, as the sample chain uses), OI
 * building from the open and U-shaped cumulative volume. The UI must badge anything built from this
 * as "Sample data".
 */
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { sampleSessionWindow } from "@/lib/flow";
import {
  atmIV,
  black76Price,
  defaultSampleIv,
  forwardFromSpot,
  gaussianSource,
  generateSampleChain,
  getDividendYield,
  mulberry32,
  sampleSeed,
  sampleSmile,
  timeToExpiryYears,
} from "@/lib/options";

/**
 * Risk-free rate the sample chain is priced with (generateSampleChain hard-codes the same 6.5%).
 * Deliberately not getMarketParams().r: the sample must not shift when the user edits r in settings.
 * useExpirySession returns this rate as the session `r` in sample mode, so analyseStraddle back-solves
 * with the rate the sample was built with.
 *
 * Time convention: the sample is generated in calendar time (like the sample chain), while
 * analyseStraddle measures time in trading time (tradingT). The "IV now/open" it reports for the
 * sample is therefore a trading-time IV, not the calendar-time smile IV the sample was built from,
 * and the theory-decay curve is a trading-time Black-76 curve. Both are self-consistent within the
 * analysis; they are just not expected to reproduce the generator's IV inputs exactly.
 */
export const SAMPLE_SESSION_R = 0.065;
/** Strikes in the anchor chain: the sample chain's default, so its quotes match the Option Chain page. */
const ANCHOR_STRIKES = 41;

const TICK = 0.05;
const tick = (v: number) => Math.max(TICK, Math.round(v / TICK) * TICK);
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface ExpirySampleInput {
  symbol: string;
  expiry: string;
  spot: number;
  /** Instant the sample chain is anchored to (default: now). */
  now?: Date;
  /** Minutes between simulated snapshots (default 3). */
  stepMin?: number;
}

/** The sample chain the session ends on: generateSampleChain at `now` (or at the session end once the contract has expired). */
export function sampleSessionAnchor(o: Pick<ExpirySampleInput, "symbol" | "expiry" | "spot" | "now">) {
  const now = o.now ?? new Date();
  const { end } = sampleSessionWindow(now);
  const at = timeToExpiryYears(o.expiry, now) > 0 ? now : new Date(end);
  return generateSampleChain({ symbol: o.symbol, spot: o.spot, expiry: o.expiry, now: at, strikes: ANCHOR_STRIKES });
}

/** Simulated snapshots over the session window (today after 09:20 IST on a trading day, else the previous session). */
export function simulateExpirySession(o: ExpirySampleInput): ChainSnapshot[] {
  const symbol = String(o?.symbol || "").toUpperCase();
  if (!symbol || !(o.spot > 0) || !o.expiry) return [];
  const now = o.now ?? new Date();
  const { start, end } = sampleSessionWindow(now);
  if (!(end > start)) return [];
  if (!(timeToExpiryYears(o.expiry, new Date(start)) > 0)) return [];
  const anchor = sampleSessionAnchor({ symbol, expiry: o.expiry, spot: o.spot, now });
  const rows = anchor.chain.slice().sort((a, b) => a.strikePrice - b.strikePrice);
  if (rows.length === 0) return [];

  const r = SAMPLE_SESSION_R;
  const q = getDividendYield(symbol);
  const stepMs = Math.max(1, o.stepMin ?? 3) * 60_000;
  const times: number[] = [];
  for (let t = start; t < end; t += stepMs) times.push(t);
  times.push(end);
  const n = times.length;
  const rand = mulberry32(sampleSeed(symbol, o.expiry, start / 60_000));
  const gauss = gaussianSource(rand);

  // ATM IV of the anchor chain; the session opens a little richer and eases into it.
  const anchorT = Math.max(timeToExpiryYears(o.expiry, now), 1 / (365 * 24));
  const chainAtm = atmIV(rows, forwardFromSpot(o.spot, anchorT, r, q));
  const ivEnd = Number.isFinite(chainAtm) && chainAtm > 0 ? chainAtm / 100 : defaultSampleIv(symbol);
  const openDrift = 0.02 + 0.04 * rand();
  const atmIvs = times.map((_, i) => {
    const w = n > 1 ? i / (n - 1) : 1;
    return ivEnd * (1 + openDrift * (1 - w) + 0.006 * gauss() * (1 - w));
  });
  atmIvs[n - 1] = ivEnd;

  // Spot: a mean-reverting walk in session time that ends exactly on the anchor spot.
  const sdStep = ivEnd * Math.sqrt(stepMs / 60_000 / (252 * 375));
  const walk: number[] = [0];
  for (let i = 1; i < n; i++) walk.push(walk[i - 1] * 0.985 + gauss() * sdStep);
  const shift = walk[n - 1];
  const spots = walk.map((x) => o.spot * Math.exp(x - shift));
  spots[n - 1] = o.spot;

  // U-shaped cumulative volume weights.
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 1;
    w.push((0.4 + 6 * (u - 0.5) ** 2) * (0.7 + 0.6 * rand()));
  }
  const totW = w.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const cumW = w.map((x) => (acc += x) / totW);

  // Model price on the sample smile at snapshot i (calendar time, like generateSampleChain).
  const model = (i: number, K: number, side: "CE" | "PE") => {
    const T = Math.max(timeToExpiryYears(o.expiry, new Date(times[i])), 1 / (365 * 24 * 60));
    const F = forwardFromSpot(spots[i], T, r, q);
    const z = Math.log(K / F) / Math.max(atmIvs[i] * Math.sqrt(T), 1e-6);
    const sigma = sampleSmile(atmIvs[i], z);
    return { price: black76Price({ F, K, T, r, sigma, type: side }), sigma };
  };

  // Per-leg offsets so the model path lands exactly on the anchor quote.
  const legs = rows.flatMap((row) =>
    (["CE", "PE"] as const).map((side) => {
      const leg = side === "CE" ? row.ce : row.pe;
      const endModel = model(n - 1, row.strikePrice, side);
      return {
        K: row.strikePrice,
        side,
        leg,
        priceOffset: leg.ltp - endModel.price,
        ivOffset: leg.iv - endModel.sigma * 100,
        spreadPct: leg.ltp > 0 && leg.askPrice > leg.bidPrice ? (leg.askPrice - leg.bidPrice) / leg.ltp : 0.01,
        openOi: Math.max(0, leg.oi - leg.oiChange),
      };
    }),
  );

  const snaps: ChainSnapshot[] = [];
  for (let i = 0; i < n; i++) {
    const ts = times[i];
    const last = i === n - 1;
    const wt = n > 1 ? i / (n - 1) : 1;
    const out: StrikeSnap[] = legs.map((l) => {
      if (last) {
        return { strike: l.K, side: l.side, ltp: l.leg.ltp, oi: l.leg.oi, vol: l.leg.volume, iv: l.leg.iv, bid: l.leg.bidPrice, ask: l.leg.askPrice };
      }
      const m = model(i, l.K, l.side);
      const ltp = r2(tick(m.price + l.priceOffset * wt));
      const spread = tick(Math.max(TICK, ltp * l.spreadPct));
      const bid = r2(Math.max(TICK, tick(ltp - spread / 2)));
      const ask = r2(tick(bid + spread));
      const oi = Math.max(0, Math.round(l.openOi + (l.leg.oi - l.openOi) * cumW[i]));
      const vol = Math.round(l.leg.volume * cumW[i]);
      return { strike: l.K, side: l.side, ltp, oi, vol, iv: r2(m.sigma * 100 + l.ivOffset * wt), bid, ask };
    });
    snaps.push({ id: `${symbol}|${o.expiry}|${ts}|sample`, symbol, expiry: o.expiry, ts, spot: last ? o.spot : r2(spots[i]), rows: out });
  }
  return snaps;
}
