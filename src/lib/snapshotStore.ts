/**
 * Snapshot store: intraday option-chain snapshots and end-of-day stats in IndexedDB.
 *
 * This is the foundation for derived flow, OI replay, PCR history and IV history. Records live in
 * the shared market database (src/lib/localDatabase.ts, stores "chainSnapshots" and "dailyStats").
 * Everything here is browser-local: history only exists for the minutes this tab was recording,
 * plus whatever src/lib/history/hydrate.ts backfills from the proxy's opt-in server recorder.
 *
 * Storage (database v4): records are columnar (src/lib/history/columnar.ts) and decoded back to the
 * public ChainSnapshot shape on read, so callers never see the stored format. Writes go through a
 * storage gate (src/lib/history/storageHealth.ts): persistence is requested, usage is checked
 * before writes, recording pauses above 80% of quota and QuotaExceededError is caught. Finished
 * days are downsampled to 5-minute bars by compactSnapshots().
 *
 * Pure helpers (row building, daily stat maths, CSV) are exported separately so they can be tested
 * without IndexedDB.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import {
  atmIV,
  atmStraddle,
  chainForward,
  enrichChain,
  getMarketParams,
  istDateString,
  maxPain,
  normalizeExpiry,
  skewMetrics,
  timeToExpiryYears,
  toISTDate,
} from "@/lib/options";
import {
  STORE_CHAIN_SNAPSHOTS,
  STORE_DAILY_STATS,
  getMetadata,
  isIndexedDBAvailable,
  openMarketDB,
  setMetadata,
} from "@/lib/localDatabase";
import {
  encodeSnapshot,
  isColumnarRecord,
  istDateOf,
  migrateRecord,
  planDownsample,
  recordToSnapshot,
  type ColumnarSnapshotRecord,
} from "@/lib/history/columnar";
import { canWrite, clearQuotaPause, isQuotaError, noteWriteError } from "@/lib/history/storageHealth";
import type { OptionLegDataExt } from "@/lib/types/market";

export interface StrikeSnap {
  strike: number;
  side: "CE" | "PE";
  ltp: number;
  oi: number;
  vol: number;
  iv: number;
  bid: number;
  ask: number;
  bidQty?: number;
  askQty?: number;
}

export interface ChainSnapshot {
  id: string;
  symbol: string;
  expiry: string;
  ts: number;
  spot: number;
  rows: StrikeSnap[];
}

export interface DailyStat {
  symbol: string;
  date: string;
  atmIv: number;
  pcrOi: number;
  pcrVol: number;
  maxPain: number;
  straddle: number;
  spot: number;
  futBasis?: number;
  rr25?: number;
}

// ── Pure helpers ──

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function normaliseSymbol(symbol: string): string {
  return String(symbol || "").trim().toUpperCase();
}

/** Expiry key used in the store: ISO when parseable, otherwise the trimmed input. */
export function normaliseExpiryKey(expiry: string): string {
  const iso = normalizeExpiry(String(expiry || ""));
  return iso || String(expiry || "").trim();
}

export function snapshotId(symbol: string, expiry: string, ts: number): string {
  return `${normaliseSymbol(symbol)}|${normaliseExpiryKey(expiry)}|${ts}`;
}

function legToSnap(strike: number, side: "CE" | "PE", leg: OptionLegData | undefined): StrikeSnap | null {
  if (!leg) return null;
  const ext = leg as OptionLegDataExt;
  const ltp = finite(leg.ltp) ? leg.ltp : 0;
  const oi = finite(leg.oi) ? leg.oi : 0;
  const vol = finite(leg.volume) ? leg.volume : 0;
  const bid = finite(leg.bidPrice) ? leg.bidPrice : 0;
  const ask = finite(leg.askPrice) ? leg.askPrice : 0;
  // A leg with no price, no OI and no volume carries no information.
  if (ltp <= 0 && oi <= 0 && vol <= 0 && bid <= 0 && ask <= 0) return null;
  const snap: StrikeSnap = { strike, side, ltp, oi, vol, iv: finite(leg.iv) ? leg.iv : 0, bid, ask };
  if (finite(ext.bidQty)) snap.bidQty = ext.bidQty;
  if (finite(ext.askQty)) snap.askQty = ext.askQty;
  return snap;
}

