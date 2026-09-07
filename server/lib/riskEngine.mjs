/**
 * riskEngine — the server-side manager of live spot-referenced SL/Target
 * positions (1CLIQ-TRADE-SPEC.md §3 "Architecture" and §4 "core maths").
 *
 * This is the module the whole Phase-2 design point rests on: "the browser is
 * a view and an arming client, it never places an exit for a managed leg."
 * riskMath.mjs supplies the direction-agnostic maths (bias/adv/trailing) and
 * positionStateMachine.mjs supplies the legal ARMED/TRIGGERED/... transitions;
 * neither of those files has any notion of time, ticks, or concurrency. This
 * file is where they meet a live tick stream, and where the one property that
 * makes real-money automation safe actually gets enforced:
 *
 *   ARMED -> TRIGGERED is a SYNCHRONOUS compare-and-set. handleTick() below
 *   reads a position's state and (if the trigger predicate holds) overwrites
 *   it with the transitioned state BEFORE calling anything that returns a
 *   Promise. Because tickBus.publish() calls every subscriber synchronously
 *   (see tickBus.mjs) and JS has no preemption within a synchronous call,
 *   there is no window in which two ticks can both observe ARMED and both
 *   fire — the second tick's handleTick() call cannot even begin until the
 *   first one (CAS included) has returned. This is what 1CLIQ-TRADE-SPEC.md
 *   §13 failure mode #2 ("double exit") is guarding against.
 *
 * exitExecutor is an INJECTABLE STUB, not live order placement. No other
 * agent has wired real placeOrder() calls into this engine yet — that is
 * Phase 3 (panic layer + live execution) per the spec's roadmap. Calling
 * configureRiskEngine({ exitExecutor }) with a real broker call is exactly
 * how that future wiring plugs in; until then the default exitExecutor
 * throws loudly rather than pretending to have exited a real position.
 *
 * Scope deliberately NOT covered here (left to Phase 3, matching
 * positionStateMachine.mjs's own "what this cannot do" precedent):
 *  - RECONCILING / ORPHANED resolution against the broker's actual book.
 *  - Broker-resident SL-M net (spec §4's "since a dead engine cannot act...").
 *  - Persisting managed positions across a process restart.
 *  - Evicting terminal-state positions (EXIT_CONFIRMED/NEEDS_ATTENTION) from
 *    the map — they stay for status visibility; a cleanup policy is a Phase 3
 *    concern once real order flow exists to test it against.
 */

import { computeAdv, shouldTriggerSL, shouldTriggerTarget, nextStopAdv } from "./riskMath.mjs";
import { transition, initialState, STATES } from "./positionStateMachine.mjs";
import { tickKey } from "./dhanPacketParser.mjs";
import * as tickBus from "./tickBus.mjs";
import * as deadManSwitch from "./deadManSwitch.mjs";
import { validateArmRequest } from "./riskArmValidation.mjs";

// Spec §4: "Require 2 consecutive ticks past the level (~300ms) to reject
// single bad prints." A single glitchy tick 1 point past a level must not
// exit a real position; two ticks in a row past the same level must.
export const CONFIRM_TICKS = 2;

const NOT_WIRED_MESSAGE =
  "riskEngine: no exitExecutor configured — live order placement is not wired " +
  "into this engine yet (1CLIQ-TRADE-SPEC.md §3/§4; Phase 3 wires the real " +
  "placeOrder path). Pass one via configureRiskEngine({ exitExecutor }).";

function defaultExitExecutor() {
  throw new Error(NOT_WIRED_MESSAGE);
}

// ── Module-level state ──
// The dead-man's-switch clocks (heartbeat + last-tick-age) live in
// deadManSwitch.mjs, a generic liveness tracker with no trading knowledge —
// see that file's header for why it was split out.
const positions = new Map(); // id -> ManagedPosition
let nextId = 1;
let exitExecutor = defaultExitExecutor;
let unsubscribeTick = null;

