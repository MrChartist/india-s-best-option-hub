import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  classifyRejection,
  buildCloseIntent,
  runPool,
  submitLegWithFreezeSlicing,
  setSleepImplForTests,
  resetPanicExecutionForTests,
} from "./panicLegExecution.mjs";

// Every retry path in this file waits on sleep() — make it instant so the
// suite doesn't spend real seconds on 400ms/1200ms backoffs.
beforeEach(() => setSleepImplForTests(() => Promise.resolve()));
afterEach(() => resetPanicExecutionForTests());

describe("classifyRejection — from the broker's own message text", () => {
  it("classifies a freeze-quantity rejection", () => {
    expect(classifyRejection("Freeze quantity breached for this order")).toBe("FREEZE_QTY");
  });

  it("classifies an insufficient-margin rejection", () => {
    expect(classifyRejection("Insufficient funds in trading account")).toBe("INSUFFICIENT_MARGIN");
    expect(classifyRejection("Margin exceeds available limit")).toBe("INSUFFICIENT_MARGIN");
  });

  it("classifies a market-closed / circuit rejection", () => {
    expect(classifyRejection("Market is closed for trading")).toBe("MARKET_CLOSED_OR_CIRCUIT");
    expect(classifyRejection("Order rejected: security in circuit limit")).toBe("MARKET_CLOSED_OR_CIRCUIT");
  });

  it("classifies a network/5xx failure", () => {
    expect(classifyRejection("Dhan API error [502]: Bad Gateway")).toBe("NETWORK");
    expect(classifyRejection("fetch failed")).toBe("NETWORK");
    expect(classifyRejection("ECONNRESET")).toBe("NETWORK");
  });

  it("is case-insensitive", () => {
    expect(classifyRejection("FREEZE QUANTITY EXCEEDED")).toBe("FREEZE_QTY");
  });

  it("falls back to UNKNOWN for a message it doesn't recognise, rather than guessing", () => {
    expect(classifyRejection("Invalid security id")).toBe("UNKNOWN");
    expect(classifyRejection()).toBe("UNKNOWN");
  });
});

describe("buildCloseIntent", () => {
  it("BUYs to close a short (negative netQty), deriving whole lots from netQty/lotSize", () => {
    const intent = buildCloseIntent({ id: "p1", securityId: "1", exchangeSegment: "NSE_FNO", netQty: -50, lotSize: 25 }, 1);
    expect(intent).toMatchObject({ transactionType: "BUY", lots: 2, quantity: 50, orderType: "MARKET", validity: "IOC", wave: 1 });
  });

  it("SELLs to close a long (positive netQty)", () => {
    const intent = buildCloseIntent({ id: "p2", securityId: "2", netQty: 1, lotSize: 25 }, 2);
    expect(intent.transactionType).toBe("SELL");
  });

  it("prefers an explicit `lots` over deriving it from netQty/lotSize", () => {
    const intent = buildCloseIntent({ id: "p3", securityId: "3", netQty: -3, lotSize: 25, lots: 3 }, 1);
    expect(intent.lots).toBe(3);
    expect(intent.quantity).toBe(75);
  });

  it("defaults lotSize to 1 for an equity leg with no contract multiplier", () => {
    const intent = buildCloseIntent({ id: "p4", securityId: "4", netQty: -150 }, 3);
    expect(intent.lots).toBe(150);
    expect(intent.quantity).toBe(150);
  });
});

