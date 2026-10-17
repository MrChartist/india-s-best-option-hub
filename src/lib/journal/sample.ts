/**
 * Bundled SAMPLE tradebook in Zerodha's tradebook CSV format, generated deterministically so the
 * journal can be explored without uploading anything. Every number here is made up; the UI labels it.
 *
 * Trades span July to September 2026 on NIFTY (weekly, Tuesday) and BANKNIFTY (monthly): short
 * strangles, iron condors, credit spreads, long options and an expiry-day scalp, priced with Black-76
 * on a seeded random-walk spot so premiums and P&L look realistic.
 */
import { addTradingDays, black76Price, getExpiries, getLotSize, getStrikeStep, isTradingDay, isWeeklyExpiry, timeToExpiryYears, toISTDate, type OptionType, type Side } from "@/lib/options";

export const SAMPLE_TRADEBOOK_NOTE = "Sample tradebook: generated trades for demonstration only, not real executions.";

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKLY_CODE = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "O", "N", "D"];

/** Zerodha trading symbol for an option (weekly or monthly format). */
export function zerodhaSymbol(underlying: string, expiry: string, strike: number, type: OptionType): string {
  const yy = expiry.slice(2, 4);
  const m = +expiry.slice(5, 7) - 1;
  if (isWeeklyExpiry(underlying, expiry)) return `${underlying}${yy}${WEEKLY_CODE[m]}${expiry.slice(8, 10)}${strike}${type}`;
  return `${underlying}${yy}${MONTH[m]}${strike}${type}`;
}

interface Leg {
  type: OptionType;
  side: Side;
  /** Strike offset from ATM in strike steps (+ above, − below). */
  off: number;
}

const STRUCTURES: Array<{ name: string; legs: Leg[]; weight: number; hold: [number, number]; lots: number }> = [
  { name: "short strangle", legs: [{ type: "CE", side: "SELL", off: 6 }, { type: "PE", side: "SELL", off: -6 }], weight: 4, hold: [1, 4], lots: 1 },
  { name: "iron condor", legs: [{ type: "CE", side: "SELL", off: 5 }, { type: "CE", side: "BUY", off: 9 }, { type: "PE", side: "SELL", off: -5 }, { type: "PE", side: "BUY", off: -9 }], weight: 3, hold: [2, 5], lots: 2 },
  { name: "bull put spread", legs: [{ type: "PE", side: "SELL", off: -2 }, { type: "PE", side: "BUY", off: -6 }], weight: 2, hold: [1, 4], lots: 2 },
  { name: "long call", legs: [{ type: "CE", side: "BUY", off: 1 }], weight: 2, hold: [0, 2], lots: 1 },
  { name: "long put", legs: [{ type: "PE", side: "BUY", off: -1 }], weight: 1, hold: [0, 2], lots: 1 },
  { name: "short straddle", legs: [{ type: "CE", side: "SELL", off: 0 }, { type: "PE", side: "SELL", off: 0 }], weight: 2, hold: [0, 1], lots: 1 },
];

