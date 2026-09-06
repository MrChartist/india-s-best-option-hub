// Position Store — localStorage-based CRUD for user positions
// Persists positions across page refreshes. Same pattern as brokerConfig.ts

import { calculateGreeks, type Position } from "./mockData";

const STORAGE_KEY = "optionsdesk_positions";
const CLOSED_STORAGE_KEY = "optionsdesk_closed_positions";

// Lot sizes per symbol (standard NSE lot sizes — verified from Dhan instrument master)
export const LOT_SIZE_MAP: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 25,
  MIDCPNIFTY: 50,
  SENSEX: 10,
  BANKEX: 15,
  // Popular F&O stocks (verified from Dhan CSV / NSE circulars)
  RELIANCE: 250,
  TCS: 175,
  HDFCBANK: 550,
  INFY: 400,
  ICICIBANK: 700,
  SBIN: 750,
  HINDUNILVR: 300,
  BHARTIARTL: 475,
  ITC: 1600,
  KOTAKBANK: 400,
  LT: 150,
  AXISBANK: 625,
  ASIANPAINT: 200,
  MARUTI: 50,
  TATAMOTORS: 1125,
  SUNPHARMA: 350,
  TITAN: 175,
  WIPRO: 1500,
  ULTRACEMCO: 100,
  BAJFINANCE: 125,
  DRREDDY: 125,
  TATASTEEL: 5500,
  HINDALCO: 1075,
  DLF: 825,
  M_M: 175,
  // Additional popular F&O stocks
  HCLTECH: 350,
  NTPC: 1850,
  POWERGRID: 2250,
  HAL: 150,
  CIPLA: 325,
  EICHERMOT: 175,
  TECHM: 400,
  DIVISLAB: 150,
  ADANIENT: 250,
  ADANIPORTS: 625,
  BAJAJ_AUTO: 75,
  BPCL: 1050,
  COALINDIA: 1400,
  GRASIM: 275,
  INDUSINDBK: 400,
  JSWSTEEL: 675,
  TATACONSUM: 450,
  APOLLOHOSP: 125,
  NESTLEIND: 25,
  ONGC: 3075,
  BAJAJFINSV: 125,
};

// Approximate spot prices for symbols (used as defaults)
export const SPOT_PRICE_MAP: Record<string, number> = {
  NIFTY: 24250,
  BANKNIFTY: 51850,
  FINNIFTY: 23180,
  MIDCPNIFTY: 12850,
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

// Step sizes for strikes
export const STEP_SIZE_MAP: Record<string, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  FINNIFTY: 50,
  MIDCPNIFTY: 25,
};

export function getLotSize(symbol: string): number {
  return LOT_SIZE_MAP[symbol] || 500;
}

export function getSpotPrice(symbol: string): number {
  return SPOT_PRICE_MAP[symbol] || 2500;
}

export function getStepSize(symbol: string): number {
  return STEP_SIZE_MAP[symbol] || 50;
}

// ── Expiry / DTE helpers ──
// Position `expiry` strings look like "27 Mar" or "27 Mar 2026". When no year
// is present we resolve it against `reference`'s year, rolling forward a year
// if the resulting date has already passed (e.g. parsing "05 Jan" in December,
// or parsing any past month once the calendar year has moved on — this used
// to be hardcoded to a fixed year which silently broke once that year ended).
export function parseExpiryDate(expiry: string, reference: Date = new Date()): Date | null {
  if (!expiry) return null;
  const hasYear = /\d{4}/.test(expiry);
  const candidate = new Date(hasYear ? expiry : `${expiry} ${reference.getFullYear()}`);
  if (isNaN(candidate.getTime())) return null;
  if (!hasYear && candidate.getTime() < reference.getTime() - 24 * 60 * 60 * 1000) {
    candidate.setFullYear(reference.getFullYear() + 1);
  }
  return candidate;
}

// Whole days remaining until `expiry` (never negative). Falls back to
// `fallbackDays` when the string is empty/unparseable.
export function daysToExpiry(expiry: string, fallbackDays = 7, reference: Date = new Date()): number {
  const date = parseExpiryDate(expiry, reference);
  if (!date) return fallbackDays;
  return Math.max(0, Math.ceil((date.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24)));
}

