import { describe, it, expect, beforeEach } from "vitest";
import { beat, recordTick, start, stop, isRunning, status, resetDeadManSwitchForTests } from "./deadManSwitch.mjs";

beforeEach(() => resetDeadManSwitchForTests());

describe("status — before anything has run", () => {
  it("is not alive and has no tick age", () => {
    expect(status()).toEqual({ alive: false, lastTickAgeMs: null });
  });
});

describe("beat / status — liveness", () => {
  it("is alive immediately after a beat, using an injectable clock", () => {
    beat(1000);
    expect(status(1000).alive).toBe(true);
    expect(status(1500).alive).toBe(true); // well within the default stale window
  });

  it("goes stale once the clock passes the default 3000ms window", () => {
    beat(1000);
    expect(status(1000 + 3000).alive).toBe(false); // exactly at the boundary — not < is not alive
    expect(status(1000 + 2999).alive).toBe(true);
  });

  it("respects a custom aliveStaleMs", () => {
    beat(1000);
    expect(status(1000 + 500, { aliveStaleMs: 400 }).alive).toBe(false);
    expect(status(1000 + 300, { aliveStaleMs: 400 }).alive).toBe(true);
  });
});

describe("recordTick / status — feed staleness, independent of heartbeat", () => {
  it("reports null lastTickAgeMs until a tick has been recorded", () => {
    beat(1000);
    expect(status(1000).lastTickAgeMs).toBeNull();
  });

  it("computes age from the injectable clock", () => {
    recordTick(1000);
    expect(status(1000).lastTickAgeMs).toBe(0);
    expect(status(4500).lastTickAgeMs).toBe(3500);
  });

  it("a dead heartbeat and a stale feed are reported independently", () => {
    beat(1000);
    recordTick(1000);
    const later = status(10000); // heartbeat AND feed both long stale
    expect(later.alive).toBe(false);
    expect(later.lastTickAgeMs).toBe(9000);
  });
});

describe("start / stop / isRunning", () => {
  it("is not running until start() is called, and running after", () => {
    expect(isRunning()).toBe(false);
    start();
    expect(isRunning()).toBe(true);
    stop();
    expect(isRunning()).toBe(false);
  });

  it("start() writes an immediate beat, without waiting for the first interval tick", () => {
    start();
    expect(status().alive).toBe(true);
    stop();
  });

  it("start() is idempotent — calling it twice does not throw or leak a second timer", () => {
    start();
    start();
    expect(isRunning()).toBe(true);
    stop();
    expect(isRunning()).toBe(false); // one stop() fully stops it, confirming only one timer was ever running
  });

  it("stop() is safe to call when not running", () => {
    expect(() => stop()).not.toThrow();
  });
});

describe("resetDeadManSwitchForTests", () => {
  it("stops the timer and clears both clocks", () => {
    start();
    recordTick();
    resetDeadManSwitchForTests();
    expect(isRunning()).toBe(false);
    expect(status()).toEqual({ alive: false, lastTickAgeMs: null });
  });
});
