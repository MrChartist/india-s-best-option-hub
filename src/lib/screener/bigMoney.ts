/**
 * Big Money feed helpers (pure): NSE bulk and block deals plus futures OI jumps.
 * We only show what the exchange publishes. No "sweep" or "dark pool" labels: those do not
 * exist in Indian cash or F&O data.
 */
import { canonicalFnoSymbol } from "./universe";

export interface DealRow {
  date: string;
  symbol: string;
  name: string;
  client: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  remarks?: string;
}

export interface OiSpurtRow {
  symbol: string;
  latestOi: number;
  prevOi: number;
  chgOi: number;
  chgOiPct: number;
  volume: number;
  pChange?: number;
  underlyingValue?: number;
}

export interface OiJump {
  symbol: string;
  oiChangePct: number;
  changePct: number | null;
  source: "oi-spurts" | "futures-eod" | "sample";
}

/** NSE flags an OI jump in the Big Money feed above this change (percent). */
export const OI_JUMP_PCT = 10;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";

export function parseDealsPayload(data: unknown): DealRow[] {
  if (!Array.isArray(data)) return [];
  const out: DealRow[] = [];
  for (const d of data) {
    if (!isObj(d) || typeof d.symbol !== "string" || !d.symbol) continue;
    const qty = finite(d.qty) ? d.qty : 0;
    const price = finite(d.price) ? d.price : 0;
    if (qty <= 0 || price <= 0) continue;
    out.push({
      date: typeof d.date === "string" ? d.date : "",
      symbol: canonicalFnoSymbol(d.symbol),
      name: typeof d.name === "string" ? d.name : "",
      client: typeof d.client === "string" ? d.client : "",
      side: d.side === "SELL" ? "SELL" : "BUY",
      qty,
      price,
      remarks: typeof d.remarks === "string" && d.remarks ? d.remarks : undefined,
    });
  }
  return out;
}

export function parseOiSpurtsPayload(data: unknown): OiSpurtRow[] {
  if (!Array.isArray(data)) return [];
  const out: OiSpurtRow[] = [];
  for (const d of data) {
    if (!isObj(d) || typeof d.symbol !== "string" || !d.symbol) continue;
    if (!finite(d.chgOiPct)) continue;
    out.push({
      symbol: canonicalFnoSymbol(d.symbol),
      latestOi: finite(d.latestOi) ? d.latestOi : 0,
      prevOi: finite(d.prevOi) ? d.prevOi : 0,
      chgOi: finite(d.chgOi) ? d.chgOi : 0,
      chgOiPct: d.chgOiPct,
      volume: finite(d.volume) ? d.volume : 0,
      pChange: finite(d.pChange) ? d.pChange : undefined,
      underlyingValue: finite(d.underlyingValue) ? d.underlyingValue : undefined,
    });
  }
  return out;
}

/** Deal value in rupees. */
export function dealValue(d: Pick<DealRow, "qty" | "price">): number {
  return d.qty * d.price;
}

export interface DealSummary {
  symbol: string;
  buyValue: number;
  sellValue: number;
  net: number;
  deals: number;
}

/** Net buy/sell value per symbol, largest absolute net first. */
export function summariseDeals(deals: readonly DealRow[]): DealSummary[] {
  const map = new Map<string, DealSummary>();
  for (const d of deals) {
    const s = map.get(d.symbol) ?? { symbol: d.symbol, buyValue: 0, sellValue: 0, net: 0, deals: 0 };
    const v = dealValue(d);
    if (d.side === "BUY") s.buyValue += v;
    else s.sellValue += v;
    s.net = s.buyValue - s.sellValue;
    s.deals += 1;
    map.set(d.symbol, s);
  }
  return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

/** Futures OI jumps above the threshold, merged from scanned futures (preferred) and OI spurts. */
export function oiJumps(
  rows: ReadonlyArray<{ symbol: string; oiChangePct: number | null; changePct: number; oiSource: string | null }>,
  threshold = OI_JUMP_PCT,
): OiJump[] {
  const out: OiJump[] = [];
  for (const r of rows) {
    if (r.oiChangePct === null || !finite(r.oiChangePct) || r.oiChangePct <= threshold) continue;
    const source: OiJump["source"] = r.oiSource === "futures-eod" ? "futures-eod" : r.oiSource === "sample" ? "sample" : "oi-spurts";
    out.push({ symbol: r.symbol, oiChangePct: r.oiChangePct, changePct: finite(r.changePct) ? r.changePct : null, source });
  }
  return out.sort((a, b) => b.oiChangePct - a.oiChangePct);
}
