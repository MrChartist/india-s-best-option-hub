/**
 * Paper trading engine (pure functions + localStorage persistence under "mc_paper_v1").
 *
 * - Market orders fill at mid ± slippage (percent of mid, rounded to the 0.05 tick against you).
 * - Limit orders fill when the slippage-adjusted market price is at or better than the limit.
 * - Positions are netted per contract (symbol, expiry, strike, type) with average-price accounting;
 *   reducing or closing realises P&L. Every fill pays brokerage, STT, exchange, SEBI, stamp and GST.
 * - SL / target per position are checked on every quote tick and square off at market.
 * - At expiry (15:30 IST) positions settle at intrinsic against the underlying price; ITM longs pay
 *   STT on exercise. Open orders on expired contracts are cancelled.
 * - Every fill is tagged with its entry context (IV percentile, India VIX, DTE, IV).
 *
 * Cash convention: buying premium debits cash, selling credits it; margin for short options is
 * blocked from free funds (estimateMargin) but not debited.
 */
import {
  BROKER_PRESETS,
  addTradingDays,
  calcCharges,
  calendarDaysBetween,
  estimateMargin,
  exerciseSTT,
  getBrokerPreset,
  getContractSpec,
  intrinsic,
  isValidIsoDate,
  istDateString,
  maxProfitLoss,
  toISTDate,
  type BrokerPreset,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";

export const PAPER_KEY = "mc_paper_v1";
export const DEFAULT_CAPITAL = 500_000;
export const DEFAULT_SLIPPAGE_PCT = 0.5;
export const TICK = 0.05;

// ── Types ──

export interface Contract {
  symbol: string;
  /** ISO yyyy-mm-dd */
  expiry: string;
  strike: number;
  type: OptionType;
}

export interface EntryContext {
  /** IV percentile 0-100 at entry (null when history is too short). */
  ivp: number | null;
  /** What the IVP was computed from. */
  ivpBasis: "symbol" | "vix" | null;
  /** India VIX at entry. */
  vix: number | null;
  /** Calendar days to expiry at entry. */
  dte: number;
  /** Contract IV in percent at entry. */
  iv: number | null;
  spot: number | null;
}

export interface Quote {
  bid: number;
  ask: number;
  ltp: number;
  /** "dhan" | "nse" | "cache" | "sample" ... */
  source: string;
}

export type OrderType = "MARKET" | "LIMIT";
export type OrderStatus = "OPEN" | "FILLED" | "CANCELLED" | "REJECTED";
export type OrderOrigin = "ticket" | "basket" | "sl" | "target" | "square-off";
const ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["OPEN", "FILLED", "CANCELLED", "REJECTED"]);

export interface OrderInput extends Contract {
  side: Side;
  lots: number;
  lotSize: number;
  orderType: OrderType;
  limitPrice?: number;
  /** Stop-loss premium for the resulting position. */
  sl?: number;
  /** Target premium for the resulting position. */
  target?: number;
  origin?: OrderOrigin;
  context?: EntryContext;
}

export interface PaperOrder extends OrderInput {
  id: string;
  status: OrderStatus;
  origin: OrderOrigin;
  createdAt: number;
  updatedAt: number;
  fillPrice?: number;
  filledAt?: number;
  charges?: number;
  quoteSource?: string;
  reason?: string;
}

export interface PaperPosition extends Contract {
  key: string;
  /** Signed lots: + long, − short. */
  netLots: number;
  lotSize: number;
  avgPrice: number;
  sl?: number;
  target?: number;
  openedAt: number;
  context?: EntryContext;
  ltp?: number;
  markAt?: number;
  markSource?: string;
}

export interface PaperTrade extends Contract {
  id: string;
  orderId?: string;
  kind: "FILL" | "SETTLEMENT";
  ts: number;
  /** IST trading date (ISO). */
  date: string;
  side: Side;
  lots: number;
  lotSize: number;
  price: number;
  charges: number;
  /** P&L realised by this trade before charges (0 for an opening fill). */
  realisedGross: number;
  /** realisedGross − charges for this trade. */
  realisedNet: number;
  quoteSource?: string;
  context?: EntryContext;
  origin?: OrderOrigin;
}

export type LedgerKind = "DEPOSIT" | "PREMIUM" | "CHARGES" | "SETTLEMENT" | "EXERCISE_STT" | "RESET" | "ARCHIVE";

export interface LedgerEntry {
  id: string;
  ts: number;
  date: string;
  kind: LedgerKind;
  description: string;
  /** Cash flow (+ credit, − debit). */
  amount: number;
  /** Cash balance after this entry. */
  balance: number;
  /** For an ARCHIVE summary row: how many entries it replaces and their total per kind. */
  archived?: { count: number; from: string; to: string; byKind: Partial<Record<LedgerKind, number>> };
}

export interface PaperSettings {
  /** Slippage in percent of mid (0.5 = 0.5%). */
  slippagePct: number;
  brokerId: string;
  /** Fill against generated sample quotes when no live chain is available (fills are labelled). */
  allowSampleFills: boolean;
  /** SEBI-style guardrails. Optional so older saved accounts stay valid (defaults apply). */
  guardrails?: Guardrails;
}

export interface Guardrails {
  /** Beginner mode: selling options that are not covered by a long of the same type is hidden and blocked. */
  beginnerMode: boolean;
  /** Largest max loss allowed per order or basket, as a percent of current equity (cash + open positions at their marks). */
  maxRiskPct: number;
  /** Daily loss cap in rupees (equity now − equity at the start of the IST day). null = off. */
  dailyLossCap: number | null;
}

export const DEFAULT_GUARDRAILS: Guardrails = { beginnerMode: true, maxRiskPct: 2, dailyLossCap: 10_000 };

export interface KillSwitch {
  /** Epoch ms until which new opening orders are blocked (next trading-day open by default). */
  until: number;
  at: number;
  reason: string;
}

export interface PaperState {
  version: 1;
  startingCapital: number;
  cash: number;
  settings: PaperSettings;
  orders: PaperOrder[];
  positions: PaperPosition[];
  trades: PaperTrade[];
  ledger: LedgerEntry[];
  createdAt: number;
  /**
   * Last underlying spot seen per symbol and IST date at or before that day's 15:30 close, keyed by
   * settlementKey(symbol, date), with the time it was seen. Expired contracts settle at the mark for
   * their expiry date (when it falls in the closing window), never at a spot seen after the close.
   */
  spotMarks?: Record<string, SpotMark>;
  /** Active kill switch: opening orders are blocked until `until`; exits still work. */
  killSwitch?: KillSwitch;
  /**
   * Account equity at the start of the IST trading day (cash + positions at their last mark from
   * the previous session), captured on the day's first tick or fill. Today's P&L for the daily
   * loss cap is equity now minus this, so overnight MTM from earlier days never counts as today's.
   */
  dayStart?: DayStart;
}

export interface DayStart {
  /** IST date (ISO). */
  date: string;
  equity: number;
  ts: number;
}

export interface SpotMark {
  spot: number;
  ts: number;
}