// ── Runtime shape guards ──
// Defends against corrupted localStorage and malformed imports: without this,
// a single bad entry (e.g. missing a numeric field) causes `.toFixed()` calls
// downstream to throw and crash the whole page.
function isValidPosition(p: unknown): p is Position {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return typeof o.id === "string"
    && typeof o.symbol === "string"
    && (o.type === "CE" || o.type === "PE")
    && (o.action === "BUY" || o.action === "SELL")
    && Number.isFinite(o.strike)
    && Number.isFinite(o.lots)
    && Number.isFinite(o.entryPrice)
    && Number.isFinite(o.currentPrice)
    && Number.isFinite(o.lotSize)
    // These are rendered with .toFixed()/.toLocaleString() in the UI
    // (PositionTracker's table, portfolio summary, What-If simulator) —
    // a record missing any of them used to pass validation and then throw
    // at render time instead of being filtered out here.
    && Number.isFinite(o.pnl)
    && Number.isFinite(o.pnlPercent)
    && Number.isFinite(o.delta)
    && Number.isFinite(o.theta)
    && Number.isFinite(o.iv)
    && typeof o.entryDate === "string"
    && typeof o.expiry === "string";
}

// ── Active Positions CRUD ──

export function getPositions(): Position[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Filter out any corrupted/malformed entries instead of trusting the
        // whole array — one bad record used to poison every consumer.
        const valid = parsed.filter(isValidPosition);
        if (valid.length > 0) return valid;
      }
    }
  } catch { /* ignore parse errors */ }
  // First time (or corrupted storage): start with empty positions
  return [];
}

// True if STORAGE_KEY holds a non-empty string that failed to parse as a
// Position[] — used to warn the user instead of silently discarding data.
export function isPositionsDataCorrupted(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return !Array.isArray(parsed);
  } catch {
    return true;
  }
}