/**
 * Arm a new managed position. `config` is `{exchangeSegment, securityId, s0,
 * side, optionType, slPts, tgtPts, trailing?, order?}` — see
 * riskArmValidation.mjs for the field-by-field contract each one must meet.
 * `exchangeSegment`/`securityId` identify the UNDERLYING this leg's SL/Target
 * reference (e.g. the spot index), not the option contract itself; combined
 * via tickKey() they give the exact key ticks arrive under. `order` is an
 * opaque payload handed verbatim to exitExecutor on trigger — this engine
 * never reads it.
 *
 * @returns {{ok:true, id:string}|{ok:false, reason:string}}
 */
export function armPosition(config) {
  // Full shape/enum/sign-invariant ladder lives in riskArmValidation.mjs — a
  // rejection here means nothing below this line ever runs.
  const check = validateArmRequest(config);
  if (!check.ok) return check;

  const {
    exchangeSegment, securityId, s0, side, optionType, slPts, tgtPts,
    trailing = null, order = null,
  } = config;

  // IDLE -> ARMED is always legal; routed through transition() rather than
  // hand-built so every state this engine creates comes from the one FSM.
  const armResult = transition(initialState(), "arm");

  const id = String(nextId++);
  positions.set(id, {
    id,
    spotKey: tickKey(exchangeSegment, securityId),
    s0,
    side,
    optionType,
    slPts,
    tgtPts,
    trailing,
    order,
    mfe: -Infinity, // running max favourable excursion in adv space (spec §4)
    stopAdv: -slPts, // ratcheted stop; starts equal to the plain SL distance
    slStreak: 0,
    tgtStreak: 0,
    fsm: armResult.state,
  });

  return { ok: true, id };
}

/**
 * Disarm a managed position (ARMED -> IDLE). Any other status (already
 * TRIGGERED, exiting, etc.) is rejected by the state machine — disarm must
 * never look like it stopped an exit that is already in flight.
 */
export function disarmPosition(id) {
  const pos = positions.get(id);
  if (!pos) return { ok: false, reason: `Unknown position id: ${id}` };

  const result = transition(pos.fsm, "disarm");
  if (!result.ok) return result;

  // IDLE has no further meaning to this engine — a disarmed leg is simply no
  // longer managed. Terminal/failure statuses (EXIT_FAILED, NEEDS_ATTENTION,
  // ...) are deliberately NOT deleted this way; they stay visible until a
  // Phase-3 reconciliation flow resolves them.
  positions.delete(id);
  return { ok: true };
}

/** Read-only snapshot of one managed position, or null. Defensive copy. */
export function getPosition(id) {
  const pos = positions.get(id);
  return pos ? { ...pos, fsm: { ...pos.fsm } } : null;
}

function countArmed() {
  let n = 0;
  for (const pos of positions.values()) {
    if (pos.fsm.status === STATES.ARMED) n++;
  }
  return n;
}

/**
 * Fire an exit for one position. Everything up to and including the CAS is
 * synchronous; exitExecutor is then called (also synchronously, so a stub or
 * a real broker call is invoked in the very same tick handler that decided
 * to trigger) and its eventual outcome is what advances TRIGGERED ->
 * EXIT_SUBMITTED / EXIT_FAILED. That resolution happening later, on a
 * microtask, is fine — the property this file guarantees is only that no
 * SECOND trigger can ever observe ARMED again for this position, and that is
 * already true the instant the line below runs.
 */
function fireExit(pos, reason, adv) {
  const casResult = transition(pos.fsm, "trigger");
  if (!casResult.ok) return false; // not ARMED anymore — structurally can't double-fire

  // THE SYNCHRONOUS COMPARE-AND-SET. Nothing above this line is allowed to
  // await; nothing below it un-does this write.
  pos.fsm = casResult.state;

  const payload = {
    id: pos.id,
    reason, // "SL" | "TARGET"
    adv,
    side: pos.side,
    optionType: pos.optionType,
    spotKey: pos.spotKey,
    s0: pos.s0,
    order: pos.order,
  };

  let outcome;
  try {
    outcome = exitExecutor(payload);
  } catch {
    const failed = transition(pos.fsm, "submit_error");
    if (failed.ok) pos.fsm = failed.state;
    return true;
  }

  Promise.resolve(outcome)
    .then(() => {
      const ok = transition(pos.fsm, "submit_ok");
      if (ok.ok) pos.fsm = ok.state;
    })
    .catch(() => {
      const failed = transition(pos.fsm, "submit_error");
      if (failed.ok) pos.fsm = failed.state;
    });

  return true;
}

