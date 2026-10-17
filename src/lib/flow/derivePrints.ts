/**
 * derivePrints: turn two successive chain snapshots into interval "prints".
 *
 * For every contract whose cumulative volume rose between `prev` and `curr`:
 *   dVol      = curr.vol − prev.vol                     (contracts)
 *   premium   = dVol × ltp × lotSize                    (₹)
 *   aggressor = where the LTP sits inside the bid/ask   (ASK ≥ 75% of the spread, BID ≤ 25%, else MID)
 *               falling back to a tick test vs the previous LTP when there is no usable quote
 *   tag       = OPENING if OI rose by at least `minOiShare` of dVol, CLOSING if it fell by that much,
 *               UNKNOWN otherwise (churn: volume traded without a matching OI change)
 *
 * This is an approximation built from snapshots, not trade-level data.
 */
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";
import { istDateString, normalizeExpiry } from "@/lib/options";
import type { Aggressor, FlowPrint, Moneyness, PrintTag } from "./types";

export interface DeriveOptions {
  /** Share of dVol that |dOI| must reach before a print is tagged OPENING/CLOSING. Default 0.1. */
  minOiShare?: number;
  /** Ignore intervals longer than this (ms). Default 30 minutes. */
  maxGapMs?: number;
  /** Drop prints below this many contracts. Default 1. */
  minDVol?: number;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Aggressor from the quote; null when the quote is unusable (missing, crossed or zero-width). */
export function quoteAggressor(ltp: number, bid: number, ask: number): Aggressor | null {
  if (!(ltp > 0) || !(bid > 0) || !(ask > 0) || ask <= bid) return null;
  if (ltp >= ask) return "ASK";
  if (ltp <= bid) return "BID";
  const pos = (ltp - bid) / (ask - bid);
  if (pos >= 0.75) return "ASK";
  if (pos <= 0.25) return "BID";
  return "MID";
}

/** Tick test: uptick = buyer-initiated, downtick = seller-initiated. */
export function tickAggressor(ltp: number, prevLtp: number): Aggressor | null {
  if (!(ltp > 0) || !(prevLtp > 0)) return null;
  if (ltp > prevLtp) return "ASK";
  if (ltp < prevLtp) return "BID";
  return "MID";
}

export function classifyAggressor(curr: Pick<StrikeSnap, "ltp" | "bid" | "ask">, prevLtp: number): { aggressor: Aggressor; basis: FlowPrint["aggressorBasis"] } {
  const q = quoteAggressor(curr.ltp, curr.bid, curr.ask);
  if (q) return { aggressor: q, basis: "quote" };
  const t = tickAggressor(curr.ltp, prevLtp);
  if (t) return { aggressor: t, basis: "tick" };
  return { aggressor: "MID", basis: "none" };
}

export function classifyTag(dOI: number, dVol: number, minOiShare = 0.1): PrintTag {
  if (!finite(dOI) || !finite(dVol) || dVol <= 0) return "UNKNOWN";
  const need = Math.max(1, dVol * Math.max(0, minOiShare));
  if (dOI >= need) return "OPENING";
  if (dOI <= -need) return "CLOSING";
  return "UNKNOWN";
}

/** Strike nearest to spot among the given strikes (NaN when none). */
export function nearestStrike(strikes: number[], spot: number): number {
  let best = NaN;
  let bestD = Infinity;
  for (const k of strikes) {
    const d = Math.abs(k - spot);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

export function classifyMoneyness(strike: number, type: "CE" | "PE", spot: number, atmStrike: number): Moneyness {
  if (!(spot > 0)) return "OTM";
  if (strike === atmStrike) return "ATM";
  if (type === "CE") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}

/** Whole calendar days between two ISO dates (b − a). */
export function calendarDaysBetween(aIso: string, bIso: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(aIso);
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bIso);
  if (!pa || !pb) return NaN;
  const a = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const b = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((b - a) / 86_400_000);
}

export function dteFor(expiry: string, ts: number): number {
  const exp = normalizeExpiry(expiry) || expiry;
  const d = calendarDaysBetween(istDateString(new Date(ts)), exp);
  return finite(d) ? Math.max(0, d) : NaN;
}

const keyOf = (r: Pick<StrikeSnap, "strike" | "side">) => `${r.strike}|${r.side}`;

export function derivePrints(prev: ChainSnapshot, curr: ChainSnapshot, lotSize: number, opts: DeriveOptions = {}): FlowPrint[] {
  if (!prev || !curr || !Array.isArray(prev.rows) || !Array.isArray(curr.rows)) return [];
  if (prev.symbol !== curr.symbol || prev.expiry !== curr.expiry) return [];
  if (!(curr.ts > prev.ts)) return [];
  if (curr.ts - prev.ts > (opts.maxGapMs ?? 30 * 60_000)) return [];
  // Volume and OI reset at the start of each session: never diff across IST dates.
  if (istDateString(new Date(prev.ts)) !== istDateString(new Date(curr.ts))) return [];
  const lot = finite(lotSize) && lotSize > 0 ? lotSize : 1;
  const minDVol = Math.max(1, opts.minDVol ?? 1);
  const before = new Map<string, StrikeSnap>();
  for (const r of prev.rows) before.set(keyOf(r), r);
  const spot = finite(curr.spot) && curr.spot > 0 ? curr.spot : prev.spot;
  const atm = nearestStrike([...new Set(curr.rows.map((r) => r.strike))], spot);
  const dte = dteFor(curr.expiry, curr.ts);
  const out: FlowPrint[] = [];
  for (const r of curr.rows) {
    const p = before.get(keyOf(r));
    if (!p) continue;
    const dVol = (finite(r.vol) ? r.vol : 0) - (finite(p.vol) ? p.vol : 0);
    if (dVol < minDVol) continue;
    const ltp = finite(r.ltp) && r.ltp > 0 ? r.ltp : 0;
    if (ltp <= 0) continue;
    const dOI = (finite(r.oi) ? r.oi : 0) - (finite(p.oi) ? p.oi : 0);
    const { aggressor, basis } = classifyAggressor(r, p.ltp);
    out.push({
      id: `${curr.symbol}|${curr.expiry}|${r.strike}|${r.side}|${curr.ts}`,
      ts: curr.ts,
      fromTs: prev.ts,
      symbol: curr.symbol,
      expiry: curr.expiry,
      strike: r.strike,
      type: r.side,
      dVol,
      premium: dVol * ltp * lot,
      ltp,
      bid: finite(r.bid) ? r.bid : 0,
      ask: finite(r.ask) ? r.ask : 0,
      aggressor,
      aggressorBasis: basis,
      dOI,
      tag: classifyTag(dOI, dVol, opts.minOiShare),
      dte,
      moneyness: classifyMoneyness(r.strike, r.side, spot, atm),
      spot,
      lotSize: lot,
    });
  }
  return out.sort((a, b) => b.premium - a.premium);
}

/** Prints for every consecutive pair in a time-ordered series (newest interval first). */
export function derivePrintsFromSeries(snaps: ChainSnapshot[], lotSize: number, opts?: DeriveOptions): FlowPrint[] {
  const sorted = [...(snaps ?? [])].sort((a, b) => a.ts - b.ts);
  const out: FlowPrint[] = [];
  for (let i = sorted.length - 1; i >= 1; i--) out.push(...derivePrints(sorted[i - 1], sorted[i], lotSize, opts));
  return out;
}

/** Signed premium: ask-side counts as bought (+), bid-side as sold (−), mid as 0. */
export function signedPremium(p: Pick<FlowPrint, "aggressor" | "premium">): number {
  if (p.aggressor === "ASK") return p.premium;
  if (p.aggressor === "BID") return -p.premium;
  return 0;
}
