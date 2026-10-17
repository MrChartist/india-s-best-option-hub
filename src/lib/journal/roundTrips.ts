/**
 * FIFO matching of fills into round trips, with charges from the shared dated charges table.
 *
 * - Fills are grouped into orders (same order id, else same contract, side and second) so brokerage
 *   is charged once per order, as brokers do; an order's charges are split across its fills by qty.
 * - Per contract, opening lots queue up and each opposite fill closes the oldest lots first.
 * - Pieces with the same entry order and exit order merge into one round trip.
 * - Options still open after their 15:30 IST expiry can be closed at ₹0 ("assumed expired"), because
 *   broker tradebooks do not list expiry settlements. In-the-money expiries need a manual exit trade.
 */
import { BROKER_PRESETS, calcCharges, calendarDaysBetween, getBrokerPreset, toISTDate, type BrokerPreset } from "@/lib/options";
import type { JournalFill, OpenLot, RoundTrip } from "./types";

const round2 = (v: number) => Math.round(v * 100) / 100;

export function contractKeyOf(f: Pick<JournalFill, "underlying" | "expiry" | "strike" | "type">): string {
  return `${f.underlying}|${f.expiry}|${f.strike}|${f.type}`;
}

export function contractName(f: Pick<JournalFill, "underlying" | "strike" | "type">): string {
  return f.type === "FUT" ? `${f.underlying} FUT` : `${f.underlying} ${f.strike} ${f.type}`;
}

function orderKey(f: JournalFill): string {
  if (f.orderId) return `${f.source}|o|${f.orderId}`;
  const sec = f.ts !== null ? Math.floor(f.ts / 1000) : f.date;
  return `${f.source}|${contractKeyOf(f)}|${f.side}|${sec}`;
}

/** Charges per fill id: known charges when the source supplies them, else computed per order. */
export function chargesPerFill(fills: JournalFill[], brokerFor?: (f: JournalFill) => BrokerPreset): Map<string, number> {
  const out = new Map<string, number>();
  const orders = new Map<string, JournalFill[]>();
  for (const f of fills) {
    if (f.knownCharges !== undefined) {
      out.set(f.id, Math.max(0, f.knownCharges));
      continue;
    }
    if (f.settlement) {
      out.set(f.id, 0);
      continue;
    }
    const k = orderKey(f);
    const arr = orders.get(k);
    if (arr) arr.push(f);
    else orders.set(k, [f]);
  }
  for (const list of orders.values()) {
    const f0 = list[0];
    const qty = list.reduce((a, f) => a + f.qty, 0);
    const avg = list.reduce((a, f) => a + f.price * f.qty, 0) / qty;
    const broker = brokerFor?.(f0) ?? getBrokerPreset(f0.source) ?? BROKER_PRESETS[0];
    const total = calcCharges([{ type: f0.type, side: f0.side, price: avg, qty, exchange: f0.exchange }], { broker, onDate: f0.date }).total;
    for (const f of list) out.set(f.id, (total * f.qty) / qty);
  }
  return out;
}

function sortKey(f: JournalFill): number {
  if (f.ts !== null && Number.isFinite(f.ts)) return f.ts;
  // No time: treat as 09:15 IST on the trade date.
  return toISTDate(f.date, "09:15").getTime();
}

interface Lot {
  fill: JournalFill;
  qty: number;
  chargePerUnit: number;
}

interface Piece {
  entry: JournalFill;
  exit: JournalFill | null;
  qty: number;
  entryCharges: number;
  exitCharges: number;
  exitPrice: number;
  exitDate: string;
  exitTs: number | null;
  assumedExpiry: boolean;
}

export interface MatchOptions {
  /** Close options still open after expiry at ₹0. Default true. */
  assumeExpiredWorthless?: boolean;
  now?: Date;
  brokerFor?: (f: JournalFill) => BrokerPreset;
  /** Minutes within which entries on one underlying count as one multi-leg structure. Default 5. */
  groupWindowMin?: number;
}

export interface MatchResult {
  trips: RoundTrip[];
  open: OpenLot[];
  /** Total charges on fills that are still open (paid, not yet in any round trip). */
  openCharges: number;
}