// ── Small helpers ──

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const round2 = (v: number) => Math.round(v * 100) / 100;
let seq = 0;
function newId(prefix: string, now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}-${now.toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function contractKey(c: Contract): string {
  return `${c.symbol}|${c.expiry}|${c.strike}|${c.type}`;
}

export function contractLabel(c: Contract): string {
  return `${c.symbol} ${c.strike} ${c.type}`;
}

export function brokerFor(state: PaperState): BrokerPreset {
  return getBrokerPreset(state.settings.brokerId) ?? BROKER_PRESETS[0];
}

export function createPaperState(capital: number = DEFAULT_CAPITAL, now: Date = new Date(), settings?: Partial<PaperSettings>): PaperState {
  const cap = isNum(capital) && capital > 0 ? capital : DEFAULT_CAPITAL;
  const ts = now.getTime();
  return {
    version: 1,
    startingCapital: cap,
    cash: cap,
    settings: { slippagePct: DEFAULT_SLIPPAGE_PCT, brokerId: "zerodha", allowSampleFills: true, guardrails: { ...DEFAULT_GUARDRAILS }, ...settings },
    orders: [],
    positions: [],
    trades: [],
    ledger: [{ id: newId("l", ts), ts, date: istDateString(now), kind: "DEPOSIT", description: "Virtual capital", amount: cap, balance: cap }],
    createdAt: ts,
    dayStart: { date: istDateString(now), equity: cap, ts },
  };
}

/** Equity now: cash plus open positions at their latest marks. */
export function equityOf(state: PaperState): number {
  return state.cash + positionsValue(state.positions);
}

/**
 * Record the start-of-day equity once per IST date. Call before marks or fills of the new day are
 * applied, so the snapshot holds the previous session's marks. Returns the same object when the
 * snapshot is already current.
 */
export function ensureDayStart(state: PaperState, now: Date = new Date()): PaperState {
  const date = istDateString(now);
  if (state.dayStart?.date === date) return state;
  return { ...state, dayStart: { date, equity: round2(equityOf(state)), ts: now.getTime() } };
}

// ── Pricing ──

/** Mid of a two-sided quote, else LTP; NaN when neither is usable. */
export function quoteMid(q: Quote | null | undefined): number {
  if (!q) return NaN;
  if (q.bid > 0 && q.ask > 0 && q.ask >= q.bid) return (q.bid + q.ask) / 2;
  return q.ltp > 0 ? q.ltp : NaN;
}

/** Mark price for MTM: LTP when traded, else mid. */
export function quoteMark(q: Quote | null | undefined): number {
  if (!q) return NaN;
  return q.ltp > 0 ? q.ltp : quoteMid(q);
}

function roundTick(v: number, dir: "up" | "down"): number {
  const n = v / TICK;
  const k = dir === "up" ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return round2(k * TICK);
}

/** Market fill: mid × (1 ± slippage%) rounded to the tick against the trader; never below one tick. */
export function marketFillPrice(q: Quote | null | undefined, side: Side, slippagePct: number): number {
  const mid = quoteMid(q);
  if (!isNum(mid) || mid <= 0) return NaN;
  const slip = Math.max(0, isNum(slippagePct) ? slippagePct : 0) / 100;
  const raw = side === "BUY" ? mid * (1 + slip) : mid * (1 - slip);
  return Math.max(TICK, roundTick(raw, side === "BUY" ? "up" : "down"));
}

/** Limit fill price, or NaN when the order is not marketable yet. Marketable limits fill at the (better) market price. */
export function limitFillPrice(q: Quote | null | undefined, side: Side, limit: number, slippagePct: number): number {
  const fp = marketFillPrice(q, side, slippagePct);
  if (!isNum(fp) || !isNum(limit) || limit <= 0) return NaN;
  if (side === "BUY") return fp <= limit + 1e-9 ? fp : NaN;
  return fp >= limit - 1e-9 ? fp : NaN;
}

// ── Margin and funds ──

function positionLeg(p: PaperPosition): Leg {
  return { symbol: p.symbol, type: p.type, side: p.netLots > 0 ? "BUY" : "SELL", strike: p.strike, expiry: p.expiry, lots: Math.abs(p.netLots), lotSize: p.lotSize, premium: p.avgPrice };
}

/** Margin blocked for underlyings that have at least one short leg (SPAN-style estimate). */
export function marginBlocked(positions: PaperPosition[], spots: Record<string, number>, now: Date = new Date()): number {
  const bySymbol = new Map<string, PaperPosition[]>();
  for (const p of positions) {
    if (p.netLots === 0) continue;
    const arr = bySymbol.get(p.symbol);
    if (arr) arr.push(p);
    else bySymbol.set(p.symbol, [p]);
  }
  let total = 0;
  for (const [symbol, list] of bySymbol) {
    if (!list.some((p) => p.netLots < 0)) continue;
    const spot = spots[symbol] > 0 ? spots[symbol] : list.reduce((a, p) => a + p.strike, 0) / list.length;
    const m = estimateMargin(list.map(positionLeg), { spot, now });
    // estimateMargin includes premium paid for long legs; that premium has already left cash.
    const paid = list.reduce((a, p) => a + (p.netLots > 0 ? p.netLots * p.lotSize * p.avgPrice : 0), 0);
    total += Math.max(0, m.total - paid);
  }
  return total;
}

/** Mark-to-market value of open positions (long value − short liability). */
export function positionsValue(positions: PaperPosition[], marks?: Record<string, number>): number {
  return positions.reduce((a, p) => {
    const m = marks?.[p.key] ?? p.ltp ?? p.avgPrice;
    return a + p.netLots * p.lotSize * (isNum(m) ? m : p.avgPrice);
  }, 0);
}

export function unrealisedPnl(positions: PaperPosition[], marks?: Record<string, number>): number {
  return positions.reduce((a, p) => {
    const m = marks?.[p.key] ?? p.ltp ?? p.avgPrice;
    return a + p.netLots * p.lotSize * ((isNum(m) ? m : p.avgPrice) - p.avgPrice);
  }, 0);
}

export interface Funds {
  cash: number;
  positionsValue: number;
  equity: number;
  margin: number;
  /** cash − margin: what new orders can use. */
  available: number;
  unrealised: number;
  realisedNet: number;
}

export function funds(state: PaperState, spots: Record<string, number> = {}, now: Date = new Date()): Funds {
  const pv = positionsValue(state.positions);
  const margin = marginBlocked(state.positions, spots, now);
  return {
    cash: state.cash,
    positionsValue: pv,
    equity: state.cash + pv,
    margin,
    available: state.cash - margin,
    unrealised: unrealisedPnl(state.positions),
    realisedNet: state.trades.reduce((a, t) => a + t.realisedNet, 0),
  };
}

// ── Fills ──

function ledgerPush(state: PaperState, e: Omit<LedgerEntry, "id" | "balance">): void {
  state.cash = round2(state.cash + e.amount);
  state.ledger.push({ ...e, id: newId("l", e.ts), balance: state.cash });
}

/**
 * Apply a fill to a (cloned) state: nets the position, books premium and charges in the ledger and
 * records the trade with its realised P&L. Pure with respect to the input state.
 */
/** Exchange whose charge rates apply: BSE for SENSEX / BANKEX, NSE otherwise. */
function exchangeOf(symbol: string): "NSE" | "BSE" {
  return getContractSpec(symbol)?.exchange === "BSE" ? "BSE" : "NSE";
}

export function applyFill(state0: PaperState, order: PaperOrder, price: number, now: Date, quoteSource?: string): PaperState {
  const state = ensureDayStart(state0, now);
  const s: PaperState = { ...state, orders: [...state.orders], positions: state.positions.map((p) => ({ ...p })), trades: [...state.trades], ledger: [...state.ledger] };
  const ts = now.getTime();
  const date = istDateString(now);
  const qty = order.lots * order.lotSize;
  const signedLots = order.side === "BUY" ? order.lots : -order.lots;
  const ch = calcCharges([{ type: order.type, side: order.side, price, qty, exchange: exchangeOf(order.symbol) }], { broker: brokerFor(s), onDate: date });
  const key = contractKey(order);
  const idx = s.positions.findIndex((p) => p.key === key);
  let realisedGross = 0;

  if (idx < 0) {
    s.positions.push({
      key,
      symbol: order.symbol,
      expiry: order.expiry,
      strike: order.strike,
      type: order.type,
      netLots: signedLots,
      lotSize: order.lotSize,
      avgPrice: price,
      sl: order.sl,
      target: order.target,
      openedAt: ts,
      context: order.context,
      ltp: price,
      markAt: ts,
      markSource: quoteSource,
    });
  } else {
    const p = s.positions[idx];
    const n = p.netLots;
    if (n === 0 || Math.sign(n) === Math.sign(signedLots)) {
      p.avgPrice = round2((Math.abs(n) * p.avgPrice + order.lots * price) / (Math.abs(n) + order.lots));
      p.netLots = n + signedLots;
      if (order.sl !== undefined) p.sl = order.sl;
      if (order.target !== undefined) p.target = order.target;
    } else {
      const closing = Math.min(Math.abs(n), order.lots);
      realisedGross = closing * p.lotSize * (price - p.avgPrice) * Math.sign(n);
      const after = n + signedLots;
      if (after === 0) {
        s.positions.splice(idx, 1);
      } else if (Math.sign(after) !== Math.sign(n)) {
        // Flipped through zero: the remainder opens at this price with fresh risk levels.
        p.netLots = after;
        p.avgPrice = price;
        p.openedAt = ts;
        p.context = order.context;
        p.sl = order.sl;
        p.target = order.target;
      } else {
        p.netLots = after;
      }
    }
  }

  const premiumFlow = -signedLots * order.lotSize * price;
  ledgerPush(s, { ts, date, kind: "PREMIUM", description: `${order.side} ${order.lots} × ${contractLabel(order)} @ ${price.toFixed(2)}`, amount: round2(premiumFlow) });
  if (ch.total > 0) ledgerPush(s, { ts, date, kind: "CHARGES", description: `Charges on ${order.side} ${contractLabel(order)} (STT ${ch.stt.toFixed(2)})`, amount: -round2(ch.total) });

  s.trades.push({
    id: newId("t", ts),
    orderId: order.id,
    kind: "FILL",
    ts,
    date,
    symbol: order.symbol,
    expiry: order.expiry,
    strike: order.strike,
    type: order.type,
    side: order.side,
    lots: order.lots,
    lotSize: order.lotSize,
    price,
    charges: round2(ch.total),
    realisedGross: round2(realisedGross),
    realisedNet: round2(realisedGross - ch.total),
    quoteSource,
    context: order.context,
    origin: order.origin,
  });

  const oi = s.orders.findIndex((o) => o.id === order.id);
  const filled: PaperOrder = { ...order, status: "FILLED", fillPrice: price, filledAt: ts, updatedAt: ts, charges: round2(ch.total), quoteSource };
  if (oi >= 0) s.orders[oi] = filled;
  else s.orders.push(filled);
  return s;
}

// ── Validation of an order ──

export function validateOrderInput(o: OrderInput): string | null {
  if (!o.symbol) return "Choose a symbol.";
  if (!isValidIsoDate(o.expiry)) return "Choose an expiry.";
  if (!(o.strike > 0)) return "Choose a strike.";
  if (o.type !== "CE" && o.type !== "PE") return "Choose CE or PE.";
  if (o.side !== "BUY" && o.side !== "SELL") return "Choose buy or sell.";
  if (!Number.isInteger(o.lots) || o.lots <= 0) return "Lots must be a whole number above zero.";
  if (!(o.lotSize > 0)) return "Lot size is unknown for this symbol.";
  if (o.orderType === "LIMIT" && !(isNum(o.limitPrice) && o.limitPrice > 0)) return "Enter a limit price.";
  if (o.sl !== undefined && !(o.sl > 0)) return "Stop-loss must be above zero.";
  if (o.target !== undefined && !(o.target > 0)) return "Target must be above zero.";
  if (o.orderType === "LIMIT") return riskSideError(o.side, o.limitPrice as number, o.sl, o.target);
  return null;
}

/**
 * Stop-loss and target must sit on the right side of the entry: below and above it for a buy,
 * above and below it for a sell. Otherwise the order would exit on the very next tick and the
 * max-loss guard would read the stop as zero risk.
 */
export function riskSideError(side: Side, entry: number, sl?: number, target?: number): string | null {
  if (!(isNum(entry) && entry > 0)) return null;
  const buy = side === "BUY";
  if (sl !== undefined && isNum(sl) && sl > 0 && (buy ? sl >= entry : sl <= entry)) {
    return buy ? "Stop-loss must be below the entry for a buy." : "Stop-loss must be above the entry for a sell.";
  }
  if (target !== undefined && isNum(target) && target > 0 && (buy ? target <= entry : target >= entry)) {
    return buy ? "Target must be above the entry for a buy." : "Target must be below the entry for a sell.";
  }
  return null;
}

export interface PlaceContext {
  quote: Quote | null;
  now: Date;
  spots: Record<string, number>;
}

export interface PlaceResult {
  state: PaperState;
  order: PaperOrder;
  /** "filled" | "open" | "rejected" */
  outcome: "filled" | "open" | "rejected";
  message: string;
}

function canUseQuote(state: PaperState, q: Quote | null): boolean {
  return !!q && (q.source !== "sample" || state.settings.allowSampleFills);
}

/** Would this fill leave free funds negative? Returns a reason or null. */
export function fundsCheck(state: PaperState, order: PaperOrder, price: number, ctx: PlaceContext): string | null {
  const after = applyFill(state, order, price, ctx.now);
  const margin = marginBlocked(after.positions, ctx.spots, ctx.now);
  const available = after.cash - margin;
  const before = state.cash - marginBlocked(state.positions, ctx.spots, ctx.now);
  // Allow risk-reducing orders even when funds are short.
  if (available < 0 && available < before) {
    return `Insufficient funds: needs about ₹${Math.round(before - available).toLocaleString("en-IN")} but ₹${Math.max(0, Math.round(before)).toLocaleString("en-IN")} is free.`;
  }
  return null;
}

/** Place an order: market orders fill now (or reject), limits fill when marketable or rest as OPEN. */
export function placeOrder(state: PaperState, input: OrderInput, ctx: PlaceContext): PlaceResult {
  const ts = ctx.now.getTime();
  const order: PaperOrder = { ...input, id: newId("o", ts), status: "OPEN", origin: input.origin ?? "ticket", createdAt: ts, updatedAt: ts };
  const reject = (reason: string): PlaceResult => {
    const rejected: PaperOrder = { ...order, status: "REJECTED", reason };
    return { state: { ...state, orders: [...state.orders, rejected] }, order: rejected, outcome: "rejected", message: reason };
  };
  const invalid = validateOrderInput(input);
  if (invalid) return reject(invalid);
  if (toISTDate(input.expiry, "15:30").getTime() <= ts) return reject("This contract has expired.");

  const q = ctx.quote;
  const usable = canUseQuote(state, q);
  const price = !usable ? NaN : order.orderType === "MARKET" ? marketFillPrice(q, order.side, state.settings.slippagePct) : limitFillPrice(q, order.side, order.limitPrice ?? NaN, state.settings.slippagePct);

  if (order.orderType === "MARKET" && !isNum(price)) {
    return reject(q && !usable ? "Only sample quotes are available and sample fills are switched off." : "No quote for this contract right now.");
  }
  if (!isNum(price)) {
    return { state: { ...state, orders: [...state.orders, order] }, order, outcome: "open", message: `Limit ${order.side} at ₹${order.limitPrice?.toFixed(2)} is waiting for the market.` };
  }
  const sideErr = riskSideError(order.side, price, order.sl, order.target);
  if (sideErr) return reject(sideErr);
  const short = fundsCheck(state, order, price, ctx);
  if (short) return reject(short);
  const next = applyFill(state, order, price, ctx.now, q?.source);
  const filled = next.orders.find((o) => o.id === order.id) ?? order;
  return { state: next, order: filled, outcome: "filled", message: `${order.side} ${order.lots} × ${contractLabel(order)} filled at ₹${price.toFixed(2)}${q?.source === "sample" ? " (sample quote)" : ""}.` };
}

export function cancelOrder(state: PaperState, id: string, now: Date = new Date()): PaperState {
  return { ...state, orders: state.orders.map((o) => (o.id === id && o.status === "OPEN" ? { ...o, status: "CANCELLED", updatedAt: now.getTime(), reason: "Cancelled by you" } : o)) };
}

export function setPositionRisk(state: PaperState, key: string, risk: { sl?: number | null; target?: number | null }): PaperState {
  return {
    ...state,
    positions: state.positions.map((p) => {
      if (p.key !== key) return p;
      const next = { ...p };
      if (risk.sl !== undefined) next.sl = risk.sl && risk.sl > 0 ? risk.sl : undefined;
      if (risk.target !== undefined) next.target = risk.target && risk.target > 0 ? risk.target : undefined;
      return next;
    }),
  };
}

/** Square off a position at market (closing order for its full size). */
export function squareOff(state: PaperState, key: string, ctx: PlaceContext, origin: OrderOrigin = "square-off"): PlaceResult | null {
  const p = state.positions.find((x) => x.key === key);
  if (!p || p.netLots === 0) return null;
  return placeOrder(
    state,
    { symbol: p.symbol, expiry: p.expiry, strike: p.strike, type: p.type, side: p.netLots > 0 ? "SELL" : "BUY", lots: Math.abs(p.netLots), lotSize: p.lotSize, orderType: "MARKET", origin },
    ctx,
  );
}

// ── Expiry settlement ──

export interface SettlementEvent {
  key: string;
  label: string;
  settlement: number;
  realisedNet: number;
  stt: number;
}

/**
 * Settle every position whose contract expired (15:30 IST) at intrinsic value against `spots[symbol]`.
 * ITM longs pay STT on exercise. Positions without a spot stay open. Open orders on expired contracts are cancelled.
 */
/** Start of the window whose spot marks are accepted as the expiry-day close (NSE's closing-price window). */
const SETTLE_WINDOW_START = "15:00";
const MARKET_CLOSE = "15:30";

/** Key for an explicit settlement price: `${symbol}|${expiry}`. */
export function settlementKey(symbol: string, expiry: string): string {
  return `${symbol}|${expiry}`;
}

/**
 * Record the latest spot per symbol for today's IST date while it is at or before 15:30. Spots seen
 * after the close are ignored, so a later tick never overwrites the pre-close mark. Marks for past
 * dates are kept only while an open position still expires on that date.
 */
export function recordSpotMarks(state: PaperState, now: Date, spots: Record<string, number>): PaperState {
  const ts = now.getTime();
  const today = istDateString(now);
  if (!(ts <= toISTDate(today, MARKET_CLOSE).getTime())) return state;
  let marks: Record<string, SpotMark> | null = null;
  for (const [sym, spot] of Object.entries(spots ?? {})) {
    if (!(isNum(spot) && spot > 0)) continue;
    const key = settlementKey(sym, today);
    const prev = state.spotMarks?.[key];
    if (prev && prev.ts > ts) continue;
    marks ??= { ...(state.spotMarks ?? {}) };
    marks[key] = { spot, ts };
  }
  if (!marks) return state;
  const needed = new Set(state.positions.map((p) => settlementKey(p.symbol, p.expiry)));
  for (const key of Object.keys(marks)) {
    if (key.slice(key.lastIndexOf("|") + 1) !== today && !needed.has(key)) delete marks[key];
  }
  return { ...state, spotMarks: marks };
}

/**
 * Settlement price for an expired contract: an explicit official close for (symbol, expiry) when the
 * caller has one, else the last spot recorded inside the expiry day's 15:00 to 15:30 IST window.
 * Returns NaN when neither exists; the position then stays open until a close is available.
 */
export function settlementSpot(state: PaperState, c: Contract, settlementPrices?: Record<string, number>): number {
  const explicit = settlementPrices?.[settlementKey(c.symbol, c.expiry)];
  if (isNum(explicit) && explicit > 0) return explicit;
  const mark = state.spotMarks?.[settlementKey(c.symbol, c.expiry)];
  if (!mark || !(isNum(mark.spot) && mark.spot > 0) || !isNum(mark.ts)) return NaN;
  const from = toISTDate(c.expiry, SETTLE_WINDOW_START).getTime();
  const to = toISTDate(c.expiry, MARKET_CLOSE).getTime();
  return mark.ts >= from && mark.ts <= to ? mark.spot : NaN;
}

/**
 * Settle expired positions at the underlying's expiry-day close. `spots` are the current live spots:
 * they are recorded as pre-close marks when `now` is at or before 15:30 IST, but a spot seen after the
 * close is never used to settle. Pass `settlementPrices` (keyed by settlementKey) with official closes
 * to settle positions whose expiry day was not observed live.
 */
export function settleExpiredPaper(
  state: PaperState,
  now: Date,
  spots: Record<string, number>,
  settlementPrices?: Record<string, number>,
): { state: PaperState; settled: SettlementEvent[] } {
  const ts = now.getTime();
  state = recordSpotMarks(state, now, spots);
  const isExp = (c: Contract) => toISTDate(c.expiry, MARKET_CLOSE).getTime() <= ts;
  const prices = new Map<string, number>();
  const due = state.positions.filter((p) => {
    if (!isExp(p)) return false;
    const px = settlementSpot(state, p, settlementPrices);
    if (!(px > 0)) return false;
    prices.set(p.key, px);
    return true;
  });
  const staleOrders = state.orders.some((o) => o.status === "OPEN" && isExp(o));
  if (!due.length && !staleOrders) return { state, settled: [] };

  const s: PaperState = { ...state, positions: [...state.positions], trades: [...state.trades], ledger: [...state.ledger], orders: state.orders.map((o) => (o.status === "OPEN" && isExp(o) ? { ...o, status: "CANCELLED" as const, updatedAt: ts, reason: "Contract expired" } : o)) };
  const settled: SettlementEvent[] = [];
  for (const p of due) {
    const spot = prices.get(p.key) as number;
    const iv = intrinsic(spot, p.strike, p.type);
    const qty = p.netLots * p.lotSize;
    const settleTs = Math.min(ts, toISTDate(p.expiry, "15:30").getTime());
    const date = p.expiry;
    const gross = (iv - p.avgPrice) * qty;
    const stt = p.netLots > 0 && iv > 0 ? exerciseSTT(iv, qty, p.expiry) : 0;
    if (iv > 0) ledgerPush(s, { ts: settleTs, date, kind: "SETTLEMENT", description: `${contractLabel(p)} settled at ${iv.toFixed(2)} (spot ${spot.toFixed(2)})`, amount: round2(iv * qty) });
    else ledgerPush(s, { ts: settleTs, date, kind: "SETTLEMENT", description: `${contractLabel(p)} expired worthless (spot ${spot.toFixed(2)})`, amount: 0 });
    if (stt > 0) ledgerPush(s, { ts: settleTs, date, kind: "EXERCISE_STT", description: `STT on exercise, ${contractLabel(p)}`, amount: -round2(stt) });
    s.trades.push({
      id: newId("t", settleTs),
      kind: "SETTLEMENT",
      ts: settleTs,
      date,
      symbol: p.symbol,
      expiry: p.expiry,
      strike: p.strike,
      type: p.type,
      side: p.netLots > 0 ? "SELL" : "BUY",
      lots: Math.abs(p.netLots),
      lotSize: p.lotSize,
      price: round2(iv),
      charges: round2(stt),
      realisedGross: round2(gross),
      realisedNet: round2(gross - stt),
      context: p.context,
    });
    s.positions = s.positions.filter((x) => x.key !== p.key);
    settled.push({ key: p.key, label: contractLabel(p), settlement: iv, realisedNet: round2(gross - stt), stt: round2(stt) });
  }
  return { state: s, settled };
}

// ── Tick processing ──

export interface TickEvent {
  kind: "limit-filled" | "sl" | "target" | "settled" | "rejected";
  message: string;
}

/**
 * Process one quote tick: mark positions, fill marketable limit orders, trigger SL/targets and settle
 * expired contracts. `quotes` is keyed by contractKey().
 */
export function processTick(
  state: PaperState,
  quotes: Record<string, Quote>,
  now: Date,
  spots: Record<string, number>,
  settlementPrices?: Record<string, number>,
): { state: PaperState; events: TickEvent[] } {
  const events: TickEvent[] = [];
  const ts = now.getTime();
  // Snapshot start-of-day equity before today's first marks overwrite yesterday's.
  const day = ensureDayStart(state, now);
  let s: PaperState = {
    ...day,
    positions: day.positions.map((p) => {
      const q = quotes[contractKey(p)];
      const m = quoteMark(q);
      return isNum(m) && m > 0 ? { ...p, ltp: m, markAt: ts, markSource: q.source } : p;
    }),
  };
  const ctx: PlaceContext = { quote: null, now, spots };

  // Limit orders.
  for (const o of s.orders.filter((x) => x.status === "OPEN" && x.orderType === "LIMIT")) {
    const q = quotes[contractKey(o)];
    if (!canUseQuote(s, q ?? null)) continue;
    const px = limitFillPrice(q, o.side, o.limitPrice ?? NaN, s.settings.slippagePct);
    if (!isNum(px)) continue;
    const short = riskSideError(o.side, px, o.sl, o.target) ?? fundsCheck(s, o, px, { ...ctx, quote: q });
    if (short) {
      s = { ...s, orders: s.orders.map((x) => (x.id === o.id ? { ...x, status: "REJECTED", updatedAt: ts, reason: short } : x)) };
      events.push({ kind: "rejected", message: `Limit ${o.side} ${contractLabel(o)} rejected: ${short}` });
      continue;
    }
    s = applyFill(s, o, px, now, q.source);
    events.push({ kind: "limit-filled", message: `Limit ${o.side} ${o.lots} × ${contractLabel(o)} filled at ₹${px.toFixed(2)}.` });
  }

  // Stop-loss and target.
  for (const p of [...s.positions]) {
    if (p.sl === undefined && p.target === undefined) continue;
    const q = quotes[p.key];
    if (!canUseQuote(s, q ?? null)) continue;
    const m = quoteMark(q);
    if (!isNum(m)) continue;
    const long = p.netLots > 0;
    const slHit = p.sl !== undefined && (long ? m <= p.sl : m >= p.sl);
    const tgHit = !slHit && p.target !== undefined && (long ? m >= p.target : m <= p.target);
    if (!slHit && !tgHit) continue;
    const res = squareOff(s, p.key, { ...ctx, quote: q }, slHit ? "sl" : "target");
    if (!res) continue;
    s = res.state;
    if (res.outcome === "filled") events.push({ kind: slHit ? "sl" : "target", message: `${slHit ? "Stop-loss" : "Target"} hit on ${contractLabel(p)} at ₹${m.toFixed(2)}. ${res.message}` });
  }

  // Expiry.
  const st = settleExpiredPaper(s, now, spots, settlementPrices);
  s = st.state;
  for (const e of st.settled) events.push({ kind: "settled", message: `${e.label} settled at ₹${e.settlement.toFixed(2)}${e.stt ? ` (STT on exercise ₹${e.stt.toFixed(2)})` : ""}.` });
  return { state: s, events };
}

// ── Reporting ──

/** Realised P&L (net of charges) per IST date. */
export function dailyPnl(state: PaperState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of state.trades) out[t.date] = round2((out[t.date] ?? 0) + t.realisedNet);
  return out;
}

