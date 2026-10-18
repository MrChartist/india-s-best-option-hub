/**
 * compositedge on the contract harness and the shared XTS suite (compositedgeXtsTestkit.mjs). No network: fetch
 * is stubbed from __fixtures__/compositedge/, and the instrument cache is an in-memory map so nothing touches .cache.
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

import * as adapter from "./compositedge.mjs";
import * as cache from "../lib/instrumentCache.mjs";
import { describeXtsAdapter, describeXtsParsers } from "./compositedgeXtsTestkit.mjs";

describeXtsAdapter({ adapter, clearCache: () => cache.__clear(), interactiveMode: "requestToken" });
describeXtsParsers();
