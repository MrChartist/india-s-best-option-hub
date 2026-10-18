/**
 * Bounds for the server-side upstream WebSocket pools (pocketfulWs.mjs, tradejiniStream.mjs,
 * hdfcsecuritiesFeed.mjs). Each pool keeps one socket per credential so REST-shaped calls can reuse it; without
 * limits a socket stays open on the user's token after they log out, every distinct credential opens another
 * persistent socket, and the subscription and tick maps grow for ever.
 *
 * The guard adds three limits to a pool's Map<key, entry>:
 *  - idle timeout: a socket nobody has asked for a snapshot in `idleMs` (and that has no live listener) is closed;
 *  - connection cap: opening one more socket than `maxConnections` first closes the least recently used idle one,
 *    and refuses (422) if every socket is busy with a live listener;
 *  - subscription cap: trimSubscriptions() drops the oldest subscriptions beyond `maxSubscriptions`.
 */
import { BrokerError } from "./contract.mjs";

export const FEED_LIMITS = Object.freeze({
  idleMs: 120_000,
  maxConnections: 8,
  maxSubscriptions: 1500,
  sweepMs: 30_000,
});

/**
 * @param {Map<string, object>} connections  The pool's own map. Entries get a `lastUsed` timestamp.
 * @param {{ closeEntry: (key: string, entry: object) => void, isBusy?: (entry: object) => boolean,
 *   limits?: Partial<typeof FEED_LIMITS>, now?: () => number, label?: string }} opts
 *   closeEntry must close the socket and remove the entry from `connections`.
 */
export function createFeedPoolGuard(connections, { closeEntry, isBusy = () => false, limits = {}, now = () => Date.now(), label = "Broker" }) {
  const cfg = { ...FEED_LIMITS, ...limits };
  let timer = null;

  const close = (key, entry) => {
    try { closeEntry(key, entry); } catch { /* the socket may already be gone */ }
    if (connections.get(key) === entry) connections.delete(key);
  };

  function stopIfEmpty() {
    if (timer && connections.size === 0) { clearInterval(timer); timer = null; }
  }

  /** Close every idle socket. Returns how many were closed. */
  function sweep() {
    let closed = 0;
    const t = now();
    for (const [key, entry] of [...connections]) {
      if (entry.connecting || entry.pending) continue;
      if (!isBusy(entry) && t - (entry.lastUsed ?? 0) >= cfg.idleMs) { close(key, entry); closed++; }
    }
    stopIfEmpty();
    return closed;
  }

  function ensureTimer() {
    if (timer || cfg.sweepMs <= 0) return;
    timer = setInterval(sweep, cfg.sweepMs);
    timer.unref?.();
  }

  /** Mark an entry as just used (call on every snapshot request). */
  function touch(entry) {
    entry.lastUsed = now();
    ensureTimer();
    return entry;
  }

  /** Make room for one more socket: close idle ones, then the least recently used non-busy one. */
  function beforeOpen() {
    sweep();
    while (connections.size >= cfg.maxConnections) {
      const victims = [...connections].filter(([, e]) => !isBusy(e) && !e.connecting && !e.pending).sort((a, b) => (a[1].lastUsed ?? 0) - (b[1].lastUsed ?? 0));
      if (!victims.length) {
        throw new BrokerError(`${label}: too many live feed connections are open on this proxy. Close a live feed and try again.`, { code: "FEED_LIMIT", statusCode: 422 });
      }
      close(...victims[0]);
    }
  }

  /** Close every socket (for logout / session expiry / tests). */
  function closeAll() {
    for (const [key, entry] of [...connections]) close(key, entry);
    stopIfEmpty();
  }

  return { touch, beforeOpen, sweep, closeAll, limits: cfg };
}

/**
 * Drop the oldest members of `set` (insertion order) that are not in `keep` until it holds at most `max`.
 * Returns the dropped members so the caller can unsubscribe them and forget their ticks.
 */
export function trimSubscriptions(set, keep, max = FEED_LIMITS.maxSubscriptions) {
  const dropped = [];
  if (set.size <= max) return dropped;
  for (const k of set) {
    if (set.size <= max) break;
    if (keep.has(k)) continue;
    set.delete(k);
    dropped.push(k);
  }
  return dropped;
}