export function dteAt(expiry: string, now: Date = new Date()): number {
  return Math.max(0, calendarDaysBetween(istDateString(now), expiry));
}

// ── Basket import ──

export interface BasketLegLike {
  symbol: string;
  expiry: string;
  strike: number;
  type: OptionType;
  side: Side;
  lots: number;
  premium: number;
}

/** Turn basket legs (option-chain contract) into market order inputs. Unknown lot sizes are skipped. */
export function basketToOrders(legs: BasketLegLike[], lotSizeFor: (symbol: string, expiry: string) => number | undefined): { orders: OrderInput[]; skipped: string[] } {
  const orders: OrderInput[] = [];
  const skipped: string[] = [];
  for (const l of legs) {
    const lot = lotSizeFor(l.symbol, l.expiry);
    if (!lot || !(l.lots > 0) || !(l.strike > 0)) {
      skipped.push(`${l.symbol} ${l.strike} ${l.type}`);
      continue;
    }
    orders.push({ symbol: l.symbol, expiry: l.expiry, strike: l.strike, type: l.type, side: l.side, lots: Math.max(1, Math.round(l.lots)), lotSize: lot, orderType: "MARKET", origin: "basket" });
  }
  return { orders, skipped };
}

// ── Persistence, export / import ──

function validContract(o: Record<string, unknown>): boolean {
  return typeof o.symbol === "string" && typeof o.expiry === "string" && isValidIsoDate(o.expiry) && isNum(o.strike) && (o.type === "CE" || o.type === "PE");
}

