/**
 * Position store: localStorage CRUD for manually tracked option positions.
 *
 * - Lot sizes come from the shared contract table in "@/lib/options" (getLotSize). An unknown symbol
 *   returns undefined; callers show a visible warning and ask for the lot size instead of guessing.
 * - Expiry is stored as ISO yyyy-mm-dd. Legacy "20-Oct-2026" / "20 Oct" strings are normalised on read.
 * - Closing a position deducts entry and exit charges: grossPnl is kept, netPnl = grossPnl − charges.
 * - settleExpired(now, spots) settles expired positions at intrinsic value and charges STT on exercise
 *   for in-the-money long options.
 * - Every storage write is wrapped in try/catch (private mode or a full quota never throws).
 */
import type { Position } from "./mockData";
import {
  CONTRACT_SPECS,
  chargesForLegs,
  exerciseSTT,
  getLotSize as getContractLotSize,
  getStrikeStep,
  intrinsic,
  isValidIsoDate,
  istDateString,
  normalizeExpiry,
  toISTDate,
  type BrokerPreset,
  type ChargesBreakdown,
  type Leg,
} from "@/lib/options";

const STORAGE_KEY = "optionsdesk_positions";
const CLOSED_STORAGE_KEY = "optionsdesk_closed_positions";

// ── Data model ──

/** A tracked position. Extends the legacy Position shape with optional fields (all backwards compatible). */
export interface TrackedPosition extends Position {
  /** ISO entry date (yyyy-mm-dd, IST). `entryDate` stays as the short display label. */
  entryDateIso?: string;
  /** Groups legs of one strategy (e.g. an iron condor entered together). */
  strategyId?: string;
  /** Free-text label shown as a chip (e.g. "Weekly strangle"). */
  tag?: string;
  /** True when the CMP was typed by the user and must not be overwritten by the live feed. */
  cmpManual?: boolean;
}

export type CloseReason = "manual" | "expiry";

export interface ClosedPosition extends TrackedPosition {
  exitPrice: number;
  exitDate: string;
  exitDateIso?: string;
  /** Net realised P&L (= netPnl). Kept for backwards compatibility. */
  realizedPnl: number;
  /** (exit − entry) × side × qty, before charges. */
  grossPnl?: number;
  /** Entry + exit charges (and STT on exercise when settled ITM). */
  charges?: number;
  chargesBreakdown?: ChargesBreakdown;
  netPnl?: number;
  closeReason?: CloseReason;
  /** STT on exercise (ITM long settled at expiry). */
  exerciseStt?: number;
  /** Underlying price used for an expiry settlement. */
  settlementSpot?: number;
}

// ── Lot sizes, spot defaults, strike steps ──

/**
 * Lot size per symbol, read live from the shared contract table (so runtime overrides from the
 * instrument master apply). Kept as an object export for compatibility with older imports.
 */
export const LOT_SIZE_MAP: Record<string, number> = new Proxy({} as Record<string, number>, {
  get: (_t, key) => (typeof key === "string" ? getContractLotSize(key) : undefined),
  has: (_t, key) => typeof key === "string" && getContractLotSize(key) !== undefined,
  ownKeys: () => Object.keys(CONTRACT_SPECS),
  getOwnPropertyDescriptor: (_t, key) => {
    if (typeof key !== "string") return undefined;
    const v = getContractLotSize(key);
    return v === undefined ? undefined : { value: v, enumerable: true, configurable: true, writable: false };
  },
});

/**
 * Lot size for a symbol (and optionally a contract expiry, since older contracts keep their old lot).
 * undefined for an unknown symbol: callers must warn and ask the user for it.
 */
export function getLotSize(symbol: string, expiryIso?: string): number | undefined {
  return getContractLotSize(symbol, expiryIso);
}

