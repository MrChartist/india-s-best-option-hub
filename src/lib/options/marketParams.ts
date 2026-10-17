/** Market parameters (risk-free rate, dividend yield, day count), user-overridable. */
import type { MarketParams } from "./types";

export const DEFAULT_MARKET_PARAMS: MarketParams = { r: 0.065, q: 0, dayCount: "ACT365" };

const STORAGE_KEY = "mc_market_params";

/** Annual dividend yields (decimal) for index underlyings. Indicative; verify periodically. */
export const DIVIDEND_YIELD: Record<string, number> = {
  NIFTY: 0.013,
  BANKNIFTY: 0.009,
  SENSEX: 0.012,
};

export function getDividendYield(symbol: string): number {
  return DIVIDEND_YIELD[(symbol || "").toUpperCase()] ?? 0;
}

function sanitize(p: Partial<MarketParams> | null | undefined, base: MarketParams): MarketParams {
  const out: MarketParams = { ...base };
  if (p && typeof p === "object") {
    if (typeof p.r === "number" && Number.isFinite(p.r) && p.r > -0.5 && p.r < 1) out.r = p.r;
    if (typeof p.q === "number" && Number.isFinite(p.q) && p.q > -0.5 && p.q < 1) out.q = p.q;
    if (p.dayCount === "ACT365" || p.dayCount === "TRADING252") out.dayCount = p.dayCount;
  }
  return out;
}

function storage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage ?? null;
    }
  } catch {
    /* storage blocked */
  }
  return null;
}

export function getMarketParams(): MarketParams {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MARKET_PARAMS };
    return sanitize(JSON.parse(raw) as Partial<MarketParams>, DEFAULT_MARKET_PARAMS);
  } catch {
    return { ...DEFAULT_MARKET_PARAMS };
  }
}

export function setMarketParams(p: Partial<MarketParams>): MarketParams {
  const next = sanitize(p, getMarketParams());
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / privacy errors */
  }
  return next;
}
