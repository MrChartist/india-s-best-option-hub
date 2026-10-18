/**
 * iifl on the contract harness and the shared XTS-family suite (rmoneyXtsFamilyTestkit.mjs), plus the
 * official v2 trading login (OAuth accessToken + host lookup). No network: fetch is stubbed from
 * __fixtures__/iifl/ and the instrument cache is an in-memory map.
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
import * as adapter from "./iifl.mjs";
import * as cache from "../lib/instrumentCache.mjs";
import { describeXtsFamily } from "./rmoneyXtsFamilyTestkit.mjs";
import { BrokerError, SessionRequiredError } from "./contract.mjs";
import { createFetchStub, loadFixtures } from "./contractHarness.mjs";

describeXtsFamily({ adapter, clearCache: () => cache.__clear(), authKind: "requestTokenExchange" });

describe("iifl trading session (OAuth accessToken + host lookup)", () => {
  const fx = loadFixtures("iifl");
  const creds = fx.manifest.creds;
  const funds = fx.byCapability.funds.responses;
  const [lookup, session, balance] = funds;
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; adapter.resetForTests({ intervalMs: 0 }); cache.__clear(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("uses the documented hosts and paths", () => {
    expect(adapter.BASE_URLS.MD).toBe("https://ttblaze.iifl.com/apibinarymarketdata");
    expect(adapter.BASE_URLS.HOSTLOOKUP).toBe("https://ttblaze.iifl.com/hostlookup");
  });

  it("looks up the host, logs in with accessToken + uniqueKey and calls the returned connectionString", async () => {
    const stub = createFetchStub(funds);
    globalThis.fetch = stub.fetch;
    await adapter.fetchFunds(creds);
    expect(stub.calls.map((c) => c.url)).toEqual([lookup.url, session.url, balance.url]);
    expect(JSON.parse(stub.calls[1].body)).toEqual({ appKey: creds.interactiveApiKey, secretKey: creds.interactiveApiSecret, accessToken: creds.requestToken, uniqueKey: "dummyUniqueKey01" });
    expect(stub.calls[2].headers.authorization).toBe("dummy.ia.token");
  });

  it("refuses a connectionString on another host and never sends the keys there", async () => {
    const evil = { ...lookup, json: { ...lookup.json, result: { ...lookup.json.result, connectionString: "https://evil.example.com/interactive" } } };
    const stub = createFetchStub([evil, session, balance]);
    globalThis.fetch = stub.fetch;
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(BrokerError);
    expect(stub.calls.map((c) => c.url)).toEqual([lookup.url]);
  });

  it("marks a rejected accessToken as used and asks for a fresh login without calling again", async () => {
    const stub = createFetchStub([lookup, { ...session, status: 400, json: { type: "error", code: "e-user-0005", description: "Invalid access token" } }]);
    globalThis.fetch = stub.fetch;
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(stub.calls).toHaveLength(2);
  });

  it("asks for a fresh login when the trading session expires mid-day (no silent retry)", async () => {
    const stub = createFetchStub([lookup, session, { ...balance, status: 400, json: { type: "error", code: "e-token-0005", description: "Invalid Token" } }]);
    globalThis.fetch = stub.fetch;
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(stub.calls).toHaveLength(3);
  });

  it("falls back to the key-pair login (official SDK route) when no accessToken is saved", async () => {
    const stub = createFetchStub([
      { method: "POST", url: "https://ttblaze.iifl.com/interactive/user/session", expectBody: { appKey: creds.interactiveApiKey, secretKey: creds.interactiveApiSecret, source: "WebAPI" }, json: session.json },
      { method: "GET", url: "https://ttblaze.iifl.com/interactive/user/balance", json: balance.json },
    ]);
    globalThis.fetch = stub.fetch;
    const { requestToken: _drop, ...keyPairOnly } = creds;
    expect((await adapter.fetchFunds(keyPairOnly)).data.availableCash).toBe(247044.72);
  });
});
