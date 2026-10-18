import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  armPosition,
  disarmPosition,
  getPosition,
  handleTick,
  getStatus,
  configureRiskEngine,
  startRiskEngine,
  stopRiskEngine,
  resetRiskEngineForTests,
  CONFIRM_TICKS,
} from "./riskEngine.mjs";
import { subscriberCount, resetTickBusForTests } from "./tickBus.mjs";
import { TRAIL_MODES } from "./riskMath.mjs";

const SPOT_SEG = "IDX_I";
const SPOT_ID = "25"; // BANKNIFTY
const SPOT_KEY = `${SPOT_SEG}:${SPOT_ID}`;
const S0 = 58090;

/** A valid BUY-CE leg: profits when spot rises. SL 50pts, Target 80pts. */
function validLeg(overrides = {}) {
  return {
    exchangeSegment: SPOT_SEG,
    securityId: SPOT_ID,
    s0: S0,
    side: "BUY",
    optionType: "CE",
    slPts: 50,
    tgtPts: 80,
    ...overrides,
  };
}

function tickAt(ltp) {
  return { key: SPOT_KEY, ltp };
}

beforeEach(() => {
  resetRiskEngineForTests();
  resetTickBusForTests();
});
afterEach(() => {
  resetRiskEngineForTests();
  resetTickBusForTests();
});

// The full shape/enum/sign-invariant ladder is exercised directly against
// riskArmValidation.mjs in riskArmValidation.test.mjs. These two just confirm
// armPosition is actually wired to it: a rejection there means armPosition
// creates nothing, and an acceptance actually lands in the managed-position map.
describe("armPosition — wired to riskArmValidation", () => {
  it("accepts a valid config, returns an id, and it counts as armed", () => {
    const result = armPosition(validLeg());
    expect(result.ok).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(getStatus().armedCount).toBe(1);
  });

  it("a validation rejection creates nothing", () => {
    const { exchangeSegment, ...rest } = validLeg();
    const result = armPosition(rest);
    expect(result.ok).toBe(false);
    expect(getStatus().armedCount).toBe(0);
  });
});

describe("disarmPosition", () => {
  it("moves an armed position back out of the managed set", () => {
    const { id } = armPosition(validLeg());
    expect(getStatus().armedCount).toBe(1);
    const result = disarmPosition(id);
    expect(result.ok).toBe(true);
    expect(getStatus().armedCount).toBe(0);
    expect(getPosition(id)).toBeNull();
  });

  it("rejects disarming an unknown id", () => {
    const result = disarmPosition("does-not-exist");
    expect(result.ok).toBe(false);
  });

  it("rejects disarming a position that already triggered", () => {
    configureRiskEngine({ exitExecutor: () => {} });
    const { id } = armPosition(validLeg());
    // Drive spot down through SL twice (CONFIRM_TICKS) to trigger.
    handleTick(tickAt(S0 - 60));
    handleTick(tickAt(S0 - 60));
    expect(getPosition(id).fsm.status).toBe("TRIGGERED");

    const result = disarmPosition(id);
    expect(result.ok).toBe(false);
  });
});

describe("handleTick — SL/Target trigger with 2-consecutive-tick confirmation", () => {
  it("never calls exitExecutor while adv has not reached either level", () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    armPosition(validLeg());

    handleTick(tickAt(S0 + 5));
    handleTick(tickAt(S0 - 5));
    handleTick(tickAt(S0 + 20));

    expect(calls).toHaveLength(0);
  });

  it("does not fire on a single qualifying tick (rejects a lone bad print)", () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    const { id } = armPosition(validLeg());

    handleTick(tickAt(S0 - 60)); // adv = -60, past SL(-50) — but only once so far
    expect(calls).toHaveLength(0);
    expect(getPosition(id).fsm.status).toBe("ARMED");
  });

  it(`fires exactly once after ${CONFIRM_TICKS} consecutive SL-breaching ticks, with side/reason/adv`, () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    const { id } = armPosition(validLeg());

    handleTick(tickAt(S0 - 60));
    handleTick(tickAt(S0 - 60));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id, reason: "SL", side: "BUY", optionType: "CE", adv: -60 });
    expect(getPosition(id).fsm.status).toBe("TRIGGERED");
  });

  it("a non-qualifying tick in between resets the confirmation streak", () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    armPosition(validLeg());

    handleTick(tickAt(S0 - 60)); // streak 1
    handleTick(tickAt(S0));      // back above SL — streak resets to 0
    handleTick(tickAt(S0 - 60)); // streak 1 again, not 2

    expect(calls).toHaveLength(0);
  });

  it(`fires exactly once after ${CONFIRM_TICKS} consecutive Target-reaching ticks`, () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    const { id } = armPosition(validLeg());

    handleTick(tickAt(S0 + 90));
    handleTick(tickAt(S0 + 90));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id, reason: "TARGET", adv: 90 });
  });

  it("never fires twice for the same trigger, however many more ticks arrive", () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    armPosition(validLeg());

    handleTick(tickAt(S0 - 60));
    handleTick(tickAt(S0 - 60));
    handleTick(tickAt(S0 - 60));
    handleTick(tickAt(S0 - 100));
    handleTick(tickAt(S0 - 60));

    expect(calls).toHaveLength(1);
  });

  it("ignores ticks for a different instrument", () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    armPosition(validLeg());

    handleTick({ key: "IDX_I:13", ltp: S0 - 500 }); // NIFTY, not the armed leg's spot
    handleTick({ key: "IDX_I:13", ltp: S0 - 500 });

    expect(calls).toHaveLength(0);
  });

  it("ignores malformed ticks without throwing", () => {
    expect(() => handleTick(null)).not.toThrow();
    expect(() => handleTick({})).not.toThrow();
    expect(() => handleTick({ key: SPOT_KEY, ltp: "not-a-number" })).not.toThrow();
  });

  it("respects the sign for a SELL CE leg (bias flips vs. the BUY CE default)", () => {
    // SELL CE has bias -1: it profits when spot FALLS, the mirror image of the
    // BUY CE leg used everywhere else in this file. A falling spot must move
    // this leg toward Target, not SL — the exact sign this engine must not invert.
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    const { id } = armPosition(validLeg({ side: "SELL", optionType: "CE" })); // bias -1: profits when spot FALLS

    // Spot falling should move this leg toward TARGET, not SL.
    handleTick(tickAt(S0 - 90));
    handleTick(tickAt(S0 - 90));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id, reason: "TARGET" });
  });
});

