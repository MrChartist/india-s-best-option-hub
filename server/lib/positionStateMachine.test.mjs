import { describe, it, expect } from "vitest";
import { transition, initialState, STATES, RETRY_BUDGET } from "./positionStateMachine.mjs";

describe("initialState", () => {
  it("starts IDLE with a clean retry counter", () => {
    expect(initialState()).toEqual({ status: "IDLE", attempts: 0 });
  });
});

describe("the happy path, one edge at a time", () => {
  it("IDLE -arm-> ARMED", () => {
    const r = transition(initialState(), "arm");
    expect(r).toEqual({ ok: true, state: { status: "ARMED", attempts: 0 } });
  });

  it("ARMED -disarm-> IDLE", () => {
    const r = transition({ status: "ARMED", attempts: 0 }, "disarm");
    expect(r).toEqual({ ok: true, state: { status: "IDLE", attempts: 0 } });
  });

  it("ARMED -trigger-> TRIGGERED (predicate true, synchronous CAS)", () => {
    const r = transition({ status: "ARMED", attempts: 0 }, "trigger");
    expect(r).toEqual({ ok: true, state: { status: "TRIGGERED", attempts: 0 } });
  });

  it("ARMED -orphan-> ORPHANED (broker shows the leg gone)", () => {
    const r = transition({ status: "ARMED", attempts: 0 }, "orphan");
    expect(r).toEqual({ ok: true, state: { status: "ORPHANED", attempts: 0 } });
  });

  it("TRIGGERED -submit_ok-> EXIT_SUBMITTED", () => {
    const r = transition({ status: "TRIGGERED", attempts: 0 }, "submit_ok");
    expect(r.ok).toBe(true);
    expect(r.state.status).toBe("EXIT_SUBMITTED");
  });

  it("TRIGGERED -throws-> EXIT_FAILED", () => {
    const r = transition({ status: "TRIGGERED", attempts: 0 }, "submit_error");
    expect(r.ok).toBe(true);
    expect(r.state.status).toBe("EXIT_FAILED");
  });

  it("EXIT_SUBMITTED -confirm-> EXIT_CONFIRMED (terminal)", () => {
    const r = transition({ status: "EXIT_SUBMITTED", attempts: 0 }, "confirm");
    expect(r.state.status).toBe("EXIT_CONFIRMED");
  });

  it("EXIT_SUBMITTED -rejected-> EXIT_FAILED", () => {
    const r = transition({ status: "EXIT_SUBMITTED", attempts: 0 }, "reject");
    expect(r.state.status).toBe("EXIT_FAILED");
  });

  it("EXIT_SUBMITTED -no terminal in 5s / reboot-> RECONCILING", () => {
    const r = transition({ status: "EXIT_SUBMITTED", attempts: 0 }, "timeout");
    expect(r.state.status).toBe("RECONCILING");
  });
});

describe("partial-fill re-arm path", () => {
  it("EXIT_SUBMITTED -partial-> PARTIAL -> ARMED' (residual, re-armed on remaining lots)", () => {
    const submitted = { status: "EXIT_SUBMITTED", attempts: 1 };
    const partial = transition(submitted, "partial");
    expect(partial).toEqual({ ok: true, state: { status: "PARTIAL", attempts: 1 } });

    const reArmed = transition(partial.state, "re_arm");
    // The residual leg is a fresh managed position, not a retry of the old
    // one -- the retry counter resets even though it carried a nonzero value
    // going into PARTIAL.
    expect(reArmed).toEqual({ ok: true, state: { status: "ARMED", attempts: 0 } });
  });
});

describe("EXIT_FAILED -> retry vs NEEDS_ATTENTION", () => {
  it("retries into TRIGGERED when budget remains AND reconcile proves no fill", () => {
    const r = transition({ status: "EXIT_FAILED", attempts: 0 }, "retry", { reconcileConfirmedNoFill: true });
    expect(r).toEqual({ ok: true, state: { status: "TRIGGERED", attempts: 1 } });
  });

  it("consumes the retry budget across successive failures, then stops at exactly 2", () => {
    expect(RETRY_BUDGET).toBe(2);

    let r = transition({ status: "EXIT_FAILED", attempts: 0 }, "retry", { reconcileConfirmedNoFill: true });
    expect(r.state).toEqual({ status: "TRIGGERED", attempts: 1 });

    // Second failure, second retry -- still within budget.
    r = transition({ status: "EXIT_FAILED", attempts: 1 }, "retry", { reconcileConfirmedNoFill: true });
    expect(r.state).toEqual({ status: "TRIGGERED", attempts: 2 });

    // Third failure -- budget exhausted, must go to NEEDS_ATTENTION even
    // though reconcile again proves no fill.
    r = transition({ status: "EXIT_FAILED", attempts: 2 }, "retry", { reconcileConfirmedNoFill: true });
    expect(r.state).toEqual({ status: "NEEDS_ATTENTION", attempts: 2 });
  });

  it("goes to NEEDS_ATTENTION when reconcile has NOT proven no-fill, regardless of remaining budget", () => {
    const noContext = transition({ status: "EXIT_FAILED", attempts: 0 }, "retry");
    expect(noContext.state).toEqual({ status: "NEEDS_ATTENTION", attempts: 0 });

    const falseFlag = transition({ status: "EXIT_FAILED", attempts: 0 }, "retry", { reconcileConfirmedNoFill: false });
    expect(falseFlag.state).toEqual({ status: "NEEDS_ATTENTION", attempts: 0 });

    // A truthy-but-not-boolean-true value must NOT open the retry path --
    // same strict-equality discipline as orderGuard's liveArmed check.
    const truthyButNotTrue = transition({ status: "EXIT_FAILED", attempts: 0 }, "retry", { reconcileConfirmedNoFill: "yes" });
    expect(truthyButNotTrue.state).toEqual({ status: "NEEDS_ATTENTION", attempts: 0 });
  });

  it("NEEDS_ATTENTION is manual-only -- the engine must never auto-resubmit from here", () => {
    const r = transition({ status: "NEEDS_ATTENTION", attempts: 2 }, "retry", { reconcileConfirmedNoFill: true });
    expect(r.ok).toBe(false);
  });
});

