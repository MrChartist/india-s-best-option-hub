/**
 * Snapshot store: intraday option-chain snapshots and end-of-day stats in IndexedDB.
 *
 * This is the foundation for derived flow, OI replay, PCR history and IV history. Records live in
 * the shared market database (src/lib/localDatabase.ts, stores "chainSnapshots" and "dailyStats").
 * Everything here is browser-local: history only exists for the minutes this tab was recording.
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
} from "@/lib/options";
import {
  STORE_CHAIN_SNAPSHOTS,
  STORE_DAILY_STATS,
  isIndexedDBAvailable,
  openMarketDB,
} from "@/lib/localDatabase";
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

// ── Public API ──

export async function recordSnapshot(symbol: string, expiry: string, spot: number, chain: OptionData[]): Promise<void> {
  const ts = Date.now();
  const snap = buildSnapshot(symbol, expiry, spot, chain, ts);
  if (snap.rows.length === 0) return;
  const key = `${snap.symbol}|${snap.expiry}`;
  const prev = lastByKey.get(key);
  if (prev !== undefined && ts - prev < MIN_SNAPSHOT_GAP_MS) return;
  const d = await db();
  if (!d) return;
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readwrite");
  tx.objectStore(STORE_CHAIN_SNAPSHOTS).put(snap);
  await txDone(tx);
  lastByKey.set(key, ts);
  lastRecordedTs = ts;
}

export async function getSnapshots(symbol: string, expiry: string, fromTs?: number, toTs?: number): Promise<ChainSnapshot[]> {
  const d = await db();
  if (!d) return [];
  const sym = normaliseSymbol(symbol);
  const exp = normaliseExpiryKey(expiry);
  const range = IDBKeyRange.bound([sym, exp, finite(fromTs) ? fromTs : 0], [sym, exp, finite(toTs) ? toTs : Number.MAX_SAFE_INTEGER]);
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
  const rows = await reqToPromise(tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("symbolExpiryTs").getAll(range) as IDBRequest<ChainSnapshot[]>);
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function getLatestSnapshots(symbol: string, expiry: string, n: number): Promise<ChainSnapshot[]> {
  const d = await db();
  const want = Math.max(0, Math.floor(n));
  if (!d || want === 0) return [];
  const sym = normaliseSymbol(symbol);
  const exp = normaliseExpiryKey(expiry);
  const range = IDBKeyRange.bound([sym, exp, 0], [sym, exp, Number.MAX_SAFE_INTEGER]);
  const tx = d.transaction(STORE_CHAIN_SNAPSHOTS, "readonly");
  const out: ChainSnapshot[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = tx.objectStore(STORE_CHAIN_SNAPSHOTS).index("symbolExpiryTs").openCursor(range, "prev");
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= want) return resolve();
      out.push(cur.value as ChainSnapshot);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out.reverse();
}

export async function putDailyStat(s: DailyStat): Promise<void> {
  const d = await db();
  if (!d || !s?.symbol || !s?.date) return;
  const tx = d.transaction(STORE_DAILY_STATS, "readwrite");
  tx.objectStore(STORE_DAILY_STATS).put({ ...s, symbol: normaliseSymbol(s.symbol) });
  await txDone(tx);
}

export async function getDailyStats(symbol: string, days: number): Promise<DailyStat[]> {
  const d = await db();
  if (!d) return [];
  const tx = d.transaction(STORE_DAILY_STATS, "readonly");
  const all = await reqToPromise(tx.objectStore(STORE_DAILY_STATS).index("symbol").getAll(normaliseSymbol(symbol)) as IDBRequest<DailyStat[]>);
  return selectRecentDailyStats(all, days);
}

/** Delete snapshots older than keepDays. Returns the number deleted. */
export async function pruneSnapshots(keepDays: number): Promise<number> {
  const d = await db();
  if (!d) return 0;
  const cutoff = Date.now() - Math.max(0, keepDays) * 86_400_000;
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
  return deleted;
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
