/** Bounds on the upstream WebSocket pools: idle close, connection cap with LRU eviction, subscription trimming. */
import { describe, expect, it } from "vitest";
import { createFeedPoolGuard, trimSubscriptions } from "./upstreamFeedLimits.mjs";

function pool({ maxConnections = 2, idleMs = 1000 } = {}) {
  let clock = 0;
  const connections = new Map();
  const closed = [];
  const guard = createFeedPoolGuard(connections, {
    limits: { maxConnections, idleMs, sweepMs: 0 },
    now: () => clock,
    isBusy: (e) => e.busy === true,
    closeEntry: (key) => closed.push(key),
  });
  const add = (key, extra = {}) => {
    guard.beforeOpen();
    const e = guard.touch({ ...extra });
    connections.set(key, e);
    return e;
  };
  return { connections, closed, guard, add, tick: (ms) => { clock += ms; } };
}

describe("createFeedPoolGuard", () => {
  it("closes a socket nobody has used for idleMs, but never one with a live listener", () => {
    const p = pool();
    p.add("a");
    p.add("b", { busy: true });
    p.tick(999);
    expect(p.guard.sweep()).toBe(0);
    p.tick(1);
    expect(p.guard.sweep()).toBe(1);
    expect(p.closed).toEqual(["a"]);
    expect([...p.connections.keys()]).toEqual(["b"]);
  });

  it("touch() keeps a socket alive", () => {
    const p = pool();
    const a = p.add("a");
    p.tick(900);
    p.guard.touch(a);
    p.tick(900);
    expect(p.guard.sweep()).toBe(0);
  });

  it("evicts the least recently used idle socket when the cap is reached", () => {
    const p = pool({ maxConnections: 2, idleMs: 60_000 });
    const a = p.add("a");
    p.tick(10);
    p.add("b");
    p.tick(10);
    p.guard.touch(a);
    p.add("c");
    expect(p.closed).toEqual(["b"]);
    expect([...p.connections.keys()].sort()).toEqual(["a", "c"]);
  });

  it("refuses with 422 FEED_LIMIT when every socket is busy", () => {
    const p = pool({ maxConnections: 1, idleMs: 60_000 });
    p.add("a", { busy: true });
    let err;
    try { p.add("b"); } catch (e) { err = e; }
    expect(err?.code).toBe("FEED_LIMIT");
    expect(err?.statusCode).toBe(422);
  });

  it("closeAll() closes everything", () => {
    const p = pool();
    p.add("a");
    p.add("b");
    p.guard.closeAll();
    expect(p.connections.size).toBe(0);
    expect(p.closed.sort()).toEqual(["a", "b"]);
  });
});

describe("trimSubscriptions", () => {
  it("drops the oldest members not needed by the current request", () => {
    const set = new Set(["a", "b", "c", "d", "e"]);
    expect(trimSubscriptions(set, new Set(["a", "e"]), 3)).toEqual(["b", "c"]);
    expect([...set]).toEqual(["a", "d", "e"]);
  });

  it("leaves a set under the cap alone", () => {
    const set = new Set(["a"]);
    expect(trimSubscriptions(set, new Set(), 3)).toEqual([]);
  });
});
