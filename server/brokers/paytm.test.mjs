/**
 * Paytm Money adapter: contract harness over every declared capability, symbol mapping from the
 * security masters, the native and master-built chains, order bodies, error normalisation and the
 * order gate. No network: fetch answers only from fixtures.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as adapter from "./paytm.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { parseCsv, toInstrument } from "./paytmInstruments.mjs";
import { buildFollowUpBody, buildOrderBody } from "./paytmOrders.mjs";
import { orderStatusOf, mapPosition } from "./paytmPortfolio.mjs";
import { istTimestamp, toIsoDate } from "./paytmClient.mjs";

const fx = loadFixtures("paytm");
const realFetch = globalThis.fetch;
const ALL = parseCsv(fx.byCapability.instruments.responses[0].text);
const byId = (id, type) => ALL.find((r) => r.security_id === id && (!type || r.instrument_type === type));

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

beforeEach(() => adapter.resetPaytmInstrumentCache());
afterEach(() => { globalThis.fetch = realFetch; });

describe("paytm contract", () => {
  it("passes strict validation with no warnings", () => {
    const v = validateAdapter(adapter);
    expect(v).toMatchObject({ ok: true, mode: "strict", errors: [] });
    expect(v.warnings).toEqual([]);
  });

  it("every declared capability returns the normalised shape from its fixture", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability);
    for (const cap of declaredCapabilities(adapter)) if (cap !== "auth") expect(covered).toContain(cap);
  });

  it("declares neither historical (no candle API) nor feed (needs the public_access_token)", () => {
    expect(adapter.capabilities.historical).toBeUndefined();
    expect(adapter.capabilities.feed).toBeUndefined();
  });
});

describe("paytm symbol mapping", () => {
  it("maps NIFTY monthly and weekly options to NFO with ISO expiries and paise tick sizes", () => {
    expect(toInstrument(byId("58445"))).toEqual({
      token: "58445", exchange: "NFO", tradingSymbol: "NIFTY-Oct2026-25000-CE", underlying: "NIFTY", instrumentType: "OPTIDX",
      expiry: "2026-10-27", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05,
    });
    expect(toInstrument(byId("47001"))).toMatchObject({ expiry: "2026-11-03", optionType: "CE" });
  });

  it("maps the SENSEX weekly to BFO, a stock option, and indices to IDX- tokens (ids clash with equities)", () => {
    expect(toInstrument(byId("844454"))).toMatchObject({ exchange: "BFO", underlying: "SENSEX", expiry: "2026-10-29", lotSize: 20 });
    expect(toInstrument(byId("106593"))).toMatchObject({ exchange: "NFO", underlying: "RELIANCE", instrumentType: "OPTSTK", strike: 1400 });
    expect(toInstrument(byId("13", "I"))).toMatchObject({ token: "IDX-13", exchange: "NSE", underlying: "NIFTY", instrumentType: "INDEX" });
    expect(toInstrument(byId("13", "ES"))).toMatchObject({ token: "13", exchange: "NSE", tradingSymbol: "ABB", instrumentType: "EQ", tickSize: 0.5 });
    const names = ALL.filter((r) => r.instrument_type === "I").map(toInstrument).map((i) => `${i.exchange}:${i.underlying}:${i.token}`);
    expect(names).toEqual(["NSE:NIFTY:IDX-13", "NSE:BANKNIFTY:IDX-25", "NSE:FINNIFTY:IDX-27", "NSE:MIDCPNIFTY:IDX-442", "BSE:SENSEX:IDX-51", "BSE:BANKEX:IDX-69", "NSE:INDIAVIX:IDX-21"]);
  });

  it("reads config expiries (epoch ms) as IST dates, ascending and de-duplicated", async () => {
    const r = await withFetch(fx.byCapability.expiries.responses, () => adapter.fetchExpiryList(fx.manifest.creds, "NIFTY"));
    expect(r.value.data).toEqual(["2026-10-20", "2026-10-27", "2026-11-03"]);
    expect([toIsoDate("2026-10-27 14:00:00"), toIsoDate("27-10-2026"), toIsoDate("2023-02-23T00:00:00")]).toEqual(["2026-10-27", "2026-10-27", "2023-02-23"]);
  });

  it("uses the broker's IV and Greeks from the native chain", async () => {
    const r = await withFetch(fx.byCapability.optionChain.responses, () => adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-27"));
    expect(r.value.data.last_price).toBe(25061.4);
    expect(r.value.data.oc["25000"].ce).toMatchObject({ last_price: 182.4, iv: 13.54, delta: 0.57, oi: 1874500, oi_chg: 100, volume: 90048 });
    expect(r.value.data.oc["25000"].pe).toMatchObject({ iv: 13.8, delta: -0.43, oi_chg: -2500 });
  });

  it("builds the SENSEX chain from the option master, index id 51 and FULL quotes (with bid/ask)", async () => {
    const r = await withFetch(fx.byCapability._sensexChain.responses, () => adapter.fetchOptionChain(fx.manifest.creds, "SENSEX", "2026-10-29"));
    expect(r.error).toBeUndefined();
    expect(r.value.data.last_price).toBe(82110.27);
    expect(r.value.data.oc["82000"].ce).toMatchObject({ last_price: 512.3, oi: 120340, bid_price: 512.25, ask_price: 512.35 });
    // change_oi is an absolute contract count (no OI percentage field exists in the FULL quote).
    const responses = structuredClone(fx.byCapability._sensexChain.responses);
    for (const resp of responses) for (const q of resp.json?.data ?? []) if (q.security_id === 844454) q.change_oi = -3400;
    const r2 = await withFetch(responses, () => adapter.fetchOptionChain(fx.manifest.creds, "SENSEX", "2026-10-29"));
    expect(r2.value.data.oc["82000"].ce).toMatchObject({ oi: 120340, oi_chg: -3400 });
    expect(r.calls.map((c) => decodeURIComponent(c.url)).filter((u) => u.includes("price/live"))).toEqual([
      "https://developer.paytmmoney.com/data/v1/price/live?mode=LTP&pref=BSE:51:INDEX",
      "https://developer.paytmmoney.com/data/v1/price/live?mode=FULL&pref=BSE:844454:OPTION,BSE:844455:OPTION",
    ]);
  });

  it("maps statuses, positions and IST timestamps", () => {
    expect([orderStatusOf("Successful"), orderStatusOf("Pending"), orderStatusOf("Pending", 10, 40), orderStatusOf("Rejected"), orderStatusOf("Cancelled"), orderStatusOf("odd")])
      .toEqual(["COMPLETE", "OPEN", "PARTIALLY_FILLED", "REJECTED", "CANCELLED", "UNKNOWN"]);
    const p = mapPosition(fx.byCapability.positions.responses[0].json.data[0]);
    expect(p).toMatchObject({ exchange: "NFO", product: "INTRADAY", netQty: -25, avgPrice: 2000, ltp: 3538, unrealisedPnl: -38450 });
    expect([istTimestamp("2023-01-31 18:17:25"), istTimestamp("31-07-2019 14:55:00"), istTimestamp("0001-01-01 00:00:00")]).toEqual(["2023-01-31T18:17:25+05:30", "2019-07-31T14:55:00+05:30", null]);
  });
});

describe("paytm orders", () => {
  it("builds a BFO stop-loss body with lots x lot size, D segment and the parent exchange", () => {
    expect(buildOrderBody({ exchange: "BFO", token: "844454", side: "SELL", product: "INTRADAY", orderType: "SL", lots: 3, price: 500, triggerPrice: 505 }, 20)).toEqual({
      txn_type: "S", exchange: "BSE", segment: "D", product: "I", security_id: "844454", quantity: 60, validity: "DAY", order_type: "SL", price: 500, trigger_price: 505,
      source: "M", off_mkt_flag: "false", order_ltp: 500,
    });
  });

  it("refuses market orders (docs: not supported), CNC on derivatives and a missing lot size", () => {
    const base = { exchange: "NFO", token: "58445", side: "BUY", product: "MARGIN", lots: 1, price: 10 };
    expect(() => buildOrderBody({ ...base, orderType: "MARKET" }, 65)).toThrow(/market orders/);
    expect(() => buildOrderBody({ ...base, orderType: "LIMIT", product: "CNC" }, 65)).toThrow(BrokerInputError);
    expect(() => buildOrderBody({ ...base, orderType: "LIMIT" }, 0)).toThrow(/resolvedLotSize/);
  });

  it("passes serial_no, group_id and ext_info back unchanged on modify and cancel", () => {
    const existing = fx.byCapability.orderBook.responses[0].json.data[0];
    const cancel = buildFollowUpBody(existing);
    expect(cancel).toMatchObject({ order_no: "152301319082", serial_no: 1, group_id: 1, mkt_type: "NL", ext_info: existing.ext_info });
    expect(buildFollowUpBody(existing, { price: 120, quantity: 100 })).toMatchObject({ price: 120, quantity: 100, order_type: "LMT", ext_info: existing.ext_info });
  });

  it("refuses every order call without a valid gate, before any network call", async () => {
    for (const [fn, args] of [[adapter.placeOrder, fx.byCapability.placeOrder.args], [adapter.modifyOrder, ["1", {}]], [adapter.cancelOrder, ["1"]]]) {
      const r = await withFetch([], () => fn(fx.manifest.creds, ...args, { action: "cancelOrder", brokerId: "paytm" }));
      expect(r.error).toBeInstanceOf(OrderGateError);
      expect(r.calls).toEqual([]);
    }
  });
});

describe("paytm errors", () => {
  it("turns the documented 401 PM_OPEN_API_0001 into SessionRequiredError without leaking the token", async () => {
    const r = await withFetch([{ method: "GET", urlPattern: "funds/summary", status: 401, json: { status: 401, message: "Invalid Access Token", error_code: "PM_OPEN_API_0001" } }], () => adapter.fetchFunds(fx.manifest.creds));
    expect(r.error).toBeInstanceOf(SessionRequiredError);
    const n = adapter.normaliseError(r.error, { secrets: [fx.manifest.creds.accessToken] });
    expect(n).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(n.message).not.toContain(fx.manifest.creds.accessToken);
  });

  it("maps 400 PM_OPEN_API_400 to UPSTREAM_INPUT and an order failure body to a 502", async () => {
    const bad = await withFetch([{ method: "GET", urlPattern: "orders/v1/position", status: 400, json: { status: 400, message: "Bad Request", error_code: "PM_OPEN_API_400" } }], () => adapter.fetchPositions(fx.manifest.creds));
    expect(adapter.normaliseError(bad.error)).toMatchObject({ statusCode: 502, code: "UPSTREAM_INPUT" });
    const failed = await withFetch([{ method: "GET", urlPattern: "user/orders", status: 200, json: { status: "failure", message: "Something went wrong", error_code: "RS-9999" } }], () => adapter.fetchOrderBook(fx.manifest.creds));
    expect(adapter.normaliseError(failed.error)).toMatchObject({ statusCode: 502, code: "UPSTREAM_ERROR" });
    expect(failed.error.message).toContain("RS-9999");
  });

  it("refuses data calls with no token before any download", async () => {
    const r = await withFetch([], () => adapter.fetchOptionChain({ apiKey: "k" }, "SENSEX"));
    expect(r.error).toBeInstanceOf(SessionRequiredError);
    expect(r.calls).toEqual([]);
  });
});
