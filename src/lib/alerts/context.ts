/**
 * Context builders for the newer rule types: per-strike quotes, the session's Premium Tide and the
 * open-positions snapshot. All pure; the runtime feeds them real (non-sample) chains only.
 */
import type { OptionData } from "@/lib/mockData";
import type { FlowPrint } from "@/lib/flow/types";
import { premiumTide } from "@/lib/flow/premiumTide";
import { positionExpiryIso, sideSign, type TrackedPosition } from "@/lib/positionStore";
import { ANY_SYMBOL, type PortfolioSnapshot, type StrikeQuote } from "./types";

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const num = (x: unknown): number => (finite(x) ? x : NaN);

export function strikeQuotes(chain: OptionData[]): StrikeQuote[] {
  return (chain ?? [])
    .filter((r) => r && finite(r.strikePrice))
    .map((r) => ({
      strike: r.strikePrice,
      ce: { ltp: num(r.ce?.ltp), iv: num(r.ce?.iv), oiChange: num(r.ce?.oiChange) },
      pe: { ltp: num(r.pe?.ltp), iv: num(r.pe?.iv), oiChange: num(r.pe?.oiChange) },
    }));
}

/** Latest net Premium Tide (₹) for one underlying's prints; undefined without prints. */
export function latestTideNet(prints: FlowPrint[], symbol: string): number | undefined {
  const own = (prints ?? []).filter((p) => p?.symbol === symbol);
  if (own.length === 0) return undefined;
  const pts = premiumTide(own, { bucketMs: 0 });
  const last = pts[pts.length - 1];
  return last && finite(last.net) ? last.net : undefined;
}

/** A live chain the portfolio builder can mark legs from. */
export interface MarkFeed {
  symbol: string;
  expiry: string;
  asOf: number;
  chain: OptionData[];
}

/**
 * Portfolio snapshots keyed by underlying plus ANY (all positions). A leg is "marked" only when a
 * live chain for its exact expiry has a traded price for its strike; Greeks come from the same row.
 */
export function buildPortfolio(positions: TrackedPosition[], feeds: MarkFeed[]): Record<string, PortfolioSnapshot> {
  const out: Record<string, PortfolioSnapshot> = {};
  const add = (key: string, d: Omit<PortfolioSnapshot, "ts"> & { ts: number }) => {
    const p = (out[key] ??= { pnl: 0, delta: 0, gamma: 0, theta: 0, vega: 0, legs: 0, marked: 0, ts: Infinity });
    p.pnl += d.pnl;
    p.delta += d.delta;
    p.gamma += d.gamma;
    p.theta += d.theta;
    p.vega += d.vega;
    p.legs += d.legs;
    p.marked += d.marked;
    p.ts = Math.min(p.ts, d.ts);
  };
  const bySymbol = new Map(feeds.map((f) => [f.symbol.toUpperCase(), f]));
  for (const pos of positions ?? []) {
    if (!pos || !(pos.lots > 0) || !(pos.lotSize > 0)) continue;
    const sym = pos.symbol.toUpperCase();
    const f = bySymbol.get(sym);
    const row =
      f && f.expiry === positionExpiryIso(pos) ? f.chain.find((r) => r.strikePrice === pos.strike) : undefined;
    const leg = row ? (pos.type === "CE" ? row.ce : row.pe) : undefined;
    const qty = sideSign(pos.action) * pos.lots * pos.lotSize;
    const marked = !!leg && finite(leg.ltp) && leg.ltp > 0;
    const d = marked
      ? {
          pnl: (leg.ltp - pos.entryPrice) * qty,
          delta: finite(leg.delta) ? leg.delta * qty : 0,
          gamma: finite(leg.gamma) ? leg.gamma * qty : 0,
          theta: finite(leg.theta) ? leg.theta * qty : 0,
          vega: finite(leg.vega) ? leg.vega * qty : 0,
          legs: 1,
          marked: 1,
          ts: f!.asOf,
        }
      : { pnl: 0, delta: 0, gamma: 0, theta: 0, vega: 0, legs: 1, marked: 0, ts: Infinity };
    add(sym, d);
    add(ANY_SYMBOL, d);
  }
  for (const p of Object.values(out)) if (!finite(p.ts)) p.ts = 0;
  return out;
}
