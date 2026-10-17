import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildErrorReport, buildIssueUrl, clearLogs, formatLogs, GITHUB_ISSUES_URL, getRecentErrors, getRecentLogs, log, LOG_CAPACITY, setConsoleMirroring } from "./log";

beforeEach(() => {
  clearLogs();
  setConsoleMirroring(false);
});

afterEach(() => {
  setConsoleMirroring(true);
  vi.restoreAllMocks();
});

describe("log ring buffer", () => {
  it("records entries in order with level and data", () => {
    log.info("a");
    log.warn("b", { x: 1 });
    log.error("c");
    const entries = getRecentLogs();
    expect(entries.map((e) => [e.level, e.message])).toEqual([
      ["info", "a"],
      ["warn", "b"],
      ["error", "c"],
    ]);
    expect(entries[1].data).toEqual({ x: 1 });
    expect(entries[0]).not.toHaveProperty("data");
  });

  it("drops the oldest entries beyond capacity", () => {
    for (let i = 0; i < LOG_CAPACITY + 25; i++) log.debug(`m${i}`);
    const entries = getRecentLogs();
    expect(entries).toHaveLength(LOG_CAPACITY);
    expect(entries[0].message).toBe("m25");
    expect(entries.at(-1)?.message).toBe(`m${LOG_CAPACITY + 24}`);
  });

  it("filters recent errors with a limit", () => {
    log.error("e1");
    log.info("i");
    log.error("e2");
    log.error("e3");
    expect(getRecentErrors().map((e) => e.message)).toEqual(["e1", "e2", "e3"]);
    expect(getRecentErrors(2).map((e) => e.message)).toEqual(["e2", "e3"]);
    expect(getRecentErrors(0)).toEqual([]);
    expect(getRecentLogs(0)).toEqual([]);
  });

  it("mirrors warnings and errors to the console when enabled", () => {
    setConsoleMirroring(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    log.warn("w");
    log.error("e", 42);
    expect(warn).toHaveBeenCalledWith("w");
    expect(error).toHaveBeenCalledWith("e", 42);
  });

  it("formats lines with IST time, level and safe data", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    log.warn("proxy offline", circular);
    log.error("crash", new Error("bad"));
    log.info("long", "x".repeat(800));
    const text = formatLogs();
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2} WARN {2}proxy offline \{"a":1,"self":"\[Circular\]"\}$/);
    expect(lines[1]).toContain("ERROR crash Error: bad");
    expect(lines[2].endsWith("…")).toBe(true);
  });
});

describe("error reports", () => {
  it("builds a report with page, stack and recent log", () => {
    log.warn("feed stale");
    const err = new Error("Cannot read properties of undefined");
    const report = buildErrorReport(err, "\n    at Chain\n    at Page");
    expect(report).toContain("Error: Error: Cannot read properties of undefined");
    expect(report).toContain("Page: unknown");
    expect(report).toMatch(/Time: .+ IST/);
    expect(report).toContain("Component stack:");
    expect(report).toContain("feed stale");
  });

  it("builds a prefilled GitHub issue URL under the length cap", () => {
    const err = new Error("x".repeat(300));
    err.stack = "Error\n" + "    at frame (file.js:1:1)\n".repeat(2000);
    for (let i = 0; i < 50; i++) log.error("noise ".repeat(40));
    const url = buildIssueUrl(err);
    expect(url.startsWith(`${GITHUB_ISSUES_URL}?`)).toBe(true);
    expect(url.length).toBeLessThanOrEqual(7000);
    const params = new URL(url).searchParams;
    expect(params.get("labels")).toBe("bug");
    expect(params.get("title")?.length).toBeLessThanOrEqual(120);
    expect(params.get("body")).toContain("Error report");
  });
});