/** Generate the sample tradebook CSV (Zerodha columns). Deterministic for a seed. */
export function generateSampleTradebook(seed = 2026): string {
  const rand = rng(seed);
  const header = "symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date";
  const rows: string[] = [header];
  let tradeSeq = 410000;
  let orderSeq = 1300000;
  const spots: Record<string, number> = { NIFTY: 24600, BANKNIFTY: 54800 };
  const vols: Record<string, number> = { NIFTY: 0.12, BANKNIFTY: 0.14 };
  let day = "2026-07-01";
  const end = "2026-09-22"; // last entry; exits (at most five sessions later) stay inside September
  const r = 0.065;
  const weightTotal = STRUCTURES.reduce((a, s) => a + s.weight, 0);

  const pickStructure = () => {
    let x = rand() * weightTotal;
    for (const s of STRUCTURES) {
      x -= s.weight;
      if (x <= 0) return s;
    }
    return STRUCTURES[0];
  };
  const pathSpot = (sym: string, days: number) => {
    let s = spots[sym];
    for (let i = 0; i < days; i++) s *= Math.exp((rand() - 0.5) * 2 * vols[sym] * Math.sqrt(1 / 252) * 1.7);
    return s;
  };
  const price = (sym: string, spot: number, strike: number, type: OptionType, expiry: string, at: Date, iv: number) => {
    const T = Math.max(timeToExpiryYears(expiry, at), 1 / (365 * 24 * 4));
    const px = black76Price({ F: spot * Math.exp(r * T), K: strike, T, r, sigma: iv, type });
    return Math.max(0.05, Math.round(px * 20) / 20);
  };
  const hhmm = (minsFromOpen: number) => {
    const t = 9 * 60 + 15 + minsFromOpen;
    return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };
  const write = (sym: string, expiry: string, strike: number, type: OptionType, side: Side, qty: number, px: number, date: string, time: string, ts: string) => {
    const order = ++orderSeq;
    // Split some orders into two fills, as exchanges do.
    const parts = qty >= 2 * (getLotSize(sym, expiry) ?? qty) && rand() < 0.5 ? [qty / 2, qty / 2] : [qty];
    for (const q of parts) {
      rows.push([zerodhaSymbol(sym, expiry, strike, type), "", date, "NFO", "FO", "", side.toLowerCase(), "false", String(q), px.toFixed(2), String(++tradeSeq), `10000${order}`, `${date}T${time}:${ts}`, expiry].join(","));
    }
  };

  while (day <= end) {
    if (!isTradingDay(day) || rand() < 0.45) {
      day = addTradingDays(day, 1);
      continue;
    }
    const sym = rand() < 0.75 ? "NIFTY" : "BANKNIFTY";
    spots[sym] = pathSpot(sym, 1);
    const st = pickStructure();
    const entryMin = Math.floor(rand() * 340);
    const entryTime = hhmm(entryMin);
    const entryAt = toISTDate(day, entryTime);
    const exps = getExpiries(sym, entryAt, 3);
    const expiry = (st.name === "short straddle" ? exps[0] : exps[rand() < 0.6 ? 0 : 1])?.date;
    if (!expiry) {
      day = addTradingDays(day, 1);
      continue;
    }
    const step = getStrikeStep(sym) * (sym === "BANKNIFTY" ? 2 : 1);
    const lot = getLotSize(sym, expiry) ?? 1;
    const atm = Math.round(spots[sym] / step) * step;
    const iv = vols[sym] * (0.85 + rand() * 0.5);
    let holdDays = st.hold[0] + Math.floor(rand() * (st.hold[1] - st.hold[0] + 1));
    let exitDay = addTradingDays(day, holdDays);
    if (exitDay > expiry) {
      exitDay = expiry;
      holdDays = 0;
    }
    const exitMin = exitDay === day ? Math.min(370, entryMin + 15 + Math.floor(rand() * 120)) : Math.floor(rand() * 360);
    const exitTime = hhmm(exitMin);
    const exitAt = toISTDate(exitDay, exitTime);
    const exitSpot = pathSpot(sym, Math.max(1, holdDays));
    const exitIv = iv * (0.88 + rand() * 0.24);
    const qty = st.lots * lot;
    for (const leg of st.legs) {
      const strike = atm + leg.off * step;
      const inPx = price(sym, spots[sym], strike, leg.type, expiry, entryAt, iv);
      const outPx = price(sym, exitSpot, strike, leg.type, expiry, exitAt, exitIv);
      const sec = String(Math.floor(rand() * 60)).padStart(2, "0");
      write(sym, expiry, strike, leg.type, leg.side, qty, inPx, day, entryTime, sec);
      write(sym, expiry, strike, leg.type, leg.side === "BUY" ? "SELL" : "BUY", qty, outPx, exitDay, exitTime, sec);
    }
    spots[sym] = exitSpot;
    day = addTradingDays(day, 1);
  }
  return rows.join("\n");
}

let cached: string | null = null;
/** The bundled sample tradebook (memoised). */
export function sampleTradebook(): string {
  cached ??= generateSampleTradebook();
  return cached;
}
