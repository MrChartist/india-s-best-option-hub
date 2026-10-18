/**
 * TradeSmart adapter on the contract harness and the shared Noren suite (shoonyaNorenTestkit.mjs).
 * No network: fetch is stubbed, and the instrument cache is an in-memory map per test so nothing
 * touches the developer's .cache directory.
 */
import { vi } from "vitest";

vi.mock("../lib/instrumentCache.mjs", () => {
  const mem = new Map();
  return {
    ONE_DAY_MS: 86_400_000,
    getCachedOrFetch: async (key, fn) => {
      if (!mem.has(key)) mem.set(key, await fn());
      return mem.get(key);
    },
    __clear: () => mem.clear(),
  };
});

import * as adapter from "./tradesmart.mjs";
import { resetSessions } from "./tradesmartAuth.mjs";
import { describeNorenAdapter } from "./shoonyaNorenTestkit.mjs";

describeNorenAdapter({
  adapter,
  resetSessions,
  uidField: "clientId",
  transport: "bearer",
  token: "dummyTradesmartAccessToken",
  products: ["CNC", "INTRADAY", "MARGIN"],
  noIntradayOnBFO: false,
});

import { describe, expect, it } from "vitest";
import { resolveExpiresAt } from "./tradesmartAuth.mjs";

describe("tradesmart token expiry", () => {
  it("reads expires_in as a duration or an epoch timestamp, falling back to 05:00 IST", () => {
    const now = Date.UTC(2026, 9, 17, 5, 0, 0);
    expect(resolveExpiresAt(28800, now)).toBe(now + 28_800_000);
    expect(resolveExpiresAt(1792300000, now)).toBe(1792300000 * 1000);
    expect(resolveExpiresAt(undefined, now)).toBe(Date.UTC(2026, 9, 17, 23, 30, 0));
  });
});
