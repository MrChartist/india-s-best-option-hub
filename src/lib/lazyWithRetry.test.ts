import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_KEY,
  clearChunkReloadFlag,
  importWithRetry,
  isChunkLoadError,
  lazyWithRetry,
  reloadOnceForChunkError,
} from "./lazyWithRetry";
import { clearLogs, setConsoleMirroring } from "./log";

const chunkError = () => new TypeError("Failed to fetch dynamically imported module: /assets/Gex-abc123.js");

beforeEach(() => {
  setConsoleMirroring(false);
  clearLogs();
  sessionStorage.clear();
});

afterEach(() => {
  setConsoleMirroring(true);
});

describe("isChunkLoadError", () => {
  it.each([
    [chunkError(), true],
    [new Error("error loading dynamically imported module"), true],
    [new TypeError("Importing a module script failed."), true],
    [Object.assign(new Error("x"), { name: "ChunkLoadError" }), true],
    [new Error("Loading chunk 42 failed."), true],
    [new Error("Cannot read properties of undefined"), false],
    [null, false],
    ["Failed to fetch dynamically imported module", false],
  ])("%s → %s", (err, expected) => {
    expect(isChunkLoadError(err)).toBe(expected);
  });
});

describe("reloadOnceForChunkError", () => {
  it("reloads once, then refuses inside the cooldown", () => {
    const reload = vi.fn();
    let t = 1_000_000;
    const now = () => t;
    expect(reloadOnceForChunkError({ reload, now })).toBe(true);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe(String(t));
    t += 1000;
    expect(reloadOnceForChunkError({ reload, now })).toBe(false);
    t += CHUNK_RELOAD_COOLDOWN_MS;
    expect(reloadOnceForChunkError({ reload, now })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when storage throws", () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(reloadOnceForChunkError({ reload, storage })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("importWithRetry", () => {
  it("returns the module and clears the reload flag", async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
    const mod = { default: "ok" };
    await expect(importWithRetry(() => Promise.resolve(mod), { delayMs: 0 })).resolves.toBe(mod);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it("retries once before succeeding", async () => {
    const factory = vi.fn().mockRejectedValueOnce(chunkError()).mockResolvedValueOnce({ default: 1 });
    await expect(importWithRetry(factory, { delayMs: 0 })).resolves.toEqual({ default: 1 });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-chunk errors without reloading", async () => {
    const reload = vi.fn();
    const err = new Error("boom");
    await expect(importWithRetry(() => Promise.reject(err), { delayMs: 0, reload })).rejects.toBe(err);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads once on a persistent chunk error and never settles", async () => {
    const reload = vi.fn();
    const p = importWithRetry(() => Promise.reject(chunkError()), { delayMs: 0, reload });
    const settled = await Promise.race([p.then(() => "settled", () => "settled"), new Promise((r) => setTimeout(() => r("pending"), 20))]);
    expect(settled).toBe("pending");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("rethrows a chunk error after a recent reload instead of looping", async () => {
    const reload = vi.fn();
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    await expect(importWithRetry(() => Promise.reject(chunkError()), { delayMs: 0, reload })).rejects.toThrow(/dynamically imported/);
    expect(reload).not.toHaveBeenCalled();
  });

  it("clearChunkReloadFlag tolerates a missing storage", () => {
    expect(() => clearChunkReloadFlag(null)).not.toThrow();
  });
});

describe("lazyWithRetry", () => {
  it("returns a lazy component", () => {
    const C = lazyWithRetry(() => Promise.resolve({ default: () => null }));
    expect(C.$$typeof).toBe(Symbol.for("react.lazy"));
  });
});
