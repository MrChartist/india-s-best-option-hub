/**
 * Browser storage health for the snapshot history store.
 *
 *  - Asks once per session for persistent storage (navigator.storage.persist()) so the browser does
 *    not evict recorded history under storage pressure.
 *  - Checks navigator.storage.estimate() before writes (throttled) and pauses recording above
 *    QUOTA_PAUSE_RATIO of the quota, resuming automatically once usage falls below it.
 *  - Remembers QuotaExceededError from IndexedDB and pauses writes for QUOTA_ERROR_BACKOFF_MS.
 *
 * getStorageHealth() is synchronous (last known state); refreshStorageHealth() re-measures.
 * The quota-error pause lasts the full backoff even if an estimate shows room, because estimates
 * are approximate and some browsers enforce lower per-origin limits; clearQuotaPause() lifts it.
 * subscribeStorageHealth() notifies UI (DatabaseManager) on every change.
 */

/** Recording pauses when usage reaches this share of the quota. */
export const QUOTA_PAUSE_RATIO = 0.8;
/** Writes are skipped for this long after a QuotaExceededError (unless an estimate shows room). */
export const QUOTA_ERROR_BACKOFF_MS = 5 * 60_000;
/** estimate() is not called more often than this before writes. */
export const ESTIMATE_THROTTLE_MS = 30_000;

export interface StorageHealth {
  /** navigator.storage.estimate() is available. */
  supported: boolean;
  usage: number | null;
  quota: number | null;
  /** usage / quota, 0..1, or null when unknown. */
  ratio: number | null;
  /** true / false once persist() has answered, null before or when unsupported. */
  persisted: boolean | null;
  /** Writes are currently skipped (near quota or after a quota error). */
  paused: boolean;
  pauseReason: "near-quota" | "quota-error" | null;
  lastError: string | null;
  lastErrorAt: number | null;
  checkedAt: number | null;
  /** Writes skipped because of the pause since the page loaded. */
  skippedWrites: number;
}

const initial = (): StorageHealth => ({
  supported: typeof navigator !== "undefined" && typeof navigator.storage?.estimate === "function",
  usage: null,
  quota: null,
  ratio: null,
  persisted: null,
  paused: false,
  pauseReason: null,
  lastError: null,
  lastErrorAt: null,
  checkedAt: null,
  skippedWrites: 0,
});

let health: StorageHealth = initial();
let persistAsked = false;
let quotaErrorUntil = 0;
const listeners = new Set<(h: StorageHealth) => void>();

function set(patch: Partial<StorageHealth>): void {
  health = { ...health, ...patch };
  listeners.forEach((cb) => {
    try {
      cb(health);
    } catch {
      /* a broken listener must not break recording */
    }
  });
}

/** Last known storage state (synchronous). */
export function getStorageHealth(): StorageHealth {
  return health;
}

export function subscribeStorageHealth(cb: (h: StorageHealth) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Pure: is a usage/quota pair above the pause threshold? Unknown → false (do not block). */
export function isNearQuota(usage: number | null | undefined, quota: number | null | undefined, ratio: number = QUOTA_PAUSE_RATIO): boolean {
  if (typeof usage !== "number" || typeof quota !== "number" || !Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return false;
  return usage / quota >= ratio;
}

/** True for the DOMException (or IDB transaction error) a browser raises when storage is full. */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown; inner?: unknown };
  if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  if (e.code === 22 || e.code === 1014) return true;
  return typeof e.message === "string" && /quota/i.test(e.message);
}

async function askPersist(): Promise<void> {
  if (persistAsked) return;
  persistAsked = true;
  try {
    const st = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!st) return;
    let persisted = typeof st.persisted === "function" ? await st.persisted() : false;
    if (!persisted && typeof st.persist === "function") persisted = await st.persist();
    set({ persisted });
  } catch {
    set({ persisted: false });
  }
}

/** Re-measure usage and quota now (also requests persistence once). */
export async function refreshStorageHealth(now: number = Date.now()): Promise<StorageHealth> {
  await askPersist();
  const st = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!st || typeof st.estimate !== "function") {
    set({ supported: false, checkedAt: now });
    return health;
  }
  try {
    const est = await st.estimate();
    const usage = typeof est.usage === "number" ? est.usage : null;
    const quota = typeof est.quota === "number" ? est.quota : null;
    const near = isNearQuota(usage, quota);
    const quotaBlocked = now < quotaErrorUntil;
    set({
      supported: true,
      usage,
      quota,
      ratio: usage !== null && quota ? Math.min(1, usage / quota) : null,
      checkedAt: now,
      paused: near || quotaBlocked,
      pauseReason: quotaBlocked ? "quota-error" : near ? "near-quota" : null,
    });
  } catch {
    set({ checkedAt: now });
  }
  return health;
}

/**
 * Gate before a write. Resolves true when the write may go ahead. Re-measures at most every
 * ESTIMATE_THROTTLE_MS; inside a quota-error backoff it answers false.
 */
export async function canWrite(now: number = Date.now()): Promise<boolean> {
  if (health.checkedAt === null || now - health.checkedAt >= ESTIMATE_THROTTLE_MS) await refreshStorageHealth(now);
  const blocked = health.paused || now < quotaErrorUntil;
  if (blocked) {
    set({ skippedWrites: health.skippedWrites + 1 });
    return false;
  }
  return true;
}

/** Lift a quota-error pause early (after the user freed space, e.g. cleared or pruned snapshots). */
export function clearQuotaPause(): void {
  quotaErrorUntil = 0;
  if (health.pauseReason === "quota-error") set({ paused: false, pauseReason: null, checkedAt: null });
}

/** Record a failed write. Quota errors pause writes; other errors are only remembered. */
export function noteWriteError(err: unknown, now: number = Date.now()): void {
  const message = err instanceof Error || (err && typeof err === "object" && "message" in err) ? String((err as { message: unknown }).message) : String(err);
  if (isQuotaError(err)) {
    quotaErrorUntil = now + QUOTA_ERROR_BACKOFF_MS;
    set({ paused: true, pauseReason: "quota-error", lastError: "Browser storage is full (QuotaExceededError)", lastErrorAt: now });
  } else {
    set({ lastError: message.slice(0, 200) || "Write failed", lastErrorAt: now });
  }
}

/** Tests only: forget all state. */
export function resetStorageHealth(): void {
  persistAsked = false;
  quotaErrorUntil = 0;
  health = initial();
}
