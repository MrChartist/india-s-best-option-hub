/**
 * HDFC Securities (InvestRight) adapter: contract harness over every declared capability, symbol
 * mapping from the security master, fetch-ltp exchange codes, order body building, error
 * normalisation, the order gate and the protobuf feed. No network: fetch is stubbed by the harness /
 * createFetchStub, the WebSocket snapshot is replaced, and the feed runs on a fake socket.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as adapter from "./hdfcsecurities.mjs";
import { OrderGateError, SessionRequiredError, BrokerInputError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { tickSizeOf, toInstrument } from "./hdfcsecuritiesInstruments.mjs";
import { buildModifyBody, buildOrderBody } from "./hdfcsecuritiesOrders.mjs";
import { bookExpiryIso, exchangeOf, istTimestamp, orderStatusOf } from "./hdfcsecuritiesPortfolio.mjs";
import { parseFrame } from "./hdfcsecuritiesProtobuf.mjs";
import { setHdfcWebSocketImpl } from "./hdfcsecuritiesFeed.mjs";

const fx = loadFixtures("hdfcsecurities");
const realFetch = globalThis.fetch;
const CSV = fx.byCapability.instruments.responses[0].text;
const HEADER = CSV.split("\n")[0].split(",");
const rowOf = (line) => Object.fromEntries(line.split(",").map((v, i) => [HEADER[i], v]));
const rowsBy = (pred) => CSV.split("\n").slice(1).filter(Boolean).map(rowOf).filter(pred);

const fakeTicks = new Map([
  ["51288", { token: 51288, ltp: 182.4, oi: 1874500, volume: 90048, depth: { buy: [{ price: 182.3, quantity: 650, orders: 3 }], sell: [{ price: 182.5, quantity: 325, orders: 2 }] } }],
  ["51289", { token: 51289, ltp: 141.1, oi: 1201300, volume: 70011, depth: { buy: [{ price: 141.0, quantity: 130, orders: 1 }], sell: [{ price: 141.2, quantity: 195, orders: 2 }] } }],
]);

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

beforeEach(() => {
  adapter.resetHdfcSecuritiesInstrumentCache();
  adapter.setHdfcSecuritiesSnapshotForTests(async (_creds, scripIds) => {
    const out = new Map();
    for (const s of scripIds) {
      const t = s.slice(s.lastIndexOf("_") + 1);
      if (fakeTicks.has(t)) out.set(t, fakeTicks.get(t));
    }
    return out;
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  adapter.setHdfcSecuritiesSnapshotForTests(null);
  setHdfcWebSocketImpl(null);
});

describe("hdfcsecurities contract", () => {
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

  it("declares no historical capability (InvestRight has no candle API)", () => {
    expect(adapter.capabilities.historical).toBeUndefined();
    expect(adapter.fetchHistorical).toBeUndefined();
  });
});

describe("hdfcsecurities symbol mapping", () => {
  it("maps NIFTY weekly and monthly options to NFO with ISO expiries and paise tick sizes", () => {
    const [monthly] = rowsBy((r) => r.exch_security_id === "51288");
    const [weekly] = rowsBy((r) => r.exch_security_id === "43801");
    expect(toInstrument(monthly)).toEqual({
      token: "51288", exchange: "NFO", tradingSymbol: "NIFTY 27 OCT 2026 25000 CE", underlying: "NIFTY", instrumentType: "OPTIDX",
      expiry: "2026-10-27", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05,
    });
    expect(toInstrument(weekly)).toMatchObject({ exchange: "NFO", expiry: "2026-11-03", optionType: "CE", strike: 25000 });
  });

  it("maps a SENSEX weekly option to BFO by its market-data token (not the B-prefixed order id)", () => {
    const [sensex] = rowsBy((r) => r.security_id === "B842869");
    expect(toInstrument(sensex)).toMatchObject({ token: "842869", exchange: "BFO", underlying: "SENSEX", instrumentType: "OPTIDX", expiry: "2026-10-29", lotSize: 20 });
  });

  it("maps a stock option, the six index spot rows, and drops MCX and DUMMY rows", () => {
    const [rel] = rowsBy((r) => r.exch_security_id === "106474");
    expect(toInstrument(rel)).toMatchObject({ exchange: "NFO", underlying: "RELIANCE", instrumentType: "OPTSTK", strike: 1400, lotSize: 500 });
    const indices = rowsBy((r) => r.instrument_segment === "EQUITY").map(toInstrument).filter((i) => i?.instrumentType === "INDEX");
    expect(indices.map((i) => `${i.exchange}:${i.underlying}:${i.token}`)).toEqual([
      "NSE:NIFTY:26000", "NSE:BANKNIFTY:26009", "NSE:FINNIFTY:26037", "NSE:MIDCPNIFTY:26074", "BSE:SENSEX:1", "BSE:BANKEX:12",
    ]);
    expect(rowsBy((r) => r.exchange === "MCX").map(toInstrument)).toEqual([null]);
    expect(rowsBy((r) => r.exch_security_id.startsWith("DUMMY")).map(toInstrument)).toEqual([null]);
  });

  it("reads tick sizes as paise when integral and rupees when decimal", () => {
    expect([tickSizeOf("5"), tickSizeOf(".05"), tickSizeOf("10"), tickSizeOf("100")]).toEqual([0.05, 0.05, 0.1, 1]);
  });

  it("lists expiries ascending and asks fetch-ltp for option legs under NFO, the index under NSE_INDEX", async () => {
    const { value } = await withFetch(fx.byCapability.expiries.responses, () => adapter.fetchExpiryList(fx.manifest.creds, "NIFTY"));
    expect(value.data).toEqual(["2026-10-27", "2026-11-03"]);
    const r = await withFetch(fx.byCapability.optionChain.responses, () => adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-27"));
    const puts = r.calls.filter((c) => c.method === "PUT").map((c) => JSON.parse(c.body).data.map((d) => d.exchange));
    expect(puts).toEqual([["NSE_INDEX"], ["NFO", "NFO", "NFO", "NFO"]]);
    expect(r.value.data.last_price).toBe(25061.4);
    expect(r.value.data.oc["25000"].ce).toMatchObject({ last_price: 182.4, oi: 1874500, volume: 90048, bid_price: 182.3, ask_price: 182.5 });
    expect(Number.isFinite(r.value.data.oc["25000"].ce.iv)).toBe(true); // Black-Scholes, percent
  });

  it("maps book exchanges, dates and statuses", () => {
    expect([exchangeOf("NSE", "OPTIDX"), exchangeOf("BSE", "OPTIDX"), exchangeOf("NSE", "EQUITY"), exchangeOf("NSE", "FUTCUR")]).toEqual(["NFO", "BFO", "NSE", "CDS"]);
    expect([bookExpiryIso("30 APR 2024"), bookExpiryIso("27-JUN-24")]).toEqual(["2024-04-30", "2024-06-27"]);
    expect(istTimestamp("30/04/2024 12:40:12")).toBe("2024-04-30T12:40:12+05:30");
    expect([orderStatusOf("Traded"), orderStatusOf("Pending", 5, 10), orderStatusOf("Trigger Pending"), orderStatusOf("something new")]).toEqual(["COMPLETE", "PARTIALLY_FILLED", "TRIGGER_PENDING", "UNKNOWN"]);
    // Word-based classification: case and separator variants land in the same bucket.
    expect(orderStatusOf("TRADED")).toBe("COMPLETE");
    expect(orderStatusOf("pending")).toBe("OPEN");
    expect(orderStatusOf("SL_TRIGGER-PENDING")).toBe("TRIGGER_PENDING");
    expect(orderStatusOf("Cancel Confirmed")).toBe("CANCELLED");
    expect(orderStatusOf("Cancelled")).toBe("CANCELLED");
    expect(orderStatusOf("Cancel Pending")).toBe("OPEN");
    expect(orderStatusOf("Rejected")).toBe("REJECTED");
    // A refused cancel/modify leaves the order live, so panic cancel must still see it as open.
    expect(orderStatusOf("Cancel Rejected")).toBe("OPEN");
    expect(orderStatusOf("Modify Rejected")).toBe("OPEN");
    expect(orderStatusOf("Partially Traded")).toBe("PARTIALLY_FILLED");
    expect(orderStatusOf("After Market Order Req Received")).toBe("OPEN");
    expect(orderStatusOf("")).toBe("UNKNOWN");
  });
});

describe("hdfcsecurities orders", () => {
  const [niftyCe] = rowsBy((r) => r.exch_security_id === "51288");
  const [sensexCe] = rowsBy((r) => r.security_id === "B842869");
  const [reliance] = rowsBy((r) => r.security_id === "RELINDEQNR");

  it("builds an index-option body from the master (security id, underlying, YYYYMMDD expiry, lots x lot size)", () => {
    const body = buildOrderBody(sensexCe, { exchange: "BFO", token: "842869", side: "SELL", product: "INTRADAY", orderType: "SL", lots: 3, price: 500, triggerPrice: 505 }, 20, { reference: "42" });
    expect(body).toEqual({
      exchange: "BSE", security_id: "B842869", instrument_segment: "OPTIDX", transaction_type: "SELL", product: "INTRADAY", order_type: "SL", quantity: 60,
      price: 500, trigger_price: 505, disclosed_quantity: 0, validity: "DAY", amo: false, external_reference_number: "42",
      expiry_date: "20261029", underlying_symbol: "SENSEX", option_type: "CE", strike_price: 82000,
    });
  });

  it("maps cash CNC to DELIVERY and refuses products that do not fit the segment", () => {
    expect(buildOrderBody(reliance, { exchange: "NSE", token: "2885", side: "BUY", product: "CNC", orderType: "MARKET", lots: 4 }, 1).product).toBe("DELIVERY");
    expect(() => buildOrderBody(niftyCe, { exchange: "NFO", token: "51288", side: "BUY", product: "CNC", orderType: "MARKET", lots: 1 }, 65)).toThrow(BrokerInputError);
    expect(() => buildOrderBody(niftyCe, { exchange: "NFO", token: "51288", side: "BUY", product: "MARGIN", orderType: "LIMIT", lots: 1 }, 65)).toThrow(/price is required/);
    expect(() => buildOrderBody(niftyCe, { exchange: "NFO", token: "51288", side: "BUY", product: "MARGIN", orderType: "MARKET", lots: 1 }, 0)).toThrow(/resolvedLotSize/);
    expect(() => buildOrderBody(niftyCe, { exchange: "BFO", token: "51288", side: "BUY", product: "MARGIN", orderType: "MARKET", lots: 1 }, 65)).toThrow(/exchange/);
  });

  it("builds a modify body that keeps the order's product", () => {
    expect(buildModifyBody({ product: "OVERNIGHT", quantity: 15, order_type: "LIMIT", validity: "DAY", price: 38 }, { price: 40 })).toEqual({
      quantity: 15, order_type: "LIMIT", validity: "DAY", disclosed_quantity: 0, product: "OVERNIGHT", price: 40, trigger_price: 0, amo: false,
    });
  });

  it("refuses every order call without a valid gate, before any network call", async () => {
    const order = fx.byCapability.placeOrder.args;
    for (const [fn, args] of [[adapter.placeOrder, order], [adapter.modifyOrder, ["1", {}]], [adapter.cancelOrder, ["1"]]]) {
      const r = await withFetch([], () => fn(fx.manifest.creds, ...args, { action: "placeOrder", brokerId: "hdfcsecurities" }));
      expect(r.error).toBeInstanceOf(OrderGateError);
      expect(r.calls).toEqual([]);
    }
  });
});

describe("hdfcsecurities errors", () => {
  it("turns a rejected token into SessionRequiredError (422) without leaking it", async () => {
    const r = await withFetch([{ method: "GET", urlPattern: "user/margins", status: 401, json: { status: "error", message: "Unauthorized" } }], () => adapter.fetchFunds(fx.manifest.creds));
    expect(r.error).toBeInstanceOf(SessionRequiredError);
    const n = adapter.normaliseError(r.error, { secrets: [fx.manifest.creds.accessToken] });
    expect(n).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(n.message).not.toContain("dummy-ir-api-key");
  });

  it("maps 429 to UPSTREAM_RATE_LIMIT and 400 to UPSTREAM_INPUT, and never puts the api key in a message", async () => {
    const rl = await withFetch([{ method: "GET", urlPattern: "orders", status: 429, json: {} }], () => adapter.fetchOrderBook(fx.manifest.creds));
    expect(adapter.normaliseError(rl.error)).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    const bad = await withFetch([{ method: "GET", urlPattern: "trades", status: 400, json: { message: "bad request" } }], () => adapter.fetchTradeBook(fx.manifest.creds));
    const n = adapter.normaliseError(bad.error);
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_INPUT" });
    expect(n.message).not.toContain("api_key");
  });

  it("refuses data calls with no token before any download", async () => {
    const r = await withFetch([], () => adapter.fetchOptionChain({ apiKey: "k" }, "NIFTY", "2026-10-27"));
    expect(r.error).toBeInstanceOf(SessionRequiredError);
    expect(r.calls).toEqual([]);
  });

  it("reports testConnection failure as an error result, never a throw", async () => {
    const r = await withFetch([{ method: "GET", urlPattern: "user/margins", status: 500, text: "oops" }], () => adapter.testConnection(fx.manifest.creds));
    expect(r.value).toMatchObject({ status: "error" });
  });
});

// ── protobuf feed ──

function varint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}
const tag = (field, wire) => varint((field << 3) | wire);
const vField = (f, n) => Buffer.concat([tag(f, 0), varint(n)]);
const dField = (f, x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x); return Buffer.concat([tag(f, 1), b]); };
const mField = (f, buf) => Buffer.concat([tag(f, 2), varint(buf.length), buf]);

function mbpFrame(token, packetType, { ltp, oi, volume, bid, ask }) {
  const level = (price, qty, buy) => Buffer.concat([vField(1, qty), dField(2, price), vField(3, 1), vField(4, buy ? 1 : 0)]);
  const depth = Buffer.concat([mField(1, level(bid, 100, true)), mField(1, level(ask, 50, false))]);
  const mbp = Buffer.concat([dField(1, ltp), dField(5, ltp - 2), dField(6, ltp + 3), dField(7, ltp - 1), dField(8, ltp - 4), vField(9, volume), mField(12, depth), vField(17, oi)]);
  const dto = Buffer.concat([vField(1, token), mField(2, mbp), vField(9, packetType)]);
  return mField(1, dto);
}

class FakeSocket {
  static last = null;
  constructor(url) { this.url = url; this.sent = []; this.listeners = {}; this.readyState = 0; FakeSocket.last = this; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  send(msg) { this.sent.push(JSON.parse(msg)); }
  close() { this.readyState = 3; }
  emit(type, ev = {}) { if (type === "open") this.readyState = 1; for (const fn of this.listeners[type] || []) fn(ev); }
}

describe("hdfcsecurities feed", () => {
  it("decodes an NSE_FO_ALL frame with depth and OI, and skips heartbeats", () => {
    const [tick] = parseFrame(mbpFrame(51288, 3, { ltp: 182.4, oi: 1874500, volume: 90048, bid: 182.3, ask: 182.5 }));
    expect(tick).toMatchObject({ token: 51288, kind: "mbp", ltp: 182.4, oi: 1874500, volume: 90048 });
    expect(tick.depth.buy[0]).toEqual({ quantity: 100, price: 182.3, orders: 1 });
    expect(parseFrame(mField(1, Buffer.concat([vField(1, 5), vField(9, 16)])))).toEqual([]);
  });

  it("createFeed subscribes with scripIds, sends the token only in the URL, and emits contract quotes", () => {
    setHdfcWebSocketImpl(FakeSocket);
    const ticks = [];
    const status = [];
    const feed = adapter.createFeed(fx.manifest.creds, { onTick: (q) => ticks.push(q), onStatus: (s) => status.push(s) });
    const ws = FakeSocket.last;
    expect(ws.url).toMatch(/^wss:\/\/developer\.hdfcsec\.com\/wsapi\/v1\/session\?token=/);
    feed.subscribe([{ token: "51288", exchange: "NFO" }, { token: "26000", exchange: "NSE" }]);
    ws.emit("open");
    expect(ws.sent[0]).toEqual({ heart_beat: false, subscribe: [{ scripId: "NFO_51288", type: "ALL" }, { scripId: "NSE_INDEX_26000", type: "ALL" }] });
    ws.emit("message", { data: new Uint8Array(mbpFrame(51288, 3, { ltp: 182.4, oi: 1874500, volume: 90048, bid: 182.3, ask: 182.5 })) });
    expect(ticks[0]).toEqual({ token: "51288", exchange: "NFO", ltp: 182.4, open: 180.4, high: 185.4, low: 178.4, close: 181.4, volume: 90048, oi: 1874500, bid: 182.3, ask: 182.5 });
    feed.unsubscribe([{ token: "51288", exchange: "NFO" }]);
    expect(ws.sent[1]).toEqual({ heart_beat: false, unSubscribe: [{ scripId: "NFO_51288", type: "ALL" }] });
    feed.close();
    expect(status[0]).toEqual({ connected: true });
  });
});
