/**
 * HIRO-style hedging pressure, estimated from derived interval prints.
 *
 * For every print, the option writers are assumed to be short the change in open interest (the
 * same India seller view the GEX page defaults to). To stay delta-neutral they trade futures:
 *
 *   hedge flow (₹ Cr) = Σ dOI × Δ × lot size × spot / 1e7
 *
 *   + new call OI  → writers short call delta → they BUY futures   (positive, supportive)
 *   + new put OI   → writers long delta (short put) → they SELL futures (negative, pressure)
 *   − OI (closing) → the hedge unwinds, with the opposite sign.
 *
 * Δ is the Black-76 spot delta at the print's LTP-implied volatility (falls back to 15% when the
 * LTP cannot be inverted), on the dividend-adjusted forward F = S·e^((r−q)T) the rest of the
 * options core uses.
 *
 * OI unit: NSE reports OI in contracts, so dOI is multiplied by the lot size. Some broker feeds
 * report OI in quantity (units); then dOI already counts units and the lot multiplier is skipped.
 * The unit can be passed explicitly (`oiUnit`) or is inferred from the prints the same way the GEX
 * page infers it from a chain (quantity changes are always whole multiples of the lot size). This is a model of hedging, not observed dealer trades: NSE publishes
 * no trade-level data and no dealer books.
 */
import { forwardFromSpot, getDividendYield, getMarketParams, greeks76Spot, impliedVol76, timeToExpiryYears } from "@/lib/options";
import type { FlowPrint } from "./types";

export type HedgePrint = Pick<
  FlowPrint,
  "ts" | "symbol" | "expiry" | "strike" | "type" | "ltp" | "dOI" | "dte" | "spot" | "lotSize"
>;

export interface HedgePoint {
  /** Bucket start, epoch ms. */
  ts: number;
  /** Cumulative call-driven hedge flow, ₹ Cr. */
  calls: number;
  /** Cumulative put-driven hedge flow, ₹ Cr. */
  puts: number;
  /** Cumulative flow from 0DTE contracts only (calls and puts), ₹ Cr. Also inside calls / puts. */
  zeroDte: number;
  /** calls + puts, ₹ Cr. */
  total: number;
  /** Underlying at the bucket close. */
  spot?: number;
}

export interface HedgeSummary {
  calls: number;
  puts: number;
  zeroDte: number;
  total: number;
  prints: number;
  firstSpot: number | null;
  lastSpot: number | null;
  /** Spot change since the first print, percent. NaN without spot. */
  spotChangePct: number;
}

/** "contracts" (NSE) or "qty" (OI reported in units by some broker feeds). */
export type OiUnit = "contracts" | "qty";

export const FALLBACK_IV = 0.15;
const CRORE = 1e7;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Spot delta of a print's contract at its LTP-implied vol. Expired (T = 0) contracts get their
 * intrinsic delta. Returns 0 for unusable inputs.
 */
export function printDelta(
  p: Pick<HedgePrint, "ts" | "expiry" | "strike" | "type" | "ltp" | "spot"> & { symbol?: string },
  o: { r?: number; q?: number; fallbackIv?: number } = {},
): number {
  const S = p?.spot;
  const K = p?.strike;
  if (!fin(S) || S <= 0 || !fin(K) || K <= 0) return 0;
  const T = timeToExpiryYears(p.expiry, new Date(p.ts));
  if (!fin(T)) return 0;
  if (T <= 0) {
    if (p.type === "CE") return S > K ? 1 : 0;
    return S < K ? -1 : 0;
  }
  const r = fin(o.r) ? o.r : getMarketParams().r;
  const q = fin(o.q) ? o.q : p.symbol ? getDividendYield(p.symbol) : 0;
  const F = forwardFromSpot(S, T, r, fin(q) ? q : 0);
  let sigma = fin(p.ltp) && p.ltp > 0 ? impliedVol76(p.ltp, { F, K, T, r, type: p.type }) : NaN;
  if (!fin(sigma) || sigma <= 0) sigma = fin(o.fallbackIv) && o.fallbackIv > 0 ? o.fallbackIv : FALLBACK_IV;
  const d = greeks76Spot({ F, K, T, r, sigma, type: p.type }, S).delta;
  return fin(d) ? d : 0;
}

/**
 * Guess the OI unit behind a set of prints. Quantity-based dOI is always a whole multiple of the
 * lot size; contract dOI is a multiple only by chance (about 1 in lotSize). Needs at least 12
 * non-zero prints with a lot size of 2 or more; otherwise assumes contracts (NSE).
 */
export function inferPrintOiUnit(prints: Array<Pick<HedgePrint, "dOI" | "lotSize">> | undefined): OiUnit {
  let n = 0;
  let multiples = 0;
  for (const p of Array.isArray(prints) ? prints : []) {
    if (!p || !fin(p.dOI) || p.dOI === 0 || !fin(p.lotSize) || p.lotSize < 2) continue;
    n++;
    const k = p.dOI / p.lotSize;
    if (Math.abs(k - Math.round(k)) < 1e-9) multiples++;
  }
  if (n < 12) return "contracts";
  return multiples / n >= 0.95 ? "qty" : "contracts";
}

/**
 * Hedge flow of one print in ₹ Cr given its delta (positive = writers buy futures). dOI is in
 * contracts by default (× lot size); pass oiUnit "qty" when the feed reports OI in units.
 */
