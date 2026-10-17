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
  calcCharges,
  calendarDaysBetween,
  estimateMargin,
  exerciseSTT,
  getBrokerPreset,
  intrinsic,
  isValidIsoDate,
  istDateString,
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

export type LedgerKind = "DEPOSIT" | "PREMIUM" | "CHARGES" | "SETTLEMENT" | "EXERCISE_STT" | "RESET";

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
}

export interface PaperSettings {
  /** Slippage in percent of mid (0.5 = 0.5%). */
  slippagePct: number;
  brokerId: string;
  /** Fill against generated sample quotes when no live chain is available (fills are labelled). */
  allowSampleFills: boolean;
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
    settings: { slippagePct: DEFAULT_SLIPPAGE_PCT, brokerId: "zerodha", allowSampleFills: true, ...settings },
    orders: [],
    positions: [],
    trades: [],
    ledger: [{ id: newId("l", ts), ts, date: istDateString(now), kind: "DEPOSIT", description: "Virtual capital", amount: cap, balance: cap }],
    createdAt: ts,
  };
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
export function applyFill(state: PaperState, order: PaperOrder, price: number, now: Date, quoteSource?: string): PaperState {
  const s: PaperState = { ...state, orders: [...state.orders], positions: state.positions.map((p) => ({ ...p })), trades: [...state.trades], ledger: [...state.ledger] };
  const ts = now.getTime();
  const date = istDateString(now);
  const qty = order.lots * order.lotSize;
  const signedLots = order.side === "BUY" ? order.lots : -order.lots;
  const ch = calcCharges([{ type: order.type, side: order.side, price, qty }], { broker: brokerFor(s), onDate: date });
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
  let s: PaperState = {
    ...state,
    positions: state.positions.map((p) => {
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
    const short = fundsCheck(s, o, px, { ...ctx, quote: q });
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
  };
  const positions = arr(o.positions)
    .filter((p) => validContract(p) && isNum(p.netLots) && p.netLots !== 0 && isNum(p.lotSize) && p.lotSize > 0 && isNum(p.avgPrice))
    .map((p) => {
      const pos = p as unknown as PaperPosition;
      return { ...pos, key: contractKey(pos) };
    });
  const orders = arr(o.orders).filter((x) => validContract(x) && typeof x.id === "string" && (x.side === "BUY" || x.side === "SELL") && isNum(x.lots) && isNum(x.lotSize) && typeof x.status === "string") as unknown as PaperOrder[];
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
  };
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