/** Approximate reference spot prices, used only as a last-resort default when no quote is available. */
export const SPOT_PRICE_MAP: Record<string, number> = {
  NIFTY: 24250,
  BANKNIFTY: 51850,
  FINNIFTY: 23180,
  MIDCPNIFTY: 12850,
  SENSEX: 80000,
  BANKEX: 58000,
  RELIANCE: 2945,
  TCS: 3850,
  HDFCBANK: 1685,
  INFY: 1520,
  ICICIBANK: 1245,
  SBIN: 825,
  TATAMOTORS: 985,
  BAJFINANCE: 7280,
  ITC: 468,
  MARUTI: 12450,
  HINDUNILVR: 2650,
  BHARTIARTL: 1580,
  KOTAKBANK: 1820,
  LT: 3450,
  AXISBANK: 1125,
  SUNPHARMA: 1680,
  TITAN: 3250,
  WIPRO: 485,
  TATASTEEL: 168,
  HINDALCO: 625,
  DLF: 885,
};

/** Strike steps per symbol (delegates to the contract table; 50 when unknown). */
export const STEP_SIZE_MAP: Record<string, number> = new Proxy({} as Record<string, number>, {
  get: (_t, key) => (typeof key === "string" ? getStrikeStep(key) : undefined),
});

export function getSpotPrice(symbol: string): number {
  return SPOT_PRICE_MAP[symbol] || 2500;
}

export function getStepSize(symbol: string): number {
  return getStrikeStep(symbol);
}

// ── Helpers ──

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const round2 = (v: number) => Math.round(v * 100) / 100;

function shortDateLabel(d: Date = new Date()): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

/** ISO expiry for a position ("" when it cannot be parsed). */
export function positionExpiryIso(p: Pick<Position, "expiry">): string {
  if (!p.expiry) return "";
  return isValidIsoDate(p.expiry) ? p.expiry : normalizeExpiry(p.expiry);
}

export function sideSign(action: "BUY" | "SELL"): 1 | -1 {
  return action === "BUY" ? 1 : -1;
}

/** Gross P&L in rupees for a price (positive = profit). */
export function grossPnlAt(p: Pick<Position, "action" | "entryPrice" | "lots" | "lotSize">, price: number): number {
  return (price - p.entryPrice) * sideSign(p.action) * p.lots * p.lotSize;
}

function pnlPercentAt(p: Pick<Position, "action" | "entryPrice">, price: number): number {
  return p.entryPrice > 0 ? Math.round(((price - p.entryPrice) / p.entryPrice) * sideSign(p.action) * 10000) / 100 : 0;
}

/** The position as a math-core Leg (entry premium, ISO expiry). */
export function positionToLeg(p: TrackedPosition, overrides?: Partial<Leg>): Leg {
  return {
    id: p.id,
    symbol: p.symbol,
    type: p.type,
    side: p.action,
    strike: p.strike,
    expiry: positionExpiryIso(p),
    lots: p.lots,
    lotSize: p.lotSize,
    premium: p.entryPrice,
    ...overrides,
  };
}

function sumCharges(a: ChargesBreakdown, b: ChargesBreakdown): ChargesBreakdown {
  return {
    brokerage: a.brokerage + b.brokerage,
    stt: a.stt + b.stt,
    exchange: a.exchange + b.exchange,
    sebi: a.sebi + b.sebi,
    stamp: a.stamp + b.stamp,
    gst: a.gst + b.gst,
    total: a.total + b.total,
  };
}

/** Charges on the entry order (at the entry premium, on the entry date). */
export function entryCharges(p: TrackedPosition, broker?: BrokerPreset): ChargesBreakdown {
  return chargesForLegs([positionToLeg(p)], { broker, onDate: p.entryDateIso });
}

/** Charges on an exit order at `exitPrice` (opposite side). */
export function exitCharges(p: TrackedPosition, exitPrice: number, onDate?: string, broker?: BrokerPreset): ChargesBreakdown {
  const leg = positionToLeg(p, { side: p.action === "BUY" ? "SELL" : "BUY", premium: Math.max(0, exitPrice) });
  return chargesForLegs([leg], { broker, onDate });
}

