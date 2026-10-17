/**
 * Columnar snapshot codec (IndexedDB format v2, database version 4).
 *
 * A chain snapshot used to be stored as an array of row objects, one per strike and side. That
 * costs a property name per value and a structured-clone object per row. The columnar record keeps
 * one Float64Array of unique ascending strikes and, per side (CE and PE), one Float32Array each for
 * ltp, oi, vol, iv, bid and ask, aligned with the strikes. A leg that is absent at a strike is NaN
 * in every column. Bid and ask quantities are kept in optional Float32Arrays (NaN = not quoted).
 *
 * Precision: Float32 holds integers exactly up to 16,777,216 and prices to well under a paisa
 * below ₹65,536. Decoding rounds prices and IV to 2 decimals and OI and volume to whole numbers, so
 * a round trip returns the recorded values for every realistic option quote. Volume above 1.67
 * crore (quantity-based feeds) can be off by a few units, which no consumer can see.
 *
 * Pure module: no IndexedDB, safe for the database upgrade path and for Node tests.
 */
import type { ChainSnapshot, StrikeSnap } from "@/lib/snapshotStore";

export const COLUMNAR_FORMAT = 2 as const;

/** Bar size used when an older trading day is compacted. */
export const DOWNSAMPLE_BAR_MS = 5 * 60_000;

export type SnapshotGranularity = "raw" | "5m";

export interface ColumnarSide {
  ltp: Float32Array;
  oi: Float32Array;
  vol: Float32Array;
  iv: Float32Array;
  bid: Float32Array;
  ask: Float32Array;
  bidQty?: Float32Array;
  askQty?: Float32Array;
}

/** What actually sits in the chainSnapshots object store from database version 4 on. */
export interface ColumnarSnapshotRecord {
  id: string;
  symbol: string;
  expiry: string;
  ts: number;
  spot: number;
  fmt: typeof COLUMNAR_FORMAT;
  granularity: SnapshotGranularity;
  strikes: Float64Array;
  ce: ColumnarSide;
  pe: ColumnarSide;
}

/** A pre-v4 record: rows as plain objects. */
export interface LegacySnapshotRecord {
  id: string;
  symbol: string;
  expiry: string;
  ts: number;
  spot: number;
  rows: StrikeSnap[];
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const round2 = (x: number) => Math.round(x * 100) / 100;

function emptySide(n: number, withQty: boolean): ColumnarSide {
  const col = () => new Float32Array(n).fill(NaN);
  const side: ColumnarSide = { ltp: col(), oi: col(), vol: col(), iv: col(), bid: col(), ask: col() };
  if (withQty) {
    side.bidQty = col();
    side.askQty = col();
  }
  return side;
}

/** Encode a snapshot (row objects) into the columnar record stored in IndexedDB. */
export function encodeSnapshot(snap: ChainSnapshot, granularity: SnapshotGranularity = "raw"): ColumnarSnapshotRecord {
  const rows = Array.isArray(snap?.rows) ? snap.rows.filter((r) => r && finite(r.strike) && (r.side === "CE" || r.side === "PE")) : [];
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  const index = new Map(strikes.map((k, i) => [k, i]));
  const withQty = rows.some((r) => finite(r.bidQty) || finite(r.askQty));
  const ce = emptySide(strikes.length, withQty);
  const pe = emptySide(strikes.length, withQty);
  for (const r of rows) {
    const i = index.get(r.strike) as number;
    const s = r.side === "CE" ? ce : pe;
    s.ltp[i] = finite(r.ltp) ? r.ltp : 0;
    s.oi[i] = finite(r.oi) ? r.oi : 0;
    s.vol[i] = finite(r.vol) ? r.vol : 0;
    s.iv[i] = finite(r.iv) ? r.iv : 0;
    s.bid[i] = finite(r.bid) ? r.bid : 0;
    s.ask[i] = finite(r.ask) ? r.ask : 0;
    if (s.bidQty && finite(r.bidQty)) s.bidQty[i] = r.bidQty;
    if (s.askQty && finite(r.askQty)) s.askQty[i] = r.askQty;
  }
  return {
    id: snap.id,
    symbol: snap.symbol,
    expiry: snap.expiry,
    ts: snap.ts,
    spot: finite(snap.spot) ? snap.spot : 0,
    fmt: COLUMNAR_FORMAT,
    granularity,
    strikes: Float64Array.from(strikes),
    ce,
    pe,
  };
}

function sideRow(strike: number, side: "CE" | "PE", s: ColumnarSide, i: number): StrikeSnap | null {
  const ltp = s.ltp[i];
  if (Number.isNaN(ltp)) return null;
  const row: StrikeSnap = {
    strike,
    side,
    ltp: round2(ltp),
    oi: Math.round(s.oi[i]),
    vol: Math.round(s.vol[i]),
    iv: round2(s.iv[i]),
    bid: round2(s.bid[i]),
    ask: round2(s.ask[i]),
  };
  const bq = s.bidQty?.[i];
  const aq = s.askQty?.[i];
  if (bq !== undefined && !Number.isNaN(bq)) row.bidQty = Math.round(bq);
  if (aq !== undefined && !Number.isNaN(aq)) row.askQty = Math.round(aq);
  return row;
}

/** Decode a columnar record back to the public ChainSnapshot shape (CE then PE per strike). */
export function decodeSnapshot(rec: ColumnarSnapshotRecord): ChainSnapshot {
  const rows: StrikeSnap[] = [];
  const n = rec?.strikes?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const k = rec.strikes[i];
    const c = sideRow(k, "CE", rec.ce, i);
    const p = sideRow(k, "PE", rec.pe, i);
    if (c) rows.push(c);
    if (p) rows.push(p);
  }
  return { id: rec.id, symbol: rec.symbol, expiry: rec.expiry, ts: rec.ts, spot: rec.spot, rows };
}