/** FIFO-match fills into round trips. Pure. */
export function matchRoundTrips(fills: JournalFill[], o: MatchOptions = {}): MatchResult {
  const now = o.now ?? new Date();
  const assume = o.assumeExpiredWorthless !== false;
  const charges = chargesPerFill(fills, o.brokerFor);
  const indexed = fills.map((f, i) => ({ f, i }));
  indexed.sort((a, b) => sortKey(a.f) - sortKey(b.f) || a.i - b.i);
  const queues = new Map<string, Lot[]>();
  const pieces: Piece[] = [];

  for (const { f } of indexed) {
    const key = contractKeyOf(f);
    const q = queues.get(key) ?? [];
    queues.set(key, q);
    const perUnit = (charges.get(f.id) ?? 0) / f.qty;
    let remaining = f.qty;
    while (remaining > 1e-9 && q.length && q[0].fill.side !== f.side) {
      const lot = q[0];
      const take = Math.min(lot.qty, remaining);
      pieces.push({
        entry: lot.fill,
        exit: f,
        qty: take,
        entryCharges: lot.chargePerUnit * take,
        exitCharges: perUnit * take,
        exitPrice: f.price,
        exitDate: f.date,
        exitTs: f.ts,
        assumedExpiry: false,
      });
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= 1e-9) q.shift();
    }
    if (remaining > 1e-9) q.push({ fill: f, qty: remaining, chargePerUnit: perUnit });
  }

  const open: OpenLot[] = [];
  let openCharges = 0;
  for (const q of queues.values()) {
    for (const lot of q) {
      const f = lot.fill;
      const expired = toISTDate(f.expiry, "15:30").getTime() <= now.getTime();
      if (assume && expired && f.type !== "FUT") {
        pieces.push({ entry: f, exit: null, qty: lot.qty, entryCharges: lot.chargePerUnit * lot.qty, exitCharges: 0, exitPrice: 0, exitDate: f.expiry, exitTs: toISTDate(f.expiry, "15:30").getTime(), assumedExpiry: true });
      } else {
        open.push({ underlying: f.underlying, expiry: f.expiry, strike: f.strike, type: f.type, source: f.source, direction: f.side === "BUY" ? "LONG" : "SHORT", qty: lot.qty, price: f.price, date: f.date });
        openCharges += lot.chargePerUnit * lot.qty;
      }
    }
  }

  // Merge pieces that share entry order and exit order.
  const merged = new Map<string, Piece & { entryValue: number; exitValue: number }>();
  for (const p of pieces) {
    const k = `${orderKey(p.entry)}→${p.exit ? orderKey(p.exit) : `expiry:${contractKeyOf(p.entry)}`}`;
    const cur = merged.get(k);
    if (cur) {
      cur.qty += p.qty;
      cur.entryCharges += p.entryCharges;
      cur.exitCharges += p.exitCharges;
      cur.entryValue += p.entry.price * p.qty;
      cur.exitValue += p.exitPrice * p.qty;
    } else merged.set(k, { ...p, entryValue: p.entry.price * p.qty, exitValue: p.exitPrice * p.qty });
  }

  const trips: RoundTrip[] = [];
  for (const [k, p] of merged) {
    const long = p.entry.side === "BUY";
    const entryPrice = p.entryValue / p.qty;
    const exitPrice = p.exitValue / p.qty;
    const gross = (exitPrice - entryPrice) * p.qty * (long ? 1 : -1);
    const ch = p.entryCharges + p.exitCharges;
    trips.push({
      id: `${p.entry.id}#${hash(k)}`,
      underlying: p.entry.underlying,
      expiry: p.entry.expiry,
      strike: p.entry.strike,
      type: p.entry.type,
      source: p.entry.source,
      direction: long ? "LONG" : "SHORT",
      qty: p.qty,
      entryDate: p.entry.date,
      entryTs: p.entry.ts,
      exitDate: p.exitDate,
      exitTs: p.exitTs,
      entryPrice: round2(entryPrice),
      exitPrice: round2(exitPrice),
      gross: round2(gross),
      charges: round2(ch),
      net: round2(gross - ch),
      dte: Math.max(0, calendarDaysBetween(p.entry.date, p.entry.expiry)),
      assumedExpiry: p.assumedExpiry,
      settled: !!p.exit?.settlement,
      strategy: "",
      groupId: "",
    });
  }
  trips.sort((a, b) => entrySort(a) - entrySort(b) || a.id.localeCompare(b.id));
  assignStrategies(trips, o.groupWindowMin ?? 5);
  return { trips, open, openCharges: round2(openCharges) };
}

