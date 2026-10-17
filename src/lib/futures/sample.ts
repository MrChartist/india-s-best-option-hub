/**
 * Deterministic SAMPLE futures history for the Futures page when the NSE bhavcopy is unreachable.
 * Clearly labelled "sample" in the UI; never stored and never mixed with market data.
 *
 * Model: the underlying follows a seeded random walk; each monthly contract trades at
 * spot × e^{(r − q)·t} plus a small seeded mispricing; total futures OI drifts, and the share held
 * in the next and far months (rollover) rises through the cycle, sharply in the last week.
 */
import {
  addCalendarDays,
  getDividendYield,
  getMarketParams,
  isTradingDay,
  previousTradingDay,
  tradingDaysBetween,
  calendarDaysBetween,
} from "@/lib/options";
import { sampleRows, seededRandom } from "@/lib/screener/sample";
import { monthlyExpiriesBetween, type FuturesDay } from "./model";

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const SAMPLE_INDEX_OI: Record<string, number> = {
  NIFTY: 1_65_000,
  BANKNIFTY: 1_10_000,
  FINNIFTY: 18_000,
  MIDCPNIFTY: 22_000,
};

let spotCache: Map<string, number> | null = null;
/** Sessions generated for every sample history, so the overview and the detail view agree. */
export const SAMPLE_SESSIONS = 90;

/** Sample spot for a symbol (matches the screener's sample rows). */
export function sampleSpot(symbol: string): number {
  spotCache ??= new Map(sampleRows().map((r) => [r.symbol, r.ltp]));
  return spotCache.get(symbol) ?? r2(200 + (hash(symbol) % 3800));
}

/** The last `count` trading days ending on or before `end`, ascending. */
export function tradingDaysBack(end: string, count: number): string[] {
  const out: string[] = [];
  let d = isTradingDay(end) ? end : previousTradingDay(end);
  for (let i = 0; i < count; i++) {
    out.push(d);
    d = previousTradingDay(d);
  }
  return out.reverse();
}

/**
 * Sample futures days for `symbol`, `sessions` trading days ending at `end` (ascending).
 * Same output for the same arguments.
 */
export function sampleFuturesHistory(
  symbol: string,
  end: string,
  sessions = SAMPLE_SESSIONS,
  seed = 20261017,
): FuturesDay[] {
  const dates = tradingDaysBack(end, Math.max(2, Math.min(300, Math.floor(sessions))));
  const rnd = seededRandom(hash(symbol) ^ seed);
  const isIndex = symbol in SAMPLE_INDEX_OI;
  const r = getMarketParams().r;
  const q = getDividendYield(symbol);
  const dailyVol = (isIndex ? 0.13 : 0.26) / Math.sqrt(252);
  const baseOi = isIndex ? SAMPLE_INDEX_OI[symbol] : Math.round(8_000 + rnd() * 60_000);

  // Walk the spot backwards from today's sample spot so the latest day matches the screener.
  const spots: number[] = new Array(dates.length);
  spots[dates.length - 1] = sampleSpot(symbol);
  for (let i = dates.length - 2; i >= 0; i--)
    spots[i] = r2(spots[i + 1] / Math.exp((rnd() - 0.5) * 2 * dailyVol * 1.7));

  const expiries = monthlyExpiriesBetween(symbol, dates[0], addCalendarDays(end, 120));
  const cycleNoise = new Map(expiries.map((e) => [e, { roll: 0.78 + rnd() * 0.14, mis: (rnd() - 0.5) * 0.002 }]));
  const prevOi = new Map<string, number>();
  let totalOi = baseOi;
  const out: FuturesDay[] = [];

  dates.forEach((date, i) => {
    const live = expiries.filter((e) => e >= date).slice(0, 3);
    if (live.length === 0) return;
    const S = spots[i];
    totalOi = Math.max(baseOi * 0.6, totalOi * (1 + (rnd() - 0.48) * 0.05));
    const near = live[0];
    const tdte = Math.max(0, tradingDaysBetween(date, near));
    const target = cycleNoise.get(near)?.roll ?? 0.85;
    // Rollover share: ~8–12% early in the cycle, climbing to ~80–90% by expiry day.
    const rolled = Math.min(0.95, 0.09 + (target - 0.09) * Math.exp(-tdte / 3.4) + rnd() * 0.015);
    const farShare = 0.04 + rnd() * 0.03;
    const shares = [1 - rolled, rolled * (1 - farShare), rolled * farShare];
    const contracts = live.map((expiry, k) => {
      const days = Math.max(0, calendarDaysBetween(date, expiry));
      const mis = cycleNoise.get(expiry)?.mis ?? 0;
      const price = r2(S * Math.exp((r - q) * (days / 365)) * (1 + mis + (rnd() - 0.5) * 0.0006));
      const oi = Math.max(0, Math.round(totalOi * shares[k]));
      const before = prevOi.get(expiry);
      const chgOi = before === undefined ? oi : oi - before;
      prevOi.set(expiry, oi);
      const volume = Math.round(oi * (k === 0 ? 0.6 + rnd() * 0.9 : 0.15 + rnd() * 0.3) * (tdte <= 5 ? 1.8 : 1));
      return { expiry, price, oi, chgOi, volume };
    });
    out.push({ symbol, date, underlying: S, contracts });
  });
  return out;
}