describe("double-trigger is blocked once the caller's state pointer has actually moved", () => {
  it("a second 'trigger' against the now-TRIGGERED state is rejected", () => {
    const armed = { status: "ARMED", attempts: 0 };
    const first = transition(armed, "trigger");
    expect(first.ok).toBe(true);
    expect(first.state.status).toBe("TRIGGERED");

    // The caller updates its held state to `first.state` (the synchronous CAS
    // documented in the file header) and only then can a second event arrive.
    const second = transition(first.state, "trigger");
    expect(second.ok).toBe(false);
  });

  it("re-triggering a STALE armed snapshot is NOT prevented by this pure function -- that is the caller's job", () => {
    // Documenting the boundary explicitly: if the caller (incorrectly) keeps
    // calling transition() against the same stale ARMED object instead of the
    // CAS'd result, this function has no way to know a trigger already fired.
    const staleArmed = { status: "ARMED", attempts: 0 };
    const first = transition(staleArmed, "trigger");
    const secondAgainstStale = transition(staleArmed, "trigger");
    expect(first.ok).toBe(true);
    expect(secondAgainstStale.ok).toBe(true); // by design -- see file header
  });
});

describe("every edge not drawn in the spec diagram is rejected, never silently ignored", () => {
  const ALL_STATES = Object.values(STATES);
  const ALL_EVENTS = [
    "arm", "disarm", "trigger", "orphan",
    "submit_ok", "submit_error", "confirm", "partial", "reject", "timeout",
    "re_arm", "retry",
  ];

  // The only (status, event) pairs with a defined transition in the diagram.
  const LEGAL = {
    IDLE: ["arm"],
    ARMED: ["disarm", "trigger", "orphan"],
    TRIGGERED: ["submit_ok", "submit_error"],
    EXIT_SUBMITTED: ["confirm", "partial", "reject", "timeout"],
    PARTIAL: ["re_arm"],
    EXIT_FAILED: ["retry"],
    EXIT_CONFIRMED: [],
    ORPHANED: [],
    RECONCILING: [],
    NEEDS_ATTENTION: [],
  };

  for (const status of ALL_STATES) {
    for (const event of ALL_EVENTS) {
      const shouldBeLegal = LEGAL[status].includes(event);
      it(`${status} -${event}-> ${shouldBeLegal ? "accepted" : "REJECTED"}`, () => {
        const r = transition({ status, attempts: 0 }, event, { reconcileConfirmedNoFill: true });
        expect(r.ok).toBe(shouldBeLegal);
        if (!shouldBeLegal) {
          expect(typeof r.reason).toBe("string");
          expect(r.reason.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe("malformed state input is rejected rather than guessed", () => {
  it("rejects an unknown status string", () => {
    const r = transition("NOT_A_STATE", "arm");
    expect(r.ok).toBe(false);
  });

  it("rejects a state object with an unknown status", () => {
    const r = transition({ status: "WAT", attempts: 0 }, "arm");
    expect(r.ok).toBe(false);
  });

  it("rejects null/undefined state", () => {
    expect(transition(null, "arm").ok).toBe(false);
    expect(transition(undefined, "arm").ok).toBe(false);
  });

  it("treats a bare status string as attempts: 0, for caller convenience", () => {
    const r = transition("EXIT_FAILED", "retry", { reconcileConfirmedNoFill: true });
    expect(r).toEqual({ ok: true, state: { status: "TRIGGERED", attempts: 1 } });
  });

  it("tolerates a non-finite attempts field by treating it as 0 rather than throwing", () => {
    const r = transition({ status: "EXIT_FAILED", attempts: "oops" }, "retry", { reconcileConfirmedNoFill: true });
    expect(r.state.attempts).toBe(1);
  });
});
