/**
 * Shared vitest suite for the three XTS adapters (compositedge, ibulls, jainamxts). Each <id>.test.mjs
 * mocks ../lib/instrumentCache.mjs (so nothing touches .cache) and calls describeXtsAdapter(). No network:
 * every fetch is answered from server/brokers/__fixtures__/<id>/ or fails the test.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrokerInputError, OrderGateError, SessionRequiredError, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { checkOptionChain, toOptionData } from "./contractShapes.mjs";
import { buildModifyBody, buildOrderBody, mapOrderStatus, parseFoMaster, parseOhlc, underlyingCashToken } from "./compositedgeXtsCore.mjs";

/**
 * @param {object} o
 * @param {object} o.adapter          the broker module
 * @param {() => void} o.clearCache   clears the mocked instrument cache
 * @param {"keyPair"|"requestToken"} o.interactiveMode
 */
export function describeXtsAdapter({ adapter, clearCache, interactiveMode }) {
  const id = adapter.id;
  const fx = loadFixtures(id);
  const creds = fx.manifest.creds;
  const { MD, IA } = adapter.BASE_URLS;
  let realFetch;
  let stub;

  const useResponses = (responses) => {
    stub = createFetchStub(responses);
    globalThis.fetch = stub.fetch;
    return stub;
  };

  beforeEach(() => {
    realFetch = globalThis.fetch;
    adapter.resetForTests({ intervalMs: 0 });
    clearCache();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe(`${id} adapter contract`, () => {
    it("passes the strict contract with no warnings", () => {
      const v = validateAdapter(adapter);
      expect(v.mode).toBe("strict");
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      expect(adapter.capabilities.auth.kind).toBe(interactiveMode === "requestToken" ? "requestTokenExchange" : "apiKeyToken");
    });

    it("meets every declared capability against the official-doc fixtures", async () => {
      const report = await runContractHarness(adapter, fx);
      expect(harnessFailures(report)).toEqual([]);
      expect(report.results.map((r) => r.capability)).toEqual(expect.arrayContaining([
        "testConnection", "instruments", "expiries", "optionChain", "ltp", "quotes", "depth", "historical",
        "positions", "holdings", "funds", "orderBook", "tradeBook", "placeOrder", "modifyOrder", "cancelOrder", "normaliseError",
      ]));
    });

    it("pins every request to the broker's own host", async () => {
      useResponses(fx.byCapability.optionChain.responses);
      await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
      const host = new URL(MD).origin;
      expect(stub.calls.length).toBeGreaterThan(0);
      for (const c of stub.calls) expect(new URL(c.url).origin).toBe(host);
    });
  });

  describe(`${id} symbol mapping`, () => {
    it("lists NIFTY weekly and monthly expiries in ascending ISO order", async () => {
      useResponses(fx.byCapability.expiries.responses);
      const r = await adapter.fetchExpiryList(creds, "NIFTY");
      expect(r.data).toEqual(["2026-10-20", "2026-10-27"]);
    });

    it("builds the NIFTY weekly chain from master + 1502 + 1510 with spot from the index list", async () => {
      useResponses(fx.byCapability.optionChain.responses);
      const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
      expect(checkOptionChain(r, { minStrikes: 3 })).toEqual([]);
      expect(Object.keys(r.data.oc).sort()).toEqual(["24900", "25000", "25100"]);
      expect(r.data.last_price).toBe(25012.35);
      const atm = r.data.oc["25000"];
      expect(atm.ce).toMatchObject({ last_price: 118.9, volume: 3389250, bid_price: 118.75, ask_price: 119, security_id: "40003" });
      expect(atm.ce.oi).toBeGreaterThan(0);
      expect(atm.pe.last_price).toBe(98.35);
      const opt = toOptionData(r);
      expect(opt.chain.find((s) => s.strikePrice === 25000).ce.iv).toBeGreaterThan(1); // percent, back-solved
      // the spot quote is a separate 1502 call on NSECM (segment 1), token 26000
      const spotCall = stub.calls.find((c) => c.url.endsWith("/instruments/quotes") && JSON.parse(c.body).instruments[0].exchangeInstrumentID === 26000);
      expect(JSON.parse(spotCall.body)).toMatchObject({ xtsMessageCode: 1502, publishFormat: "JSON", instruments: [{ exchangeSegment: 1 }] });
    });

    it("keeps the NIFTY monthly chain separate from the weekly one", async () => {
      useResponses(fx.byCapability.optionChain.responses);
      const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-27");
      expect(Object.keys(r.data.oc)).toEqual(["25000"]);
      expect(r.data.oc["25000"].ce.last_price).toBe(236.5);
    });

    it("maps SENSEX weekly options from the BSEFO master (series IO) with the BSE index spot", async () => {
      const f = fx.byCapability.optionChainSensex;
      useResponses(f.responses);
      const exp = await adapter.fetchExpiryList(creds, "SENSEX");
      expect(exp.data).toEqual(["2026-10-22"]);
      const r = await adapter.fetchOptionChain(creds, ...f.args);
      expect(checkOptionChain(r, f.expect)).toEqual([]);
      expect(r.data.last_price).toBe(82044.7);
      expect(r.data.oc["82000"].pe.last_price).toBe(365.8);
      const legCall = stub.calls.find((c) => c.url.endsWith("/instruments/quotes") && JSON.parse(c.body).instruments[0].exchangeSegment === 12);
      expect(legCall).toBeTruthy();
    });

    it("maps BANKEX (BSEFO, series OPTIDX)", async () => {
      useResponses(fx.byCapability.optionChain.responses);
      expect((await adapter.fetchExpiryList(creds, "BANKEX")).data).toEqual(["2026-10-29"]);
      const ltp = await adapter.fetchLTP(creds, "BANKEX");
      expect(ltp.data.last_price).toBe(63120.45);
    });

    it("builds a stock option chain with the spot taken from UnderlyingInstrumentId", async () => {
      const f = fx.byCapability.optionChainStock;
      useResponses(f.responses);
      const r = await adapter.fetchOptionChain(creds, ...f.args);
      expect(r.data.last_price).toBe(1412.6);
      expect(r.data.oc["1400"].ce.last_price).toBe(31.45);
      expect(underlyingCashToken("1100100002885")).toBe("2885");
    });

    it("maps instruments: canonical index derivatives, stock F&O, indices; drops non-canonical index options", async () => {
      useResponses(fx.byCapability.instruments.responses);
      const { data } = await adapter.fetchInstruments(creds);
      expect(data.some((i) => i.underlying === "NIFTYNXT50")).toBe(false);
      expect(data.find((i) => i.token === "40003")).toEqual({
        token: "40003", exchange: "NFO", tradingSymbol: "NIFTY26O2025000CE", underlying: "NIFTY", instrumentType: "OPTIDX",
        expiry: "2026-10-20", strike: 25000, optionType: "CE", lotSize: 75, tickSize: 0.05,
      });
      expect(data.find((i) => i.token === "40021")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null, expiry: "2026-10-27" });
      expect(data.find((i) => i.token === "50001")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
      expect(data.find((i) => i.token === "1140001")).toMatchObject({ exchange: "BFO", instrumentType: "OPTIDX", underlying: "SENSEX" });
      expect(data.find((i) => i.instrumentType === "INDEX" && i.underlying === "NIFTY")).toMatchObject({ token: "26000", exchange: "NSE" });
      expect(data.find((i) => i.instrumentType === "INDEX" && i.underlying === "SENSEX")).toMatchObject({ token: "26065", exchange: "BSE" });
    });

    it("rejects malformed symbols before any network call", async () => {
      useResponses([]);
      await expect(adapter.fetchExpiryList(creds, "nifty 50; drop")).rejects.toBeInstanceOf(BrokerInputError);
      expect(stub.calls).toHaveLength(0);
    });
  });

  describe(`${id} market data details`, () => {
    it("returns 5-level depth from the 1502 Bids/Asks", async () => {
      useResponses(fx.byCapability.depth.responses);
      const r = await adapter.fetchDepth(creds, { token: "40003", exchange: "NFO" });
      expect(r.data.bids).toHaveLength(5);
      expect(r.data.bids[0]).toEqual({ price: 118.75, qty: 975, orders: 3 });
      expect(r.data.asks[0]).toEqual({ price: 119, qty: 525, orders: 1 });
    });

    it("converts OHLC epochs (IST wall clock) to real epoch seconds", async () => {
      const f = fx.byCapability.historical;
      useResponses(f.responses);
      const r = await adapter.fetchHistorical(creds, ...f.args);
      expect(r.data[0]).toMatchObject({ time: Date.parse("2026-10-16T09:15:00+05:30") / 1000, open: 121.5, close: 119.9, volume: 112500, oi: 3221625 });
      expect(parseOhlc("1792108800|1|2|0.5|1.5|10|0|", "1d")[0].time).toBe(Date.parse("2026-10-16T00:00:00+05:30") / 1000);
    });

    it("refuses unsupported candle intervals", async () => {
      useResponses([]);
      await expect(adapter.fetchHistorical(creds, { instrument: { token: "40003", exchange: "NFO" }, interval: "2h", from: "2026-10-16", to: "2026-10-16" })).rejects.toBeInstanceOf(BrokerInputError);
      expect(stub.calls).toHaveLength(0);
    });

    it("re-logs in once when the market-data token is rejected (e-token-0005)", async () => {
      const responses = fx.byCapability.ltp.responses;
      let rejected = false;
      const base = createFetchStub(responses);
      const calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push(url);
        if (!rejected && String(url).endsWith("/instruments/quotes")) {
          rejected = true;
          return new Response(JSON.stringify({ type: "error", code: "e-token-0005", description: "Invalid Token" }), { status: 400 });
        }
        return base.fetch(url, init);
      };
      const r = await adapter.fetchLTP(creds, "NIFTY");
      expect(r.data.last_price).toBe(25012.35);
      expect(calls.filter((u) => u.endsWith("/auth/login"))).toHaveLength(2);
    });

    it("spaces market-data calls at the configured interval (official limit: 1 request/second)", async () => {
      adapter.resetForTests({ intervalMs: 40 });
      useResponses(fx.byCapability.ltp.responses);
      await adapter.fetchLTP(creds, "NIFTY"); // warms index list + session
      const t0 = Date.now();
      await adapter.fetchLTP(creds, "NIFTY");
      await adapter.fetchLTP(creds, "NIFTY");
      expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
    });

    it("refuses to log in without the Market Data keys, before any network call", async () => {
      useResponses([]);
      await expect(adapter.fetchLTP({}, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
      expect(stub.calls).toHaveLength(0);
      const t = await adapter.testConnection({});
      expect(t.status).toBe("error");
    });

    it("testConnection reports a failed login without echoing the keys", async () => {
      useResponses([{ method: "POST", url: `${MD}/auth/login`, status: 400, json: { type: "error", code: "e-user-0001", description: "Invalid appKey or secretKey" } }]);
      const t = await adapter.testConnection(creds);
      expect(t.status).toBe("error");
      for (const v of Object.values(creds)) expect(t.message).not.toContain(v);
    });
  });

  describe(`${id} portfolio and orders`, () => {
    it("maps order statuses from the official order states", () => {
      expect(mapOrderStatus("New", "Limit")).toBe("OPEN");
      expect(mapOrderStatus("PendingNew", "Market")).toBe("OPEN");
      expect(mapOrderStatus("New", "StopLimit")).toBe("TRIGGER_PENDING");
      expect(mapOrderStatus("PartiallyFilled", "Limit")).toBe("PARTIALLY_FILLED");
      expect(mapOrderStatus("Filled", "Limit")).toBe("COMPLETE");
      expect(mapOrderStatus("Cancelled", "Limit")).toBe("CANCELLED");
      expect(mapOrderStatus("Rejected", "Limit")).toBe("REJECTED");
      expect(mapOrderStatus("Weird", "Limit")).toBe("UNKNOWN");
    });

    it("normalises the order book, positions, holdings and funds", async () => {
      useResponses([...fx.byCapability.orderBook.responses, ...fx.byCapability.positions.responses.slice(1), ...fx.byCapability.holdings.responses.slice(1), ...fx.byCapability.funds.responses.slice(1)]);
      const orders = (await adapter.fetchOrderBook(creds)).data;
      expect(orders.map((o) => o.status)).toEqual(["OPEN", "TRIGGER_PENDING", "COMPLETE", "REJECTED"]);
      expect(orders[0]).toMatchObject({ orderId: "648468730", exchange: "NFO", token: "40003", product: "MARGIN", qty: 75, pendingQty: 75, placedAt: "2026-10-16T11:17:29+05:30" });
      expect(orders[3].statusMessage).toBe("RMS:Margin Exceeds");
      const positions = (await adapter.fetchPositions(creds)).data;
      expect(positions[0]).toMatchObject({ netQty: 75, avgPrice: 118.45, product: "MARGIN", exchange: "NFO", pnl: 33.75 });
      expect(positions[1]).toMatchObject({ netQty: -20, avgPrice: 370.1, product: "INTRADAY", exchange: "BFO" });
      const holdings = (await adapter.fetchHoldings(creds)).data;
      expect(holdings[0]).toMatchObject({ isin: "INE002A01018", exchange: "NSE", token: "2885", qty: 10, avgPrice: 1290.5 });
      const funds = (await adapter.fetchFunds(creds)).data;
      expect(funds).toEqual({ availableCash: 209544.72, usedMargin: 52955.278, totalBalance: 250000, collateral: 12500, withdrawable: null });
    });

    it("builds documented order bodies and refuses anything it cannot map", () => {
      expect(buildOrderBody({ exchange: "NFO", token: "40004", transactionType: "SELL", orderType: "SL", product: "INTRADAY", lots: 1, price: 90, triggerPrice: 92, tag: "leg-1 hedge" }, 75)).toEqual({
        exchangeSegment: "NSEFO", exchangeInstrumentID: 40004, productType: "MIS", orderType: "StopLimit", orderSide: "SELL", timeInForce: "DAY",
        disclosedQuantity: 0, orderQuantity: 75, limitPrice: 90, stopPrice: 92, orderUniqueIdentifier: "leg1hedge",
      });
      expect(buildOrderBody({ exchange: "BFO", token: "1140001", transactionType: "BUY", orderType: "MARKET", product: "CNC", validity: "IOC", lots: 3 }, 20)).toMatchObject({
        exchangeSegment: "BSEFO", orderType: "Market", productType: "CNC", timeInForce: "IOC", orderQuantity: 60, limitPrice: 0, stopPrice: 0,
      });
      expect(() => buildOrderBody({ exchange: "NFO", token: "40003", transactionType: "BUY", orderType: "LIMIT", product: "MTF", lots: 1, price: 1 }, 75)).toThrow(BrokerInputError);
      expect(() => buildOrderBody({ exchange: "NFO", token: "40003", transactionType: "BUY", orderType: "LIMIT", lots: 1, price: 1 }, undefined)).toThrow(/lot size/);
      expect(() => buildOrderBody({ exchange: "NFO", token: "40003", transactionType: "BUY", orderType: "LIMIT", lots: 1.5, price: 1 }, 75)).toThrow(/lots/);
      expect(() => buildOrderBody({ exchange: "XYZ", token: "40003", transactionType: "BUY", orderType: "LIMIT", lots: 1, price: 1 }, 75)).toThrow(/exchange/);
      expect(() => buildModifyBody("648468730", { orderType: "LIMIT", product: "MARGIN", price: 10 })).toThrow(/quantity/);
      expect(() => buildModifyBody("12ab", { orderType: "LIMIT", product: "MARGIN", quantity: 75, price: 10 })).toThrow(/order id/);
    });

    it("never sends an order without a fresh gate, and a gate works only once", async () => {
      const f = fx.byCapability.placeOrder;
      useResponses(f.responses);
      await expect(adapter.placeOrder(creds, ...f.args)).rejects.toBeInstanceOf(OrderGateError);
      await expect(adapter.placeOrder(creds, ...f.args, { action: "placeOrder", brokerId: id })).rejects.toBeInstanceOf(OrderGateError);
      const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "dhan" });
      await expect(adapter.placeOrder(creds, ...f.args, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
      const cancelGate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: id });
      await expect(adapter.placeOrder(creds, ...f.args, cancelGate)).rejects.toBeInstanceOf(OrderGateError);
      expect(stub.calls).toHaveLength(0);
      const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: id });
      expect(await adapter.placeOrder(creds, ...f.args, gate)).toEqual({ orderId: "648468734", orderStatus: "UNKNOWN" });
      await expect(adapter.placeOrder(creds, ...f.args, gate)).rejects.toBeInstanceOf(OrderGateError);
      expect(stub.calls.filter((c) => c.url === `${IA}/orders`)).toHaveLength(1);
    });

    it("does not retry an order when the trading token is rejected", async () => {
      const f = fx.byCapability.placeOrder;
      useResponses([f.responses[0], { method: "POST", url: `${IA}/orders`, status: 400, json: { type: "error", code: "e-token-0005", description: "Invalid Token" } }]);
      const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: id });
      const err = await adapter.placeOrder(creds, ...f.args, gate).catch((e) => e);
      if (interactiveMode === "requestToken") expect(err).toBeInstanceOf(SessionRequiredError);
      else expect(err.code).toBe("UPSTREAM_AUTH");
      expect(stub.calls.filter((c) => c.url === `${IA}/orders`)).toHaveLength(1);
    });

    it("sends clientID only for dealer logins, and asks for it when missing", async () => {
      const dealerLogin = { ...fx.byCapability.positions.responses[0], json: { ...fx.byCapability.positions.responses[0].json, result: { ...fx.byCapability.positions.responses[0].json.result, isInvestorClient: false } } };
      useResponses([dealerLogin, { method: "GET", url: `${IA}/portfolio/positions?dayOrNet=NetWise&clientID=CLIENT9`, json: fx.byCapability.positions.responses[1].json }]);
      await expect(adapter.fetchPositions(creds)).rejects.toBeInstanceOf(BrokerInputError);
      const r = await adapter.fetchPositions({ ...creds, clientId: "CLIENT9" });
      expect(r.data).toHaveLength(2);
    });

    it("asks for the Interactive keys before any trading call", async () => {
      useResponses([]);
      const err = await adapter.fetchFunds({ ...creds, interactiveApiKey: "" }).catch((e) => e);
      expect(err).toBeInstanceOf(BrokerInputError);
      expect(err.message).toContain("interactiveApiKey");
      expect(stub.calls).toHaveLength(0);
    });

    if (interactiveMode === "requestToken") {
      it("treats a rejected or reused request token as 'log in again' (422), without a second exchange", async () => {
        useResponses([{ method: "POST", url: `${IA}/user/session`, status: 400, json: { type: "error", code: "e-user-0002", description: "Invalid accessToken" } }]);
        const err = await adapter.fetchFunds(creds).catch((e) => e);
        expect(err).toBeInstanceOf(SessionRequiredError);
        expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
        const again = await adapter.fetchFunds(creds).catch((e) => e);
        expect(again).toBeInstanceOf(SessionRequiredError);
        expect(stub.calls).toHaveLength(1);
      });
    } else {
      it("re-opens the trading session once on a token rejection for read calls", async () => {
        const login = fx.byCapability.funds.responses[0];
        let first = true;
        const base = createFetchStub(fx.byCapability.funds.responses);
        const calls = [];
        globalThis.fetch = async (url, init) => {
          calls.push(url);
          if (first && String(url).endsWith("/user/balance")) {
            first = false;
            return new Response(JSON.stringify({ type: "error", code: "e-token-0005", description: "Invalid Token" }), { status: 400 });
          }
          return base.fetch(url, init);
        };
        expect(login.url).toBe(`${IA}/user/session`);
        const r = await adapter.fetchFunds(creds);
        expect(r.data.availableCash).toBe(209544.72);
        expect(calls.filter((u) => u.endsWith("/user/session"))).toHaveLength(2);
      });
    }
  });

  describe(`${id} errors`, () => {
    it("normalises upstream errors to 502 and redacts secrets", () => {
      const out = adapter.normaliseError(new Error(`bad key ${creds.interactiveApiSecret}`), { secrets: [creds.interactiveApiSecret] });
      expect(out.statusCode).toBe(502);
      expect(out.message).not.toContain(creds.interactiveApiSecret);
      expect(adapter.normaliseError(new Error("Invalid Token")).code).toBe("UPSTREAM_AUTH");
      expect(adapter.normaliseError(new BrokerInputError("x")).statusCode).toBe(422);
    });
  });
}

/** Pure parser checks shared by the three suites (run once from compositedge.test.mjs). */
export function describeXtsParsers() {
  describe("XTS master parser", () => {
    it("reads the documented F&O layout and skips malformed rows", () => {
      const rows = parseFoMaster([
        "NSEFO|64024|2|IDEA|IDEA22NOV12PE|OPTSTK|IDEA-OPTSTK|2114700061211|16739.8|13696.2|5001|0.05|70000|1|1100100014366|IDEA|2022-11-24T14:30:00|12|4|IDEA 24NOV2022 PE 12|1|1",
        "garbage",
        "NSEFO|1|2|X|X|OPTSTK|X|1|1|1|1|0.05|1|1|1|X|not-a-date|10|3|X|1|1",
      ].join("\n"));
      expect(rows).toEqual([{ seg: "NSEFO", token: "64024", name: "IDEA", sym: "IDEA22NOV12PE", series: "OPTSTK", tick: 0.05, lot: 70000, und: "1100100014366", expiry: "2022-11-24", strike: 12, opt: "PE" }]);
    });
  });
}
