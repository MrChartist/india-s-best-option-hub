import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOCK_STATES,
  COOLING_PERIOD_MS,
  getLockState,
  setLockState,
  requestUnlock,
  setLockFilePathForTests,
  resetLockFilePathForTests,
} from "./tradingLockState.mjs";

let dir, lockFile;

beforeEach(() => {
  // A scratch file under the OS temp dir — never .cache/trading-lock.json —
  // so these tests cannot pollute or depend on the real lock file.
  dir = mkdtempSync(join(tmpdir(), "tradinglock-test-"));
  lockFile = join(dir, "trading-lock.json");
  setLockFilePathForTests(lockFile);
});

afterEach(() => {
  resetLockFilePathForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("getLockState — fails closed on anything short of a clean, recognised record", () => {
  it("reads locked-by-engine-fault when the file does not exist yet", () => {
    expect(getLockState().state).toBe(LOCK_STATES.LOCKED_BY_ENGINE_FAULT);
  });

  it("reads locked-by-engine-fault on corrupt JSON", () => {
    writeFileSync(lockFile, "{not json", "utf-8");
    expect(getLockState().state).toBe(LOCK_STATES.LOCKED_BY_ENGINE_FAULT);
  });

  it("reads locked-by-engine-fault when the file names a state this module does not recognise", () => {
    writeFileSync(lockFile, JSON.stringify({ state: "totally-unlocked-trust-me" }), "utf-8");
    expect(getLockState().state).toBe(LOCK_STATES.LOCKED_BY_ENGINE_FAULT);
  });

  it("reads locked-by-engine-fault for valid JSON that isn't a lock record at all", () => {
    writeFileSync(lockFile, JSON.stringify([1, 2, 3]), "utf-8");
    expect(getLockState().state).toBe(LOCK_STATES.LOCKED_BY_ENGINE_FAULT);
  });

  it("reads the real state back once a valid record has been written", () => {
    setLockState(LOCK_STATES.UNLOCKED, { by: "user1" }, 1000);
    expect(getLockState()).toEqual({ state: LOCK_STATES.UNLOCKED, since: 1000, meta: { by: "user1" } });
  });
});

describe("setLockState", () => {
  it("throws rather than persisting an unrecognised state", () => {
    expect(() => setLockState("definitely-not-a-state")).toThrow(/Unknown trading lock state/);
    // Nothing was ever written, so a read still (correctly) fails closed.
    expect(getLockState().state).toBe(LOCK_STATES.LOCKED_BY_ENGINE_FAULT);
  });

  it("round-trips every recognised state", () => {
    for (const state of Object.values(LOCK_STATES)) {
      setLockState(state, null, 42);
      expect(getLockState().state).toBe(state);
    }
  });
});

describe("requestUnlock — pure eligibility check, no timer of its own", () => {
  it("clears unlocked/locked-by-user with no cooling or figure required", () => {
    expect(requestUnlock(LOCK_STATES.UNLOCKED, null, null, 0)).toEqual({ ok: true });
    expect(requestUnlock(LOCK_STATES.LOCKED_BY_USER, null, null, 0)).toEqual({ ok: true });
  });

  it("refuses locked-by-engine-fault — that needs operator intervention, not the trader ritual", () => {
    const result = requestUnlock(LOCK_STATES.LOCKED_BY_ENGINE_FAULT, "0", 0, COOLING_PERIOD_MS);
    expect(result.ok).toBe(false);
  });

  it("rejects when the cooling period has not fully elapsed", () => {
    const result = requestUnlock(LOCK_STATES.LOCKED_BY_MTM_LOSS, "48500", 48500, COOLING_PERIOD_MS - 1000);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cooling/i);
  });

  it("rejects a mismatched typed figure even once cooling has fully elapsed", () => {
    const result = requestUnlock(LOCK_STATES.LOCKED_BY_MTM_LOSS, "40000", 48500, COOLING_PERIOD_MS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/i);
  });

  it("accepts a matching typed figure once cooling has elapsed, tolerating currency formatting", () => {
    expect(requestUnlock(LOCK_STATES.LOCKED_BY_MTM_LOSS, "₹48,500", 48500, COOLING_PERIOD_MS)).toEqual({ ok: true });
    expect(requestUnlock(LOCK_STATES.LOCKED_BY_MTM_LOSS, "48500.00", 48500, COOLING_PERIOD_MS)).toEqual({ ok: true });
  });

  it("applies the identical cooling + figure rules to locked-by-daily-loss-limit", () => {
    expect(requestUnlock(LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT, "100000", 100000, COOLING_PERIOD_MS - 1).ok).toBe(false);
    expect(requestUnlock(LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT, "99000", 100000, COOLING_PERIOD_MS).ok).toBe(false);
    expect(requestUnlock(LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT, "100000", 100000, COOLING_PERIOD_MS).ok).toBe(true);
  });

  it("treats a missing/non-finite coolingElapsedMs as zero elapsed, not as unlimited", () => {
    const result = requestUnlock(LOCK_STATES.LOCKED_BY_MTM_LOSS, "100", 100, undefined);
    expect(result.ok).toBe(false);
  });
});