/** Hand-written validation of a stored or imported state. Returns null when the shape is wrong. */
export function parsePaperState(json: string): PaperState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !isNum(o.cash) || !isNum(o.startingCapital)) return null;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : []);
  const st = (o.settings && typeof o.settings === "object" ? o.settings : {}) as Record<string, unknown>;
  const settings: PaperSettings = {
    slippagePct: isNum(st.slippagePct) && st.slippagePct >= 0 && st.slippagePct <= 20 ? st.slippagePct : DEFAULT_SLIPPAGE_PCT,
    brokerId: typeof st.brokerId === "string" && getBrokerPreset(st.brokerId) ? st.brokerId : "zerodha",
    allowSampleFills: st.allowSampleFills !== false,
    guardrails: parseGuardrails(st.guardrails),
  };
  // Imported or stored state is untrusted: hold it to the same rules as a freshly placed order.
  const optPos = (v: unknown): number | undefined => (isNum(v) && v > 0 ? v : undefined);
  const positions = arr(o.positions)
    .filter((p) => validContract(p) && isNum(p.netLots) && Number.isInteger(p.netLots) && p.netLots !== 0 && isNum(p.lotSize) && p.lotSize > 0 && isNum(p.avgPrice) && p.avgPrice >= 0)
    .map((p) => {
      const pos = p as unknown as PaperPosition;
      return { ...pos, sl: optPos(p.sl), target: optPos(p.target), key: contractKey(pos) };
    });
  const orders = arr(o.orders)
    .filter(
      (x) =>
        validContract(x) &&
        typeof x.id === "string" &&
        (x.side === "BUY" || x.side === "SELL") &&
        isNum(x.lots) &&
        Number.isInteger(x.lots) &&
        x.lots > 0 &&
        isNum(x.lotSize) &&
        x.lotSize > 0 &&
        (x.orderType === "MARKET" || (x.orderType === "LIMIT" && isNum(x.limitPrice) && x.limitPrice > 0)) &&
        ORDER_STATUSES.has(x.status as OrderStatus),
    )
    .map((x) => ({ ...x, sl: optPos(x.sl), target: optPos(x.target) })) as unknown as PaperOrder[];
  const trades = arr(o.trades).filter((x) => validContract(x) && typeof x.id === "string" && typeof x.date === "string" && isNum(x.price) && isNum(x.realisedNet) && isNum(x.realisedGross) && isNum(x.charges)) as unknown as PaperTrade[];
  const ledger = arr(o.ledger).filter((x) => typeof x.id === "string" && isNum(x.ts) && isNum(x.amount) && isNum(x.balance) && typeof x.kind === "string") as unknown as LedgerEntry[];
  return {
    version: 1,
    startingCapital: o.startingCapital,
    cash: o.cash,
    settings,
    orders,
    positions,
    trades,
    ledger,
    createdAt: isNum(o.createdAt) ? o.createdAt : Date.now(),
    ...(parseSpotMarks(o.spotMarks) ?? {}),
    ...(parseKillSwitch(o.killSwitch) ?? {}),
    ...(parseDayStart(o.dayStart) ?? {}),
  };
}

