/**
 * Pure helpers for the Calculators hub. All pricing, charges, margin, sizing and calendar maths
 * come from "@/lib/options"; this file only wires those functions into calculator-shaped inputs
 * and outputs (trade rows, square-off comparisons, basis maths, holiday-shift detection).
 * No React here, so it is unit-tested in calcLogic.test.ts.
 */
import {
  BROKER_PRESETS,
  CONTRACT_SPECS,
  addCalendarDays,
  black76Price,
  bsPrice,
  greeks,
  greeks76,
  calcCharges,
  exerciseSTT,
  forwardFromSpot,
  getContractSpec,
  getExpiries,
  intrinsic,
  isoWeekday,
  maxProfitLoss,
  type BrokerPreset,
  type ChargesBreakdown,
  type ContractSpec,
  type Exchange,
  type Fill,
  type Greeks,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";

// ───────────────────────────── Parsing ─────────────────────────────

/** Parse a user-typed number ("1,23,456.50", " 12 ") → number; NaN when empty or invalid. */
export function toNum(input: string | number | null | undefined): number {
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  if (typeof input !== "string") return NaN;
  const s = input.replace(/[,\s₹]/g, "").replace(/−/g, "-");
  if (!s || s === "-" || s === ".") return NaN;
  // Plain decimals only: Number() would also accept hex/octal/binary ("0x10" → 16).
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export type Tone = "default" | "bullish" | "bearish" | "warning" | "info" | "brand";

/** Profit/loss colour for a signed rupee value. */
export function toneOf(v: number): Tone {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return "default";
  return v > 0 ? "bullish" : "bearish";
}

export const isPos = (n: number): boolean => Number.isFinite(n) && n > 0;
export const isNonNeg = (n: number): boolean => Number.isFinite(n) && n >= 0;

// ───────────────────────────── Brokers ─────────────────────────────

/** Build the broker used for charges: a preset, or the custom one from user fields. */
export function resolveBroker(id: string, custom: { perOrder: number; pctOfTurnover?: number; cap?: number }): BrokerPreset {
  if (id !== "custom") return BROKER_PRESETS.find((b) => b.id === id) ?? BROKER_PRESETS[0];
  const perOrder = isNonNeg(custom.perOrder) ? custom.perOrder : 0;
  const pct = isPos(custom.pctOfTurnover ?? NaN) ? (custom.pctOfTurnover as number) / 100 : undefined;
  const cap = isPos(custom.cap ?? NaN) ? custom.cap : undefined;
  return { id: "custom", name: "Custom", perOrder, pctOfTurnover: pct, cap: pct ? (cap ?? (perOrder > 0 ? perOrder : undefined)) : undefined };
}

// ───────────────────────────── Charges: trade rows ─────────────────────────────

export type Instrument = OptionType | "FUT";

export interface TradeRow {
  id: string;
  instrument: Instrument;
  /** Side of the opening order. */
  side: Side;
  entry: number;
  /** NaN when the position is still open (entry-only charges). */
  exit: number;
  lots: number;
  lotSize: number;
  exchange: Exchange;
}

export interface TradeResult {
  valid: boolean;
  qty: number;
  turnover: number;
  /** Gross P&L before charges (NaN when there is no exit). */
  gross: number;
  charges: ChargesBreakdown;
  /** gross − charges (NaN when there is no exit). */
  net: number;
  /** Exit price at which net P&L is zero (round trip). */
  breakevenExit: number;
  /** Points per unit the price must move in your favour just to cover charges. */
  breakevenPoints: number;
  /** Round-trip charges for one lot at the breakeven exit. */
  chargesPerLot: number;
  hasExit: boolean;
}

const ZERO: ChargesBreakdown = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, stamp: 0, gst: 0, total: 0 };

export function rowQty(row: Pick<TradeRow, "lots" | "lotSize">): number {
  return isPos(row.lots) && isPos(row.lotSize) ? Math.round(row.lots) * row.lotSize : 0;
}

/** Fills for a trade row: the opening order, plus the closing order when an exit price exists. */
export function tradeFills(row: TradeRow, exitOverride?: number): Fill[] {
  const qty = rowQty(row);
  if (!(qty > 0) || !isNonNeg(row.entry)) return [];
  const fills: Fill[] = [{ type: row.instrument, side: row.side, price: row.entry, qty, exchange: row.exchange }];
  const exit = exitOverride ?? row.exit;
  if (isNonNeg(exit)) fills.push({ type: row.instrument, side: row.side === "BUY" ? "SELL" : "BUY", price: exit, qty, exchange: row.exchange });
  return fills;
}

/**
 * Exit price where gross P&L exactly pays for round-trip charges. Charges depend on the exit price
 * (STT, exchange fee, stamp), so solve by fixed-point iteration; it converges in a few steps because
 * the charge rate per rupee of exit price is tiny.
 */
export function breakevenExitPrice(row: TradeRow, broker: BrokerPreset, onDate?: string): number {
  const qty = rowQty(row);
  if (!(qty > 0) || !isNonNeg(row.entry)) return NaN;
  const dir = row.side === "BUY" ? 1 : -1;
  let x = row.entry;
  for (let i = 0; i < 40; i++) {
    const c = calcCharges(tradeFills(row, Math.max(x, 0)), { broker, onDate }).total;
    const next = row.entry + (dir * c) / qty;
    if (Math.abs(next - x) < 1e-7) {
      x = next;
      break;
    }
    x = next;
  }
  // A short whose round-trip charges exceed the premium collected can never break even:
  // an option price cannot go below zero.
  return x < 0 ? NaN : x;
}

export function analyseTrade(row: TradeRow, broker: BrokerPreset, onDate?: string): TradeResult {
  const qty = rowQty(row);
  const valid = qty > 0 && isNonNeg(row.entry);
  if (!valid) {
    return { valid, qty, turnover: 0, gross: NaN, charges: ZERO, net: NaN, breakevenExit: NaN, breakevenPoints: NaN, chargesPerLot: NaN, hasExit: false };
  }
  const hasExit = isNonNeg(row.exit);
  const charges = calcCharges(tradeFills(row), { broker, onDate });
  const dir = row.side === "BUY" ? 1 : -1;
  const gross = hasExit ? dir * (row.exit - row.entry) * qty : NaN;
  const turnover = row.entry * qty + (hasExit ? row.exit * qty : 0);
  const breakevenExit = breakevenExitPrice(row, broker, onDate);
  const breakevenPoints = Number.isFinite(breakevenExit) ? Math.abs(breakevenExit - row.entry) : NaN;
  const lots = Math.max(1, Math.round(row.lots));
  const roundTrip = calcCharges(tradeFills(row, Number.isFinite(breakevenExit) ? breakevenExit : 0), { broker, onDate }).total;
  return {
    valid,
    qty,
    turnover,
    gross,
    charges,
    net: hasExit ? gross - charges.total : NaN,
    breakevenExit,
    breakevenPoints,
    chargesPerLot: roundTrip / lots,
    hasExit,
  };
}

export function sumBreakdowns(list: ChargesBreakdown[]): ChargesBreakdown {
  return list.reduce<ChargesBreakdown>(
    (a, b) => ({
      brokerage: a.brokerage + b.brokerage,
      stt: a.stt + b.stt,
      exchange: a.exchange + b.exchange,
      sebi: a.sebi + b.sebi,
      stamp: a.stamp + b.stamp,
      gst: a.gst + b.gst,
      total: a.total + b.total,
    }),
    { ...ZERO },
  );
}

// ───────────────────────────── Exercise vs square off ─────────────────────────────

export interface ExerciseInput {
  type: OptionType;
  strike: number;
  /** Expected final settlement price of the underlying. */
  settlement: number;
  /** Premium you can sell at now (for the square-off route). */
  premiumNow: number;
  /** Premium you paid (optional, for net P&L). */
  entryPremium: number;
  qty: number;
  broker: BrokerPreset;
  /** Charge brokerage on exercise/settlement (some brokers do). */
  brokerageOnExercise: boolean;
  onDate?: string;
}

export interface ExerciseResult {
  valid: boolean;
  intrinsicPerUnit: number;
  itm: boolean;
  squareOff: { proceeds: number; charges: ChargesBreakdown; net: number; pnl: number };
  expire: { proceeds: number; stt: number; brokerage: number; gst: number; total: number; net: number; pnl: number };
  /** Positive when square off leaves you with more money. */
  advantage: number;
  better: "SQUARE_OFF" | "EXPIRE" | "EQUAL";
  /** Lowest premium at which squaring off beats letting it expire. */
  squareOffThreshold: number;
}

function exerciseCosts(intrinsicPerUnit: number, qty: number, broker: BrokerPreset, withBrokerage: boolean, onDate: string | undefined, gstRate: number) {
  const stt = exerciseSTT(intrinsicPerUnit, qty, onDate);
  const brokerage = withBrokerage && intrinsicPerUnit > 0 ? (broker.pctOfTurnover ? Math.min(broker.pctOfTurnover * intrinsicPerUnit * qty, broker.cap ?? broker.perOrder) : broker.perOrder) : 0;
  const gst = brokerage * gstRate;
  return { stt, brokerage, gst, total: stt + brokerage + gst };
}

export function squareOffVsExpire(i: ExerciseInput, gstRate = 0.18): ExerciseResult {
  const valid = isPos(i.strike) && isPos(i.settlement) && isNonNeg(i.premiumNow) && isPos(i.qty);
  const intr = valid ? intrinsic(i.settlement, i.strike, i.type) : 0;
  const entryCost = isNonNeg(i.entryPremium) ? i.entryPremium * i.qty : 0;
  const sellFill: Fill[] = valid ? [{ type: i.type, side: "SELL", price: i.premiumNow, qty: i.qty }] : [];
  const sqCharges = calcCharges(sellFill, { broker: i.broker, onDate: i.onDate });
  const proceeds = valid ? i.premiumNow * i.qty : 0;
  const sqNet = proceeds - sqCharges.total;
  const ex = exerciseCosts(intr, i.qty, i.broker, i.brokerageOnExercise, i.onDate, gstRate);
  const exProceeds = intr * i.qty;
  const exNet = exProceeds - ex.total;
  const advantage = sqNet - exNet;
  // threshold premium P: P*qty - sellCharges(P) = exNet  (fixed point; sell charges are ~linear in P)
  let p = valid ? Math.max(intr, 0) : NaN;
  if (valid) {
    for (let k = 0; k < 40; k++) {
      const c = calcCharges([{ type: i.type, side: "SELL", price: Math.max(p, 0), qty: i.qty }], { broker: i.broker, onDate: i.onDate }).total;
      const next = (exNet + c) / i.qty;
      if (Math.abs(next - p) < 1e-7) {
        p = next;
        break;
      }
      p = next;
    }
  }
  return {
    valid,
    intrinsicPerUnit: intr,
    itm: intr > 0,
    squareOff: { proceeds, charges: sqCharges, net: sqNet, pnl: sqNet - entryCost },
    expire: { proceeds: exProceeds, ...ex, net: exNet, pnl: exNet - entryCost },
    advantage,
    better: Math.abs(advantage) < 0.005 ? "EQUAL" : advantage > 0 ? "SQUARE_OFF" : "EXPIRE",
    squareOffThreshold: p,
  };
}

// ───────────────────────────── Futures basis ─────────────────────────────

export interface BasisResult {
  valid: boolean;
  basis: number;
  basisPct: number;
  /** Simple annualised carry, % a year: (F/S − 1) × 365 / days. */
  annualisedPct: number;
  /** Continuously compounded carry, % a year: ln(F/S) / T. */
  continuousPct: number;
  /** Fair futures from spot with the given r and q. */
  fair: number;
  /** Futures minus fair value. */
  mispricing: number;
  /** Dividend yield implied by the futures price: r − ln(F/S)/T, % a year. */
  impliedDivYieldPct: number;
  state: "PREMIUM" | "DISCOUNT" | "FLAT";
}

/** T in years; r and q as decimals. */
export function futuresBasis(spot: number, fut: number, T: number, r: number, q: number): BasisResult {
  const valid = isPos(spot) && isPos(fut) && isPos(T) && Number.isFinite(r);
  if (!valid) {
    return { valid, basis: NaN, basisPct: NaN, annualisedPct: NaN, continuousPct: NaN, fair: NaN, mispricing: NaN, impliedDivYieldPct: NaN, state: "FLAT" };
  }
  const basis = fut - spot;
  const ln = Math.log(fut / spot);
  const fair = forwardFromSpot(spot, T, r, Number.isFinite(q) ? q : 0);
  return {
    valid,
    basis,
    basisPct: (basis / spot) * 100,
    annualisedPct: (fut / spot - 1) * (1 / T) * 100,
    continuousPct: (ln / T) * 100,
    fair,
    mispricing: fut - fair,
    impliedDivYieldPct: (r - ln / T) * 100,
    state: Math.abs(basis) < 1e-9 ? "FLAT" : basis > 0 ? "PREMIUM" : "DISCOUNT",
  };
}

// ───────────────────────────── Expiries and contract lookup ─────────────────────────────

export interface ExpiryRow {
  date: string;
  type: "weekly" | "monthly";
  dte: number;
  tradingDte: number;
  lotSize?: number;
  /** Raw scheduled expiry when a holiday moved this one earlier; "" otherwise. */
  shiftedFrom: string;
}

/**
 * When an expiry falls on a different weekday than the contract's rule, a holiday moved it to the
 * previous trading day. Returns the scheduled (holiday) date, or "" when the expiry was not moved.
 */
export function holidayShiftFrom(spec: Pick<ContractSpec, "expiryWeekday">, isoDate: string): string {
  const wd = isoWeekday(isoDate);
  if (!Number.isFinite(wd) || wd === spec.expiryWeekday) return "";
  const ahead = (spec.expiryWeekday - wd + 7) % 7;
  if (ahead === 0) return "";
  const raw = addCalendarDays(isoDate, ahead);
  return raw;
}

export function upcomingExpiries(symbol: string, now: Date = new Date(), count = 6): ExpiryRow[] {
  const spec = getContractSpec(symbol);
  return getExpiries(symbol, now, count).map((e) => ({ ...e, shiftedFrom: spec ? holidayShiftFrom(spec, e.date) : "" }));
}

/** Symbols to offer in pickers: indices first (in registry order), then stocks A–Z. */
export function symbolOptions(): { indices: ContractSpec[]; stocks: ContractSpec[] } {
  const all = Object.values(CONTRACT_SPECS).filter((s) => s.lotSize > 0);
  return {
    indices: all.filter((s) => s.kind === "INDEX"),
    stocks: all.filter((s) => s.kind === "STOCK").sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

/** Case-insensitive search on symbol and name; symbol prefix matches rank first. */
export function searchSpecs(query: string, specs: ContractSpec[] = Object.values(CONTRACT_SPECS)): ContractSpec[] {
  const q = query.trim().toUpperCase();
  const kindRank = (s: ContractSpec) => (s.kind === "INDEX" ? 0 : 1);
  if (!q) return [...specs].sort((a, b) => kindRank(a) - kindRank(b) || a.symbol.localeCompare(b.symbol));
  const scored: Array<{ s: ContractSpec; score: number }> = [];
  for (const s of specs) {
    const sym = s.symbol.toUpperCase();
    const name = (s.name ?? "").toUpperCase();
    let score = -1;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (sym.includes(q)) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push({ s, score });
  }
  return scored.sort((a, b) => a.score - b.score || kindRank(a.s) - kindRank(b.s) || a.s.symbol.localeCompare(b.s.symbol)).map((x) => x.s);
}

export const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ───────────────────────────── Position sizing from legs ─────────────────────────────

export interface LegsRisk {
  /** Worst expiry loss for one "unit" of the strategy (smallest lot count), in rupees (positive). */
  perLot: number;
  unlimited: boolean;
  /** Lots of the smallest leg; the strategy is scaled per this many lots. */
  baseLots: number;
  totalMaxLoss: number;
}

export function maxLossPerLotFromLegs(legs: Leg[]): LegsRisk {
  const act = legs.filter((l) => l.enabled !== false && isPos(l.lots) && isPos(l.lotSize));
  if (act.length === 0) return { perLot: NaN, unlimited: false, baseLots: 0, totalMaxLoss: NaN };
  const pl = maxProfitLoss(act);
  const baseLots = Math.min(...act.map((l) => l.lots));
  if (pl.unlimitedLoss) return { perLot: Infinity, unlimited: true, baseLots, totalMaxLoss: Infinity };
  const total = Math.abs(pl.maxLoss);
  return { perLot: total / baseLots, unlimited: false, baseLots, totalMaxLoss: total };
}

// ───────────────────────────── Option pricing ─────────────────────────────

export interface PriceInputs {
  /** "BS": spot-based Black-Scholes-Merton with dividend yield q; "B76": futures-based Black-76. */
  model: "BS" | "B76";
  underlying: number;
  strike: number;
  T: number;
  r: number;
  q: number;
}

export interface Priced {
  price: number;
  g: Greeks;
  intrinsic: number;
  /** Forward used for probabilities (spot × e^((r−q)T) for BS, the futures price for B76). */
  forward: number;
}

/** Price and Greeks for one option under the chosen model. sigma is a decimal. */
export function priceOption(s: PriceInputs, sigma: number, type: OptionType, K: number = s.strike): Priced {
  if (s.model === "B76") {
    const F = s.underlying;
    const p = { F, K, T: s.T, r: s.r, sigma, type };
    return { price: black76Price(p), g: greeks76(p), intrinsic: intrinsic(F, K, type), forward: F };
  }
  const p = { S: s.underlying, K, T: s.T, r: s.r, q: s.q, sigma, type };
  return { price: bsPrice(p), g: greeks(p), intrinsic: intrinsic(s.underlying, K, type), forward: forwardFromSpot(s.underlying, s.T, s.r, s.q) };
}

/* ── Date picker helpers (calendar widgets work in the browser's local time) ── */

/** "2026-10-20" → local-midnight Date for a calendar widget; null when invalid. */
export function isoToCalendarDate(iso: string | undefined | null): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** Local calendar Date → "2026-10-20" (the IST calendar date the user picked). */
export function calendarDateToIso(d: Date | undefined | null): string {
  if (!d || !Number.isFinite(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
