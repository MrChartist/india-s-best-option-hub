/**
 * rmoney on the contract harness and the shared XTS-family suite (rmoneyXtsFamilyTestkit.mjs), plus the
 * pasted trading session token. No network: fetch is stubbed from __fixtures__/rmoney/ and the instrument
 * cache is an in-memory map.
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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as adapter from "./rmoney.mjs";
import * as cache from "../lib/instrumentCache.mjs";
import { describeXtsFamily } from "./rmoneyXtsFamilyTestkit.mjs";
import { SessionRequiredError } from "./contract.mjs";
import { createFetchStub, loadFixtures } from "./contractHarness.mjs";

describeXtsFamily({ adapter, clearCache: () => cache.__clear(), authKind: "apiKeyToken" });

describe("rmoney trading session (pasted token)", () => {
  const fx = loadFixtures("rmoney");
  const creds = fx.manifest.creds;
  const IA = adapter.BASE_URLS.IA;
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; adapter.resetForTests({ intervalMs: 0 }); cache.__clear(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("uses the documented host, port and paths", () => {
    expect(adapter.BASE_URLS.MD).toBe("https://xts.rmoneyindia.co.in:3000/apibinarymarketdata");
    expect(IA).toBe("https://xts.rmoneyindia.co.in:3000/interactive");
  });

  it("sends the pasted token as the authorization header with no login call", async () => {
    const stub = createFetchStub(fx.byCapability.orderBook.responses);
    globalThis.fetch = stub.fetch;
    await adapter.fetchOrderBook(creds);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].headers.authorization).toBe(creds.interactiveSessionToken);
  });

  it("asks the user to log in when no session token is saved, before any network call", async () => {
    const stub = createFetchStub([]);
    globalThis.fetch = stub.fetch;
    const { interactiveSessionToken: _drop, ...noToken } = creds;
    await expect(adapter.fetchPositions(noToken)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(stub.calls).toHaveLength(0);
  });

  it("turns a rejected token into SessionRequiredError and stops using it", async () => {
    const stub = createFetchStub([{ method: "GET", url: `${IA}/orders`, status: 400, json: { type: "error", code: "e-session-0007", description: "Session expired" } }]);
    globalThis.fetch = stub.fetch;
    await expect(adapter.fetchOrderBook(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchOrderBook(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(stub.calls).toHaveLength(1);
  });
});