/** Round-trip charges if the position were squared off at `exitPrice` now. */
export function roundTripCharges(p: TrackedPosition, exitPrice: number, broker?: BrokerPreset): ChargesBreakdown {
  return sumCharges(entryCharges(p, broker), exitCharges(p, exitPrice, undefined, broker));
}

// ── Storage ──

function readArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray(key: string, value: unknown[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Upgrade a stored position in place: ISO expiry, numbers recomputed. */
function upgrade<T extends TrackedPosition>(p: T): T {
  const iso = positionExpiryIso(p);
  return iso && iso !== p.expiry ? { ...p, expiry: iso } : p;
}

// ── Active positions CRUD ──

export function getPositions(): TrackedPosition[] {
  return readArray(STORAGE_KEY)
    .map(validatePosition)
    .filter((p): p is TrackedPosition => p !== null)
    .map(upgrade);
}

/** Persist active positions. Returns false when storage is unavailable (the UI keeps working in memory). */
export function savePositions(positions: TrackedPosition[]): boolean {
  return writeArray(STORAGE_KEY, positions);
}

export function addPosition(pos: TrackedPosition): TrackedPosition[] {
  const all = getPositions();
  all.push(upgrade(pos));
  savePositions(all);
  return all;
}

export function removePosition(id: string): TrackedPosition[] {
  const all = getPositions().filter((p) => p.id !== id);
  savePositions(all);
  return all;
}

/** Apply updates and recompute P&L when price, entry or size changes. */
export function applyPositionUpdate(p: TrackedPosition, updates: Partial<TrackedPosition>): TrackedPosition {
  const updated = upgrade({ ...p, ...updates });
  if (updates.currentPrice !== undefined || updates.entryPrice !== undefined || updates.lots !== undefined || updates.lotSize !== undefined || updates.action !== undefined) {
    updated.pnl = Math.round(grossPnlAt(updated, updated.currentPrice));
    updated.pnlPercent = pnlPercentAt(updated, updated.currentPrice);
  }
  return updated;
}

export function updatePosition(id: string, updates: Partial<TrackedPosition>): TrackedPosition[] {
  const all = getPositions().map((p) => (p.id === id ? applyPositionUpdate(p, updates) : p));
  savePositions(all);
  return all;
}

export function clearPositions(): void {
  writeArray(STORAGE_KEY, []);
}

// ── Closed positions ──

export function getClosedPositions(): ClosedPosition[] {
  return readArray(CLOSED_STORAGE_KEY)
    .map(validateClosedPosition)
    .filter((p): p is ClosedPosition => p !== null);
}

export function saveClosedPositions(closed: ClosedPosition[]): boolean {
  return writeArray(CLOSED_STORAGE_KEY, closed);
}

/** Pure: build the closed record for an exit at `exitPrice`, net of entry and exit charges. */
export function buildClosedPosition(
  pos: TrackedPosition,
  exitPrice: number,
  o?: { now?: Date; broker?: BrokerPreset; reason?: CloseReason; exerciseStt?: number; settlementSpot?: number; exitOrder?: boolean },
): ClosedPosition {
  const now = o?.now ?? new Date();
  const exitIso = istDateString(now);
  const px = Math.max(0, isNum(exitPrice) ? exitPrice : 0);
  const gross = grossPnlAt(pos, px);
  const entry = entryCharges(pos, o?.broker);
  // An expiry settlement has no exit order, so no exit brokerage/STT; exercise STT is added separately.
  const exit = o?.exitOrder === false ? { brokerage: 0, stt: 0, exchange: 0, sebi: 0, stamp: 0, gst: 0, total: 0 } : exitCharges(pos, px, exitIso, o?.broker);
  const breakdown = sumCharges(entry, exit);
  const stt = Math.max(0, o?.exerciseStt ?? 0);
  if (stt > 0) {
    breakdown.stt += stt;
    breakdown.total += stt;
  }
  const charges = breakdown.total;
  const net = gross - charges;
  return {
    ...pos,
    currentPrice: px,
    exitPrice: px,
    exitDate: shortDateLabel(now),
    exitDateIso: exitIso,
    grossPnl: round2(gross),
    charges: round2(charges),
    chargesBreakdown: breakdown,
    netPnl: round2(net),
    realizedPnl: round2(net),
    pnl: Math.round(net),
    pnlPercent: pnlPercentAt(pos, px),
    closeReason: o?.reason ?? "manual",
    exerciseStt: stt > 0 ? round2(stt) : undefined,
    settlementSpot: o?.settlementSpot,
  };
}

export function closePosition(id: string, exitPrice: number, o?: { now?: Date; broker?: BrokerPreset }): { active: TrackedPosition[]; closed: ClosedPosition[] } {
  const all = getPositions();
  const pos = all.find((p) => p.id === id);
  if (!pos) return { active: all, closed: getClosedPositions() };
  const closedPos = buildClosedPosition(pos, exitPrice, { now: o?.now, broker: o?.broker, reason: "manual" });
  const active = all.filter((p) => p.id !== id);
  savePositions(active);
  const closed = [...getClosedPositions(), closedPos];
  saveClosedPositions(closed);
  return { active, closed };
}

export function clearClosedPositions(): void {
  writeArray(CLOSED_STORAGE_KEY, []);
}

// ── Expiry settlement ──

/** True once the contract's 15:30 IST expiry has passed. */
export function isExpired(p: Pick<Position, "expiry">, now: Date = new Date()): boolean {
  const iso = positionExpiryIso(p);
  if (!iso) return false;
  const at = toISTDate(iso, "15:30").getTime();
  return Number.isFinite(at) && now.getTime() >= at;
}

/**
 * Pure: split positions into those still open, those settled now, and expired ones that cannot be
 * settled yet because no settlement spot is known for the symbol.
 */
export function settlePositions(
  positions: TrackedPosition[],
  now: Date,
  spots: Record<string, number>,
  broker?: BrokerPreset,
): { active: TrackedPosition[]; settled: ClosedPosition[]; pending: TrackedPosition[] } {
  const active: TrackedPosition[] = [];
  const settled: ClosedPosition[] = [];
  const pending: TrackedPosition[] = [];
  for (const p of positions) {
    if (!isExpired(p, now)) {
      active.push(p);
      continue;
    }
    const spot = spots[p.symbol];
    if (!isNum(spot) || spot <= 0) {
      active.push(p);
      pending.push(p);
      continue;
    }
    const iv = intrinsic(spot, p.strike, p.type);
    const iso = positionExpiryIso(p);
    const stt = p.action === "BUY" && iv > 0 ? exerciseSTT(iv, p.lots * p.lotSize, iso) : 0;
    const settleAt = toISTDate(iso, "15:30");
    settled.push(buildClosedPosition(p, iv, { now: settleAt, broker, reason: "expiry", exerciseStt: stt, settlementSpot: spot, exitOrder: false }));
  }
  return { active, settled, pending };
}

/**
 * Settle every expired active position at intrinsic value (STT on exercise for ITM longs) and persist.
 * `spots` maps symbol → settlement price; symbols without a price stay open and are returned as pending.
 */
export function settleExpired(
  now: Date = new Date(),
  spots: Record<string, number> = {},
  broker?: BrokerPreset,
): { active: TrackedPosition[]; closed: ClosedPosition[]; settled: ClosedPosition[]; pending: TrackedPosition[] } {
  const res = settlePositions(getPositions(), now, spots, broker);
  if (res.settled.length === 0) return { active: res.active, closed: getClosedPositions(), settled: [], pending: res.pending };
  savePositions(res.active);
  const closed = [...getClosedPositions(), ...res.settled];
  saveClosedPositions(closed);
  return { active: res.active, closed, settled: res.settled, pending: res.pending };
}

// ── Create a new Position with smart defaults ──

export function createPosition(
  overrides: Partial<TrackedPosition> & { symbol: string; type: "CE" | "PE"; action: "BUY" | "SELL"; strike: number; entryPrice: number },
): TrackedPosition {
  const symbol = overrides.symbol.trim().toUpperCase();
  const expiry = overrides.expiry ? (isValidIsoDate(overrides.expiry) ? overrides.expiry : normalizeExpiry(overrides.expiry) || overrides.expiry) : "";
  const lotSize = overrides.lotSize && overrides.lotSize > 0 ? overrides.lotSize : getLotSize(symbol, expiry || undefined) ?? 1;
  const lots = overrides.lots && overrides.lots > 0 ? overrides.lots : 1;
  const currentPrice = overrides.currentPrice ?? overrides.entryPrice;
  const base = { action: overrides.action, entryPrice: overrides.entryPrice, lots, lotSize };
  const now = new Date();
  return {
    id: overrides.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    symbol,
    type: overrides.type,
    action: overrides.action,
    strike: overrides.strike,
    lots,
    entryPrice: overrides.entryPrice,
    currentPrice,
    lotSize,
    entryDate: overrides.entryDate || shortDateLabel(now),
    entryDateIso: overrides.entryDateIso || istDateString(now),
    expiry,
    pnl: Math.round(grossPnlAt(base, currentPrice)),
    pnlPercent: pnlPercentAt(base, currentPrice),
    delta: overrides.delta ?? (overrides.type === "CE" ? 0.5 : -0.5),
    theta: overrides.theta ?? 0,
    iv: overrides.iv ?? 0,
    strategyId: overrides.strategyId,
    tag: overrides.tag,
    cmpManual: overrides.cmpManual,
  };
}

// ── Validation (hand-written, no zod) ──

function str(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

/** Validate one unknown value as a position; returns a clean copy or null. */
export function validatePosition(x: unknown): TrackedPosition | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const symbol = str(o.symbol)?.trim().toUpperCase();
  if (!symbol) return null;
  if (o.type !== "CE" && o.type !== "PE") return null;
  if (o.action !== "BUY" && o.action !== "SELL") return null;
  const action: "BUY" | "SELL" = o.action;
  if (!isNum(o.strike) || o.strike <= 0) return null;
  if (!isNum(o.lots) || o.lots <= 0) return null;
  if (!isNum(o.entryPrice) || o.entryPrice < 0) return null;
  const lotSize = isNum(o.lotSize) && o.lotSize > 0 ? o.lotSize : getLotSize(symbol);
  if (!lotSize) return null;
  const currentPrice = isNum(o.currentPrice) && o.currentPrice >= 0 ? o.currentPrice : o.entryPrice;
  const expiryRaw = str(o.expiry) ?? "";
  const expiry = expiryRaw ? (isValidIsoDate(expiryRaw) ? expiryRaw : normalizeExpiry(expiryRaw) || expiryRaw) : "";
  const base = { action, entryPrice: o.entryPrice, lots: o.lots, lotSize };
  const entryDateIso = str(o.entryDateIso);
  return {
    id: str(o.id) || `imp-${Math.random().toString(36).slice(2, 10)}`,
    symbol,
    type: o.type,
    action,
    strike: o.strike,
    lots: o.lots,
    entryPrice: o.entryPrice,
    currentPrice,
    lotSize,
    entryDate: str(o.entryDate) ?? "",
    entryDateIso: entryDateIso && isValidIsoDate(entryDateIso) ? entryDateIso : undefined,
    expiry,
    pnl: isNum(o.pnl) ? o.pnl : Math.round(grossPnlAt(base, currentPrice)),
    pnlPercent: isNum(o.pnlPercent) ? o.pnlPercent : pnlPercentAt(base, currentPrice),
    delta: isNum(o.delta) ? o.delta : 0,
    theta: isNum(o.theta) ? o.theta : 0,
    iv: isNum(o.iv) ? o.iv : 0,
    strategyId: str(o.strategyId) || undefined,
    tag: str(o.tag) || undefined,
    cmpManual: o.cmpManual === true ? true : undefined,
  };
}

export function validateClosedPosition(x: unknown): ClosedPosition | null {
  const base = validatePosition(x);
  if (!base) return null;
  const o = x as Record<string, unknown>;
  if (!isNum(o.exitPrice) || o.exitPrice < 0) return null;
  const gross = isNum(o.grossPnl) ? o.grossPnl : grossPnlAt(base, o.exitPrice);
  const charges = isNum(o.charges) ? o.charges : undefined;
  const net = isNum(o.netPnl) ? o.netPnl : isNum(o.realizedPnl) ? o.realizedPnl : charges !== undefined ? gross - charges : gross;
  const exitDateIso = str(o.exitDateIso);
  return {
    ...base,
    currentPrice: o.exitPrice,
    exitPrice: o.exitPrice,
    exitDate: str(o.exitDate) ?? "",
    exitDateIso: exitDateIso && isValidIsoDate(exitDateIso) ? exitDateIso : undefined,
    grossPnl: round2(gross),
    charges: charges !== undefined ? round2(charges) : undefined,
    netPnl: round2(net),
    realizedPnl: round2(net),
    closeReason: o.closeReason === "expiry" ? "expiry" : o.closeReason === "manual" ? "manual" : undefined,
    exerciseStt: isNum(o.exerciseStt) ? o.exerciseStt : undefined,
    settlementSpot: isNum(o.settlementSpot) ? o.settlementSpot : undefined,
  };
}

// ── Export / Import ──

export interface PositionsExport {
  version: 2;
  active: TrackedPosition[];
  closed: ClosedPosition[];
  exportedAt: string;
}

export function exportPositions(): string {
  const payload: PositionsExport = { version: 2, active: getPositions(), closed: getClosedPositions(), exportedAt: new Date().toISOString() };
  return JSON.stringify(payload, null, 2);
}

export interface ImportResult {
  active: TrackedPosition[];
  closed: ClosedPosition[];
  addedActive: number;
  addedClosed: number;
  /** Entries skipped because they failed validation. */
  rejected: number;
  /** Entries skipped because a position with the same id already exists. */
  duplicates: number;
  error?: string;
}

/**
 * Pure merge: validate the incoming JSON and merge it into the current lists (existing ids win).
 * Accepts { active, closed } or a bare array of active positions.
 */
export function mergeImport(json: string, current: { active: TrackedPosition[]; closed: ClosedPosition[] }): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ...current, addedActive: 0, addedClosed: 0, rejected: 0, duplicates: 0, error: "The file is not valid JSON." };
  }
  const rawActive: unknown[] = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).active) ? ((data as Record<string, unknown>).active as unknown[]) : [];
  const rawClosed: unknown[] = data && typeof data === "object" && !Array.isArray(data) && Array.isArray((data as Record<string, unknown>).closed) ? ((data as Record<string, unknown>).closed as unknown[]) : [];
  if (rawActive.length === 0 && rawClosed.length === 0) {
    return { ...current, addedActive: 0, addedClosed: 0, rejected: 0, duplicates: 0, error: "No positions found. Expected { active: [...], closed: [...] }." };
  }
  let rejected = 0;
  let duplicates = 0;
  const ids = new Set([...current.active.map((p) => p.id), ...current.closed.map((p) => p.id)]);
  const active = [...current.active];
  const closed = [...current.closed];
  let addedActive = 0;
  let addedClosed = 0;
  for (const r of rawActive) {
    const p = validatePosition(r);
    if (!p) rejected++;
    else if (ids.has(p.id)) duplicates++;
    else {
      ids.add(p.id);
      active.push(p);
      addedActive++;
    }
  }
  for (const r of rawClosed) {
    const p = validateClosedPosition(r);
    if (!p) rejected++;
    else if (ids.has(p.id)) duplicates++;
    else {
      ids.add(p.id);
      closed.push(p);
      addedClosed++;
    }
  }
  return { active, closed, addedActive, addedClosed, rejected, duplicates };
}

/** Validate, merge into storage and persist. Never throws. */
export function importPositions(json: string): ImportResult {
  const res = mergeImport(json, { active: getPositions(), closed: getClosedPositions() });
  if (!res.error) {
    savePositions(res.active);
    saveClosedPositions(res.closed);
  }
  return res;
}