/** Typed-array check that also works across realms (structured clones from another context). */
function isTyped(x: unknown, tag: "Float64Array" | "Float32Array"): boolean {
  return ArrayBuffer.isView(x) && Object.prototype.toString.call(x) === `[object ${tag}]`;
}

export function isColumnarRecord(x: unknown): x is ColumnarSnapshotRecord {
  const r = x as Partial<ColumnarSnapshotRecord> | null;
  return !!r && r.fmt === COLUMNAR_FORMAT && isTyped(r.strikes, "Float64Array") && !!r.ce && !!r.pe && isTyped(r.ce.ltp, "Float32Array") && isTyped(r.pe.ltp, "Float32Array");
}

export function isLegacyRecord(x: unknown): x is LegacySnapshotRecord {
  const r = x as Partial<LegacySnapshotRecord> | null;
  return !!r && typeof r.id === "string" && Array.isArray(r.rows);
}

/** Read any stored record (columnar or legacy) as a ChainSnapshot. Null for junk. */
export function recordToSnapshot(x: unknown): ChainSnapshot | null {
  if (isColumnarRecord(x)) return decodeSnapshot(x);
  if (isLegacyRecord(x)) {
    const { id, symbol, expiry, ts, spot, rows } = x;
    return { id, symbol, expiry, ts, spot, rows };
  }
  return null;
}

/** Upgrade one stored record to the columnar format. Returns null when it is already columnar or unreadable. */
export function migrateRecord(x: unknown): ColumnarSnapshotRecord | null {
  if (isColumnarRecord(x) || !isLegacyRecord(x)) return null;
  return encodeSnapshot(x, "raw");
}

/** Approximate stored bytes of a record (typed-array payload plus a small fixed overhead). */
export function recordBytes(rec: ColumnarSnapshotRecord): number {
  const sideBytes = (s: ColumnarSide) =>
    s.ltp.byteLength + s.oi.byteLength + s.vol.byteLength + s.iv.byteLength + s.bid.byteLength + s.ask.byteLength + (s.bidQty?.byteLength ?? 0) + (s.askQty?.byteLength ?? 0);
  return rec.strikes.byteLength + sideBytes(rec.ce) + sideBytes(rec.pe) + 160;
}

/** IST trading date (yyyy-mm-dd) of an epoch ms, fixed +05:30 offset (IST has no DST). */
export function istDateOf(ts: number): string {
  return new Date(ts + 330 * 60_000).toISOString().slice(0, 10);
}

/** Start of the IST 5-minute bar containing ts (bars are aligned to IST wall-clock minutes). */
export function barStart(ts: number, barMs: number = DOWNSAMPLE_BAR_MS): number {
  return Math.floor(ts / barMs) * barMs;
}

/**
 * Downsample plan for a set of snapshot keys: for each symbol, expiry and bar, keep the LAST
 * snapshot in the bar (its LTP, OI and IV are the bar close, and day volume is cumulative, so the
 * last value is the bar's running total). Returns the ids to delete and the ids kept.
 */
export function planDownsample(
  items: Array<{ id: string; symbol: string; expiry: string; ts: number }>,
  barMs: number = DOWNSAMPLE_BAR_MS,
): { keep: string[]; drop: string[] } {
  const last = new Map<string, { id: string; ts: number }>();
  for (const it of items) {
    const key = `${it.symbol}|${it.expiry}|${barStart(it.ts, barMs)}`;
    const cur = last.get(key);
    if (!cur || it.ts >= cur.ts) last.set(key, { id: it.id, ts: it.ts });
  }
  const keepSet = new Set([...last.values()].map((v) => v.id));
  const keep: string[] = [];
  const drop: string[] = [];
  for (const it of items) (keepSet.has(it.id) ? keep : drop).push(it.id);
  return { keep, drop };
}