function parseDayStart(x: unknown): { dayStart: DayStart } | null {
  if (!x || typeof x !== "object") return null;
  const d = x as Record<string, unknown>;
  if (typeof d.date !== "string" || !isNum(d.equity) || !isNum(d.ts)) return null;
  return { dayStart: { date: d.date, equity: d.equity, ts: d.ts } };
}

export function parseGuardrails(x: unknown): Guardrails {
  const g = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  return {
    beginnerMode: g.beginnerMode !== false,
    maxRiskPct: isNum(g.maxRiskPct) && g.maxRiskPct > 0 && g.maxRiskPct <= 100 ? g.maxRiskPct : DEFAULT_GUARDRAILS.maxRiskPct,
    dailyLossCap: g.dailyLossCap === null ? null : isNum(g.dailyLossCap) && g.dailyLossCap > 0 ? g.dailyLossCap : DEFAULT_GUARDRAILS.dailyLossCap,
  };
}

function parseKillSwitch(x: unknown): { killSwitch: KillSwitch } | null {
  if (!x || typeof x !== "object") return null;
  const k = x as Record<string, unknown>;
  if (!isNum(k.until) || !isNum(k.at)) return null;
  return { killSwitch: { until: k.until, at: k.at, reason: typeof k.reason === "string" ? k.reason : "Kill switch" } };
}