/** Flatten a chain into StrikeSnap rows (CE then PE per strike, ascending strike). */
export function buildSnapshotRows(chain: OptionData[]): StrikeSnap[] {
  const rows: StrikeSnap[] = [];
  const sorted = (Array.isArray(chain) ? chain : []).filter((r) => r && finite(r.strikePrice) && r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
  for (const r of sorted) {
    const ce = legToSnap(r.strikePrice, "CE", r.ce);
    const pe = legToSnap(r.strikePrice, "PE", r.pe);
    if (ce) rows.push(ce);
    if (pe) rows.push(pe);
  }
  return rows;
}

export function buildSnapshot(symbol: string, expiry: string, spot: number, chain: OptionData[], ts: number = Date.now()): ChainSnapshot {
  return {
    id: snapshotId(symbol, expiry, ts),
    symbol: normaliseSymbol(symbol),
    expiry: normaliseExpiryKey(expiry),
    ts,
    spot: finite(spot) ? spot : 0,
    rows: buildSnapshotRows(chain),
  };
}

const emptyLeg = (): OptionLegDataExt => ({ ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 });

/** Rebuild an OptionData[] chain from a snapshot (Greeks and OI change are zero; enrich if needed). */
export function snapshotToChain(snap: Pick<ChainSnapshot, "rows">): OptionData[] {
  const byStrike = new Map<number, OptionData>();
  for (const s of snap?.rows ?? []) {
    let row = byStrike.get(s.strike);
    if (!row) {
      row = { strikePrice: s.strike, ce: emptyLeg(), pe: emptyLeg() };
      byStrike.set(s.strike, row);
    }
    const leg: OptionLegDataExt = { ...emptyLeg(), ltp: s.ltp, oi: s.oi, volume: s.vol, iv: s.iv, bidPrice: s.bid, askPrice: s.ask };
    if (finite(s.bidQty)) leg.bidQty = s.bidQty;
    if (finite(s.askQty)) leg.askQty = s.askQty;
    if (s.side === "CE") row.ce = leg;
    else row.pe = leg;
  }
  return [...byStrike.values()].sort((a, b) => a.strikePrice - b.strikePrice);
}

/**
 * End-of-day stats from a chain. atmIv and rr25 are in PERCENT (same unit as OptionLegData.iv).
 * Values that cannot be computed come back as NaN (atmIv, straddle) or are omitted (rr25, futBasis).
 */
export function computeDailyStat(o: {
  symbol: string;
  date: string;
  spot: number;
  chain: OptionData[];
  expiry: string;
  now?: Date;
  futuresPrice?: number;
}): DailyStat {
  const chain = Array.isArray(o.chain) ? o.chain : [];
  let ceOi = 0;
  let peOi = 0;
  let ceVol = 0;
  let peVol = 0;
  for (const r of chain) {
    ceOi += finite(r?.ce?.oi) ? r.ce.oi : 0;
    peOi += finite(r?.pe?.oi) ? r.pe.oi : 0;
    ceVol += finite(r?.ce?.volume) ? r.ce.volume : 0;
    peVol += finite(r?.pe?.volume) ? r.pe.volume : 0;
  }
  const now = o.now ?? new Date();
  const { r } = getMarketParams();
  const T = timeToExpiryYears(normaliseExpiryKey(o.expiry), now);
  const F = chainForward(chain, o.spot, T, r);
  const iv = atmIV(chain, F);
  const st = atmStraddle(chain, o.spot);
  const stat: DailyStat = {
    symbol: normaliseSymbol(o.symbol),
    date: o.date,
    atmIv: finite(iv) ? r4(iv) : NaN,
    pcrOi: ceOi > 0 ? r4(peOi / ceOi) : NaN,
    pcrVol: ceVol > 0 ? r4(peVol / ceVol) : NaN,
    maxPain: chain.length > 0 ? maxPain(chain) : NaN,
    straddle: finite(st.straddle) ? Math.round(st.straddle * 100) / 100 : NaN,
    spot: finite(o.spot) ? o.spot : NaN,
  };
  if (finite(o.futuresPrice) && o.futuresPrice > 0 && finite(o.spot) && o.spot > 0) {
    stat.futBasis = Math.round((o.futuresPrice - o.spot) * 100) / 100;
  } else if (finite(F) && finite(o.spot) && o.spot > 0) {
    // Parity-implied forward minus spot (labelled as derived in the UI).
    stat.futBasis = Math.round((F - o.spot) * 100) / 100;
  }
  if (finite(iv) && chain.length > 0 && finite(T) && T > 0) {
    const enriched = enrichChain(chain, { spot: o.spot, expiry: normaliseExpiryKey(o.expiry), now, forward: finite(F) ? F : undefined, overwrite: true });
    const smile: Array<{ delta: number; iv: number }> = [];
    for (const row of enriched) {
      if (row.ce?.iv > 0 && finite(row.ce.delta)) smile.push({ delta: row.ce.delta, iv: row.ce.iv });
      if (row.pe?.iv > 0 && finite(row.pe.delta)) smile.push({ delta: row.pe.delta, iv: row.pe.iv });
    }
    const sk = skewMetrics(smile, iv);
    if (finite(sk.rr25)) stat.rr25 = r4(sk.rr25);
  }
  return stat;
}

function csvCell(v: string | number | undefined): string {
  if (v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** IST "yyyy-mm-dd HH:MM:SS" for an epoch ms. */
export function istTimestamp(ts: number): string {
  const d = new Date(ts + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export const SNAPSHOT_CSV_HEADER = "time_ist,ts,symbol,expiry,spot,strike,side,ltp,oi,volume,iv,bid,ask,bid_qty,ask_qty";

export function snapshotsToCSV(snaps: ChainSnapshot[]): string {
  const lines = [SNAPSHOT_CSV_HEADER];
  const ordered = [...(snaps ?? [])].sort((a, b) => a.ts - b.ts);
  for (const s of ordered) {
    const t = istTimestamp(s.ts);
    for (const r of s.rows) {
      lines.push([t, s.ts, s.symbol, s.expiry, s.spot, r.strike, r.side, r.ltp, r.oi, r.vol, r.iv, r.bid, r.ask, r.bidQty, r.askQty].map(csvCell).join(","));
    }
  }
  return lines.join("\n");
}

/** Keep the last `days` stats in ascending date order, one per date. */
export function selectRecentDailyStats(stats: DailyStat[], days: number): DailyStat[] {
  const byDate = new Map<string, DailyStat>();
  for (const s of stats ?? []) if (s?.date) byDate.set(s.date, s);
  const sorted = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const n = Math.max(0, Math.floor(days));
  return n > 0 ? sorted.slice(-n) : [];
}

// ── Recordability (pure) ──

/** A chain is only recorded when it is fresh live data: never sample, stale or old quotes. */
export const MAX_RECORD_AGE_MS = 2 * 60_000;

export type SnapshotSkipReason = "sample" | "stale" | "old" | "empty" | "too-soon" | "paused" | "no-db" | "error";

/**
 * Why a chain must not be recorded, or null when it may be. `asOf` older than MAX_RECORD_AGE_MS
 * counts as stale even when the feed did not flag it.
 */
export function snapshotSkipReason(
  input: { source?: string; stale?: boolean; asOf?: number | null; rowCount: number },
  now: number = Date.now(),
): SnapshotSkipReason | null {
  if (input.source === "sample") return "sample";
  if (input.stale) return "stale";
  if (finite(input.asOf) && input.asOf > 0 && now - input.asOf > MAX_RECORD_AGE_MS) return "old";
  if (!(input.rowCount > 0)) return "empty";
  return null;
}

// ── Recorder state (set by useSnapshotRecorder) ──

let recordingActive = 0;
let lastRecordedTs: number | null = null;
const lastByKey = new Map<string, number>();
/** Minimum gap between two snapshots of the same symbol/expiry. */
export const MIN_SNAPSHOT_GAP_MS = 15_000;

/** Mark a recorder as active (call with true on start and false on stop). */
export function setRecordingActive(active: boolean): void {
  recordingActive = Math.max(0, recordingActive + (active ? 1 : -1));
}

/** Tests only: forget the in-memory gap tracker. */
export function resetRecorderMemory(): void {
  lastByKey.clear();
  lastRecordedTs = null;
  recordingActive = 0;
}

// ── IndexedDB plumbing ──

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

async function db(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) return null;
  try {
    return await openMarketDB();
  } catch {
    return null;
  }
}

/** Put columnar records in one transaction, behind the storage gate. Quota errors pause recording. */
async function writeRecords(d: IDBDatabase, records: ColumnarSnapshotRecord[]): Promise<"ok" | "paused" | "error"> {
  if (records.length === 0) return "ok";
  if (!(await canWrite())) return "paused";
  try {
    const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readwrite");
    const store = tx.objectStore(STORE_CHAIN_SNAPSHOTS);
    for (const r of records) store.put(r);
    await txDone(tx);
    return "ok";
  } catch (e) {
    noteWriteError(e);
    return isQuotaError(e) ? "paused" : "error";
  }
}

function decodeAll(values: unknown[]): ChainSnapshot[] {
  const out: ChainSnapshot[] = [];
  for (const v of values) {
    const s = recordToSnapshot(v);
    if (s) out.push(s);
  }
  return out;
}

// ── Public API ──

export interface RecordOptions {
  /** Feed source; "sample" is never recorded. */
  source?: string;
  /** Feed flagged the chain as stale (last-good copy, after hours). Never recorded. */
  stale?: boolean;
  /** Epoch ms the quote is from; older than MAX_RECORD_AGE_MS is treated as stale. */
  asOf?: number | null;
  /** Snapshot time (defaults to now). */
  ts?: number;
}

/** Record a snapshot and say why it was skipped, if it was. */
export async function recordSnapshotDetailed(
  symbol: string,
  expiry: string,
  spot: number,
  chain: OptionData[],
  opts: RecordOptions = {},
): Promise<{ recorded: boolean; reason?: SnapshotSkipReason }> {
  const ts = finite(opts.ts) ? opts.ts : Date.now();
  const snap = buildSnapshot(symbol, expiry, spot, chain, ts);
  const skip = snapshotSkipReason({ source: opts.source, stale: opts.stale, asOf: opts.asOf, rowCount: snap.rows.length }, ts);
  if (skip) return { recorded: false, reason: skip };
  const key = `${snap.symbol}|${snap.expiry}`;
  const prev = lastByKey.get(key);
  if (prev !== undefined && Math.abs(ts - prev) < MIN_SNAPSHOT_GAP_MS) return { recorded: false, reason: "too-soon" };
  const d = await db();
  if (!d) return { recorded: false, reason: "no-db" };
  // Claim the gap before the async write so two callers in the same tick cannot both write.
  lastByKey.set(key, ts);
  const res = await writeRecords(d, [encodeSnapshot(snap)]);
  if (res !== "ok") {
    if (prev === undefined) lastByKey.delete(key);
    else lastByKey.set(key, prev);
    return { recorded: false, reason: res === "paused" ? "paused" : "error" };
  }
  lastRecordedTs = ts;
  return { recorded: true };
}

/**
 * Record one live chain snapshot (at most one per symbol/expiry every MIN_SNAPSHOT_GAP_MS).
 * Pass the feed's source/stale/asOf so sample or stale chains are refused here as well.
 */
export async function recordSnapshot(symbol: string, expiry: string, spot: number, chain: OptionData[], opts?: RecordOptions): Promise<void> {
  try {
    await recordSnapshotDetailed(symbol, expiry, spot, chain, opts);
  } catch {
    /* recording is best-effort */
  }
}

/**
 * Bulk-import snapshots (server recorder backfill). Snapshots whose id already exists, or that fall
 * within MIN_SNAPSHOT_GAP_MS of a stored snapshot of the same symbol/expiry, are skipped.
 * Returns the number written (0 when paused or unavailable).
 */
export async function importSnapshots(snaps: ChainSnapshot[]): Promise<number> {
  const d = await db();
  const valid = (snaps ?? []).filter((s) => s && finite(s.ts) && s.ts > 0 && Array.isArray(s.rows) && s.rows.length > 0 && s.symbol && s.expiry);
  if (!d || valid.length === 0) return 0;
  const byKey = new Map<string, ChainSnapshot[]>();
  for (const s of valid) {
    const sym = normaliseSymbol(s.symbol);
    const exp = normaliseExpiryKey(s.expiry);
    const list = byKey.get(`${sym}|${exp}`) ?? [];
    list.push({ ...s, symbol: sym, expiry: exp, id: snapshotId(sym, exp, s.ts) });
    byKey.set(`${sym}|${exp}`, list);
  }
  const toWrite: ColumnarSnapshotRecord[] = [];
  for (const [key, list] of byKey) {
    const [sym, exp] = key.split("|");
    list.sort((a, b) => a.ts - b.ts);
    const lo = list[0].ts - MIN_SNAPSHOT_GAP_MS;
    const hi = list[list.length - 1].ts + MIN_SNAPSHOT_GAP_MS;
    const existing: number[] = [];
    const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("symbolExpiryTs").openKeyCursor(IDBKeyRange.bound([sym, exp, lo], [sym, exp, hi]));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        existing.push((cur.key as [string, string, number])[2]);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const taken = existing.sort((a, b) => a - b);
    for (const s of list) {
      if (nearAny(taken, s.ts, MIN_SNAPSHOT_GAP_MS)) continue;
      insertSorted(taken, s.ts);
      toWrite.push(encodeSnapshot(s, "raw"));
    }
  }
  const res = await writeRecords(d, toWrite);
  return res === "ok" ? toWrite.length : 0;
}

function nearAny(sorted: number[], ts: number, gap: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < ts) lo = mid + 1;
    else hi = mid;
  }
  return (lo < sorted.length && Math.abs(sorted[lo] - ts) < gap) || (lo > 0 && Math.abs(ts - sorted[lo - 1]) < gap);
}

function insertSorted(sorted: number[], ts: number): void {
  let i = sorted.length;
  while (i > 0 && sorted[i - 1] > ts) i--;
  sorted.splice(i, 0, ts);
}

/** Epoch ms of 00:00 IST on the IST day containing ts. */
function istDayStart(ts: number): number {
  return toISTDate(istDateOf(ts), "00:00").getTime();
}

export async function getSnapshots(symbol: string, expiry: string, fromTs?: number, toTs?: number): Promise<ChainSnapshot[]> {
  const d = await db();
  if (!d) return [];
  const sym = normaliseSymbol(symbol);
  const exp = normaliseExpiryKey(expiry);
  const range = IDBKeyRange.bound([sym, exp, finite(fromTs) ? fromTs : 0], [sym, exp, finite(toTs) ? toTs : Number.MAX_SAFE_INTEGER]);
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
  const rows = await reqToPromise(tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("symbolExpiryTs").getAll(range) as IDBRequest<unknown[]>);
  return decodeAll(rows).sort((a, b) => a.ts - b.ts);
}

export async function getLatestSnapshots(symbol: string, expiry: string, n: number): Promise<ChainSnapshot[]> {
  const d = await db();
  const want = Math.max(0, Math.floor(n));
  if (!d || want === 0) return [];
  const sym = normaliseSymbol(symbol);
  const exp = normaliseExpiryKey(expiry);
  const range = IDBKeyRange.bound([sym, exp, 0], [sym, exp, Number.MAX_SAFE_INTEGER]);
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
  const out: unknown[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("symbolExpiryTs").openCursor(range, "prev");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= want) return resolve();
      out.push(cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return decodeAll(out.reverse());
}

/** Timestamps (ascending) of stored snapshots for a symbol/expiry in [fromTs, toTs]. Key-only read. */
export async function getSnapshotTimes(symbol: string, expiry: string, fromTs = 0, toTs = Number.MAX_SAFE_INTEGER): Promise<number[]> {
  const d = await db();
  if (!d) return [];
  const sym = normaliseSymbol(symbol);
  const exp = normaliseExpiryKey(expiry);
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
  const out: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("symbolExpiryTs").openKeyCursor(IDBKeyRange.bound([sym, exp, fromTs], [sym, exp, toTs]));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      out.push((cur.key as [string, string, number])[2]);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

export async function putDailyStat(s: DailyStat): Promise<void> {
  const d = await db();
  if (!d || !s?.symbol || !s?.date) return;
  if (!(await canWrite())) return;
  try {
    const tx = d.transaction(STORE_DAILY_STATS, "readwrite");
    tx.objectStore(STORE_DAILY_STATS).put({ ...s, symbol: normaliseSymbol(s.symbol) });
    await txDone(tx);
  } catch (e) {
    noteWriteError(e);
    if (!isQuotaError(e)) throw e;
  }
}

export async function getDailyStats(symbol: string, days: number): Promise<DailyStat[]> {
  const d = await db();
  if (!d) return [];
  const tx = d.transaction(STORE_DAILY_STATS, "readonly");
  const all = await reqToPromise(tx.objectStore(STORE_DAILY_STATS).index("symbol").getAll(normaliseSymbol(symbol)) as IDBRequest<DailyStat[]>);
  return selectRecentDailyStats(all, days);
}

/** Delete snapshots older than keepDays. Returns the number deleted. */
export async function pruneSnapshots(keepDays: number, now: number = Date.now()): Promise<number> {
  const d = await db();
  if (!d) return 0;
  const cutoff = now - Math.max(0, keepDays) * 86_400_000;
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readwrite");
  let deleted = 0;
  const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("ts").openCursor(IDBKeyRange.upperBound(cutoff, true));
  req.onsuccess = () => {
    const cur = req.result;
    if (!cur) return;
    cur.delete();
    deleted++;
    cur.continue();
  };
  await txDone(tx);
  if (deleted > 0) clearQuotaPause();
  return deleted;
}

const COMPACT_META_KEY = "snapshotsCompactedThrough";

/**
 * Downsample finished trading days to 5-minute bars: for every IST day before today (and after the
 * last compacted day), keep the last snapshot in each 5-minute bar per symbol/expiry and delete the
 * rest. Kept records are marked granularity "5m". Today's raw snapshots are never touched.
 */
export async function compactSnapshots(now: number = Date.now()): Promise<{ dropped: number; kept: number }> {
  const d = await db();
  if (!d) return { dropped: 0, kept: 0 };
  const todayStart = istDayStart(now);
  let fromTs = 0;
  try {
    const meta = await getMetadata(COMPACT_META_KEY);
    if (meta?.value && /^\d{4}-\d{2}-\d{2}$/.test(meta.value)) fromTs = toISTDate(meta.value, "00:00").getTime() + 86_400_000;
  } catch {
    fromTs = 0;
  }
  if (!(fromTs < todayStart)) return { dropped: 0, kept: 0 };
  const range = IDBKeyRange.bound(fromTs, todayStart, false, true);

  const items: Array<{ id: string; symbol: string; expiry: string; ts: number }> = [];
  {
    const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("ts").openCursor(range);
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const v = cur.value as Partial<ColumnarSnapshotRecord> & { id: string; symbol: string; expiry: string; ts: number };
        if (v.granularity !== "5m") items.push({ id: v.id, symbol: v.symbol, expiry: v.expiry, ts: v.ts });
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
  const plan = planDownsample(items);
  const drop = new Set(plan.drop);
  const keep = new Set(plan.keep);
  if (drop.size > 0 || keep.size > 0) {
    const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readwrite");
    const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("ts").openCursor(range);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      const v = cur.value as { id: string };
      if (drop.has(v.id)) cur.delete();
      else if (keep.has(v.id)) {
        const rec = isColumnarRecord(cur.value) ? cur.value : migrateRecord(cur.value);
        if (rec) cur.update({ ...rec, granularity: "5m" });
      }
      cur.continue();
    };
    await txDone(tx);
  }
  try {
    await setMetadata(COMPACT_META_KEY, istDateOf(todayStart - 1));
  } catch {
    /* compaction simply runs again next session */
  }
  if (drop.size > 0) clearQuotaPause();
  return { dropped: drop.size, kept: keep.size };
}

export async function getSnapshotStats(): Promise<{ count: number; symbols: string[]; recording: boolean; lastTs: number | null }> {
  const recording = recordingActive > 0;
  const d = await db();
  if (!d) return { count: 0, symbols: [], recording, lastTs: lastRecordedTs };
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
  const store = tx.objectStore(STORE_CHAIN_SNAPSHOTS);
  const count = await reqToPromise(store.count());
  const symbols: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = store.index("symbol").openKeyCursor(null, "nextunique");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      symbols.push(String(cur.key));
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  let lastTs: number | null = lastRecordedTs;
  await new Promise<void>((resolve, reject) => {
    const req = store.index("ts").openKeyCursor(null, "prev");
    req.onsuccess = () => {
      const cur = req.result;
      if (cur && typeof cur.key === "number") lastTs = Math.max(lastTs ?? 0, cur.key);
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
  return { count, symbols, recording, lastTs };
}

export async function exportSnapshotsCSV(symbol: string, expiry: string): Promise<string> {
  return snapshotsToCSV(await getSnapshots(symbol, expiry));
}

/** IST trading date of a snapshot timestamp. */
export function snapshotDateIST(ts: number): string {
  return istDateString(new Date(ts));
}

export { getStorageHealth, refreshStorageHealth, subscribeStorageHealth, clearQuotaPause, QUOTA_PAUSE_RATIO, type StorageHealth } from "@/lib/history/storageHealth";
