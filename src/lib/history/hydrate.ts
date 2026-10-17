/**
 * Backfill the browser snapshot store from the proxy's opt-in server recorder.
 *
 * The proxy (proxy-server.mjs, RECORD_SYMBOLS=…) appends live chain snapshots to NDJSON files while
 * the market is open, so history survives closed tabs. When the proxy is reachable this module asks
 * GET /api/x/snapshots for the time ranges the browser is missing and imports them into IndexedDB
 * (importSnapshots dedupes against snapshots already recorded locally).
 *
 * Nothing runs in sample mode or while the proxy gate is offline, and each symbol/expiry is
 * hydrated at most once a minute per page session.
 */
import { getProxyStatus, proxyGet } from "@/lib/api/proxyClient";
import { normalizeExpiry, toISTDate, istDateString } from "@/lib/options";
import { MIN_SNAPSHOT_GAP_MS, getSnapshotTimes, importSnapshots, normaliseSymbol, type ChainSnapshot, type StrikeSnap } from "@/lib/snapshotStore";

/** A local gap longer than this is filled from the server. */
export const HYDRATE_GAP_MS = 5 * 60_000;
/** At most this many range requests per hydrate call. */
export const MAX_HYDRATE_RANGES = 4;
const HYDRATE_THROTTLE_MS = 60_000;

export interface ServerSnapshotsPayload {
  symbol: string;
  expiry: string | null;
  from: number;
  to: number;
  snapshots: ChainSnapshot[];
  truncated?: boolean;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function sanitiseRow(x: unknown): StrikeSnap | null {
  const r = x as Partial<StrikeSnap> | null;
  if (!r || !finite(r.strike) || r.strike <= 0 || (r.side !== "CE" && r.side !== "PE")) return null;
  const n = (v: unknown) => (finite(v) && v >= 0 ? v : 0);
  const row: StrikeSnap = { strike: r.strike, side: r.side, ltp: n(r.ltp), oi: n(r.oi), vol: n(r.vol), iv: n(r.iv), bid: n(r.bid), ask: n(r.ask) };
  if (finite(r.bidQty)) row.bidQty = r.bidQty;
  if (finite(r.askQty)) row.askQty = r.askQty;
  return row;
}

/** Validate the server's snapshot list. Junk entries are dropped, never thrown. */
export function sanitiseServerSnapshots(data: unknown): ChainSnapshot[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { snapshots?: unknown })?.snapshots) ? (data as { snapshots: unknown[] }).snapshots : [];
  const out: ChainSnapshot[] = [];
  for (const item of list) {
    const s = item as Partial<ChainSnapshot> | null;
    if (!s || typeof s.symbol !== "string" || typeof s.expiry !== "string" || !finite(s.ts) || s.ts <= 0) continue;
    const expiry = normalizeExpiry(s.expiry);
    if (!expiry) continue;
    const rows = (Array.isArray(s.rows) ? s.rows : []).map(sanitiseRow).filter((r): r is StrikeSnap => r !== null);
    if (rows.length === 0) continue;
    const symbol = normaliseSymbol(s.symbol);
    out.push({ id: `${symbol}|${expiry}|${s.ts}`, symbol, expiry, ts: s.ts, spot: finite(s.spot) ? s.spot : 0, rows });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * Ranges inside [from, to] not covered by the local timestamps (sorted ascending): the lead-in
 * before the first snapshot, gaps longer than maxGapMs, and the tail after the last snapshot.
 * The longest MAX_HYDRATE_RANGES ranges are returned in time order.
 */
export function missingRanges(sortedTs: number[], from: number, to: number, maxGapMs: number = HYDRATE_GAP_MS): Array<[number, number]> {
  if (!(to > from)) return [];
  const ts = sortedTs.filter((t) => t >= from && t <= to);
  if (ts.length === 0) return [[from, to]];
  const out: Array<[number, number]> = [];
  if (ts[0] - from > maxGapMs) out.push([from, ts[0] - 1]);
  for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > maxGapMs) out.push([ts[i - 1] + 1, ts[i] - 1]);
  if (to - ts[ts.length - 1] > maxGapMs) out.push([ts[ts.length - 1] + 1, to]);
  if (out.length <= MAX_HYDRATE_RANGES) return out;
  return out
    .map((r, i) => ({ r, i, len: r[1] - r[0] }))
    .sort((a, b) => b.len - a.len)
    .slice(0, MAX_HYDRATE_RANGES)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.r);
}