describe("handleTick — trailing stop ratchets and can only tighten the SL", () => {
  it("moves the effective SL up as mfe advances (fixed-point mode), never back down", () => {
    const calls = [];
    configureRiskEngine({ exitExecutor: (p) => calls.push(p) });
    const { id } = armPosition(validLeg({
      trailing: { mode: TRAIL_MODES.FIXED_POINT, params: { activation: 30, trailPts: 10 } },
    }));

    handleTick(tickAt(S0 + 40)); // adv=40 >= activation(30) -> stopAdv candidate = 40-10=30
    expect(getPosition(id).stopAdv).toBe(30);

    // Pull back to adv=20 twice — below the original -50 SL is nowhere close,
    // but the trailed stop (30) should now fire since adv(20) <= stopAdv(30).
    handleTick(tickAt(S0 + 20));
    handleTick(tickAt(S0 + 20));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id, reason: "SL", adv: 20 });
  });

  it("never lets the ratcheted stop move backwards on a pullback tick", () => {
    const { id } = armPosition(validLeg({
      trailing: { mode: TRAIL_MODES.FIXED_POINT, params: { activation: 30, trailPts: 10 } },
    }));
    configureRiskEngine({ exitExecutor: () => {} });

    handleTick(tickAt(S0 + 60)); // stopAdv -> 50
    const afterPeak = getPosition(id).stopAdv;
    handleTick(tickAt(S0 + 45)); // pullback that doesn't trigger (45 > 50? no, 45 < 50 would trigger SL...)
    const afterPullback = getPosition(id).stopAdv;

    expect(afterPullback).toBeGreaterThanOrEqual(afterPeak);
  });
});

// The heartbeat/lastTickAgeMs clock behaviour itself is exercised directly
// against deadManSwitch.mjs in deadManSwitch.test.mjs. These confirm getStatus
// actually composes that with this file's own armedCount, and that
// startRiskEngine/stopRiskEngine wire (and unwire) the tickBus subscription.
describe("getStatus / startRiskEngine — composition with deadManSwitch", () => {
  it("reports not alive before startRiskEngine() has ever run", () => {
    expect(getStatus().alive).toBe(false);
    expect(getStatus().lastTickAgeMs).toBeNull();
  });

  it("reports alive after startRiskEngine(), and subscribes/unsubscribes handleTick on tickBus", () => {
    startRiskEngine();
    expect(getStatus().alive).toBe(true);
    expect(subscriberCount()).toBe(1);
    stopRiskEngine();
    expect(subscriberCount()).toBe(0);
  });

  it("is idempotent — calling startRiskEngine twice does not stack subscriptions", () => {
    startRiskEngine();
    startRiskEngine();
    expect(subscriberCount()).toBe(1);
    stopRiskEngine();
  });

  it("reports armedCount across multiple positions and reflects disarms", () => {
    const a = armPosition(validLeg());
    const b = armPosition(validLeg({ securityId: "13" }));
    expect(getStatus().armedCount).toBe(2);
    disarmPosition(a.id);
    expect(getStatus().armedCount).toBe(1);
    disarmPosition(b.id);
    expect(getStatus().armedCount).toBe(0);
  });
});

describe("configureRiskEngine — exitExecutor injection", () => {
  it("the default exitExecutor throws rather than silently no-op'ing a live trigger", () => {
    resetRiskEngineForTests(); // ensure default executor, no override from another test
    armPosition(validLeg());

    // A throwing exitExecutor must still be handled (submit_error), not
    // propagate out of handleTick and break the tick loop for other positions.
    expect(() => {
      handleTick(tickAt(S0 - 60));
      handleTick(tickAt(S0 - 60));
    }).not.toThrow();
  });

  it("ignores a non-function passed as exitExecutor rather than breaking the engine", () => {
    expect(() => configureRiskEngine({ exitExecutor: "not-a-function" })).not.toThrow();
    expect(() => configureRiskEngine()).not.toThrow();
  });
});
