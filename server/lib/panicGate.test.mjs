import { describe, it, expect, beforeEach } from "vitest";
import {
  incrementEpoch,
  currentEpoch,
  isStaleEpoch,
  recordStaleFill,
  drainPendingCancelQueue,
  drainPendingCloseQueue,
  resetPanicGateForTests,
} from "./panicGate.mjs";

beforeEach(() => resetPanicGateForTests());

describe("placementEpoch", () => {
  it("starts at 0 and increments by exactly one per call", () => {
    expect(currentEpoch()).toBe(0);
    expect(incrementEpoch()).toBe(1);
    expect(incrementEpoch()).toBe(2);
    expect(currentEpoch()).toBe(2);
  });

  it("a placement captured at the current epoch is not stale", () => {
    const epochAtPlacement = currentEpoch();
    expect(isStaleEpoch(epochAtPlacement)).toBe(false);
  });

  it("a placement becomes stale once a panic action moves the epoch past it", () => {
    const epochAtPlacement = currentEpoch();
    incrementEpoch(); // a panic action fires between capture and resolution
    expect(isStaleEpoch(epochAtPlacement)).toBe(true);
  });
});

describe("recordStaleFill", () => {
  it("queues a TRADED fill for the next close-all sweep", () => {
    recordStaleFill({ orderId: "o1", status: "TRADED" });
    expect(drainPendingCloseQueue()).toEqual([{ orderId: "o1", status: "TRADED" }]);
    expect(drainPendingCancelQueue()).toEqual([]);
  });

  it("queues anything else — still resting, or unknown — for the next cancel-all sweep", () => {
    recordStaleFill({ orderId: "o2", status: "PENDING" });
    recordStaleFill({ orderId: "o3" }); // no status at all
    expect(drainPendingCancelQueue()).toEqual([{ orderId: "o2", status: "PENDING" }, { orderId: "o3" }]);
    expect(drainPendingCloseQueue()).toEqual([]);
  });

  it("ignores a non-object order rather than throwing", () => {
    expect(() => recordStaleFill(null)).not.toThrow();
    expect(() => recordStaleFill("nope")).not.toThrow();
    expect(drainPendingCancelQueue()).toEqual([]);
    expect(drainPendingCloseQueue()).toEqual([]);
  });
});

describe("drain queues", () => {
  it("empties the queue it drains and is idempotent", () => {
    recordStaleFill({ orderId: "o1", status: "PENDING" });
    expect(drainPendingCancelQueue()).toHaveLength(1);
    expect(drainPendingCancelQueue()).toEqual([]);
  });

  it("draining one queue never touches the other", () => {
    recordStaleFill({ orderId: "o1", status: "TRADED" });
    recordStaleFill({ orderId: "o2", status: "PENDING" });
    drainPendingCloseQueue();
    expect(drainPendingCancelQueue()).toEqual([{ orderId: "o2", status: "PENDING" }]);
  });
});

describe("resetPanicGateForTests", () => {
  it("resets the epoch and clears both queues", () => {
    incrementEpoch();
    recordStaleFill({ orderId: "o1", status: "TRADED" });
    recordStaleFill({ orderId: "o2", status: "PENDING" });

    resetPanicGateForTests();

    expect(currentEpoch()).toBe(0);
    expect(drainPendingCloseQueue()).toEqual([]);
    expect(drainPendingCancelQueue()).toEqual([]);
  });
});