/** The proxy has answered this session and the app is not in sample mode. */
export function isProxyReachable(): boolean {
  const g = getProxyStatus();
  return !g.sampleMode && g.status === "online";
}

/** Start of today's session window for hydration (09:00 IST, a little before the open). */
export function sessionStartToday(now: Date = new Date()): number {
  return toISTDate(istDateString(now), "09:00").getTime();
}

/** One request to the server recorder. Never throws; null data when unavailable. */
export async function fetchServerSnapshots(
  symbol: string,
  expiry: string | undefined,
  from: number,
  to: number,
  opts?: { signal?: AbortSignal },
): Promise<{ snapshots: ChainSnapshot[]; truncated: boolean; reason?: string }> {
  const env = await proxyGet<ServerSnapshotsPayload>(
    "/api/x/snapshots",
    { symbol: normaliseSymbol(symbol), expiry: expiry ? normalizeExpiry(expiry) || expiry : undefined, from: Math.floor(from), to: Math.floor(to) },
    { timeoutMs: 20_000, signal: opts?.signal },
  );
  if (!env.data) return { snapshots: [], truncated: false, reason: env.meta.reason ?? "unavailable" };
  return { snapshots: sanitiseServerSnapshots(env.data), truncated: !!env.data.truncated, reason: env.meta.reason };
}

const lastRun = new Map<string, number>();
const inflight = new Map<string, Promise<HydrateResult>>();

export interface HydrateResult {
  imported: number;
  requested: number;
  reason?: "proxy-offline" | "throttled" | "no-gaps" | "unavailable";
}

/**
 * Fill local gaps for one symbol/expiry in [from, to] (default: today's session so far) from the
 * server recorder. Concurrent calls for the same key share one run.
 */
export function hydrateSnapshots(
  symbol: string,
  expiry: string,
  opts?: { from?: number; to?: number; force?: boolean; now?: number },
): Promise<HydrateResult> {
  const sym = normaliseSymbol(symbol);
  const exp = normalizeExpiry(expiry) || expiry;
  const key = `${sym}|${exp}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  if (!exp || !isProxyReachable()) return Promise.resolve({ imported: 0, requested: 0, reason: "proxy-offline" });
  const now = opts?.now ?? Date.now();
  const prev = lastRun.get(key);
  if (!opts?.force && prev !== undefined && now - prev < HYDRATE_THROTTLE_MS) return Promise.resolve({ imported: 0, requested: 0, reason: "throttled" });
  lastRun.set(key, now);

  const run = (async (): Promise<HydrateResult> => {
    const from = opts?.from ?? sessionStartToday(new Date(now));
    const to = opts?.to ?? now;
    const local = await getSnapshotTimes(sym, exp, from, to);
    const ranges = missingRanges(local, from, to, Math.max(HYDRATE_GAP_MS, MIN_SNAPSHOT_GAP_MS * 2));
    if (ranges.length === 0) return { imported: 0, requested: 0, reason: "no-gaps" };
    let imported = 0;
    let anyAnswer = false;
    for (const [a, b] of ranges) {
      const res = await fetchServerSnapshots(sym, exp, a, b);
      if (res.reason === undefined || res.snapshots.length > 0) anyAnswer = true;
      if (res.snapshots.length > 0) imported += await importSnapshots(res.snapshots);
    }
    return anyAnswer ? { imported, requested: ranges.length } : { imported, requested: ranges.length, reason: "unavailable" };
  })()
    .catch((): HydrateResult => ({ imported: 0, requested: 0, reason: "unavailable" }))
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

/** Tests only. */
export function resetHydrateMemory(): void {
  lastRun.clear();
  inflight.clear();
}
