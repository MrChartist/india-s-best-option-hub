/**
 * Shared vitest suite for the rmoney / wisdom / iifl XTS adapters (engine: rmoneyXtsFamily.mjs). Each
 * <id>.test.mjs mocks ../lib/instrumentCache.mjs (so nothing touches .cache) and calls describeXtsFamily().
 * No network: every fetch is answered from server/brokers/__fixtures__/<id>/ or fails the test.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrokerInputError, OrderGateError, SessionRequiredError, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { checkOptionChain, toOptionData } from "./contractShapes.mjs";

const ALL_CAPS = [
  "testConnection", "instruments", "expiries", "optionChain", "ltp", "quotes", "depth", "historical",
  "positions", "holdings", "funds", "orderBook", "tradeBook", "placeOrder", "modifyOrder", "cancelOrder", "normaliseError",
];

/**
 * @param {object} o
 * @param {object} o.adapter         the broker module
 * @param {() => void} o.clearCache  clears the mocked instrument cache
 * @param {string} o.authKind        expected capabilities.auth.kind
 */
export function describeXtsFamily({ adapter, clearCache, authKind }) {
  const id = adapter.id;
  const fx = loadFixtures(id);
  const creds = fx.manifest.creds;
  const { MD } = adapter.BASE_URLS;
  const mdOrigin = new URL(MD).origin;
  let realFetch;
  let stub;

  const use = (responses) => {
    stub = createFetchStub(responses);
    globalThis.fetch = stub.fetch;
    return stub;
  };
  const responsesOf = (name) => fx.byCapability[name].responses;
  const gate = (action) => issueOrderGate({ verdict: { ok: true }, liveArmed: true, action, brokerId: id });

  beforeEach(() => {
    realFetch = globalThis.fetch;
    adapter.resetForTests({ intervalMs: 0 });
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe(`${id} contract`, () => {
    it("passes the strict contract with no warnings", () => {
      const v = validateAdapter(adapter);
      expect(v.mode).toBe("strict");
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      expect(adapter.capabilities.auth.kind).toBe(authKind);
    });

    it("meets every declared capability against the official-doc fixtures", async () => {
      const report = await runContractHarness(adapter, fx);
      expect(harnessFailures(report)).toEqual([]);
      expect(report.results.map((r) => r.capability)).toEqual(expect.arrayContaining(ALL_CAPS));
    });

    it("keeps every market-data request on the broker's own host", async () => {
      use(responsesOf("optionChain"));
      await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
      expect(stub.calls.length).toBeGreaterThan(0);
      for (const c of stub.calls) expect(new URL(c.url).origin).toBe(mdOrigin);
    });

    it("sends the market-data token on the master and index-list calls (docs: every call but login)", async () => {
      use(responsesOf("expiries"));
      await adapter.fetchExpiryList(creds, "NIFTY");
      await adapter.fetchLTP(creds, "NIFTY").catch(() => {}); // quotes are not in this fixture; only the index-list call matters
      const authed = stub.calls.filter((c) => !c.url.endsWith("/auth/login"));
      expect(authed.length).toBeGreaterThan(0);
      for (const c of authed) expect(c.headers.authorization).toBe("dummy.md.token");
    });
  });

  describe(`${id} symbol mapping`, () => {
    it("lists NIFTY weekly and monthly expiries in ascending ISO order", async () => {
      use(responsesOf("expiries"));
      expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
      expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
      expect((await adapter.fetchExpiryList(creds, "BANKEX")).data).toEqual(["2026-10-29"]);
      expect((await adapter.fetchExpiryList(creds, "RELIANCE")).data).toEqual(["2026-10-27"]);
    });

    it("builds the NIFTY weekly chain from master + 1502 + 1510 with spot from the index list", async () => {
      use(responsesOf("optionChain"));
      const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
      expect(checkOptionChain(r, { minStrikes: 3 })).toEqual([]);
      expect(Object.keys(r.data.oc).sort()).toEqual(["24900", "25000", "25100"]);
      expect(r.data.last_price).toBe(25012.35);
      const atm = r.data.oc["25000"];
      expect(atm.ce).toMatchObject({ last_price: 200.1, oi: 2_100_000, bid_price: 199.6, ask_price: 200.6, security_id: "40003" });
      expect(atm.pe.last_price).toBe(205.4);
      const row = toOptionData(r).chain.find((c) => c.strikePrice === 25000);
      expect(row.ce.iv).toBeGreaterThan(1); // percent, not a fraction
    });

    it("builds the NIFTY monthly chain from the same master", async () => {
      use(fx.byCapability.optionChainMonthly.responses);
      const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-27");
      expect(Object.keys(r.data.oc)).toEqual(["25000"]);
      expect(r.data.oc["25000"].ce.last_price).toBe(310.2);
    });

    it("builds the SENSEX weekly chain on BSEFO with the BSE index spot", async () => {
      use(fx.byCapability.optionChainSensex.responses);
      const r = await adapter.fetchOptionChain(creds, "SENSEX", "2026-10-22");
      expect(checkOptionChain(r, { minStrikes: 3 })).toEqual([]);
      expect(r.data.last_price).toBe(82010.6);
      expect(r.data.oc["82000"].ce.security_id).toBe("850003");
      const quoteCalls = stub.calls.filter((c) => c.url.endsWith("/instruments/quotes")).map((c) => JSON.parse(c.body));
      expect(quoteCalls[0].instruments[0]).toEqual({ exchangeSegment: 11, exchangeInstrumentID: 26065 });
      expect(quoteCalls[1].instruments.every((i) => i.exchangeSegment === 12)).toBe(true);
    });

    it("builds a stock option chain with spot from the underlying cash token", async () => {
      use(fx.byCapability.optionChainStock.responses);
      const r = await adapter.fetchOptionChain(creds, "RELIANCE", "2026-10-27");
      expect(Object.keys(r.data.oc).sort()).toEqual(["2800", "2900"]);
      expect(r.data.last_price).toBe(2851.4);
    });

    it("returns the index LTP from the single-object listQuotes form", async () => {
      use(responsesOf("ltp"));
      expect((await adapter.fetchLTP(creds, "NIFTY")).data.last_price).toBe(25012.35);
    });

    it("maps instruments onto canonical underlyings with master lot sizes", async () => {
      use(responsesOf("instruments"));
      const { data } = await adapter.fetchInstruments(creds);
      const find = (pred) => data.find(pred);
      expect(find((i) => i.underlying === "NIFTY" && i.instrumentType === "OPTIDX")).toMatchObject({ exchange: "NFO", lotSize: 75, expiry: "2026-10-20" });
      expect(find((i) => i.underlying === "BANKEX" && i.instrumentType === "OPTIDX")).toMatchObject({ exchange: "BFO", lotSize: 30 });
      expect(find((i) => i.underlying === "RELIANCE" && i.instrumentType === "OPTSTK")).toMatchObject({ lotSize: 500, strike: 2800 });
      expect(find((i) => i.instrumentType === "FUTIDX")).toMatchObject({ underlying: "NIFTY", strike: null, optionType: null });
      expect(find((i) => i.instrumentType === "INDEX" && i.underlying === "SENSEX")).toMatchObject({ token: "26065", exchange: "BSE" });
    });

    it("rejects malformed symbols before any network call", async () => {
      use([]);
      await expect(adapter.fetchExpiryList(creds, "NIFTY 50; DROP")).rejects.toBeInstanceOf(BrokerInputError);
      expect(stub.calls).toHaveLength(0);
    });
  });

  describe(`${id} market-data session`, () => {
    it("re-logs in once after a token rejection and then succeeds", async () => {
      const ltp = responsesOf("ltp");
      let rejected = false;
      const s = use(ltp);
      const inner = s.fetch;
      globalThis.fetch = async (url, init) => {
        if (!rejected && String(url).endsWith("/instruments/indexlist?exchangeSegment=1")) {
          rejected = true;
          return new Response(JSON.stringify({ type: "error", code: "e-token-0005", description: "Invalid Token" }), { status: 400 });
        }
        return inner(url, init);
      };
      expect((await adapter.fetchLTP(creds, "NIFTY")).data.last_price).toBe(25012.35);
      expect(s.calls.filter((c) => c.url.endsWith("/auth/login"))).toHaveLength(2);
    });

    it("testConnection reports a failed login without leaking the keys", async () => {
      use([{ method: "POST", url: `${MD}/auth/login`, status: 400, json: { type: "error", code: "e-app-0001", description: `Invalid app key ${creds.apiKey}` } }]);
      const r = await adapter.testConnection(creds);
      expect(r.status).toBe("error");
      expect(r.message).not.toContain(creds.apiKey);
      expect(r.message).not.toContain(creds.apiSecret);
    });

    it("refuses incomplete settings before any network call", async () => {
      use([]);
      await expect(adapter.fetchLTP({ apiKey: "only-key" }, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
      expect(stub.calls).toHaveLength(0);
    });
  });

  describe(`${id} orders (gated)`, () => {
    it("refuses every order call without a gate before any network call", async () => {
      use(responsesOf("placeOrder"));
      const order = fx.byCapability.placeOrder.args;
      await expect(adapter.placeOrder(creds, ...order)).rejects.toBeInstanceOf(OrderGateError);
      await expect(adapter.modifyOrder(creds, ...fx.byCapability.modifyOrder.args)).rejects.toBeInstanceOf(OrderGateError);
      await expect(adapter.cancelOrder(creds, "2190766863")).rejects.toBeInstanceOf(OrderGateError);
      expect(stub.calls).toHaveLength(0);
    });

    it("places lots x master lot size with the documented enums", async () => {
      use(responsesOf("placeOrder"));
      const ack = await adapter.placeOrder(creds, ...fx.byCapability.placeOrder.args, gate("placeOrder"));
      expect(ack).toEqual({ orderId: "2190766863", orderStatus: "UNKNOWN" });
      const body = JSON.parse(stub.calls.at(-1).body);
      expect(body).toMatchObject({ orderQuantity: 150, orderType: "Limit", productType: "NRML", timeInForce: "DAY" });
    });

    it("refuses an order with no resolved lot size even when gated, before any network call", async () => {
      use(responsesOf("placeOrder"));
      const [order] = fx.byCapability.placeOrder.args;
      await expect(adapter.placeOrder(creds, order, undefined, gate("placeOrder"))).rejects.toBeInstanceOf(BrokerInputError);
      expect(stub.calls.filter((c) => c.url.endsWith("/orders"))).toHaveLength(0);
    });

    it("reads the array-shaped cancel acknowledgement", async () => {
      use(responsesOf("cancelOrder"));
      expect(await adapter.cancelOrder(creds, "2190766863", gate("cancelOrder"))).toEqual({ orderId: "2190766863", orderStatus: "UNKNOWN" });
    });

    it("maps the order book statuses (stop orders pending a trigger, rejections with reason)", async () => {
      use(responsesOf("orderBook"));
      const { data } = await adapter.fetchOrderBook(creds);
      expect(data.map((o) => o.status)).toEqual(["OPEN", "TRIGGER_PENDING", "REJECTED"]);
      expect(data[2].statusMessage).toBe("RMS: Margin Exceeds");
      expect(data[0].placedAt).toBe("2026-10-19T11:17:29+05:30");
    });

    it("maps positions, holdings and funds", async () => {
      use([...responsesOf("positions"), ...responsesOf("holdings").slice(-1), ...responsesOf("funds").slice(-1)]);
      const pos = (await adapter.fetchPositions(creds)).data;
      expect(pos[0]).toMatchObject({ product: "MARGIN", netQty: 75, avgPrice: 25040, pnl: 4500 });
      expect(pos[1]).toMatchObject({ exchange: "NSE", product: "INTRADAY", netQty: -10, avgPrice: 2851.4 });
      const hold = (await adapter.fetchHoldings(creds)).data;
      expect(hold.find((h) => h.isin === "INE009A01021")).toMatchObject({ exchange: "BSE", token: "500209", qty: 5 });
      expect((await adapter.fetchFunds(creds)).data).toMatchObject({ availableCash: 247044.72, usedMargin: 52955.28, collateral: 50000 });
    });
  });

  describe(`${id} errors`, () => {
    it("normalises upstream errors to 502 and redacts secrets; session errors stay 422", () => {
      const e = adapter.normaliseError(new Error(`Invalid Token for ${creds.apiSecret}`), { secrets: [creds.apiSecret] });
      expect(e).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
      expect(e.message).not.toContain(creds.apiSecret);
      expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    });
  });
}