export function savePositions(positions: Position[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function addPosition(pos: Position): Position[] {
  const all = getPositions();
  all.push(pos);
  savePositions(all);
  return all;
}

export function removePosition(id: string): Position[] {
  const all = getPositions().filter(p => p.id !== id);
  savePositions(all);
  return all;
}

export function updatePosition(id: string, updates: Partial<Position>): Position[] {
  const all = getPositions().map(p => {
    if (p.id !== id) return p;
    const updated = { ...p, ...updates };
    // Recalculate P&L when currentPrice changes
    if (updates.currentPrice !== undefined || updates.entryPrice !== undefined || updates.lots !== undefined) {
      const mult = updated.action === "BUY" ? 1 : -1;
      updated.pnl = Math.round((updated.currentPrice - updated.entryPrice) * mult * updated.lots * updated.lotSize);
      updated.pnlPercent = updated.entryPrice > 0
        ? Math.round(((updated.currentPrice - updated.entryPrice) / updated.entryPrice) * mult * 10000) / 100
        : 0;
    }
    return updated;
  });
  savePositions(all);
  return all;
}

export function clearPositions(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
}

// ── Closed Positions ──

export interface ClosedPosition extends Position {
  exitPrice: number;
  exitDate: string;
  realizedPnl: number;
}

function isValidClosedPosition(p: unknown): p is ClosedPosition {
  if (!isValidPosition(p)) return false;
  const o = p as unknown as Record<string, unknown>;
  return Number.isFinite(o.exitPrice)
    && Number.isFinite(o.realizedPnl)
    && typeof o.exitDate === "string";
}

export function getClosedPositions(): ClosedPosition[] {
  try {
    const raw = localStorage.getItem(CLOSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidClosedPosition) : [];
  } catch { return []; }
}

export function closePosition(id: string, exitPrice: number): { active: Position[]; closed: ClosedPosition[] } {
  const all = getPositions();
  const pos = all.find(p => p.id === id);
  if (!pos || !Number.isFinite(exitPrice)) return { active: all, closed: getClosedPositions() };

  // Calculate realized P&L
  const mult = pos.action === "BUY" ? 1 : -1;
  const realizedPnl = Math.round((exitPrice - pos.entryPrice) * mult * pos.lots * pos.lotSize);

  const closedPos: ClosedPosition = {
    ...pos,
    currentPrice: exitPrice,
    exitPrice,
    exitDate: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    realizedPnl,
    pnl: realizedPnl,
    pnlPercent: pos.entryPrice > 0
      ? Math.round(((exitPrice - pos.entryPrice) / pos.entryPrice) * mult * 10000) / 100
      : 0,
  };

  // Remove from active
  const active = all.filter(p => p.id !== id);
  savePositions(active);

  // Add to closed
  const closed = getClosedPositions();
  closed.push(closedPos);
  localStorage.setItem(CLOSED_STORAGE_KEY, JSON.stringify(closed));

  return { active, closed };
}

export function clearClosedPositions(): void {
  localStorage.setItem(CLOSED_STORAGE_KEY, JSON.stringify([]));
}

// ── Create a new Position with smart defaults ──

export function createPosition(
  overrides: Partial<Position> & { symbol: string; type: "CE" | "PE"; action: "BUY" | "SELL"; strike: number; entryPrice: number }
): Position {
  const symbol = overrides.symbol;
  const lotSize = overrides.lotSize || getLotSize(symbol);
  const lots = overrides.lots || 1;
  const currentPrice = overrides.currentPrice ?? overrides.entryPrice;
  const mult = overrides.action === "BUY" ? 1 : -1;
  const pnl = Math.round((currentPrice - overrides.entryPrice) * mult * lots * lotSize);
  const pnlPercent = overrides.entryPrice > 0
    ? Math.round(((currentPrice - overrides.entryPrice) / overrides.entryPrice) * mult * 10000) / 100
    : 0;

  // Derive sensible delta/theta defaults via Black-Scholes instead of a flat
  // ±0.5 / -10 for every single position regardless of strike or expiry —
  // those flat placeholders made Net Delta / Net Theta on the portfolio
  // summary meaningless (a deep OTM leg reported the same risk as an ATM
  // one). Uses the same approximate spot map the rest of this store already
  // relies on (no live per-symbol quote is wired into this store), so it's
  // still an estimate, but a moneyness-aware one.
  const iv = overrides.iv ?? 14;
  let defaultDelta = overrides.type === "CE" ? 0.5 : -0.5;
  let defaultTheta = -10;
  try {
    const dte = daysToExpiry(overrides.expiry || "", 7);
    const greeks = calculateGreeks(getSpotPrice(symbol), overrides.strike, dte, iv, 6.5);
    defaultDelta = overrides.type === "CE" ? greeks.delta.call : greeks.delta.put;
    defaultTheta = overrides.type === "CE" ? greeks.theta.call : greeks.theta.put;
  } catch { /* fall back to flat defaults above if inputs are unusable */ }

  return {
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    symbol,
    type: overrides.type,
    action: overrides.action,
    strike: overrides.strike,
    lots,
    entryPrice: overrides.entryPrice,
    currentPrice,
    lotSize,
    entryDate: overrides.entryDate || new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    expiry: overrides.expiry || "",
    pnl,
    pnlPercent,
    delta: overrides.delta ?? defaultDelta,
    theta: overrides.theta ?? defaultTheta,
    iv,
  };
}

// ── Export / Import ──

export function exportPositions(): string {
  return JSON.stringify({
    active: getPositions(),
    closed: getClosedPositions(),
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export function importPositions(json: string): { active: Position[]; closed: ClosedPosition[] } {
  const data = JSON.parse(json);
  // Always write both arrays (defaulting to [] rather than skipping the
  // write). The previous version only called savePositions()/setItem() when
  // the corresponding key was present, but still returned `[]` to the caller
  // either way — the caller would then push that `[]` into React state,
  // which the page's auto-save effect promptly wrote back to localStorage,
  // silently wiping out the user's real (untouched) stored positions any
  // time an imported file was missing an `active` or `closed` key.
  const active: Position[] = Array.isArray(data?.active) ? data.active.filter(isValidPosition) : [];
  const closed: ClosedPosition[] = Array.isArray(data?.closed) ? data.closed.filter(isValidClosedPosition) : [];
  savePositions(active);
  localStorage.setItem(CLOSED_STORAGE_KEY, JSON.stringify(closed));
  return { active, closed };
}