function parseSpotMarks(x: unknown): { spotMarks: Record<string, SpotMark> } | null {
  if (!x || typeof x !== "object") return null;
  const out: Record<string, SpotMark> = {};
  for (const [sym, m] of Object.entries(x as Record<string, unknown>)) {
    const v = m as Record<string, unknown> | null;
    if (v && isNum(v.spot) && v.spot > 0 && isNum(v.ts)) out[sym] = { spot: v.spot, ts: v.ts };
  }
  return Object.keys(out).length ? { spotMarks: out } : null;
}

export function exportPaperState(state: PaperState): string {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export function loadPaper(): PaperState | null {
  try {
    const raw = localStorage.getItem(PAPER_KEY);
    return raw ? parsePaperState(raw) : null;
  } catch {
    return null;
  }
}

export function savePaper(state: PaperState): boolean {
  try {
    localStorage.setItem(PAPER_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ── Debounced persistence ──

export interface PaperSaver {
  /** Queue a save; the latest state is written once nothing new arrives for `delayMs`. */
  schedule(state: PaperState): void;
  /** Write any pending state now. Returns false only when a write was attempted and failed. */
  flush(): boolean;
  /**
   * Hold a mark-only state (new LTPs, spot marks) without a timer. It is written by the next flush
   * (page hidden or closed) or carried by the next scheduled save, so price ticks alone never write
   * the account and cannot race another tab's save.
   */
  defer(state: PaperState): void;
  /** Drop a pending write without saving. */
  cancel(): void;
  /** True while a material (scheduled) change is waiting to be written. Deferred marks do not count. */
  pending(): boolean;
}

const MARK_FIELDS = new Set(["ltp", "markAt", "markSource"]);

function samePositionIgnoringMarks(a: PaperPosition, b: PaperPosition): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (MARK_FIELDS.has(k)) continue;
    const av = (a as unknown as Record<string, unknown>)[k];
    const bv = (b as unknown as Record<string, unknown>)[k];
    if (av !== bv) return false;
  }
  return true;
}

/**
 * Does `next` hold a change worth writing straight away (orders, fills, trades, ledger, cash,
 * settings, SL/target edits, kill switch)? Mark-only changes from a price tick (position LTPs,
 * spot marks, the day-start snapshot) return false. `prev` null means nothing is saved yet.
 */
export function paperChangeIsMaterial(prev: PaperState | null, next: PaperState): boolean {
  if (!prev) return true;
  if (prev === next) return false;
  if (
    prev.orders !== next.orders ||
    prev.trades !== next.trades ||
    prev.ledger !== next.ledger ||
    prev.cash !== next.cash ||
    prev.startingCapital !== next.startingCapital ||
    prev.settings !== next.settings ||
    prev.killSwitch !== next.killSwitch ||
    prev.createdAt !== next.createdAt ||
    prev.positions.length !== next.positions.length
  ) {
    return true;
  }
  return next.positions.some((p, i) => !samePositionIgnoringMarks(prev.positions[i], p));
}

/**
 * Debounce writes of the paper account (default about 1 s) so a burst of ticks or fills costs one
 * localStorage write. Call flush() on pagehide / visibility hidden / unmount so nothing is lost.
 */
export function createPaperSaver(o?: { delayMs?: number; maxWaitMs?: number; save?: (s: PaperState) => boolean; onError?: () => void }): PaperSaver {
  const delay = Math.max(0, o?.delayMs ?? 1000);
  // Upper bound on how long a change can wait: a steady stream of ticks faster than `delay` would
  // otherwise keep pushing the write back until pagehide, and a crash would lose the session.
  const maxWait = Math.max(delay, o?.maxWaitMs ?? 5000);
  const save = o?.save ?? savePaper;
  let queued: PaperState | null = null;
  let deferred: PaperState | null = null;
  let firstQueuedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const flush = (): boolean => {
    clear();
    firstQueuedAt = null;
    const st = queued ?? deferred;
    queued = null;
    deferred = null;
    if (!st) return true;
    const ok = save(st);
    if (!ok) o?.onError?.();
    return ok;
  };
  return {
    schedule(state) {
      queued = state;
      deferred = null;
      const now = Date.now();
      if (firstQueuedAt === null) firstQueuedAt = now;
      clear();
      const wait = Math.max(0, Math.min(delay, firstQueuedAt + maxWait - now));
      timer = setTimeout(flush, wait);
    },
    flush,
    defer(state) {
      // A newer state supersedes a queued one (it carries the queued change as well).
      if (queued) queued = state;
      else deferred = state;
    },
    cancel() {
      clear();
      queued = null;
      deferred = null;
      firstQueuedAt = null;
    },
    pending: () => queued !== null,
  };
}

// ── Ledger archiving ──

export const LEDGER_ARCHIVE_DAYS = 90;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Fold ledger rows dated more than `days` IST calendar days before `now` into one ARCHIVE summary row
 * per calendar month. The summary keeps the month's net cash flow, the running balance after its last
 * row, the row count and the total per kind, so the cash history still reconciles. Existing summary
 * rows are kept as they are; the DEPOSIT that opened the account is never folded.
 */
export function compactLedger(state: PaperState, now: Date = new Date(), days: number = LEDGER_ARCHIVE_DAYS): PaperState {
  const cutoff = isoMinusDays(istDateString(now), days);
  const ledger = state.ledger;
  const old = ledger.filter((e, i) => e.date < cutoff && e.kind !== "ARCHIVE" && !(i === 0 && e.kind === "DEPOSIT"));
  if (!old.length) return state;
  const oldIds = new Set(old.map((e) => e.id));
  const byMonth = new Map<string, LedgerEntry[]>();
  for (const e of old) {
    const m = e.date.slice(0, 7);
    const arr = byMonth.get(m);
    if (arr) arr.push(e);
    else byMonth.set(m, [e]);
  }
  const summaries = new Map<string, LedgerEntry>();
  const lastIdOfMonth = new Map<string, string>();
  for (const [month, rows] of byMonth) {
    // Ledger rows are appended in order, so the last row of the month carries its closing balance.
    const sorted = rows;
    const last = sorted[sorted.length - 1];
    lastIdOfMonth.set(month, last.id);
    const byKind: Partial<Record<LedgerKind, number>> = {};
    for (const r of sorted) byKind[r.kind] = round2((byKind[r.kind] ?? 0) + r.amount);
    const amount = round2(sorted.reduce((a, r) => a + r.amount, 0));
    const [y, mm] = month.split("-");
    summaries.set(month, {
      id: `archive-${month}-${last.id}`,
      ts: last.ts,
      date: last.date,
      kind: "ARCHIVE",
      description: `Archived ${sorted.length} entr${sorted.length === 1 ? "y" : "ies"} for ${MONTH_SHORT[Number(mm) - 1] ?? mm} ${y}`,
      amount,
      balance: last.balance,
      archived: { count: sorted.length, from: sorted[0].date, to: last.date, byKind },
    });
  }
  // Rebuild in time order: each month summary replaces its rows at the position of the month's last row.
  const out: LedgerEntry[] = [];
  for (const e of ledger) {
    if (!oldIds.has(e.id)) {
      out.push(e);
      continue;
    }
    const m = e.date.slice(0, 7);
    const summary = summaries.get(m);
    if (summary && lastIdOfMonth.get(m) === e.id) out.push(summary);
  }
  return { ...state, ledger: out };
}

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - Math.max(0, Math.floor(days)));
  return d.toISOString().slice(0, 10);
}