export function hedgeFlowCr(p: Pick<HedgePrint, "dOI" | "lotSize" | "spot">, delta: number, oiUnit: OiUnit = "contracts"): number {
  if (!fin(p?.dOI) || !fin(delta) || !fin(p.spot) || p.spot <= 0) return 0;
  const lot = oiUnit === "qty" ? 1 : fin(p.lotSize) && p.lotSize > 0 ? p.lotSize : 1;
  return (p.dOI * delta * lot * p.spot) / CRORE;
}

export interface HedgeSeriesOptions {
  /** Keep only this underlying (spot is only meaningful per underlying). */
  symbol?: string;
  /** Bucket width, ms. Default 5 minutes; 0 keeps one point per print time. */
  bucketMs?: number;
  r?: number;
  /** Dividend yield override; defaults to getDividendYield(print.symbol). */
  q?: number;
  fallbackIv?: number;
  /** OI unit of the snapshot source; inferred from the prints when omitted. */
  oiUnit?: OiUnit;
}

function usable(prints: HedgePrint[] | undefined, symbol?: string): HedgePrint[] {
  const sym = symbol ? symbol.toUpperCase() : "";
  return (Array.isArray(prints) ? prints : []).filter(
    (p) => p && fin(p.ts) && fin(p.dOI) && p.dOI !== 0 && (!sym || p.symbol === sym),
  );
}

/** Cumulative intraday hedge-flow series (oldest first). */
export function hedgePressureSeries(prints: HedgePrint[], o: HedgeSeriesOptions = {}): HedgePoint[] {
  const bucketMs = o.bucketMs ?? 5 * 60_000;
  const deltaCache = new Map<string, number>();
  const buckets = new Map<number, { calls: number; puts: number; zeroDte: number; spot?: number; spotTs: number }>();
  const rows = usable(prints, o.symbol);
  const unit: OiUnit = o.oiUnit ?? inferPrintOiUnit(rows);
  for (const p of rows) {
    const key = `${p.expiry}|${p.strike}|${p.type}|${p.ts}`;
    let d = deltaCache.get(key);
    if (d === undefined) {
      d = printDelta(p, o);
      deltaCache.set(key, d);
    }
    const flow = hedgeFlowCr(p, d, unit);
    const t = bucketMs > 0 ? Math.floor(p.ts / bucketMs) * bucketMs : p.ts;
    let b = buckets.get(t);
    if (!b) {
      b = { calls: 0, puts: 0, zeroDte: 0, spotTs: -1 };
      buckets.set(t, b);
    }
    if (p.type === "CE") b.calls += flow;
    else b.puts += flow;
    if (p.dte === 0) b.zeroDte += flow;
    if (p.ts >= b.spotTs && fin(p.spot) && p.spot > 0) {
      b.spot = p.spot;
      b.spotTs = p.ts;
    }
  }
  let calls = 0;
  let puts = 0;
  let zeroDte = 0;
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => {
      calls += b.calls;
      puts += b.puts;
      zeroDte += b.zeroDte;
      const pt: HedgePoint = { ts, calls, puts, zeroDte, total: calls + puts };
      if (b.spot !== undefined) pt.spot = b.spot;
      return pt;
    });
}

/** Totals for the session from a cumulative series. */
export function hedgePressureSummary(series: HedgePoint[], prints = 0): HedgeSummary {
  const last = series[series.length - 1];
  const spots = series.map((p) => p.spot).filter((s): s is number => fin(s) && s > 0);
  const firstSpot = spots[0] ?? null;
  const lastSpot = spots[spots.length - 1] ?? null;
  return {
    calls: last?.calls ?? 0,
    puts: last?.puts ?? 0,
    zeroDte: last?.zeroDte ?? 0,
    total: last?.total ?? 0,
    prints,
    firstSpot,
    lastSpot,
    spotChangePct: firstSpot && lastSpot ? ((lastSpot - firstSpot) / firstSpot) * 100 : NaN,
  };
}

/** Count of prints that carry an OI change for the symbol (what the series is built from). */
export function hedgePrintCount(prints: HedgePrint[], symbol?: string): number {
  return usable(prints, symbol).length;
}

/**
 * One-line reading of the session's hedge flow. "Small" when |total| is under 2% of the gross
 * call + put flow (they roughly cancel).
 */
export function hedgePressureReading(s: HedgeSummary, fmtCr: (v: number) => string): string {
  if (s.prints === 0) return "No open-interest changes yet, so there is no hedging estimate.";
  const gross = Math.abs(s.calls) + Math.abs(s.puts);
  if (!(gross > 0) || Math.abs(s.total) < gross * 0.02) {
    return `Call and put hedging roughly cancel (net ${fmtCr(s.total)}): no strong push from option writers today.`;
  }
  const buying = s.total > 0;
  const side = buying ? "buyers" : "sellers";
  const lead = buying
    ? s.calls >= Math.abs(s.puts)
      ? "fresh call writing"
      : "put unwinding"
    : Math.abs(s.puts) >= Math.abs(s.calls)
      ? "fresh put writing"
      : "call unwinding";
  let withSpot = "";
  if (Number.isFinite(s.spotChangePct) && Math.abs(s.spotChangePct) >= 0.05) {
    const spotUp = s.spotChangePct > 0;
    withSpot = spotUp === buying ? ", in the same direction as spot" : ", leaning against the spot move";
  }
  return `Writers' estimated hedges are net ${side} of about ${fmtCr(Math.abs(s.total))} of futures, led by ${lead}${withSpot}.`;
}
