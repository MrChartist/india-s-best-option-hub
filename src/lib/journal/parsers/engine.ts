/** Shared tradebook-to-fills engine: each broker supplies column aliases and its symbol style. */
import { getLotSize, type Exchange, type Side } from "@/lib/options";
import type { JournalFill, JournalSource, ParseIssue, ParseResult } from "../types";
import { findColumn, parseCsv, parseNum } from "./csv";
import { contractFromColumns, parseDateTime, parseInstrument, type SymbolStyle } from "./contract";

export interface BrokerSpec {
  source: JournalSource;
  style: SymbolStyle;
  columns: {
    symbol: string[];
    date: string[];
    time?: string[];
    side: string[];
    qty: string[];
    price: string[];
    tradeId?: string[];
    orderId?: string[];
    exchange?: string[];
    expiry?: string[];
    strike?: string[];
    optionType?: string[];
    instrument?: string[];
    segment?: string[];
  };
  /** Headers only this broker uses; drives auto-detection. */
  signature: string[];
}

export function parseSide(s: string | undefined): Side | null {
  const t = (s ?? "").trim().toUpperCase();
  if (t === "BUY" || t === "B" || t === "BOUGHT" || t === "BUY ORDER") return "BUY";
  if (t === "SELL" || t === "S" || t === "SOLD" || t === "SELL ORDER") return "SELL";
  return null;
}

export function parseExchange(s: string | undefined): Exchange {
  const t = (s ?? "").trim().toUpperCase();
  return t.startsWith("B") ? "BSE" : "NSE";
}

/**
 * 53-bit string hash (cyrb53), base 36. Fill ids for rows without a trade id use it: a 32-bit
 * hash collides often enough across thousands of fills that distinct trades would be dropped
 * as duplicates.
 */
export function hashId53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Quantity in units from a quantity cell. "65/1" (units/lots, as some exports print it) gives
 * the units part. A plain number in a lot-labelled column ("Quantity/Lot", "Lots") that is not
 * a multiple of the contract's lot size is a lot count, so it is multiplied by the lot size
 * (option and futures quantities in units are always whole lots).
 */
export function parseQtyUnits(raw: string, header: string, underlying: string, expiry: string): number {
  const pair = /^\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*$/.exec(raw);
  if (pair) return Math.abs(parseNum(pair[1]));
  const n = Math.abs(parseNum(raw));
  if (!(n > 0)) return n;
  if (/lot/i.test(header)) {
    const lot = getLotSize(underlying, expiry);
    if (lot && lot > 1 && n % lot !== 0) return n * lot;
  }
  return n;
}

/** Locate the header row: the first row in the first 15 that has the symbol, side, qty and price columns. */
function findHeader(rows: Array<{ line: number; cells: string[] }>, spec: BrokerSpec): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].cells;
    if ([spec.columns.side, spec.columns.qty, spec.columns.price].every((a) => findColumn(h, a) >= 0) && (findColumn(h, spec.columns.symbol) >= 0 || (spec.columns.strike && findColumn(h, spec.columns.strike) >= 0))) return i;
  }
  return -1;
}

export function parseWithSpec(text: string, spec: BrokerSpec): ParseResult {
  const rows = parseCsv(text);
  const issues: ParseIssue[] = [];
  const fills: JournalFill[] = [];
  const hi = findHeader(rows, spec);
  if (hi < 0) {
    return { source: spec.source, fills, issues: [{ line: 1, message: "Could not find the header row (needs instrument, buy/sell, quantity and price columns)." }], rows: 0 };
  }
  const h = rows[hi].cells;
  const col = (a?: string[]) => (a ? findColumn(h, a) : -1);
  const c = {
    symbol: col(spec.columns.symbol),
    date: col(spec.columns.date),
    time: col(spec.columns.time),
    side: col(spec.columns.side),
    qty: col(spec.columns.qty),
    price: col(spec.columns.price),
    tradeId: col(spec.columns.tradeId),
    orderId: col(spec.columns.orderId),
    exchange: col(spec.columns.exchange),
    expiry: col(spec.columns.expiry),
    strike: col(spec.columns.strike),
    optionType: col(spec.columns.optionType),
    instrument: col(spec.columns.instrument),
    segment: col(spec.columns.segment),
  };
  if (c.date < 0) return { source: spec.source, fills, issues: [{ line: rows[hi].line, message: "No trade date column found." }], rows: 0 };
  const data = rows.slice(hi + 1);
  const qtyHeader = c.qty >= 0 ? h[c.qty] ?? "" : "";
  // Identical rows within one file are separate trades: count them so each keeps its own id.
  const seen = new Map<string, number>();
  for (const r of data) {
    const cell = (i: number) => (i >= 0 ? r.cells[i] ?? "" : "");
    const label = cell(c.symbol);
    const segment = cell(c.segment).toUpperCase();
    if (segment && /^(EQ|EQUITY|CASH|NSE_EQ|BSE_EQ|CDS|MCX|COM)/.test(segment)) {
      issues.push({ line: r.line, message: `${label || "Row"}: not an equity F&O trade, skipped.` });
      continue;
    }
    const dt = parseDateTime(cell(c.date), c.time >= 0 ? cell(c.time) : undefined);
    if (!dt) {
      issues.push({ line: r.line, message: `Unreadable date "${cell(c.date)}".` });
      continue;
    }
    const contract =
      (c.strike >= 0 || c.optionType >= 0) && cell(c.expiry)
        ? contractFromColumns({ underlying: label, expiry: cell(c.expiry), strike: parseNum(cell(c.strike)), optionType: cell(c.optionType), instrument: cell(c.instrument) }) ?? parseInstrument(label, spec.style, dt.date)
        : parseInstrument(label, spec.style, dt.date);
    if (!contract) {
      issues.push({ line: r.line, message: `"${label}" is not an F&O contract this importer understands, skipped.` });
      continue;
    }
    // Prefer an explicit expiry column (Zerodha has one) over the date implied by the symbol.
    const expCol = c.expiry >= 0 ? parseDateTime(cell(c.expiry))?.date : undefined;
    if (expCol) contract.expiry = expCol;
    const side = parseSide(cell(c.side));
    const qty = parseQtyUnits(cell(c.qty), qtyHeader, contract.underlying, contract.expiry);
    const price = parseNum(cell(c.price));
    if (!side) {
      issues.push({ line: r.line, message: `Unknown buy/sell value "${cell(c.side)}".` });
      continue;
    }
    if (!(qty > 0) || !(price >= 0)) {
      issues.push({ line: r.line, message: `Missing quantity or price for ${label}.` });
      continue;
    }
    const tradeId = cell(c.tradeId);
    const orderId = cell(c.orderId) || undefined;
    // Without a trade id, identify the fill by its content (never the line number, which shifts
    // between overlapping exports) plus its occurrence among identical rows in this file.
    let id = tradeId;
    if (!id) {
      const key = [cell(c.date), c.time >= 0 ? cell(c.time) : "", label, contract.expiry, contract.strike ?? "", contract.type ?? "", side, qty, price, orderId ?? ""].join("|");
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      id = hashId53(`${key}|#${n}`);
    }
    fills.push({
      ...contract,
      id: `${spec.source}:${id}`,
      source: spec.source,
      orderId,
      side,
      qty,
      price,
      date: dt.date,
      ts: dt.ts,
      exchange: c.exchange >= 0 ? parseExchange(cell(c.exchange)) : contract.underlying === "SENSEX" || contract.underlying === "BANKEX" ? "BSE" : "NSE",
      label,
    });
  }
  return { source: spec.source, fills, issues, rows: data.length };
}