describe("runPool", () => {
  it("preserves input order in the results array regardless of completion order", async () => {
    const delaysMs = [30, 10, 20]; // deliberately out of completion order
    const results = await runPool(delaysMs, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(results).toEqual([0, 1, 2]);
  });

  it("never runs more than `concurrency` handlers at once", async () => {
    let active = 0;
    let maxActive = 0;
    await runPool([1, 2, 3, 4, 5], 2, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("stops pulling NEW items once shouldStop() flips, but lets in-flight ones finish", async () => {
    const started = [];
    let stop = false;
    await runPool(
      [1, 2, 3, 4],
      2,
      async (item) => {
        started.push(item);
        if (item === 1) stop = true; // flips right after the first item starts
        await new Promise((r) => setTimeout(r, 5));
      },
      () => stop,
    );
    // The two workers that already grabbed an item before `stop` flipped are
    // allowed to finish; nothing further is pulled from the queue.
    expect(started.length).toBeLessThanOrEqual(2);
  });
});

describe("submitLegWithFreezeSlicing", () => {
  function intent(lots = 4) {
    return { positionId: "p1", securityId: "1", exchangeSegment: "NSE_FNO", lots, lotSize: 25, quantity: lots * 25, wave: 1 };
  }

  it("succeeds in one slice when the broker accepts the full size", async () => {
    const calls = [];
    const result = await submitLegWithFreezeSlicing(intent(4), async (i) => { calls.push(i.lots); return { status: "TRADED" }; }, () => {});
    expect(result).toMatchObject({ ok: true, filledLots: 4, remainingLots: 0 });
    expect(calls).toEqual([4]);
  });

  it("halves the slice on FREEZE_QTY and keeps retrying the same remaining lots until it fits — the ONLY retry that changes the payload", async () => {
    const calls = [];
    const executor = async (i) => {
      calls.push(i.lots);
      if (i.lots > 1) throw new Error("Freeze quantity limit breached");
      return { status: "TRADED" };
    };
    const result = await submitLegWithFreezeSlicing(intent(4), executor, () => {});
    expect(result.ok).toBe(true);
    expect(result.filledLots).toBe(4);
    expect(calls[0]).toBe(4); // first attempt is always the full size
    expect(calls).toContain(1); // it eventually halves all the way down to a fitting size
  });

  it("gives up on freeze slicing once it reaches 1 lot and is still rejected", async () => {
    const executor = async () => { throw new Error("Freeze quantity limit breached"); };
    const result = await submitLegWithFreezeSlicing(intent(4), executor, () => {});
    expect(result.ok).toBe(false);
    expect(result.classification).toBe("FREEZE_QTY");
    expect(result.filledLots).toBe(0);
  });

  it("retries the same slice unchanged on a NETWORK/5xx classification, then succeeds", async () => {
    let attempts = 0;
    const executor = async (i) => {
      attempts += 1;
      if (attempts < 3) throw new Error("Dhan API error [503]: Service Unavailable");
      return { status: "TRADED", lots: i.lots };
    };
    const result = await submitLegWithFreezeSlicing(intent(2), executor, () => {});
    expect(result.ok).toBe(true);
    expect(attempts).toBe(3); // 1 initial attempt + the spec's exact 2-retry ladder
  });

  it("gives up once the network retry budget (2) is exhausted", async () => {
    let attempts = 0;
    const executor = async () => { attempts += 1; throw new Error("network timeout"); };
    const result = await submitLegWithFreezeSlicing(intent(2), executor, () => {});
    expect(result.ok).toBe(false);
    expect(result.classification).toBe("NETWORK");
    expect(attempts).toBe(3);
  });

  it("gets zero retries for MARKET_CLOSED_OR_CIRCUIT", async () => {
    let attempts = 0;
    const executor = async () => { attempts += 1; throw new Error("Market is closed"); };
    const result = await submitLegWithFreezeSlicing(intent(2), executor, () => {});
    expect(attempts).toBe(1);
    expect(result.classification).toBe("MARKET_CLOSED_OR_CIRCUIT");
  });

  it("gets zero per-leg retries for INSUFFICIENT_MARGIN — that's a wave-level decision, not a leg retry", async () => {
    let attempts = 0;
    const executor = async () => { attempts += 1; throw new Error("Insufficient margin available"); };
    const result = await submitLegWithFreezeSlicing(intent(2), executor, () => {});
    expect(attempts).toBe(1);
    expect(result.classification).toBe("INSUFFICIENT_MARGIN");
  });
});
