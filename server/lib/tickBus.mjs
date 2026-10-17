/**
 * tickBus — in-process pub/sub for parsed Dhan ticks (1CLIQ-TRADE-SPEC.md §3).
 *
 * WHY this exists: proxy-server.mjs owns the single Dhan WebSocket and, before
 * this file, fanned every parsed tick straight out to browser clients. The
 * server-side risk engine (riskEngine.mjs) must see every tick BEFORE that
 * fan-out, synchronously — a stop-loss check that runs after (or depends on)
 * a browser round-trip is exactly the "closing the tab kills the automation"
 * flaw the spec calls out in 1Cliq. This module is the seam that makes the
 * ordering guaranteed rather than incidental:
 *
 *   Dhan WS -> parse -> tickBus.publish() -> riskEngine (in-process, sync)
 *                              |
 *                              +--> per-client WebSocket fan-out (browser)
 *
 * publish() calls every subscriber synchronously, in registration order,
 * before returning. proxy-server.mjs calls tickBus.publish(tick) immediately
 * after updating latestTicks and BEFORE broadcastToClients(), so by the time
 * a browser client ever sees a tick, every armed risk position has already
 * been evaluated against it.
 *
 * Deliberately tiny: no batching, no async, no queueing. A subscriber that
 * throws must not stop the tick reaching the remaining subscribers, or reaching
 * the browser fan-out that runs after this — one faulty listener (e.g. a
 * future analytics consumer) must never be able to take down the risk engine
 * or the live feed for everyone else.
 */

const subscribers = new Set();

/**
 * Register a handler to receive every tick published from now on.
 * @param {(tick: object) => void} handler
 * @returns {() => void} an unsubscribe function — safe to call more than once.
 */
export function subscribe(handler) {
  if (typeof handler !== "function") {
    throw new Error("tickBus.subscribe requires a function");
  }
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

/** Remove a previously subscribed handler. Safe to call on one that's already gone. */
export function unsubscribe(handler) {
  subscribers.delete(handler);
}

/**
 * Publish one tick to every current subscriber, synchronously and in
 * registration order. This function never awaits anything — that is what lets
 * riskEngine's ARMED->TRIGGERED compare-and-set run to completion inside a
 * single handler call, with no other tick able to interleave.
 */
export function publish(tick) {
  for (const handler of subscribers) {
    try {
      handler(tick);
    } catch {
      // A subscriber fault must never break the tick for the rest of the bus,
      // or for the browser fan-out that runs after tickBus.publish() returns.
    }
  }
}

/** How many handlers are currently subscribed. Mostly a test/diagnostic seam. */
export function subscriberCount() {
  return subscribers.size;
}

/** Test seam — removes every subscriber so tests don't leak handlers between files. */
export function resetTickBusForTests() {
  subscribers.clear();
}
