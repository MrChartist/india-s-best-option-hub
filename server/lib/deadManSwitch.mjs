/**
 * deadManSwitch — a tiny, generic liveness tracker.
 *
 * Factored out of riskEngine.mjs (which was pushing past the repo's 300-line
 * file cap) to keep two concerns separate: "is the engine process itself
 * still alive" is a generic start/stop-able heartbeat with no knowledge of
 * positions, ticks, or trading, while riskEngine.mjs owns everything domain
 * specific. This also makes the dead-man's-switch semantics from
 * 1CLIQ-TRADE-SPEC.md §4 — "the engine writes lastHeartbeat every 1s;
 * /api/risk/status returns {alive, lastTickAgeMs, ...}" — testable on their
 * own, with an injectable clock, instead of only through riskEngine's tick
 * evaluation.
 *
 * Two independent clocks are tracked:
 *  - lastHeartbeat: written by the 1s interval timer while start()ed. This is
 *    "is the engine process itself still running" — independent of whether
 *    any ticks are arriving.
 *  - lastTickAt: written by recordTick(), called once per tick the caller
 *    actually processes. This is "how stale is the market feed" — a live
 *    engine with a dead feed is a very different failure than a dead engine.
 */

const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
// >2x the default heartbeat cadence before status() calls it dead — enough
// slack that one slow event-loop tick doesn't flap the armed badge.
const DEFAULT_ALIVE_STALE_MS = 3000;

let lastHeartbeat = null;
let lastTickAt = null;
let timer = null;

/** Write the heartbeat now. Exported mainly for tests — start() drives this live. */
export function beat(now = Date.now()) {
  lastHeartbeat = now;
}

/** Record that a tick was processed just now — feeds `lastTickAgeMs`. */
export function recordTick(now = Date.now()) {
  lastTickAt = now;
}

/** Begin writing the heartbeat every `intervalMs`. Idempotent. */
export function start({ intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS } = {}) {
  if (timer) return;
  beat();
  timer = setInterval(beat, intervalMs);
  timer.unref?.(); // never keep a short-lived process (or a test) alive just for this
}

/** Stop writing the heartbeat. Safe to call when already stopped. */
export function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Whether the heartbeat timer is currently running. */
export function isRunning() {
  return timer !== null;
}

/**
 * @param {number} [now] injectable clock, for tests
 * @param {{aliveStaleMs?: number}} [opts]
 * @returns {{alive:boolean, lastTickAgeMs:number|null}}
 */
export function status(now = Date.now(), { aliveStaleMs = DEFAULT_ALIVE_STALE_MS } = {}) {
  return {
    alive: lastHeartbeat !== null && now - lastHeartbeat < aliveStaleMs,
    lastTickAgeMs: lastTickAt === null ? null : now - lastTickAt,
  };
}

/** Test seam — stops the timer and clears both clocks. */
export function resetDeadManSwitchForTests() {
  stop();
  lastHeartbeat = null;
  lastTickAt = null;
}
