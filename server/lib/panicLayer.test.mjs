import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { closeAll, cancelAll, setSleepImplForTests, resetPanicLayerForTests } from "./panicLayer.mjs";

// Speeds up cancelAll's 1.5s between-pass gap and any network-retry backoff
// inside a wave — none of these tests are about real wall-clock waiting
// EXCEPT the barrier test below, which deliberately uses a real setTimeout
// inside its fake orderExecutor (not this module's own sleep()) to prove the
// barrier actually blocks the next wave.
beforeEach(() => setSleepImplForTests(() => Promise.resolve()));
afterEach(() => resetPanicLayerForTests());

function shortLeg(id, unrealisedPnl, overrides = {}) {
  return { id, assetClass: "OPTION", netQty: -1, lotSize: 1, lots: 1, unrealisedPnl, ...overrides };
}
function longLeg(id, overrides = {}) {
  return { id, assetClass: "OPTION", netQty: 1, lotSize: 1, lots: 1, unrealisedPnl: 0, ...overrides };
}

describe("closeAll — wave ordering (spec §5 / §12)", () => {
  it("Wave A closes shorts by |unrealised loss| descending, regardless of input order", async () => {
    const callOrder = [];
    const orderExecutor = async (intent) => {
      callOrder.push(intent.positionId);
      return { status: "TRADED" };
    };
    // Deliberately NOT pre-sorted.
    const positions = [shortLeg("small-loss", -100), shortLeg("big-loss", -5000), shortLeg("mid-loss", -900)];

    await closeAll(positions, orderExecutor, async () => [], {});

    expect(callOrder).toEqual(["big-loss", "mid-loss", "small-loss"]);
  });

  it("closes shorts (Wave A) before hedges (Wave B) before futures/equity (Wave C)", async () => {
    const callOrder = [];
    const orderExecutor = async (intent) => {
      callOrder.push(intent.wave);
      return { status: "TRADED" };
    };
    const positions = [
      { id: "fut1", assetClass: "FUTURE", netQty: -1, lotSize: 1, lots: 1, unrealisedPnl: 0 },
      longLeg("hedge1"),
      shortLeg("short1", -10),
    ];

    await closeAll(positions, orderExecutor, async () => [], {});

    expect(callOrder).toEqual([1, 2, 3]);
  });
});

describe("closeAll — the hard barrier between waves", () => {
  it("a slow Wave-A order delays Wave B's first dispatch", async () => {
    const calls = [];
    const orderExecutor = async (intent) => {
      calls.push({ wave: intent.wave, t: Date.now() });
      if (intent.wave === 1) {
        await new Promise((r) => setTimeout(r, 40)); // slow but eventually-successful Wave-A fill
      }
      return { status: "TRADED" };
    };
    const positions = [shortLeg("S1", -10), longLeg("L1")];

    await closeAll(positions, orderExecutor, async () => [], {});

    const waveACall = calls.find((c) => c.wave === 1);
    const waveBCall = calls.find((c) => c.wave === 2);
    expect(waveACall).toBeDefined();
    expect(waveBCall).toBeDefined();
    expect(waveBCall.t - waveACall.t).toBeGreaterThanOrEqual(35);
  });
});