// ── Guardrails ──

export function guardrailsOf(state: PaperState): Guardrails {
  return state.settings.guardrails ?? { ...DEFAULT_GUARDRAILS };
}

/** True while the kill switch blocks new opening orders. */
export function killSwitchActive(state: PaperState, now: Date = new Date()): boolean {
  return !!state.killSwitch && state.killSwitch.until > now.getTime();
}

/** 09:15 IST on the next trading day after `now`: when a kill switch set today expires. */
export function nextSessionOpen(now: Date = new Date()): number {
  return toISTDate(addTradingDays(istDateString(now), 1), "09:15").getTime();
}

/** Turn on the kill switch: cancels open orders and blocks new opening orders until the next session. */
export function activateKillSwitch(state: PaperState, now: Date = new Date(), reason = "Kill switch pressed"): PaperState {
  const ts = now.getTime();
  return {
    ...state,
    killSwitch: { until: nextSessionOpen(now), at: ts, reason },
    orders: state.orders.map((o) => (o.status === "OPEN" ? { ...o, status: "CANCELLED" as const, updatedAt: ts, reason: "Cancelled by the kill switch" } : o)),
  };
}

export function releaseKillSwitch(state: PaperState): PaperState {
  if (!state.killSwitch) return state;
  const next = { ...state };
  delete next.killSwitch;
  return next;
}

/**
 * Today's P&L for the loss cap: equity now minus equity at the start of the IST day (realised,
 * charges, settlements and open MTM since the previous session's marks).
 *
 * Without a snapshot for today (no tick or fill yet), it falls back to today's realised net plus
 * the MTM of positions opened today; positions carried overnight count as flat until the first
 * tick, so an old loss cannot trip the cap at the open and an old gain cannot hide today's losses.
 */
export function todayPnl(state: PaperState, now: Date = new Date()): number {
  const today = istDateString(now);
  if (state.dayStart?.date === today) {
    const deposits = state.ledger.reduce((a, e) => a + (e.kind === "DEPOSIT" && e.date === today && e.ts > state.dayStart!.ts ? e.amount : 0), 0);
    return round2(equityOf(state) - state.dayStart.equity - deposits);
  }
  const realised = state.trades.reduce((a, t) => a + (t.date === today ? t.realisedNet : 0), 0);
  const openedToday = state.positions.filter((p) => isNum(p.openedAt) && istDateString(new Date(p.openedAt)) === today);
  return round2(realised + unrealisedPnl(openedToday));
}

/** True when today's loss has reached the daily cap. */
export function dailyCapBreached(state: PaperState, now: Date = new Date()): boolean {
  const cap = guardrailsOf(state).dailyLossCap;
  return cap !== null && cap > 0 && todayPnl(state, now) <= -cap;
}

/**
 * Net short lots per symbol, expiry and option type that are not covered by a long of the same type
 * in the same or a later expiry (a vertical or calendar spread covers its short). Keyed "SYM|EXP|TYPE".
 */
type CoverLeg = Pick<PaperPosition, "symbol" | "expiry" | "type" | "netLots"> & { lotSize?: number };

export function nakedShorts(positions: CoverLeg[]): Record<string, number> {
  const out: Record<string, number> = {};
  const groups = new Map<string, CoverLeg[]>();
  for (const p of positions) {
    if (!p.netLots) continue;
    const k = `${p.symbol}|${p.type}`;
    const arr = groups.get(k);
    if (arr) arr.push(p);
    else groups.set(k, [p]);
  }
  for (const list of groups.values()) {
    // Walk expiries from the latest: longs in later expiries cover shorts in earlier ones. Cover
    // is netted in units (lots × lot size), so a lot-size revision between expiries is respected;
    // the result is reported in lots of the short expiry.
    const units = (p: CoverLeg) => p.netLots * (isNum(p.lotSize) && p.lotSize > 0 ? p.lotSize : 1);
    const expiries = [...new Set(list.map((p) => p.expiry))].sort().reverse();
    let spareLongs = 0;
    for (const e of expiries) {
      const at = list.filter((p) => p.expiry === e);
      const longs = at.reduce((a, p) => a + Math.max(0, units(p)), 0);
      const shorts = at.reduce((a, p) => a + Math.max(0, -units(p)), 0);
      spareLongs += longs;
      const covered = Math.min(shorts, spareLongs);
      spareLongs -= covered;
      const nakedUnits = shorts - covered;
      if (nakedUnits > 1e-9) {
        const lot = at.find((p) => p.netLots < 0 && isNum(p.lotSize) && p.lotSize > 0)?.lotSize ?? 1;
        out[`${at[0].symbol}|${e}|${at[0].type}`] = Math.round((nakedUnits / lot) * 1e6) / 1e6;
      }
    }
  }
  return out;
}

/** Positions after a set of orders fill (netting only; prices ignored). */
export function positionsAfter(positions: PaperPosition[], orders: Array<Pick<OrderInput, "symbol" | "expiry" | "strike" | "type" | "side" | "lots" | "lotSize">>): Array<Pick<PaperPosition, "key" | "symbol" | "expiry" | "strike" | "type" | "netLots" | "lotSize">> {
  const map = new Map(positions.map((p) => [p.key, { key: p.key, symbol: p.symbol, expiry: p.expiry, strike: p.strike, type: p.type, netLots: p.netLots, lotSize: p.lotSize }]));
  for (const o of orders) {
    const key = contractKey(o);
    const cur = map.get(key) ?? { key, symbol: o.symbol, expiry: o.expiry, strike: o.strike, type: o.type, netLots: 0, lotSize: o.lotSize };
    cur.netLots += o.side === "BUY" ? o.lots : -o.lots;
    map.set(key, cur);
  }
  return [...map.values()].filter((p) => p.netLots !== 0);
}

/** True when every order only reduces an existing position (no new exposure, no flip through zero). */
export function isRiskReducing(positions: PaperPosition[], orders: Array<Pick<OrderInput, "symbol" | "expiry" | "strike" | "type" | "side" | "lots">>): boolean {
  if (!orders.length) return false;
  const net = new Map(positions.map((p) => [p.key, p.netLots]));
  for (const o of orders) {
    const key = contractKey(o);
    const n = net.get(key) ?? 0;
    const signed = o.side === "BUY" ? o.lots : -o.lots;
    if (n === 0 || Math.sign(n) === Math.sign(signed) || Math.abs(signed) > Math.abs(n)) return false;
    net.set(key, n + signed);
  }
  return true;
}

/** Would these orders leave (or add to) a naked short? Returns the offending contracts. */
export function nakedShortViolations(positions: PaperPosition[], orders: Array<Pick<OrderInput, "symbol" | "expiry" | "strike" | "type" | "side" | "lots" | "lotSize">>): string[] {
  const before = nakedShorts(positions);
  const after = nakedShorts(positionsAfter(positions, orders));
  return Object.entries(after)
    .filter(([k, v]) => v > (before[k] ?? 0))
    .map(([k]) => {
      const [sym, exp, type] = k.split("|");
      return `${sym} ${type} (${exp})`;
    });
}