function entrySort(t: Pick<RoundTrip, "entryTs" | "entryDate">): number {
  return t.entryTs ?? toISTDate(t.entryDate, "09:15").getTime();
}

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Group trips opened together on one underlying and label the structure. Mutates `trips`. */
export function assignStrategies(trips: RoundTrip[], windowMin = 5): void {
  const groups: RoundTrip[][] = [];
  const byUnderlying = new Map<string, RoundTrip[][]>();
  for (const t of trips) {
    const list = byUnderlying.get(`${t.source}|${t.underlying}`) ?? [];
    byUnderlying.set(`${t.source}|${t.underlying}`, list);
    const last = list[list.length - 1];
    const sameWindow = last && (t.entryTs !== null && last[0].entryTs !== null ? t.entryTs - last[0].entryTs <= windowMin * 60_000 : t.entryTs === null && last[0].entryTs === null && t.entryDate === last[0].entryDate);
    if (sameWindow) last.push(t);
    else {
      const g = [t];
      list.push(g);
      groups.push(g);
    }
  }
  for (const g of groups) {
    const label = classifyStructure(g);
    const id = g[0].id;
    for (const t of g) {
      t.strategy = label;
      t.groupId = id;
    }
  }
}

/** Name a set of legs (one entry per distinct contract and direction). */
export function classifyStructure(legs: Array<Pick<RoundTrip, "type" | "direction" | "strike" | "expiry">>): string {
  const uniq = new Map<string, Pick<RoundTrip, "type" | "direction" | "strike" | "expiry">>();
  for (const l of legs) uniq.set(`${l.type}|${l.direction}|${l.strike}|${l.expiry}`, l);
  const u = [...uniq.values()];
  const n = u.length;
  const long = (l: (typeof u)[number]) => l.direction === "LONG";
  if (n === 1) {
    const l = u[0];
    if (l.type === "FUT") return long(l) ? "Long futures" : "Short futures";
    return `${long(l) ? "Long" : "Short"} ${l.type === "CE" ? "call" : "put"}`;
  }
  if (u.some((l) => l.type === "FUT")) return `Futures + options (${n} legs)`;
  const ce = u.filter((l) => l.type === "CE");
  const pe = u.filter((l) => l.type === "PE");
  if (n === 2) {
    const [a, b] = u;
    if (a.type === b.type && a.direction !== b.direction) {
      if (a.expiry !== b.expiry) return a.strike === b.strike ? "Calendar spread" : "Diagonal spread";
      const lo = a.strike < b.strike ? a : b;
      if (a.type === "CE") return long(lo) ? "Bull call spread" : "Bear call spread";
      return long(lo) ? "Bull put spread" : "Bear put spread";
    }
    if (ce.length === 1 && pe.length === 1 && a.direction === b.direction) {
      const kind = ce[0].strike === pe[0].strike ? "straddle" : "strangle";
      return `${long(a) ? "Long" : "Short"} ${kind}`;
    }
    return "Custom (2 legs)";
  }
  if (n === 3 && (ce.length === 3 || pe.length === 3)) {
    const s = [...u].sort((x, y) => x.strike - y.strike);
    if (s[0].direction === s[2].direction && s[1].direction !== s[0].direction) return long(s[0]) ? "Long butterfly" : "Short butterfly";
    return "Custom (3 legs)";
  }
  if (n === 4 && ce.length === 2 && pe.length === 2 && ce[0].direction !== ce[1].direction && pe[0].direction !== pe[1].direction) {
    const sc = ce.find((l) => !long(l));
    const sp = pe.find((l) => !long(l));
    if (sc && sp) return sc.strike === sp.strike ? "Iron fly" : "Iron condor";
    return "Reverse iron condor";
  }
  return `Custom (${n} legs)`;
}
