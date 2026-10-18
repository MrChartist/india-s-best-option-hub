import { describe, it, expect, beforeEach } from "vitest";
import { subscribe, unsubscribe, publish, subscriberCount, resetTickBusForTests } from "./tickBus.mjs";

beforeEach(() => resetTickBusForTests());

describe("tickBus — subscribe/publish", () => {
  it("delivers a published tick to a subscribed handler", () => {
    const received = [];
    subscribe((tick) => received.push(tick));

    const tick = { key: "IDX_I:25", ltp: 58090 };
    publish(tick);

    expect(received).toEqual([tick]);
  });

  it("delivers to every subscriber, in registration order", () => {
    const order = [];
    subscribe(() => order.push("a"));
    subscribe(() => order.push("b"));
    subscribe(() => order.push("c"));

    publish({ key: "IDX_I:25", ltp: 1 });

    expect(order).toEqual(["a", "b", "c"]);
  });

  it("calls handlers synchronously — publish() returns only after every handler has run", () => {
    let sawIt = false;
    subscribe(() => { sawIt = true; });
    publish({ key: "IDX_I:25", ltp: 1 });
    expect(sawIt).toBe(true); // no await needed — this is the whole point of the bus
  });

  it("rejects a non-function handler rather than silently registering nothing", () => {
    expect(() => subscribe(null)).toThrow();
    expect(() => subscribe(undefined)).toThrow();
    expect(() => subscribe("not a function")).toThrow();
  });
});

describe("tickBus — unsubscribe", () => {
  it("stops delivery via the function returned from subscribe()", () => {
    const received = [];
    const unsub = subscribe((tick) => received.push(tick));

    publish({ key: "IDX_I:25", ltp: 1 });
    unsub();
    publish({ key: "IDX_I:25", ltp: 2 });

    expect(received).toHaveLength(1);
  });

  it("stops delivery via the standalone unsubscribe(handler) export", () => {
    const received = [];
    function handler(tick) { received.push(tick); }
    subscribe(handler);

    publish({ key: "IDX_I:25", ltp: 1 });
    unsubscribe(handler);
    publish({ key: "IDX_I:25", ltp: 2 });

    expect(received).toHaveLength(1);
  });

  it("calling the unsubscribe function twice is harmless", () => {
    const unsub = subscribe(() => {});
    unsub();
    expect(() => unsub()).not.toThrow();
    expect(subscriberCount()).toBe(0);
  });

  it("unsubscribing a handler that was never subscribed is a no-op", () => {
    expect(() => unsubscribe(() => {})).not.toThrow();
  });
});

describe("tickBus — fault isolation", () => {
  it("a throwing subscriber does not stop the tick reaching the rest", () => {
    const received = [];
    subscribe(() => { throw new Error("boom"); });
    subscribe((tick) => received.push(tick));

    expect(() => publish({ key: "IDX_I:25", ltp: 1 })).not.toThrow();
    expect(received).toHaveLength(1);
  });
});

describe("tickBus — subscriberCount / reset", () => {
  it("tracks additions and removals", () => {
    expect(subscriberCount()).toBe(0);
    const unsub = subscribe(() => {});
    expect(subscriberCount()).toBe(1);
    unsub();
    expect(subscriberCount()).toBe(0);
  });

  it("resetTickBusForTests clears every subscriber", () => {
    subscribe(() => {});
    subscribe(() => {});
    expect(subscriberCount()).toBe(2);
    resetTickBusForTests();
    expect(subscriberCount()).toBe(0);
  });
});
