/**
 * Volatility screener helpers (pure, node-safe): which expiry to compare, the ATM IV of a chain,
 * ranking by day-on-day IV change and CSV export. IV values are in PERCENT.
 */
import type { OptionData } from "@/lib/mockData";
import { atmIV, calendarDaysBetween, chainForward, enrichChain, getContractSpec, getMarketParams, istDateString, timeToExpiryYears } from "@/lib/options";

export const SCREENER_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"] as const;

/** About 20 of the most liquid F&O stocks. Review after each NSE F&O list change. */
export const SCREENER_STOCKS = [
  "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "AXISBANK", "KOTAKBANK", "BHARTIARTL", "LT",
  "ITC", "BAJFINANCE", "TATASTEEL", "MARUTI", "SUNPHARMA", "HINDUNILVR", "M&M", "HCLTECH", "ADANIENT", "WIPRO",
] as const;

export const SCREENER_UNIVERSE: string[] = [...SCREENER_INDICES, ...SCREENER_STOCKS];

export type IvChangeSource = "snapshot" | "bhavcopy";

export interface ScreenerRow {
  symbol: string;
  kind: "INDEX" | "STOCK";
  expiry: string;
  spot: number;
  /** Current ATM IV, percent. */
  iv: number;
  /** Previous session ATM IV for the same expiry, percent (null when unknown). */
  prevIv: number | null;
  prevSource: IvChangeSource | null;
  /** iv − prevIv in vol points. */
  change: number | null;
  /** Relative change in percent. */
  changePct: number | null;
  /** True when the chain was the labelled sample fallback. */
  sample: boolean;
  asOf: number;
}

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function symbolKind(symbol: string): "INDEX" | "STOCK" {
  const spec = getContractSpec(symbol);
  if (spec) return spec.kind;
  return (SCREENER_INDICES as readonly string[]).includes(symbol.toUpperCase()) ? "INDEX" : "STOCK";
}

/** First expiry at least `minDays` calendar days away (falls back to the last one), so the IV is not expiry-week noise. */
export function pickScreenerExpiry(expiries: string[], now: Date = new Date(), minDays = 7): string {
  const today = istDateString(now);
  const sorted = (expiries ?? []).filter(Boolean).slice().sort();
  const live = sorted.filter((e) => calendarDaysBetween(today, e) >= 0);
  return live.find((e) => calendarDaysBetween(today, e) >= minDays) ?? live[live.length - 1] ?? "";
}

/** ATM IV (percent) of a chain on the parity forward, with missing leg IVs solved by Black-76. */
export function chainAtmIv(chain: OptionData[], spot: number, expiry: string, now: Date = new Date(), r: number = getMarketParams().r): number {
  const T = timeToExpiryYears(expiry, now);
  if (!Array.isArray(chain) || chain.length === 0 || !finitePos(spot) || !finitePos(T)) return NaN;
  const F = chainForward(chain, spot, T, r);
  const enriched = enrichChain(chain, { spot, expiry, now, r, forward: F });
  const iv = atmIV(enriched, F);
  return finitePos(iv) ? r2(iv) : NaN;
}

export function withChange(row: Omit<ScreenerRow, "change" | "changePct">): ScreenerRow {
  const ok = finitePos(row.iv) && row.prevIv !== null && finitePos(row.prevIv);
  return {
    ...row,
    change: ok ? r2(row.iv - (row.prevIv as number)) : null,
    changePct: ok ? r2(((row.iv - (row.prevIv as number)) / (row.prevIv as number)) * 100) : null,
  };
}

/** Top IV gainers and losers by vol-point change (sample rows are excluded). */
export function rankByIvChange(rows: ScreenerRow[], n = 5): { gainers: ScreenerRow[]; losers: ScreenerRow[] } {
  const usable = (rows ?? []).filter((r) => !r.sample && r.change !== null && Number.isFinite(r.change));
  const gainers = usable.filter((r) => (r.change as number) > 0).sort((a, b) => (b.change as number) - (a.change as number)).slice(0, n);
  const losers = usable.filter((r) => (r.change as number) < 0).sort((a, b) => (a.change as number) - (b.change as number)).slice(0, n);
  return { gainers, losers };
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SCREENER_CSV_HEADER = "symbol,kind,expiry,spot,atm_iv_pct,prev_atm_iv_pct,change_vol_pts,change_pct,prev_source,data,as_of_ist";

export function screenerCsv(rows: ScreenerRow[], fmtTime: (ts: number) => string = (ts) => new Date(ts).toISOString()): string {
  const lines = [SCREENER_CSV_HEADER];
  for (const r of rows ?? []) {
    lines.push(
      [r.symbol, r.kind, r.expiry, r.spot, r.iv, r.prevIv, r.change, r.changePct, r.prevSource, r.sample ? "sample" : "market", fmtTime(r.asOf)].map(csvCell).join(","),
    );
  }
  return lines.join("\n");
}
