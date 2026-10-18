/**
 * Arrow adapter on the contract harness. No network (fetch is stubbed) and the shared instrument cache is
 * replaced by a per-test in-memory map. Fixtures follow the official docs' sample payloads (docs.arrow.trade).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import * as cache from "../lib/instrumentCache.mjs";
import * as adapter from "./arrow.mjs";
import { resetSessions, sha256Hex } from "./arrowAuth.mjs";
import { arrowDateToIso, expiriesFromSymbols, isoToArrowDate, parseMasterCsv, splitCsvLine, toInstrument, underlyingRef } from "./arrowInstruments.mjs";
import { parseArrowTime } from "./arrowMarket.mjs";
import { mapOrderStatus } from "./arrowOrders.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";

const fx = loadFixtures("arrow");
const creds = fx.manifest.creds;
const AUTH = fx.byCapability.testConnection.responses[0];
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => {
  cache.__clear();
  resetSessions();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("arrow contract", () => {
  it("is on the strict contract", () => {
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
    expect(report.results.filter((r) => r.capability !== "normaliseError" && r.calls === 0)).toEqual([]);
  });
});

describe("arrow auth", () => {
  it("sends SHA-256(appID:appSecret:request-token) and exchanges a request-token only once", async () => {
    const s = stub(fx.byCapability.testConnection.responses);
    expect((await adapter.testConnection(creds)).status).toBe("success");
    expect((await adapter.testConnection(creds)).status).toBe("success");
    const exchanges = s.calls.filter((c) => c.url.endsWith("/authenticate-token"));
    expect(exchanges).toHaveLength(1);
    expect(JSON.parse(exchanges[0].body).checkSum).toBe(sha256Hex("AR00001:dummy-app-secret:dummy-request-token"));
    expect(s.calls.find((c) => c.url.endsWith("/user/details")).headers).toMatchObject({ appID: "AR00001", token: "dummy.arrow.access.token" });
  });

  it("refuses before any call when a field is missing, and does not re-send a rejected request-token", async () => {
    const s = stub([{ method: "POST", url: AUTH.url, status: 400, json: { status: "failure", message: "Invalid checksum", errorCode: 400 } }]);
    await expect(adapter.fetchLTP({ appId: "AR00001" }, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
    await expect(adapter.fetchLTP(creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchLTP(creds, "NIFTY")).rejects.toThrow(/already been used/);
    expect(s.calls).toHaveLength(1);
  });

  it("maps 401 to SessionRequiredError and 429 to UPSTREAM_RATE_LIMIT, and normalises errors without secrets", async () => {
    stub([AUTH, { method: "GET", url: "https://edge.arrow.trade/user/limits", status: 401, json: { status: "error", message: "UnAuthorized", errorCode: "UNAUTHORIZED" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    resetSessions();
    stub([AUTH, { method: "GET", url: "https://edge.arrow.trade/user/limits", status: 429, json: { status: "error", message: "TooManyRequests", errorCode: "TOO_MANY_REQUESTS" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ code: "UPSTREAM_RATE_LIMIT", statusCode: 502 });
    const n = adapter.normaliseError(new Error("bad dummy-app-secret"), { secrets: [creds.appSecret] });
    expect(n.message).not.toContain("dummy-app-secret");
  });
});

describe("arrow symbol mapping", () => {
  const master = parseMasterCsv(fx.byCapability.instruments.responses[1].text);
  const byToken = (t) => toInstrument(master.find((r) => r.Token === t));

  it("maps NIFTY weekly + monthly, SENSEX weekly and a stock option from the master", () => {
    expect(byToken("51450")).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", underlying: "NIFTY", expiry: "2026-10-20", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05 });
    expect(byToken("52210")).toMatchObject({ expiry: "2026-10-27", instrumentType: "OPTIDX" });
    expect(byToken("2131475")).toMatchObject({ exchange: "BFO", underlying: "SENSEX", expiry: "2026-10-22", strike: 82000, lotSize: 20 });
    expect(byToken("104034")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, lotSize: 500 });
    expect(byToken("52001")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(byToken("26000")).toMatchObject({ instrumentType: "INDEX", tradingSymbol: "NIFTY", exchange: "NSE" });
    expect(byToken("90003")).toBeNull(); // NIFTYNXT50 is not a canonical underlying
    expect(byToken("26017")).toBeNull(); // India VIX
    expect(byToken("9999")).toBeNull(); // BE series
    expect(byToken("1398464")).toBeNull(); // commodity future
  });

  it("parses quoted CSV fields and Arrow dates", () => {
    expect(splitCsvLine('a,"b, c",d')).toEqual(["a", "b, c", "d"]);
    expect(arrowDateToIso("20-Oct-2026")).toBe("2026-10-20");
    expect(arrowDateToIso("21-JUL-2026")).toBe("2026-07-21");
    expect(isoToArrowDate("2026-10-20")).toBe("20-OCT-2026");
    expect(parseArrowTime("2026-10-14T00:00:00+0530")).toBe(Date.parse("2026-10-13T18:30:00Z") / 1000);
  });

  it("uses INDEX for index underlyings and NSE <SYM>-EQ for stocks, with ISO ascending expiries", () => {
    expect(underlyingRef("SENSEX")).toMatchObject({ chainExchange: "INDEX", chainUnderlying: "SENSEX", quoteExchange: "INDEX" });
    expect(underlyingRef("reliance")).toMatchObject({ chainExchange: "NSE", chainUnderlying: "RELIANCE-EQ", quoteSymbol: "RELIANCE-EQ" });
    const json = fx.byCapability.expiries.responses[1].json;
    expect(expiriesFromSymbols(json, "NIFTY")).toEqual(["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-24"]);
    expect(expiriesFromSymbols(json, "SENSEX")[0]).toBe("2026-10-22");
    expect(expiriesFromSymbols(json, "RELIANCE")).toEqual(["2026-10-27", "2026-11-24", "2026-12-29"]);
  });
});

describe("arrow option chain and quotes", () => {
  it("prices the documented chain contracts by token, with OI change from openingOI and solved IV", async () => {
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(r);
    expect(spotPrice).toBe(25012.15);
    expect(chain.map((c) => c.strikePrice)).toEqual([24950, 25000, 25050]);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 2168400, oiChange: 2168400 - 2014195, volume: 12070630, bidPrice: 104.9, askPrice: 105 });
    expect(atm.ce.iv).toBeGreaterThan(0);
    expect(r.data.oc["25000"].ce.security_id).toBe("51450");
  });

  it("resolves a quote ref without a trading symbol through the instrument master", async () => {
    const s = stub([AUTH, fx.byCapability.instruments.responses[1], ...fx.byCapability.quotes.responses.slice(1)]);
    const r = await adapter.fetchQuotes(creds, [{ token: "51450", exchange: "NFO" }, { token: "2885", exchange: "NSE" }]);
    expect(r.data.map((q) => q.token)).toEqual(["51450", "2885"]);
    expect(r.data[1]).toMatchObject({ ltp: 1368.2, close: 1358.8, bid: 1368.3, ask: 1368.7, oi: 0 });
    expect(s.calls.filter((c) => c.url.endsWith("/all"))).toHaveLength(1);
  });

  it("keeps quotes apart when an NSE and an NFO contract share a token number", async () => {
    stub([AUTH, {
      method: "POST",
      url: "https://edge.arrow.trade/info/quotes/full",
      json: { status: "success", data: [
        { token: 2885, symbol: "NIFTY20OCT26P24000", ltp: 5000 },
        { token: 2885, symbol: "RELIANCE-EQ", ltp: 136820 },
      ] },
    }]);
    const r = await adapter.fetchQuotes(creds, [
      { token: "2885", exchange: "NSE", tradingSymbol: "RELIANCE-EQ" },
      { token: "2885", exchange: "NFO", tradingSymbol: "NIFTY20OCT26P24000" },
    ]);
    expect(r.data.map((q) => [q.exchange, q.ltp])).toEqual([["NSE", 1368.2], ["NFO", 50]]);
  });

  it("rejects unsupported history intervals before any call", async () => {
    const s = stub([]);
    await expect(adapter.fetchHistorical(creds, { instrument: { token: "51450", exchange: "NFO" }, interval: "2m", from: "2026-10-01", to: "2026-10-02" })).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("arrow orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the documented order statuses", () => {
    expect(mapOrderStatus({ orderStatus: "COMPLETE" })).toBe("COMPLETE");
    expect(mapOrderStatus({ orderStatus: "PENDING" })).toBe("OPEN");
    expect(mapOrderStatus({ orderStatus: "OPEN", cumulativeFillQty: "65" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ orderStatus: "TRIGGER_PENDING" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ orderStatus: "CANCELLED" })).toBe("CANCELLED");
    expect(mapOrderStatus({ orderStatus: "REJECTED" })).toBe("REJECTED");
    expect(mapOrderStatus({ orderStatus: "SOMETHING" })).toBe("UNKNOWN");
  });

  it("builds only limit / stop-limit DAY orders and needs a master lot size", () => {
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(/market orders/);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, lot)).toThrow(/cash equity only/);
    expect(adapter.buildOrderBody({ ...order, exchange: "MCX", tradingSymbol: "GOLDPETAL31JUL26F" }, 1).exchange).toBe("MCXFO");
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 97 }, lot)).toMatchObject({ order: "SL-LMT", triggerPrice: "97", quantity: "130" });
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrongAction = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "arrow" });
    await expect(adapter.placeOrder(creds, order, lot, wrongAction)).rejects.toBeInstanceOf(OrderGateError);
    const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "dhan" });
    await expect(adapter.placeOrder(creds, order, lot, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
