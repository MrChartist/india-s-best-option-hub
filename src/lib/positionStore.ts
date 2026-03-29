// Position Store — localStorage-based CRUD for user positions
// Persists positions across page refreshes. Same pattern as brokerConfig.ts

import type { Position } from "./mockData";
import { getMockPositions } from "./mockData";

const STORAGE_KEY = "optionsdesk_positions";
const CLOSED_STORAGE_KEY = "optionsdesk_closed_positions";

// Lot sizes per symbol (standard NSE lot sizes)
export const LOT_SIZE_MAP: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 25,
  MIDCPNIFTY: 50,
  SENSEX: 10,
  BANKEX: 15,
  // Popular F&O stocks
  RELIANCE: 250,
  TCS: 150,
  HDFCBANK: 550,
  INFY: 300,
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
  TATAMOTORS: 575,
  SUNPHARMA: 350,
  TITAN: 175,
  WIPRO: 1500,
  ULTRACEMCO: 50,
  BAJFINANCE: 75,
  DRREDDY: 125,
  TATASTEEL: 1675,
  HINDALCO: 1075,
  DLF: 825,
  M_M: 350,
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

// ── Active Positions CRUD ──

export function getPositions(): Position[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore parse errors */ }
  // First time: load demo positions
  const demo = getMockPositions();
  savePositions(demo);
  return demo;
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

export function getClosedPositions(): ClosedPosition[] {
  try {
    const raw = localStorage.getItem(CLOSED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function closePosition(id: string, exitPrice: number): { active: Position[]; closed: ClosedPosition[] } {
  const all = getPositions();
  const pos = all.find(p => p.id === id);
  if (!pos) return { active: all, closed: getClosedPositions() };

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
    delta: overrides.delta || (overrides.type === "CE" ? 0.5 : -0.5),
    theta: overrides.theta || -10,
    iv: overrides.iv || 14,
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
  if (data.active) savePositions(data.active);
  if (data.closed) localStorage.setItem(CLOSED_STORAGE_KEY, JSON.stringify(data.closed));
  return { active: data.active || [], closed: data.closed || [] };
}
