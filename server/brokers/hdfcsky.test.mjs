/**
 * HDFC Sky adapter: contract harness over every declared capability, symbol mapping from the security
 * master, candle parsing/resampling, order bodies, error normalisation, the order gate and the feed.
 * No network: fetch is stubbed, the WebSocket snapshot is replaced and the feed runs on a fake socket.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as adapter from "./hdfcsky.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { expiryToIso, parseCsv, toInstrument } from "./hdfcskyInstruments.mjs";
import { chartParams, istToEpoch, parseCandles, resample } from "./hdfcskyHistory.mjs";
import { buildModifyBody, buildOrderBody } from "./hdfcskyOrders.mjs";
import { fundsTable, orderStatusOf } from "./hdfcskyPortfolio.mjs";
import { getClientId } from "./hdfcskyClient.mjs";
import { setHdfcWebSocketImpl } from "./hdfcsecuritiesFeed.mjs";

const fx = loadFixtures("hdfcsky");
const realFetch = globalThis.fetch;
const MASTER = parseCsv(fx.byCapability.instruments.responses[0].text);
const row = (token) => MASTER.find((r) => r.exchange_token === token);

async function withFetch(responses, fn) {
  const stub = createFetchStub(responses);
  globalThis.fetch = stub.fetch;
  try {
    return { value: await fn(), calls: stub.calls };
  } catch (error) {
    return { error, calls: stub.calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const fakeTicks = new Map([
  ["51630", { token: 51630, ltp: 182.4, oi: 2210000, volume: 120500, depth: { buy: [{ price: 182.3, quantity: 650, orders: 4 }], sell: [{ price: 182.6, quantity: 130, orders: 1 }] } }],
]);

beforeEach(() => {
  adapter.resetHdfcSkyInstrumentCache();
  adapter.setHdfcSkySnapshotForTests(async (_c, scripIds) => new Map(scripIds.map((s) => s.slice(s.lastIndexOf("_") + 1)).filter((t) => fakeTicks.has(t)).map((t) => [t, fakeTicks.get(t)])));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  adapter.setHdfcSkySnapshotForTests(null);
  setHdfcWebSocketImpl(null);
});

describe("hdfcsky contract", () => {
  it("passes strict validation with no warnings", () => {
    const v = validateAdapter(adapter);
    expect(v).toMatchObject({ ok: true, mode: "strict", errors: [] });
    expect(v.warnings).toEqual([]);
  });

  it("every declared capability returns the normalised shape from its fixture", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability);
    for (const cap of declaredCapabilities(adapter)) {
      if (cap === "auth" || cap === "feed") continue;
      expect(covered).toContain(cap);
    }
  });

  it("reads the client id from the access token's JWT sub claim", () => {
    expect(getClientId(fx.manifest.creds)).toBe("DEMO1");
    expect(getClientId({ accessToken: "not-a-jwt" })).toBe("");
  });
});

describe("hdfcsky symbol mapping", () => {
  it("maps NIFTY monthly and weekly options (NFO) and the SENSEX weekly (BFO, instrument_name IO)", () => {
    expect(toInstrument(row("51630"))).toEqual({
      token: "51630", exchange: "NFO", tradingSymbol: "NIFTY26OCT25000CE", underlying: "NIFTY", instrumentType: "OPTIDX",
      expiry: "2026-10-27", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05,
    });
    expect(toInstrument(row("45508"))).toMatchObject({ expiry: "2026-11-03", tradingSymbol: "NIFTY26N0325000CE" });
    expect(toInstrument(row("1163250"))).toMatchObject({ exchange: "BFO", underlying: "SENSEX", instrumentType: "OPTIDX", expiry: "2026-10-29", lotSize: 20 });
  });

  it("maps a stock option and cash row, canonical index names, and drops MCX and sentinel rows", () => {
    expect(toInstrument(row("36343"))).toMatchObject({ underlying: "RELIANCE", instrumentType: "OPTSTK", strike: 1400, lotSize: 500 });
    expect(toInstrument(row("2885"))).toMatchObject({ exchange: "NSE", tradingSymbol: "RELIANCE-EQ", underlying: "RELIANCE", instrumentType: "EQ", expiry: null });
    const indices = MASTER.map(toInstrument).filter((i) => i?.instrumentType === "INDEX").map((i) => `${i.exchange}:${i.underlying}`);
    expect(indices).toEqual(["NSE:NIFTY", "NSE:BANKNIFTY", "NSE:FINNIFTY", "NSE:MIDCPNIFTY", "NSE:NIFTYINFRA", "BSE:SENSEX", "BSE:BANKEX"]);
    expect(toInstrument(row("222895"))).toBeNull();
    expect(toInstrument(row("99999"))).toBeNull();
    expect([expiryToIso("03-Nov-2026"), expiryToIso("01-Jan-0001")]).toEqual(["2026-11-03", null]);
  });

  it("builds the option chain with legs priced under NFO and OI/depth from the feed", async () => {
    const r = await withFetch(fx.byCapability.optionChain.responses, () => adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-27"));
    const puts = r.calls.filter((c) => c.method === "PUT").map((c) => JSON.parse(c.body).data.map((d) => d.exchange));
    expect(puts).toEqual([["NSE_INDEX"], ["NFO", "NFO", "NFO", "NFO"]]);
    expect(r.value.data.oc["25000"].ce).toMatchObject({ last_price: 182.4, oi: 2210000, volume: 120500, bid_price: 182.3, ask_price: 182.6 });
    expect(r.value.data.oc["25100"].pe.last_price).toBe(190.3);
  });
});

describe("hdfcsky historical", () => {
  it("uses the series-free symbol for cash, trading symbol + instrument_name for BFO, segment for indices", () => {
    expect(chartParams(row("2885"))).toEqual({ symbol: "RELIANCE", exchange: "NSE", seriesType: "EQ" });
    expect(chartParams(row("1163250"))).toEqual({ symbol: "SENSEX26O2982000CE", exchange: "BFO", seriesType: "IO" });
    expect(chartParams(row("26000"))).toEqual({ symbol: "NIFTY", exchange: "NSE", seriesType: "INDICES" });
  });

  it("sorts the docs' out-of-order daily sample and reads IST timestamps", () => {
    const rows = fx.byCapability.historical.responses[1].json.data.results;
    const candles = parseCandles(rows);
    expect(candles.map((c) => c.close)).toEqual([4306.25, 4015.5, 4156.6001, 4073.1499]);
    expect(istToEpoch("22-10-2024 09:15")).toBe(Date.UTC(2024, 9, 22, 3, 45) / 1000);
  });

  it("aggregates 1-minute candles into 5-minute buckets anchored at 09:15 IST", () => {
    const t0 = istToEpoch("22-10-2024 09:15");
    const ones = Array.from({ length: 7 }, (_, i) => ({ time: t0 + i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10, oi: i }));
    expect(resample(ones, 5)).toEqual([
      { time: t0, open: 100, high: 105, low: 99, close: 104.5, volume: 50, oi: 4 },
      { time: t0 + 300, open: 105, high: 107, low: 104, close: 106.5, volume: 20, oi: 6 },
    ]);
  });

  it("refuses an unsupported interval before any call", async () => {
    const r = await withFetch([], () => adapter.fetchHistorical(fx.manifest.creds, { instrument: { token: "2885", exchange: "NSE" }, interval: "2h", from: "2025-01-01", to: "2025-01-02" }));
    expect(r.error).toBeInstanceOf(BrokerInputError);
    expect(r.calls).toEqual([]);
  });
});

describe("hdfcsky orders", () => {
  it("builds a BFO SENSEX stop-loss body with lots x lot size and SL-M mapped to SLM", () => {
    expect(buildOrderBody("DEMO1", { exchange: "BFO", token: "1163250", side: "SELL", product: "INTRADAY", orderType: "SL-M", lots: 2, triggerPrice: 505 }, 20, { userOrderId: 7 })).toEqual({
      exchange: "BFO", instrument_token: "1163250", client_id: "DEMO1", order_type: "SLM", amo: false, price: 0, trigger_price: 505, quantity: 40,
      disclosed_quantity: 0, validity: "DAY", product: "MIS", order_side: "SELL", device: "WEB", user_order_id: 7, execution_type: "REGULAR",
    });
  });

  it("refuses CNC on derivatives, NRML on cash, a missing limit price and a missing lot size", () => {
    const base = { exchange: "NFO", token: "51630", side: "BUY", orderType: "LIMIT", lots: 1, price: 10 };
    expect(() => buildOrderBody("DEMO1", { ...base, product: "CNC" }, 65)).toThrow(BrokerInputError);
    expect(() => buildOrderBody("DEMO1", { ...base, exchange: "NSE", product: "MARGIN" }, 1)).toThrow(BrokerInputError);
    expect(() => buildOrderBody("DEMO1", { ...base, product: "MARGIN", price: 0 }, 65)).toThrow(/price/);
    expect(() => buildOrderBody("DEMO1", { ...base, product: "MARGIN" }, undefined)).toThrow(/resolvedLotSize/);
  });

  it("builds a modify body from the pending order (product and instrument unchanged)", () => {
    const pending = fx.byCapability.orderBook.responses[0].json.data.orders[0];
    expect(buildModifyBody("DEMO1", pending, { quantity: 2 })).toMatchObject({ instrument_token: "10666", product: "MIS", quantity: 2, price: 27.8, oms_order_id: "200018000000003" });
  });

  it("maps OMS statuses", () => {
    expect([orderStatusOf("CONFIRMED"), orderStatusOf("COMPLETE"), orderStatusOf("CANCEL_CONFIRMED"), orderStatusOf("SL_TRIGGER_CONFIRMED"), orderStatusOf("CONFIRMED", 1, 1), orderStatusOf("WHO_KNOWS")])
      .toEqual(["OPEN", "COMPLETE", "CANCELLED", "TRIGGER_PENDING", "PARTIALLY_FILLED", "UNKNOWN"]);
  });

  it("classifies statuses by their words, and keeps an order working when only a modify/cancel request failed", () => {
    const cases = {
      REJECTED: "REJECTED", BRACKET_ORDER_REJECTED: "REJECTED",
      MODIFY_REJECTED: "OPEN", CANCEL_REJECTED: "OPEN",
      CANCELLED: "CANCELLED", AMO_CANCEL_CONFIRMED: "CANCELLED",
      CANCEL_PENDING: "OPEN", CANCEL_ACCEPTED: "OPEN",
      PARTIAL_TRADE: "PARTIALLY_FILLED", TRIGGER_PENDING: "TRIGGER_PENDING", EXPIRED: "EXPIRED",
      AMO_REQ_RECEIVED: "OPEN", MODIFY_PENDING: "OPEN", RMS_VALIDATION_COMPLETED: "OPEN", "": "UNKNOWN",
    };
    for (const [status, want] of Object.entries(cases)) expect(orderStatusOf(status), status).toBe(want);
  });

  it("maps every order_status that appears in the doc-sample fixtures to a known state", () => {
    const seen = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (k === "order_status" ? seen.add(x) : walk(x));
    };
    walk(Object.values(fx.byCapability).map((c) => c.responses));
    expect(seen.size).toBeGreaterThan(0);
    for (const s of seen) expect(orderStatusOf(s), s).not.toBe("UNKNOWN");
  });

  it("refuses every order call without a valid gate, before any network call", async () => {
    for (const [fn, args] of [[adapter.placeOrder, fx.byCapability.placeOrder.args], [adapter.modifyOrder, ["1", {}]], [adapter.cancelOrder, ["1"]]]) {
      const r = await withFetch([], () => fn(fx.manifest.creds, ...args));
      expect(r.error).toBeInstanceOf(OrderGateError);
      expect(r.calls).toEqual([]);
    }
  });
});

describe("hdfcsky funds and errors", () => {
  it("reads funds rows in both the documented {0,1} shape and [label, value] pairs", () => {
    expect(fundsTable([{ 0: "Available Margin", 1: "10.5" }]).get("availablemargin")).toBe(10.5);
    expect(fundsTable([["Margin Used", "2.25"]]).get("marginused")).toBe(2.25);
  });

  it("falls back to funds v1 when v2 answers 404", async () => {
    const v1 = { ...fx.byCapability.funds.responses[0], url: fx.byCapability.funds.responses[0].url.replace("/v2/", "/v1/") };
    const r = await withFetch([{ method: "GET", urlPattern: "/oapi/v2/funds/view", status: 404, text: "" }, v1], () => adapter.fetchFunds(fx.manifest.creds));
    expect(r.value.data).toMatchObject({ availableCash: 8239.85, usedMargin: 19.34 });
    expect(r.calls).toHaveLength(2);
  });

  it("turns error_code 40000 and HTTP 401 into SessionRequiredError (422)", async () => {
    const r = await withFetch([{ method: "GET", urlPattern: "/oapi/v1/holdings", status: 200, json: { status: "error", message: "Request forbidden", error_code: 40000, data: {} } }], () => adapter.fetchHoldings(fx.manifest.creds));
    expect(r.error).toBeInstanceOf(SessionRequiredError);
    const r401 = await withFetch([{ method: "GET", urlPattern: "/oapi/v1/trades", status: 401, json: { error: "invalid credentials" } }], () => adapter.fetchTradeBook(fx.manifest.creds));
    expect(adapter.normaliseError(r401.error, { secrets: [fx.manifest.creds.accessToken] })).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
  });

  it("maps a 44000 validation error to UPSTREAM_INPUT and 429 to UPSTREAM_RATE_LIMIT", async () => {
    const bad = await withFetch([{ method: "GET", urlPattern: "/oapi/v1/positions", status: 200, json: { data: {}, error_code: 44000, message: "`type` is invalid", status: "error" } }], () => adapter.fetchPositions(fx.manifest.creds));
    expect(adapter.normaliseError(bad.error)).toMatchObject({ statusCode: 502, code: "UPSTREAM_INPUT" });
    const rl = await withFetch([{ method: "GET", urlPattern: "/oapi/v1/trades", status: 429, json: {} }], () => adapter.fetchTradeBook(fx.manifest.creds));
    expect(adapter.normaliseError(rl.error)).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
  });

  it("refuses account calls when the token carries no client id, before any network call", async () => {
    const r = await withFetch([], () => adapter.fetchPositions({ apiKey: "k", accessToken: "opaque-token" }));
    expect(r.error).toBeInstanceOf(BrokerInputError);
    expect(r.calls).toEqual([]);
  });
});

class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; this.listeners = {}; FakeSocket.last = this; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  send(msg) { this.sent.push(JSON.parse(msg)); }
  close() {}
  emit(type, ev = {}) { for (const fn of this.listeners[type] || []) fn(ev); }
}

describe("hdfcsky feed", () => {
  it("connects to the HDFC Sky host and subscribes BFO and BSE_INDEX scripIds", () => {
    setHdfcWebSocketImpl(FakeSocket);
    const feed = adapter.createFeed(fx.manifest.creds, {});
    const ws = FakeSocket.last;
    expect(ws.url).toMatch(/^wss:\/\/developer\.hdfcsky\.com\/wsapi\/v1\/session\?token=.+&api_key=dummy-sky-api-key$/);
    ws.emit("open");
    feed.subscribe([{ token: "1163250", exchange: "BFO" }, { token: "1", exchange: "BSE" }]);
    expect(ws.sent).toEqual([{ heart_beat: false, subscribe: [{ scripId: "BFO_1163250", type: "ALL" }, { scripId: "BSE_INDEX_1", type: "ALL" }] }]);
    feed.close();
  });
});