describe("closeAll — insufficient margin in Wave B stops Wave B and resumes Wave A", () => {
  it("retries Wave A's unresolved leg before resuming the rest of Wave B", async () => {
    const calls = [];
    const attemptsById = {};
    const orderExecutor = async (intent) => {
      calls.push({ id: intent.positionId, wave: intent.wave });
      attemptsById[intent.positionId] = (attemptsById[intent.positionId] || 0) + 1;
      const n = attemptsById[intent.positionId];

      if (intent.positionId === "S2" && n === 1) throw new Error("Rejected: bad request"); // Wave A leg that fails for an unrelated reason
      if (intent.positionId === "L1" && n === 1) throw new Error("Insufficient margin available"); // triggers the margin stop
      return { status: "TRADED" };
    };
    const positions = [shortLeg("S1", -10), shortLeg("S2", -5), longLeg("L1")];

    const result = await closeAll(positions, orderExecutor, async () => [], {});

    expect(result.waves.b.marginStop).toBe(true);
    expect(result.waves.a.resumed).toBeTruthy();
    expect(result.waves.b.resumed).toBeTruthy();
    expect(result.success).toBe(true); // every leg eventually closed

    const s2Calls = calls.filter((c) => c.id === "S2");
    const l1Calls = calls.filter((c) => c.id === "L1");
    expect(s2Calls).toHaveLength(2); // original attempt + the Wave-A resume
    expect(l1Calls).toHaveLength(2); // original attempt + the Wave-B resume

    // The Wave-A resume (S2's 2nd call) must land strictly between the margin
    // rejection (L1's 1st call) and the Wave-B resume (L1's 2nd call) — this
    // is the actual "stop Wave B, resume Wave A" ordering, not just that both
    // resumes eventually happened somewhere.
    const marginRejectionIdx = calls.indexOf(l1Calls[0]);
    const waveAResumeIdx = calls.indexOf(s2Calls[1]);
    const waveBResumeIdx = calls.indexOf(l1Calls[1]);
    expect(waveAResumeIdx).toBeGreaterThan(marginRejectionIdx);
    expect(waveBResumeIdx).toBeGreaterThan(waveAResumeIdx);
  });
});

describe("closeAll — success requires a re-verified empty position book", () => {
  it("reports failure, not success, when every order call succeeded but a final re-verify still shows an open leg", async () => {
    const positions = [shortLeg("S1", -10)];
    const orderExecutor = async () => ({ status: "TRADED" }); // every HTTP call "succeeds"
    const fetchOpenPositions = async () => [shortLeg("S1", -10)]; // yet the book still shows it open

    const result = await closeAll(positions, orderExecutor, fetchOpenPositions, {});

    expect(result.success).toBe(false);
    expect(result.remainingPositions).toHaveLength(1);
  });

  it("reports success once the re-verified book is genuinely empty", async () => {
    const positions = [shortLeg("S1", -10)];
    const result = await closeAll(positions, async () => ({ status: "TRADED" }), async () => [], {});
    expect(result.success).toBe(true);
    expect(result.remainingPositions).toEqual([]);
  });
});

describe("cancelAll — two passes, 1.5s apart, re-fetching in between", () => {
  it("cancels a stray order that only appears in the between-pass refetch", async () => {
    const cancelled = [];
    const cancelExecutor = async (order) => { cancelled.push(order.orderId); return { status: "CANCELLED" }; };
    let fetchCount = 0;
    const fetchOpenOrders = async () => {
      fetchCount += 1;
      if (fetchCount === 1) return [{ orderId: "O2" }]; // the between-pass refetch surfaces a new resting order
      return []; // the final re-verify shows the book is clear
    };

    const result = await cancelAll([{ orderId: "O1" }], cancelExecutor, fetchOpenOrders, {});

    expect(cancelled).toEqual(["O1", "O2"]);
    expect(result.success).toBe(true);
    expect(fetchCount).toBe(2);
  });

  it("reports failure when the final re-verify still shows a resting order", async () => {
    const result = await cancelAll(
      [{ orderId: "O1" }],
      async () => ({ status: "CANCELLED" }),
      async () => [{ orderId: "O1" }],
      {},
    );
    expect(result.success).toBe(false);
    expect(result.remainingOrders).toHaveLength(1);
  });
});

// Regression coverage for a real finding from an adversarial audit of this
// build: both functions used to silently default to a guessed outcome
// (closeAll -> success:true, cancelAll -> success:null) when no re-verify
// function was supplied, contradicting this file's own "success is a
// re-verified empty book, never an assumption" invariant. They must now
// refuse to run at all rather than report an unearned result.
describe("closeAll/cancelAll refuse to guess success without a re-verify function", () => {
  it("closeAll throws if fetchOpenPositions is not a function", async () => {
    await expect(closeAll([shortLeg("s1", -100)], async () => ({ status: "TRADED" }), undefined, {}))
      .rejects.toThrow(/requires fetchOpenPositions/);
  });

  it("cancelAll throws if fetchOpenOrders is not a function", async () => {
    await expect(cancelAll([{ orderId: "O1" }], async () => ({ status: "CANCELLED" }), null, {}))
      .rejects.toThrow(/requires fetchOpenOrders/);
  });
});