/**
 * Evaluate one tick against every ARMED position watching that instrument.
 * Called directly by tests, and subscribed onto tickBus by startRiskEngine()
 * for the live path. MUST remain fully synchronous (see fireExit's header) —
 * do not add an `await` anywhere in this function or its call graph above the
 * CAS line.
 */
export function handleTick(tick) {
  if (!tick || typeof tick.key !== "string" || !Number.isFinite(tick.ltp)) return;
  deadManSwitch.recordTick();

  for (const pos of positions.values()) {
    if (pos.fsm.status !== STATES.ARMED) continue;
    if (pos.spotKey !== tick.key) continue;

    const adv = computeAdv(tick.ltp, pos.s0, pos.side, pos.optionType);

    if (pos.trailing) {
      pos.mfe = Math.max(pos.mfe, adv);
      pos.stopAdv = nextStopAdv(pos.trailing.mode, pos.trailing.params, pos.mfe, pos.stopAdv, pos.slPts);
    }

    // shouldTriggerSL(adv, slPts) checks `adv <= -slPts`. Passing -stopAdv
    // instead of the original slPts makes the same function trailing-aware:
    // stopAdv starts at -slPts (identical to no trailing) and only ever
    // ratchets up via nextStopAdv's Math.max, so this can only get stricter.
    const slHit = shouldTriggerSL(adv, -pos.stopAdv);
    const tgtHit = shouldTriggerTarget(adv, pos.tgtPts);

    pos.slStreak = slHit ? pos.slStreak + 1 : 0;
    pos.tgtStreak = tgtHit ? pos.tgtStreak + 1 : 0;

    if (pos.slStreak >= CONFIRM_TICKS) {
      fireExit(pos, "SL", adv);
    } else if (pos.tgtStreak >= CONFIRM_TICKS) {
      fireExit(pos, "TARGET", adv);
    }
  }
}

/**
 * Inject the real exit-order path. Left unconfigured, triggers throw
 * NOT_WIRED_MESSAGE instead of silently no-op'ing — a stop that "fires" and
 * does nothing is worse than one that fires loudly into a log.
 */
export function configureRiskEngine({ exitExecutor: exec } = {}) {
  if (typeof exec === "function") exitExecutor = exec;
}

/**
 * Start the dead-man's switch (a 1s heartbeat, per spec §4 — see
 * deadManSwitch.mjs) and subscribe handleTick onto tickBus so this engine
 * sees the live feed. Idempotent — a reconnect/retry calling this twice must
 * not stack timers or subscriptions.
 */
export function startRiskEngine({ heartbeatIntervalMs } = {}) {
  if (unsubscribeTick) return;
  deadManSwitch.start(heartbeatIntervalMs != null ? { intervalMs: heartbeatIntervalMs } : undefined);
  unsubscribeTick = tickBus.subscribe(handleTick);
}

/** Stop the heartbeat and unsubscribe from tickBus. */
export function stopRiskEngine() {
  deadManSwitch.stop();
  if (unsubscribeTick) {
    unsubscribeTick();
    unsubscribeTick = null;
  }
}

/**
 * Dead-man's switch status for /api/risk/status (spec §4): heartbeat
 * liveness + feed staleness come from deadManSwitch.mjs; armedCount is the
 * one thing only this file knows. `dhanConnected` is NOT this engine's
 * concern — the caller (proxy-server.mjs) fills it in from whatever it
 * already tracks for the Dhan WebSocket.
 *
 * @param {number} [now] injectable clock for tests
 */
export function getStatus(now = Date.now()) {
  return { ...deadManSwitch.status(now), armedCount: countArmed() };
}

/** Test seam — clears every managed position, timer and subscription state. */
export function resetRiskEngineForTests() {
  stopRiskEngine();
  deadManSwitch.resetDeadManSwitchForTests();
  positions.clear();
  nextId = 1;
  exitExecutor = defaultExitExecutor;
}
