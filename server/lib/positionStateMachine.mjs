/**
 * Managed-position state machine — 1CLIQ-TRADE-SPEC.md §4.
 *
 * This is the guard against §13 failure mode #2, "double exit": the engine
 * and the UI both fire, or a retry lands after an unseen fill, flipping the
 * trader into an unintended opposite position. A pure `transition(state,
 * event, context) -> {ok, state|reason}` function is the mechanism: every
 * edge the spec draws is implemented, and every edge it does NOT draw is
 * rejected rather than silently ignored, so a caller can never wander the
 * position into an undefined status by sending an event it didn't expect.
 *
 * IMPORTANT — what this function cannot do: the diagram's `ARMED -> TRIGGERED`
 * edge is documented as "predicate true, SYNCHRONOUS CAS". This module has no
 * concept of time or concurrency; called twice with the same ARMED state it
 * will happily return TRIGGERED twice. Double-trigger safety therefore
 * depends entirely on the CALLER (riskEngine.mjs, built later in this
 * workflow) doing the compare-and-set itself: read the current state,
 * synchronously overwrite it with this function's result BEFORE any `await`,
 * and never re-enter with a stale ARMED snapshot. What this module guarantees
 * is that once the caller's state pointer actually reads TRIGGERED, a second
 * 'trigger' event against that object is structurally rejected (TRIGGERED has
 * no 'trigger' edge) — the FSM shape is the second line of defence, the
 * caller's CAS discipline is the first.
 *
 * RECONCILING, ORPHANED, EXIT_CONFIRMED and NEEDS_ATTENTION are dead ends as
 * far as this pure FSM is concerned — the spec diagram does not draw any
 * outgoing edge from them. Reconciliation logic (how RECONCILING is actually
 * resolved against the broker's book) is out of scope for Phase 2 and belongs
 * to riskEngine.mjs; until that exists, this module refuses to guess an edge
 * that isn't in the spec.
 */

export const STATES = Object.freeze({
  IDLE: "IDLE",
  ARMED: "ARMED",
  TRIGGERED: "TRIGGERED",
  ORPHANED: "ORPHANED",
  EXIT_SUBMITTED: "EXIT_SUBMITTED",
  EXIT_CONFIRMED: "EXIT_CONFIRMED",
  PARTIAL: "PARTIAL",
  EXIT_FAILED: "EXIT_FAILED",
  RECONCILING: "RECONCILING",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
});

const VALID_STATUSES = new Set(Object.values(STATES));

/** Retry budget for EXIT_FAILED -> TRIGGERED. Exactly 2, per spec §4. */
export const RETRY_BUDGET = 2;

/** Fresh IDLE state with a clean retry counter. */
export function initialState() {
  return { status: STATES.IDLE, attempts: 0 };
}

function normalize(state) {
  if (typeof state === "string") {
    return VALID_STATUSES.has(state) ? { status: state, attempts: 0 } : null;
  }
  if (state && typeof state === "object" && VALID_STATUSES.has(state.status)) {
    const attempts = Number.isFinite(state.attempts) ? state.attempts : 0;
    return { status: state.status, attempts };
  }
  return null;
}

function accept(status, attempts) {
  return { ok: true, state: { status, attempts } };
}

function reject(reason) {
  return { ok: false, reason };
}

/**
 * Advance the state machine by exactly one event. Never mutates `state`.
 *
 * @param {string|{status:string, attempts:number}} state current state (a bare
 *   status string is accepted as shorthand for `{status, attempts: 0}`)
 * @param {string} event one of: arm, disarm, trigger, orphan, submit_ok,
 *   submit_error, confirm, partial, reject, timeout, re_arm, retry
 * @param {object} [context] event-specific data; only `retry` reads it
 *   (`context.reconcileConfirmedNoFill`)
 * @returns {{ok:true, state:{status,attempts}}|{ok:false, reason:string}}
 */
export function transition(state, event, context = {}) {
  const current = normalize(state);
  if (!current) return reject(`Invalid state: ${JSON.stringify(state)}`);
  const { status, attempts } = current;

  switch (status) {
    case STATES.IDLE:
      if (event === "arm") return accept(STATES.ARMED, 0);
      break;

    case STATES.ARMED:
      if (event === "disarm") return accept(STATES.IDLE, 0);
      // Predicate true, synchronous CAS — see the file header for what that
      // means and what this function does/doesn't enforce.
      if (event === "trigger") return accept(STATES.TRIGGERED, attempts);
      // Broker shows the leg gone (e.g. manually closed outside the app).
      // This is an alarm state, not an exit order — never place one blind.
      if (event === "orphan") return accept(STATES.ORPHANED, attempts);
      break;

    case STATES.TRIGGERED:
      if (event === "submit_ok") return accept(STATES.EXIT_SUBMITTED, attempts);
      if (event === "submit_error") return accept(STATES.EXIT_FAILED, attempts);
      break;

    case STATES.EXIT_SUBMITTED:
      if (event === "confirm") return accept(STATES.EXIT_CONFIRMED, attempts);
      if (event === "partial") return accept(STATES.PARTIAL, attempts);
      if (event === "reject") return accept(STATES.EXIT_FAILED, attempts);
      // No terminal ack within 5s, or the process rebooted mid-flight.
      if (event === "timeout") return accept(STATES.RECONCILING, attempts);
      break;

    case STATES.PARTIAL:
      // Residual lots get a fresh armed cycle — reset the retry counter, this
      // is a new managed position on what's left, not a retry of the old one.
      if (event === "re_arm") return accept(STATES.ARMED, 0);
      break;

    case STATES.EXIT_FAILED:
      if (event === "retry") {
        const canRetry = attempts < RETRY_BUDGET && context.reconcileConfirmedNoFill === true;
        // A rejection never re-fires without a POSITIVE "no fill" answer from
        // the broker — absence of confirmation is not the same as no fill,
        // and is not sufficient on its own (spec §4 / §13 #2).
        return canRetry
          ? accept(STATES.TRIGGERED, attempts + 1)
          : accept(STATES.NEEDS_ATTENTION, attempts);
      }
      break;

    // EXIT_CONFIRMED, ORPHANED, RECONCILING, NEEDS_ATTENTION: no outgoing
    // edge is drawn in the spec, so every event here falls through to the
    // rejection below. See file header.
    default:
      break;
  }

  return reject(`Illegal transition: '${event}' is not valid from ${status}`);
}
