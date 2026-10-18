/**
 * The order gate for real-money adapter methods (part of the contract in contract.mjs, which re-exports
 * withOrderGate, consumeOrderGate and isOrderGated for adapters).
 *
 * Real-money adapter methods are wrapped with withOrderGate(). The wrapper refuses (before any network
 * call) unless its LAST argument is a gate object minted by issueOrderGate() in this process, for the
 * same action, not yet used and not older than ORDER_GATE_TTL_MS. Only the proxy's trade route may mint
 * one, after validateOrder() passed with liveArmed === true. Today no non-Dhan route mints gates: the
 * browser order path for other brokers is intentionally blocked pending owner review.
 *
 * issueOrderGate is deliberately NOT re-exported from contract.mjs: adapters must never mint their own gate. Import
 * it from this module only in the proxy trade route and in tests. Every gate names exactly one broker, and every
 * wrapped method names its broker, so a gate minted for one broker can never unlock another. This is a coding
 * guard, not an authority boundary: the authority is the server-side arm session that decides `liveArmed`.
 */

import { OrderGateError } from "./contract.mjs";

export const ORDER_GATE_TTL_MS = 5000;
export const ORDER_GATED = Symbol.for("mrc.broker.orderGated");
const ORDER_ACTIONS = new Set(["placeOrder", "modifyOrder", "cancelOrder"]);
const issuedGates = new WeakMap();

/** Mint a single-use gate. Throws OrderGateError unless the guard verdict passed and live trading is armed. */
export function issueOrderGate({ verdict, liveArmed, action, brokerId, now = Date.now() } = {}) {
  if (typeof brokerId !== "string" || !brokerId) throw new OrderGateError("Order refused: the gate must name a broker. No order was sent.");
  if (liveArmed !== true) throw new OrderGateError();
  if (!verdict || verdict.ok !== true) throw new OrderGateError("Order refused: the order guard did not pass. No order was sent.");
  if (!ORDER_ACTIONS.has(action)) throw new OrderGateError(`Order refused: unknown order action ${String(action)}.`);
  const gate = Object.freeze({ action, brokerId });
  issuedGates.set(gate, { action, brokerId, expiresAt: now + ORDER_GATE_TTL_MS, used: false });
  return gate;
}

/** Validate and burn a gate. Throws OrderGateError on anything but a fresh, matching gate. */
export function consumeOrderGate(gate, { action, brokerId, now = Date.now() } = {}) {
  const rec = gate && typeof gate === "object" ? issuedGates.get(gate) : undefined;
  if (!rec || rec.used) throw new OrderGateError();
  if (rec.action !== action) throw new OrderGateError("Order refused: the gate was issued for a different action.");
  if (!brokerId || rec.brokerId !== brokerId) throw new OrderGateError("Order refused: the gate was issued for a different broker.");
  if (now > rec.expiresAt) throw new OrderGateError("Order refused: the arming check is stale. Try again.");
  rec.used = true;
}

/**
 * Wrap a real-money function. The returned function takes the original arguments plus a trailing gate.
 * `fn` is called without the gate, and only after the gate checks out.
 */
export function withOrderGate(action, fn, { brokerId } = {}) {
  if (!ORDER_ACTIONS.has(action)) throw new Error(`withOrderGate: unknown action ${action}`);
  if (typeof brokerId !== "string" || !brokerId) throw new Error(`withOrderGate: ${action} must name its brokerId`);
  const gated = async function gatedOrderCall(...args) {
    const gate = args.length > 0 ? args[args.length - 1] : undefined;
    consumeOrderGate(gate, { action, brokerId });
    return fn(...args.slice(0, -1));
  };
  Object.defineProperty(gated, ORDER_GATED, { value: action });
  return gated;
}

export function isOrderGated(fn) {
  return typeof fn === "function" && typeof fn[ORDER_GATED] === "string";
}
