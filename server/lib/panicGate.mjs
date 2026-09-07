/**
 * panicGate — the placement-epoch guard behind "cancel-all vs. an order that
 * was already mid-flight" (1CLIQ-TRADE-SPEC.md §5).
 *
 * THE PROBLEM: a keypress starts placing an order (network round-trip to the
 * broker) and, a moment later and independently, the trader hits cancel-all
 * or close-all. The placement's HTTP response can land on either side of
 * that panic action — there is no way to know in advance. If it lands after
 * and the panic sweep already ran, that order is now a live position (or a
 * resting order) the sweep never saw and never accounted for.
 *
 * THE MECHANISM: a single monotonic counter, `placementEpoch`. Every panic
 * action bumps it. Every order-placement path captures the epoch value
 * BEFORE it starts its network call, and compares it again once the call
 * resolves. If the epoch moved in between, the world changed underneath
 * that placement and its result can no longer be trusted as "an order I
 * still fully own" — see isStaleEpoch().
 *
 * CONTRACT WITH CALLERS (this module enforces none of this itself — it only
 * holds the counter and the two data queues; a caller has to actually use
 * them):
 *   1. incrementEpoch() MUST be called SYNCHRONOUSLY, before the first
 *      `await`/network call of any order-placement path AND at the start of
 *      cancelAll()/closeAll() — panicLayer.mjs's cancelAll()/closeAll() do
 *      NOT call this themselves (they place no orders of their own account;
 *      they close what's already on the book), so the caller wiring them up
 *      in proxy-server.mjs is where this actually happens for a panic
 *      action. An order-placement path does the other half: capture
 *      `currentEpoch()` before its own network call, and check
 *      `isStaleEpoch(thatValue)` after.
 *   2. A placement that comes back stale is DATA, not a network call —
 *      recordStaleFill() below only classifies and queues it. Actually
 *      cancelling it (or feeding it into the next close-all sweep) is a
 *      real network operation and belongs to proxy-server.mjs, which drains
 *      these queues with drainPendingCancelQueue()/drainPendingCloseQueue().
 */

let placementEpoch = 0;
const pendingCancelQueue = [];
const pendingCloseQueue = [];

/** Advance the epoch by one and return the new value. */
export function incrementEpoch() {
  placementEpoch += 1;
  return placementEpoch;
}

/** The current epoch value, with no side effect. */
export function currentEpoch() {
  return placementEpoch;
}

/**
 * True once the epoch has moved past a placement's captured value — i.e. at
 * least one panic action started after that placement began. Strictly
 * greater-than: a placement that captured the CURRENT epoch (nothing has
 * happened since) is not stale.
 */
export function isStaleEpoch(epochAtPlacement) {
  return currentEpoch() > epochAtPlacement;
}

/**
 * Classify a placement that returned with a stale epoch, purely as data —
 * see the file header for why the actual network follow-up is not this
 * module's job. `order.status === "TRADED"` means a real position now
 * exists and belongs in the next close-all sweep; anything else (still
 * resting, unknown, or no status at all) is treated as still-cancellable and
 * belongs in the next cancel-all sweep — the safer assumption when in doubt,
 * since cancelling an order that already traded is a normal no-op for a
 * broker, but forgetting to cancel a resting one is not.
 */
export function recordStaleFill(order) {
  if (!order || typeof order !== "object") return;
  if (order.status === "TRADED") pendingCloseQueue.push(order);
  else pendingCancelQueue.push(order);
}

/** Remove and return every currently queued stale-fill cancel candidate. */
export function drainPendingCancelQueue() {
  return pendingCancelQueue.splice(0, pendingCancelQueue.length);
}

/** Remove and return every currently queued stale-fill close candidate. */
export function drainPendingCloseQueue() {
  return pendingCloseQueue.splice(0, pendingCloseQueue.length);
}

/** Test seam — resets the epoch and both queues. */
export function resetPanicGateForTests() {
  placementEpoch = 0;
  pendingCancelQueue.length = 0;
  pendingCloseQueue.length = 0;
}
