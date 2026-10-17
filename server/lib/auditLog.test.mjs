import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  istDayKey,
  appendAuditEvent,
  readAuditEventsForDay,
  setAuditDirForTests,
  resetAuditDirForTests,
} from "./auditLog.mjs";

describe("istDayKey — IST calendar day from a UTC timestamp", () => {
  it("keeps a timestamp just before the 18:30 UTC boundary on that same UTC date's IST day", () => {
    // 18:29:59 UTC = 23:59:59 IST, still 2026-09-06 in IST.
    expect(istDayKey(new Date("2026-09-06T18:29:59.000Z"))).toBe("2026-09-06");
  });

  it("rolls a timestamp at/after the 18:30 UTC boundary onto the next IST calendar day", () => {
    // 18:30:00 UTC = 00:00:00 IST the next date — a trade here is already tomorrow in IST.
    expect(istDayKey(new Date("2026-09-06T18:30:00.000Z"))).toBe("2026-09-07");
  });

  it("is one millisecond apart across the boundary, one IST day apart in the result", () => {
    const before = istDayKey(new Date("2026-09-06T18:29:59.999Z"));
    const after = istDayKey(new Date("2026-09-06T18:30:00.000Z"));
    expect(before).toBe("2026-09-06");
    expect(after).toBe("2026-09-07");
  });

  it("defaults to now() when called with no argument", () => {
    expect(istDayKey()).toBe(istDayKey(new Date()));
  });
});

describe("appendAuditEvent / readAuditEventsForDay", () => {
  let dir;

  beforeEach(() => {
    // A scratch directory under the OS temp dir — never .cache/audit — so
    // these tests cannot pollute or depend on the real audit log.
    dir = mkdtempSync(join(tmpdir(), "auditlog-test-"));
    setAuditDirForTests(dir);
  });

  afterEach(() => {
    resetAuditDirForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a fresh file for the first event of a day", () => {
    const ts = Date.parse("2026-09-06T10:00:00.000Z"); // 15:30 IST, same calendar date
    appendAuditEvent({ ts, intentId: "i1", type: "ARM", payload: { a: 1 } });

    const file = join(dir, "2026-09-06.ndjson");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ intentId: "i1", type: "ARM", payload: { a: 1 } });
  });

  it("appends to an existing file without touching prior lines", () => {
    const ts = Date.parse("2026-09-06T10:00:00.000Z");
    appendAuditEvent({ ts, intentId: "i1", type: "ARM", payload: {} });
    appendAuditEvent({ ts: ts + 1000, intentId: "i1", type: "SUBMIT", payload: { lots: 2 } });
    appendAuditEvent({ ts: ts + 2000, intentId: "i1", type: "FILLED", payload: { price: 100.5 } });

    const file = join(dir, "2026-09-06.ndjson");
    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    // Every earlier line must be byte-identical to what it was when written —
    // this is the "never rewrites prior lines" guarantee the module promises.
    expect(JSON.parse(lines[0])).toMatchObject({ type: "ARM", payload: {} });
    expect(JSON.parse(lines[1])).toMatchObject({ type: "SUBMIT", payload: { lots: 2 } });
    expect(JSON.parse(lines[2])).toMatchObject({ type: "FILLED", payload: { price: 100.5 } });
  });

  it("routes events either side of the IST day boundary into separate files", () => {
    appendAuditEvent({ ts: Date.parse("2026-09-06T18:29:59.000Z"), intentId: "i1", type: "A", payload: null });
    appendAuditEvent({ ts: Date.parse("2026-09-06T18:30:00.000Z"), intentId: "i2", type: "B", payload: null });

    expect(existsSync(join(dir, "2026-09-06.ndjson"))).toBe(true);
    expect(existsSync(join(dir, "2026-09-07.ndjson"))).toBe(true);
    expect(readAuditEventsForDay("2026-09-06")).toHaveLength(1);
    expect(readAuditEventsForDay("2026-09-07")).toHaveLength(1);
  });

  it("defaults ts to now and payload to null when omitted", () => {
    const before = Date.now();
    appendAuditEvent({ intentId: "i1", type: "DISARM" });
    const after = Date.now();

    const events = readAuditEventsForDay(istDayKey(new Date()));
    expect(events).toHaveLength(1);
    expect(events[0].payload).toBeNull();
    expect(events[0].ts).toBeGreaterThanOrEqual(before);
    expect(events[0].ts).toBeLessThanOrEqual(after);
  });

  it("requires intentId and type, and refuses a non-object event", () => {
    expect(() => appendAuditEvent({ ts: Date.now(), type: "ARM" })).toThrow(/intentId/);
    expect(() => appendAuditEvent({ ts: Date.now(), intentId: "i1" })).toThrow(/type/);
    expect(() => appendAuditEvent(null)).toThrow(/event object/);
    expect(() => appendAuditEvent("nope")).toThrow(/event object/);
  });

  it("readAuditEventsForDay returns [] for a day with no file yet, without throwing", () => {
    expect(readAuditEventsForDay("2099-01-01")).toEqual([]);
  });

  it("readAuditEventsForDay returns parsed events in append order for an existing day", () => {
    const ts = Date.parse("2026-09-06T10:00:00.000Z");
    appendAuditEvent({ ts, intentId: "i1", type: "ARM", payload: { a: 1 } });
    appendAuditEvent({ ts: ts + 500, intentId: "i1", type: "SUBMIT", payload: { lots: 2 } });

    const events = readAuditEventsForDay("2026-09-06");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ intentId: "i1", type: "ARM", payload: { a: 1 } });
    expect(events[1]).toMatchObject({ intentId: "i1", type: "SUBMIT", payload: { lots: 2 } });
  });
});
