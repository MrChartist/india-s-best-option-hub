/**
 * Flattrade adapter on the contract harness and the shared Noren suite (shoonyaNorenTestkit.mjs).
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

import * as adapter from "./flattrade.mjs";
import { resetSessions } from "./flattradeAuth.mjs";
import { describeNorenAdapter } from "./shoonyaNorenTestkit.mjs";

describeNorenAdapter({
  adapter,
  resetSessions,
  uidField: "clientId",
  transport: "jKey",
  token: "GHUDWU53H32MTHPA536Q32WR",
  products: ["CNC", "INTRADAY", "MARGIN", "MTF"],
  noIntradayOnBFO: false,
});
