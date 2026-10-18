/**
 * wisdom on the contract harness and the shared XTS-family suite (rmoneyXtsFamilyTestkit.mjs), plus the
 * key-pair trading session. No network: fetch is stubbed from __fixtures__/wisdom/ and the instrument cache
 * is an in-memory map.
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
import * as adapter from "./wisdom.mjs";
import * as cache from "../lib/instrumentCache.mjs";
import { describeXtsFamily } from "./rmoneyXtsFamilyTestkit.mjs";
import { BrokerError } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, loadFixtures } from "./contractHarness.mjs";

describeXtsFamily({ adapter, clearCache: () => cache.__clear(), authKind: "apiKeyToken" });

describe("wisdom trading session (key pair)", () => {
  const fx = loadFixtures("wisdom");
  const creds = fx.manifest.creds;
  const IA = adapter.BASE_URLS.IA;
  const rejected = { type: "error", code: "e-token-0005", description: "Invalid Token" };
  let realFetch;
  beforeEach(() => { realFetch = globalThis.fetch; adapter.resetForTests({ intervalMs: 0 }); cache.__clear(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("uses the documented host and paths", () => {
    expect(adapter.BASE_URLS.MD).toBe("https://trade.wisdomcapital.in/apimarketdata");
    expect(IA).toBe("https://trade.wisdomcapital.in/interactive");
  });

  it("re-creates the session once when a read is rejected", async () => {
    const book = fx.byCapability.orderBook.responses;
    let first = true;
    const stub = createFetchStub(book);
    globalThis.fetch = async (url, init) => {
      if (first && String(url) === `${IA}/orders`) { first = false; return new Response(JSON.stringify(rejected), { status: 400 }); }
      return stub.fetch(url, init);
    };
    expect((await adapter.fetchOrderBook(creds)).data).toHaveLength(3);
    expect(stub.calls.filter((c) => c.url.endsWith("/user/session"))).toHaveLength(2);
  });

  it("never retries an order after a token rejection", async () => {
    const stub = createFetchStub([
      ...fx.byCapability.placeOrder.responses.filter((r) => r.url.endsWith("/user/session")),
      { method: "POST", url: `${IA}/orders`, status: 400, json: rejected },
    ]);
    globalThis.fetch = stub.fetch;
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "wisdom" });
    await expect(adapter.placeOrder(creds, ...fx.byCapability.placeOrder.args, gate)).rejects.toBeInstanceOf(BrokerError);
    expect(stub.calls.filter((c) => c.url === `${IA}/orders`)).toHaveLength(1);
  });

  it("sends clientID only when the user saved one (dealer logins)", async () => {
    const stub = createFetchStub([
      ...fx.byCapability.funds.responses.filter((r) => r.url.endsWith("/user/session")),
      { method: "GET", url: `${IA}/user/balance?clientID=DLR01`, json: fx.byCapability.funds.responses.at(-1).json },
    ]);
    globalThis.fetch = stub.fetch;
    await adapter.fetchFunds({ ...creds, clientId: "DLR01" });
    expect(stub.calls.at(-1).url).toBe(`${IA}/user/balance?clientID=DLR01`);
  });
});
