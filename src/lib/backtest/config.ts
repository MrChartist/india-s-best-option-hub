/**
 * Form settings for the backtester: defaults, validation of saved settings, the date window and the
 * hand-off of a trade's entry legs to the Strategy Builder basket format.
 */
import type { BasketLeg } from "@/components/option-chain/basket";
import { BROKER_PRESETS } from "@/lib/options";
import { getTemplate } from "@/lib/strategyTemplates";
import { SAMPLE_RANGE } from "./sampleData";
import type { BacktestConfig, EntryTiming, ExpirySeries, StrikeMode, Trade } from "./types";

export const BACKTEST_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"] as const;

export type DataChoice = "sample" | "bhavcopy";

export const PERIOD_MONTHS = [3, 6, 12] as const;

/** Everything on the form. `from`/`to` are derived from `months` and the data source at run time. */
export interface BacktestSettings extends Omit<BacktestConfig, "from" | "to"> {
  months: number;
  data: DataChoice;
}

export const DEFAULT_SETTINGS: BacktestSettings = {
  symbol: "NIFTY",
  templateId: "short-strangle",
  lots: 1,
  series: "nearest",
  timing: "dte",
  dte: 7,
  weekdays: [],
  strikeMode: "delta",
  atmOffset: 2,
  delta: 0.2,
  premium: 40,
  profitPct: 50,
  stopPct: 100,
  maxDaysHeld: null,
  exitDte: null,
  brokerId: "zerodha",
  slippagePct: 1,
  capital: 500_000,
  months: 12,
  data: "sample",
};

const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const optNum = (v: unknown, lo: number, hi: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo ? Math.min(hi, n) : null;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], dflt: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : dflt);

/** Validate settings read from storage or a URL; anything missing or out of range takes the default. */
export function parseSettings(raw: unknown): BacktestSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const templateId = typeof r.templateId === "string" && getTemplate(r.templateId) ? r.templateId : d.templateId;
  const weekdays = Array.isArray(r.weekdays) ? [...new Set(r.weekdays.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 5))].sort() : d.weekdays;
  return {
    symbol: oneOf(r.symbol, BACKTEST_SYMBOLS, "NIFTY"),
    templateId,
    lots: Math.round(num(r.lots, 1, 500, d.lots)),
    series: oneOf<ExpirySeries>(r.series, ["nearest", "monthly"], d.series),
    timing: oneOf<EntryTiming>(r.timing, ["dte", "weekday"], d.timing),
    dte: Math.round(num(r.dte, 1, 90, d.dte)),
    weekdays,
    strikeMode: oneOf<StrikeMode>(r.strikeMode, ["template", "atm", "delta", "premium"], d.strikeMode),
    atmOffset: Math.round(num(r.atmOffset, 0, 40, d.atmOffset)),
    delta: num(r.delta, 0.02, 0.9, d.delta),
    premium: num(r.premium, 0.05, 100_000, d.premium),
    profitPct: "profitPct" in r ? optNum(r.profitPct, 1, 10_000) : d.profitPct,
    stopPct: "stopPct" in r ? optNum(r.stopPct, 1, 10_000) : d.stopPct,
    maxDaysHeld: "maxDaysHeld" in r ? optNum(r.maxDaysHeld, 1, 90) : d.maxDaysHeld,
    exitDte: "exitDte" in r ? optNum(r.exitDte, 0, 90) : d.exitDte,
    brokerId: typeof r.brokerId === "string" && BROKER_PRESETS.some((b) => b.id === r.brokerId) ? r.brokerId : d.brokerId,
    slippagePct: num(r.slippagePct, 0, 20, d.slippagePct),
    capital: num(r.capital, 10_000, 1e10, d.capital),
    months: oneOf(String(r.months), PERIOD_MONTHS.map(String), String(d.months)) === String(r.months) ? Number(r.months) : d.months,
    data: oneOf<DataChoice>(r.data, ["sample", "bhavcopy"], d.data),
  };
}

/** Date window for the sample dataset: the last `months` of SAMPLE_RANGE. */
export function sampleWindow(months: number): { from: string; to: string } {
  const to = SAMPLE_RANGE.to;
  const y = +to.slice(0, 4);
  const m = +to.slice(5, 7) - Math.max(1, Math.round(months));
  const fy = y + Math.floor((m - 1) / 12);
  const fm = ((((m - 1) % 12) + 12) % 12) + 1;
  const from = `${fy}-${String(fm).padStart(2, "0")}-${to.slice(8, 10)}`;
  return { from: from < SAMPLE_RANGE.from ? SAMPLE_RANGE.from : from, to };
}

/** Engine config from form settings and a date window. */
export function toConfig(s: BacktestSettings, window: { from: string; to: string }): BacktestConfig {
  const { months: _m, data: _d, ...rest } = s;
  return { ...rest, from: window.from, to: window.to };
}

/**
 * Entry legs of a trade in the shared basket format (premium = entry fill, iv decimal). Futures legs
 * are left out because the basket carries options only; the second value says how many were dropped.
 */
export function tradeToBasketLegs(t: Trade, symbol: string): { legs: BasketLeg[]; droppedFutures: number } {
  const legs: BasketLeg[] = [];
  let droppedFutures = 0;
  for (const l of t.legs) {
    if (l.type === "FUT") {
      droppedFutures += 1;
      continue;
    }
    legs.push({ symbol, expiry: l.expiry, strike: l.strike, type: l.type, side: l.side, lots: l.lots, premium: l.entry, iv: l.iv ?? null });
  }
  return { legs, droppedFutures };
}