export interface RiskLeg {
  input: Pick<OrderInput, "symbol" | "expiry" | "strike" | "type" | "side" | "lots" | "lotSize" | "sl">;
  /** Expected fill price per unit. */
  price: number;
}

function stopOnRightSide(l: RiskLeg): boolean {
  const sl = l.input.sl;
  return sl !== undefined && isNum(sl) && sl > 0 && (l.input.side === "BUY" ? sl < l.price : sl > l.price);
}

/**
 * Worst-case loss in ₹ for new orders, including entry and exit charges.
 * - One order with a stop-loss: the distance to the stop × qty (+ charges).
 * - One long without a stop: the premium paid.
 * - Several legs: the expiry max loss of the combined legs per underlying and expiry (unlimited when
 *   any group has a naked short).
 * - A short without a stop and without a hedge: unlimited.
 */
export function worstCaseLoss(legs: RiskLeg[], broker?: BrokerPreset, onDate?: string): { loss: number; unlimited: boolean; charges: number; basis: "stop" | "premium" | "payoff" } {
  const valid = legs.filter((l) => l.price > 0 && l.input.lots > 0 && l.input.lotSize > 0);
  if (!valid.length) return { loss: 0, unlimited: false, charges: 0, basis: "premium" };
  const fills = valid.flatMap((l) => {
    const qty = l.input.lots * l.input.lotSize;
    const exitPx = stopOnRightSide(l) ? (l.input.sl as number) : l.price;
    const exchange = exchangeOf(l.input.symbol);
    return [
      { type: l.input.type, side: l.input.side, price: l.price, qty, exchange },
      { type: l.input.type, side: l.input.side === "BUY" ? ("SELL" as const) : ("BUY" as const), price: exitPx, qty, exchange },
    ];
  });
  const charges = round2(calcCharges(fills, { broker, onDate }).total);
  if (valid.length === 1) {
    const { input, price } = valid[0];
    const qty = input.lots * input.lotSize;
    // A stop on the wrong side of the entry is no stop at all (never zero risk).
    if (stopOnRightSide(valid[0])) {
      const sl = input.sl as number;
      const perUnit = input.side === "BUY" ? price - sl : sl - price;
      return { loss: round2(perUnit * qty + charges), unlimited: false, charges, basis: "stop" };
    }
    if (input.side === "BUY") return { loss: round2(price * qty + charges), unlimited: false, charges, basis: "premium" };
    return { loss: Infinity, unlimited: true, charges, basis: "payoff" };
  }
  // Group per underlying. A group with several expiries (calendar or diagonal) is valued at the
  // front expiry: a long in a later expiry is worth at least its intrinsic value then, so it caps
  // a short of the same type exactly as nakedShorts treats it as cover. Any short that no later
  // long covers stays unlimited. (Time value left in far longs makes this conservative.)
  const groups = new Map<string, Leg[]>();
  for (const l of valid) {
    const k = l.input.symbol;
    const leg: Leg = { symbol: l.input.symbol, type: l.input.type, side: l.input.side, strike: l.input.strike, expiry: l.input.expiry, lots: l.input.lots, lotSize: l.input.lotSize, premium: l.price };
    const arr = groups.get(k);
    if (arr) arr.push(leg);
    else groups.set(k, [leg]);
  }
  let loss = 0;
  for (const g0 of groups.values()) {
    const expiries = [...new Set(g0.map((l) => l.expiry))].sort();
    let g = g0;
    if (expiries.length > 1) {
      // Each expiry bounded on its own (independent spreads): keep the per-expiry sum, which is
      // the conservative figure. Only fall back to the front-expiry view when cover crosses expiries.
      const perExpiry = expiries.map((e) => maxProfitLoss(g0.filter((l) => l.expiry === e)));
      if (perExpiry.every((m) => !m.unlimitedLoss && Number.isFinite(m.maxLoss))) {
        for (const m of perExpiry) loss += Math.max(0, -m.maxLoss);
        continue;
      }
      const naked = nakedShorts(g0.map((l) => ({ symbol: l.symbol, expiry: l.expiry, type: l.type as OptionType, netLots: l.side === "BUY" ? l.lots : -l.lots, lotSize: l.lotSize })));
      if (Object.keys(naked).length > 0) return { loss: Infinity, unlimited: true, charges, basis: "payoff" };
      g = g0.map((l) => ({ ...l, expiry: expiries[0] }));
    }
    const m = maxProfitLoss(g);
    if (m.unlimitedLoss || !Number.isFinite(m.maxLoss)) return { loss: Infinity, unlimited: true, charges, basis: "payoff" };
    loss += Math.max(0, -m.maxLoss);
  }
  return { loss: round2(loss + charges), unlimited: false, charges, basis: "payoff" };
}

export interface GuardResult {
  ok: boolean;
  /** Reasons the order cannot be placed, in plain words. */
  blockers: string[];
  /** Orders only reduce existing positions; guardrails do not apply. */
  reducing: boolean;
  risk: ReturnType<typeof worstCaseLoss>;
  /** Declared max loss as a percent of capital. */
  maxLossPct: number;
}

/**
 * Check new orders against the guardrails before placing: kill switch, daily loss cap, beginner mode
 * (no naked shorts) and the mandatory max loss (in ₹, capped as a percent of capital). Orders that only
 * reduce existing positions always pass, so you can always get out.
 */
export function guardCheck(state: PaperState, legs: RiskLeg[], maxLossRs: number | null | undefined, o: { now?: Date; capital?: number } = {}): GuardResult {
  const now = o.now ?? new Date();
  const g = guardrailsOf(state);
  // Max-risk % is measured against current equity (cash + open positions at their marks), so a
  // depleted account gets a smaller per-trade limit and a grown one a larger one.
  const equity = equityOf(state);
  const capital = isNum(o.capital) && o.capital > 0 ? o.capital : equity > 0 ? equity : state.startingCapital;
  const inputs = legs.map((l) => l.input);
  const reducing = isRiskReducing(state.positions, inputs);
  const risk = worstCaseLoss(legs, brokerFor(state), istDateString(now));
  const maxLossPct = isNum(maxLossRs) && capital > 0 ? (maxLossRs / capital) * 100 : NaN;
  if (reducing) return { ok: true, blockers: [], reducing, risk, maxLossPct };
  const blockers: string[] = [];
  if (killSwitchActive(state, now)) blockers.push("The kill switch is on. Only exits are allowed until the next session.");
  else if (dailyCapBreached(state, now)) blockers.push(`Today's loss has reached your daily cap of ₹${Math.round(g.dailyLossCap ?? 0).toLocaleString("en-IN")}. Only exits are allowed today.`);
  if (g.beginnerMode) {
    const naked = nakedShortViolations(state.positions, inputs);
    if (naked.length) blockers.push(`Beginner mode blocks naked short options: ${naked.join(", ")}. Buy a hedge in the same order, or turn beginner mode off.`);
  }
  if (!isNum(maxLossRs) || maxLossRs <= 0) blockers.push("Set the most you are willing to lose on this trade (₹) before placing it.");
  else {
    if (maxLossPct > g.maxRiskPct + 1e-9) blockers.push(`Your max loss is ${maxLossPct.toFixed(2)}% of capital, above your ${g.maxRiskPct}% limit.`);
    if (risk.unlimited) blockers.push("The loss on this order is unlimited. Add a stop-loss, or a hedge leg in a basket.");
    else if (risk.loss > maxLossRs + 0.5) blockers.push(`Worst case ₹${Math.round(risk.loss).toLocaleString("en-IN")} is more than your max loss of ₹${Math.round(maxLossRs).toLocaleString("en-IN")}. Reduce lots or tighten the stop.`);
  }
  return { ok: blockers.length === 0, blockers, reducing, risk, maxLossPct };
}
