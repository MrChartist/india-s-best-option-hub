/**
 * Shared vitest suite for the three Noren adapters (flattrade, shoonya, tradesmart). Imported by
 * flattrade.test.mjs, shoonya.test.mjs and tradesmart.test.mjs, each of which mocks the instrument cache
 * (so nothing touches .cache) before importing this file. No network: fetch is always stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cache from "../lib/instrumentCache.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { bfoRoot, encodeJData, mapCandle, mapOrderStatus, parseNorenDate, toInstrument } from "./shoonyaNorenCore.mjs";

/**
 * @param {object} o
 *  adapter, resetSessions, uidField, transport ("jKey" | "bearer"), token (the fixture session token),
 *  products (API products), noIntradayOnBFO (boolean)
 */
export function describeNorenAdapter(o) {
  const { adapter, resetSessions } = o;
  const id = adapter.id;
  const fx = loadFixtures(id);
  const creds = { ...fx.manifest.creds };
  const auth = fx.byCapability.testConnection.responses[0];
  const masters = fx.byCapability.instruments.responses.slice(1);
  const realFetch = globalThis.fetch;
  const stub = (responses) => {
    const s = createFetchStub(responses);
    globalThis.fetch = s.fetch;
    return s;
  };
  const restCall = (s) => s.calls.filter((c) => c.method === "POST" && !c.url.endsWith("/GenAcsTok") && !c.url.includes("authapi."));

  beforeEach(() => { cache.__clear(); resetSessions(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-17T05:00:00Z")); });
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

  describe(`${id} contract`, () => {
    it("is on the strict contract with no warnings", () => {
      const v = validateAdapter(adapter);
      expect(v.mode).toBe("strict");
      expect(v.errors).toEqual([]);
      expect(v.warnings).toEqual([]);
      expect(adapter.capabilities.auth.kind).toBe("requestTokenExchange");
    });

    it("passes every declared capability against the official-doc fixtures", async () => {
      const report = await runContractHarness(adapter, fx);
      expect(harnessFailures(report)).toEqual([]);
      expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed").sort());
      // expiries reads the master and session already cached by earlier capabilities.
      expect(report.results.filter((r) => !["normaliseError", "expiries"].includes(r.capability) && r.calls === 0)).toEqual([]);
    });
  });

  describe(`${id} symbol mapping`, () => {
    it("lists NIFTY weekly + monthly, SENSEX weekly, BANKEX and a stock option's expiries", async () => {
      stub([auth, ...masters]);
      expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
      expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
      expect((await adapter.fetchExpiryList(creds, "BANKEX")).data).toEqual(["2026-10-29"]);
      expect((await adapter.fetchExpiryList(creds, "BANKNIFTY")).data).toEqual(["2026-10-27"]);
      expect((await adapter.fetchExpiryList(creds, "RELIANCE")).data).toEqual(["2026-10-27"]);
    });

    it("keeps SENSEX50 and NIFTYNXT50 out of the canonical index chains and maps stock options", async () => {
      stub([auth, ...masters]);
      const rows = (await adapter.fetchInstruments(creds)).data;
      expect(rows.some((r) => r.tradingSymbol.startsWith("SENSEX50"))).toBe(false);
      expect(rows.some((r) => r.tradingSymbol.startsWith("NIFTYNXT50"))).toBe(false);
      expect(rows.find((r) => r.token === "106743")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, optionType: "CE", lotSize: 500, expiry: "2026-10-27", exchange: "NFO" });
      expect(rows.find((r) => r.token === "825001")).toMatchObject({ instrumentType: "OPTIDX", underlying: "SENSEX", strike: 82000, lotSize: 20, exchange: "BFO", expiry: "2026-10-22" });
      expect(rows.find((r) => r.token === "40020")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
      expect(rows.find((r) => r.token === "2885")).toMatchObject({ instrumentType: "EQ", underlying: "RELIANCE", expiry: null });
      expect(rows.filter((r) => r.instrumentType === "INDEX").map((r) => `${r.exchange}|${r.token}`)).toEqual(["NSE|26000", "NSE|26009", "NSE|26037", "NSE|26074", "BSE|1", "BSE|12"]);
    });

    it("resolves spot for indices (static tokens) and stocks (NSE EQ master row)", async () => {
      const spot = (exch, token, lp) => ({ method: "POST", urlPattern: "/GetQuotes$", expectBody: { jData: encodeJData({ uid: creds[o.uidField], exch, token }) }, json: { stat: "Ok", lp } });
      stub([auth, ...masters, spot("BSE", "1", "81234.50"), spot("NSE", "2885", "1452.10"), spot("NSE", "26074", "12950.25")]);
      expect((await adapter.fetchLTP(creds, "SENSEX")).data.last_price).toBe(81234.5);
      expect((await adapter.fetchLTP(creds, "RELIANCE")).data.last_price).toBe(1452.1);
      expect((await adapter.fetchLTP(creds, "MIDCPNIFTY")).data.last_price).toBe(12950.25);
    });

    it("parses Noren dates and BFO roots", () => {
      expect(parseNorenDate("20-OCT-2026")).toBe("2026-10-20");
      expect(parseNorenDate("5-Nov-2026")).toBe("2026-11-05");
      expect(parseNorenDate("2026-10-20")).toBeNull();
      expect(bfoRoot("SX50OPT", "SENSEX5022OCT2626900CE")).toBe("SENSEX50");
      expect(bfoRoot("BSXOPT", "SENSEX22OCT2682000CE")).toBe("SENSEX");
      expect(bfoRoot("SENSEX", "anything")).toBe("SENSEX");
      expect(toInstrument({ exchange: "NFO", token: "1", tradingsymbol: "X", instrument: "OPTIDX", symbol: "NIFTY", expiry: "20-OCT-2026", strike: "0", optiontype: "CE", lotsize: "65" }, "NFO")).toBeNull();
    });
  });

  describe(`${id} option chain`, () => {
    it("builds Dhan-shaped legs with OI change, bid/ask and locally solved IV in percent", async () => {
      stub(fx.byCapability.optionChain.responses);
      const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
      expect(spotPrice).toBe(25012.15);
      expect(chain.map((c) => c.strikePrice)).toEqual([24950, 25000, 25050]);
      const atm = chain.find((c) => c.strikePrice === 25000);
      expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 3165900, oiChange: 233400, volume: 5430250, bidPrice: 104.85, askPrice: 105.05 });
      expect(atm.ce.iv).toBeGreaterThan(1);
      expect(atm.ce.iv).toBeLessThan(100);
      expect(atm.pe.delta).toBeLessThan(0);
    });
  });

  describe(`${id} session and transport`, () => {
    it(o.transport === "jKey" ? "sends jData + jKey in the body (no Authorization header)" : "sends a Bearer header and a jData-only body", async () => {
      const s = stub(fx.byCapability.funds.responses);
      await adapter.fetchFunds(creds);
      const [c] = restCall(s);
      if (o.transport === "jKey") {
        expect(c.body).toContain(`&jKey=${o.token}`);
        expect(c.headers.Authorization).toBeUndefined();
      } else {
        expect(c.headers.Authorization).toBe(`Bearer ${o.token}`);
        expect(c.body).not.toContain("jKey");
        expect(c.headers["Content-Type"]).toBe("text/plain");
      }
    });

    it("exchanges the one-time code once, even under concurrent calls", async () => {
      const s = stub([auth, ...fx.byCapability.funds.responses.slice(1), ...fx.byCapability.positions.responses.slice(1)]);
      await Promise.all([adapter.fetchFunds(creds), adapter.fetchPositions(creds), adapter.fetchFunds(creds)]);
      expect(s.calls.filter((c) => c.url === auth.url)).toHaveLength(1);
    });

    it("never re-sends a code after the broker rejects the session, and refuses without a network call", async () => {
      stub([auth, { method: "POST", urlPattern: "/Limits$", json: { stat: "Not_Ok", emsg: "Session Expired : Invalid Session Key" } }]);
      await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
      const s = stub([auth, ...fx.byCapability.funds.responses]);
      await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
      expect(s.calls).toHaveLength(0);
    });

    it("maps a refused code exchange to SessionRequiredError and does not retry it", async () => {
      stub([{ ...auth, json: { stat: "Not_Ok", status: "Not_Ok", emsg: "Invalid request code" } }]);
      await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
      const s = stub([auth]);
      await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
      expect(s.calls).toHaveLength(0);
    });

    it("uses a pasted accessToken without any code exchange", async () => {
      const s = stub([{ method: "POST", urlPattern: "/Limits$", json: { stat: "Ok", cash: "1000", marginused: "250" } }]);
      const r = await adapter.fetchFunds({ [o.uidField]: creds[o.uidField], accessToken: "pastedToken" });
      expect(r.data).toMatchObject({ availableCash: 750, usedMargin: 250 });
      expect(s.calls).toHaveLength(1);
      if (o.transport === "jKey") expect(s.calls[0].body).toContain("&jKey=pastedToken");
      else expect(s.calls[0].headers.Authorization).toBe("Bearer pastedToken");
    });

    it("refuses before any download or broker call when credentials are missing", async () => {
      const s = stub([]);
      await expect(adapter.fetchExpiryList({ [o.uidField]: "X" }, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
      await expect(adapter.fetchInstruments({})).rejects.toBeInstanceOf(BrokerInputError);
      expect((await adapter.testConnection({})).status).toBe("error");
      expect(s.calls).toHaveLength(0);
    });
  });

  describe(`${id} error normalisation`, () => {
    it("maps Rate_Limited to UPSTREAM_RATE_LIMIT and other Not_Ok replies to 502, and reads 'no data' as an empty book", async () => {
      stub([auth, { method: "POST", urlPattern: "/Limits$", json: { stat: "Not_Ok", emsg: "Rate_Limited: too many requests, retry after backoff" } }]);
      await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ code: "UPSTREAM_RATE_LIMIT", statusCode: 502 });
      stub([{ method: "POST", urlPattern: "/Limits$", json: { stat: "Not_Ok", emsg: "Server Timeout :  " } }]);
      const err = await adapter.fetchFunds(creds).catch((e) => e);
      expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502, code: "UPSTREAM_ERROR" });
      stub([{ method: "POST", urlPattern: "/PositionBook$", json: { stat: "Not_Ok", request_time: "14:14:11 26-05-2020", emsg: "Error Occurred : 5 \"no data\"" } }]);
      expect((await adapter.fetchPositions(creds)).data).toEqual([]);
    });

    it("redacts secrets and keeps 422 for refusals", () => {
      expect(adapter.normaliseError(new Error("bad dummyApiSecret here"), { secrets: ["dummyApiSecret"] }).message).not.toContain("dummyApiSecret");
      expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
      expect(adapter.normaliseError(new Error("Rate_Limited"))).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    });
  });

  describe(`${id} historical`, () => {
    it("reads EODChartData rows sent as JSON strings and returns ascending epoch-second candles", async () => {
      const eod = [
        "{\"time\":\"21-SEP-2022\",\"into\":\"2496.75\",\"inth\":\"2533.00\",\"intl\":\"2495.00\",\"intc\":\"2509.75\",\"ssboe\":\"1663718400\",\"intv\":\"4249172.00\"}",
        "{\"time\":\"15-SEP-2022\",\"into\":\"2583.00\",\"inth\":\"2603.55\",\"intl\":\"2556.75\",\"intc\":\"2562.70\",\"ssboe\":\"1663200000\",\"intv\":\"4783723.00\"}",
      ];
      const s = stub([auth, ...masters, { method: "POST", urlPattern: "/EODChartData$", json: eod }]);
      const r = await adapter.fetchHistorical(creds, { instrument: { token: "2885", exchange: "NSE" }, interval: "1d", from: "2022-09-01", to: "2022-09-30" });
      expect(r.data.map((c) => c.time)).toEqual([1663200000, 1663718400]);
      expect(r.data[1]).toMatchObject({ open: 2496.75, high: 2533, low: 2495, close: 2509.75, volume: 4249172 });
      expect(restCall(s).at(-1).body).toContain(encodeJData({ uid: creds[o.uidField], sym: "NSE:RELIANCE-EQ", from: "1661970600", to: "1664562599" }));
    });

    it("builds index daily candles (NIFTY spot, not in the master) from hourly TPSeries bars", async () => {
      const bar = (time, o1, h, l, c) => ({ stat: "Ok", time, into: o1, inth: h, intl: l, intc: c, intv: "0" });
      const s = stub([auth, { method: "POST", urlPattern: "/TPSeries$", json: [
        bar("02-06-2026 15:15:00", "101", "104", "100", "103"),
        bar("02-06-2026 09:15:00", "100", "102", "99", "101"),
        bar("03-06-2026 09:15:00", "103", "105", "102", "104"),
      ] }]);
      const r = await adapter.fetchHistorical(creds, { instrument: { token: "26000", exchange: "NSE" }, interval: "1d", from: "2026-06-01", to: "2026-06-03" });
      expect(r.data).toHaveLength(2);
      expect(r.data[0]).toMatchObject({ time: 1780338600, open: 100, high: 104, low: 99, close: 103 });
      expect(r.data[1]).toMatchObject({ open: 103, close: 104 });
      expect(restCall(s).some((c) => c.url.endsWith("/EODChartData"))).toBe(false);
      expect(decodeURIComponent(restCall(s).at(-1).body)).toMatch(/"intrv":"60"/);
    });

    it("maps TPSeries times (IST) and skips empty intervals", async () => {
      expect(mapCandle({ time: "02-06-2020 15:44:23", into: "1", inth: "2", intl: "0.5", intc: "1.5", intv: "6" })).toMatchObject({ time: 1591092863, volume: 6 });
      expect(mapCandle({ time: "02-06-2020 15:46:23", into: "0.00", inth: "0.00", intl: "0.00", intc: "0.00" })).toBeNull();
      await expect(adapter.fetchHistorical(creds, { instrument: { token: "22", exchange: "NSE" }, interval: "2h", from: "2026-01-01", to: "2026-01-02" })).rejects.toBeInstanceOf(BrokerInputError);
    });
  });

  describe(`${id} orders`, () => {
    const [order, lot] = fx.byCapability.placeOrder.args;
    const uid = creds[o.uidField];

    it("maps the documented Noren order statuses", () => {
      expect(mapOrderStatus({ status: "OPEN", qty: "130", fillshares: "0" })).toBe("OPEN");
      expect(mapOrderStatus({ status: "Open", qty: "130", fillshares: "65" })).toBe("PARTIALLY_FILLED");
      expect(mapOrderStatus({ status: "TRIGGER_PENDING" })).toBe("TRIGGER_PENDING");
      expect(mapOrderStatus({ status: "COMPLETE" })).toBe("COMPLETE");
      expect(mapOrderStatus({ status: "CANCELED" })).toBe("CANCELLED");
      expect(mapOrderStatus({ status: "REJECT" })).toBe("REJECTED");
      expect(mapOrderStatus({ status: "INVALID_STATUS_TYPE" })).toBe("UNKNOWN");
    });

    it("builds the PlaceOrder body with quantity from the master lot size, strings and LMT/SL-LMT only", () => {
      expect(adapter.buildOrderBody(uid, order, lot)).toMatchObject({ exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", prc: "104.5", prd: "M", trantype: "B", prctyp: "LMT", ret: "DAY", ordersource: "API" });
      expect(adapter.buildOrderBody(uid, { ...order, lotSize: 1 }, lot).qty).toBe("130");
      expect(() => adapter.buildOrderBody(uid, order)).toThrow(/resolved lot size/);
      expect(() => adapter.buildOrderBody(uid, { ...order, orderType: "MARKET" }, lot)).toThrow(BrokerInputError);
      expect(() => adapter.buildOrderBody(uid, { ...order, orderType: "STOP_LOSS_MARKET", triggerPrice: 100 }, lot)).toThrow(/market orders/);
      expect(adapter.buildOrderBody(uid, { ...order, orderType: "STOP_LOSS", triggerPrice: 100 }, lot)).toMatchObject({ prctyp: "SL-LMT", trgprc: "100" });
      expect(() => adapter.buildOrderBody(uid, { ...order, orderType: "STOP_LOSS" }, lot)).toThrow(/triggerPrice/);
      expect(() => adapter.buildOrderBody(uid, { ...order, product: "BO" }, lot)).toThrow(BrokerInputError);
      expect(() => adapter.buildOrderBody(uid, { ...order, lots: 1.5 }, lot)).toThrow(/lots/);
      expect(() => adapter.buildOrderBody(uid, { ...order, validity: "GTC" }, lot)).toThrow(/validity/);
      const mtf = () => adapter.buildOrderBody(uid, { ...order, product: "MTF", exchange: "NSE", tradingSymbol: "M&M-EQ" }, 1);
      if (o.products.includes("MTF")) expect(mtf()).toMatchObject({ prd: "F", tsym: "M&M-EQ" });
      else expect(mtf).toThrow(BrokerInputError);
      const bfoMis = () => adapter.buildOrderBody(uid, { ...order, exchange: "BFO", tradingSymbol: "SENSEX22OCT2682000CE", product: "INTRADAY" }, 20);
      if (o.noIntradayOnBFO) expect(bfoMis).toThrow(/not accepted on BFO/);
      else expect(bfoMis()).toMatchObject({ prd: "I", exch: "BFO" });
    });

    it("escapes & in symbols so the jData body is not cut (M&M)", () => {
      expect(encodeJData({ tsym: "M&M-EQ" })).toBe("{\"tsym\":\"M\\u0026M-EQ\"}");
      expect(JSON.parse(encodeJData({ tsym: "M&M-EQ" })).tsym).toBe("M&M-EQ");
    });

    it("modifies with exch/tsym looked up from the order book when the caller omits them", async () => {
      const s = stub([auth, { method: "POST", urlPattern: "/OrderBook$", json: [{ stat: "Ok", norenordno: "26101700000017", exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", prc: "104.50", prctyp: "LMT", ret: "DAY", status: "OPEN" }] },
        { method: "POST", urlPattern: "/ModifyOrder$", json: { stat: "Ok", result: "26101700000017" } }]);
      const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "modifyOrder", brokerId: id });
      expect(await adapter.modifyOrder(creds, "26101700000017", { price: 106 }, gate)).toEqual({ orderId: "26101700000017", orderStatus: "UNKNOWN" });
      expect(restCall(s).at(-1).body).toContain(encodeJData({ uid, norenordno: "26101700000017", exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", prc: "106", prctyp: "LMT", ret: "DAY", ordersource: "API" }));
    });

    it("never sends an order without a fresh gate for this broker and action", async () => {
      const s = stub(fx.byCapability.placeOrder.responses);
      await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
      const wrongAction = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: id });
      await expect(adapter.placeOrder(creds, order, lot, wrongAction)).rejects.toBeInstanceOf(OrderGateError);
      const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "dhan" });
      await expect(adapter.placeOrder(creds, order, lot, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
      await expect(adapter.cancelOrder(creds, "1")).rejects.toBeInstanceOf(OrderGateError);
      expect(s.calls).toHaveLength(0);
    });
  });

  describe(`${id} feed`, () => {
    class FakeWs {
      static last;
      constructor(url) { this.url = url; this.readyState = 1; this.sent = []; this.handlers = {}; FakeWs.last = this; queueMicrotask(() => this.emit("open")); }
      on(ev, fn) { this.handlers[ev] = fn; }
      emit(ev, data) { this.handlers[ev]?.(data); }
      send(m) { this.sent.push(JSON.parse(m)); }
      close() { this.readyState = 3; this.emit("close"); }
    }
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("authenticates with the session token, subscribes touchline and merges tf diffs into quotes", async () => {
      stub([{ method: "POST", urlPattern: "/Limits$", json: { stat: "Ok" } }]);
      const ticks = [];
      const status = [];
      const feed = adapter.createFeed({ [o.uidField]: "FZ00000", accessToken: "wsToken" }, { onTick: (t) => ticks.push(t), onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs, heartbeatMs: 60_000 });
      feed.subscribe([{ token: "40003", exchange: "NFO" }]);
      await flush(); await flush();
      const ws = FakeWs.last;
      expect(ws.sent[0]).toEqual({ t: "a", uid: "FZ00000", actid: "FZ00000", source: "API", accesstoken: "wsToken" });
      ws.emit("message", JSON.stringify({ t: "ak", uid: "FZ00000", s: "Ok" }));
      expect(ws.sent[1]).toEqual({ t: "t", k: "NFO|40003" });
      ws.emit("message", JSON.stringify({ t: "tk", e: "NFO", tk: "40003", lp: "104.95", o: "98.00", h: "110.00", l: "95.10", c: "99.40", v: "5430250", oi: "3165900", bp1: "104.85", sp1: "105.05" }));
      ws.emit("message", JSON.stringify({ t: "tf", e: "NFO", tk: "40003", lp: "105.20" }));
      expect(ticks.at(-1)).toEqual({ token: "40003", exchange: "NFO", ltp: 105.2, open: 98, high: 110, low: 95.1, close: 99.4, volume: 5430250, oi: 3165900, bid: 104.85, ask: 105.05 });
      feed.unsubscribe([{ token: "40003", exchange: "NFO" }]);
      expect(ws.sent.at(-1)).toEqual({ t: "u", k: "NFO|40003" });
      feed.close();
      expect(status[0]).toEqual({ connected: true });
    });

    it("stops for good when the connect ack is Not_Ok", async () => {
      const status = [];
      adapter.createFeed({ [o.uidField]: "FZ00000", accessToken: "deadToken" }, { onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
      await flush(); await flush();
      const ws = FakeWs.last;
      ws.emit("message", JSON.stringify({ t: "ak", s: "Not_Ok" }));
      await flush();
      expect(status.at(-1)).toMatchObject({ connected: false });
      expect(FakeWs.last).toBe(ws); // no reconnect
    });
  });
}
