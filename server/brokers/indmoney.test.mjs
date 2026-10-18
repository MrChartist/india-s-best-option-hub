/**
 * IndMoney (INDstocks) on the contract harness. No network: fetch is stubbed, the WebSocket is a fake and the
 * instrument cache is an in-memory map per test.
 */
import { EventEmitter } from "node:events";
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
import * as adapter from "./indmoney.mjs";
import { BrokerInputError, FORBIDDEN_SECRET_KEY, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness, runLoginContract } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetIndmoneyPacing, expiryFrom } from "./indmoneyAuth.mjs";
import { expiryIso, listExpiries, optionRows, parseCsv, scripCodeOf, spotRow, tickRupees, toIndexRow, toMasterRow } from "./indmoneyInstruments.mjs";
import { clean } from "./indmoneyMarket.mjs";
import { exchangeOf, orderStatusOf } from "./indmoneyPortfolio.mjs";
import { parseTick, wsCode } from "./indmoneyFeed.mjs";

const fx = loadFixtures("indmoney");
const csvText = (source) => fx.byCapability.instruments.responses.find((r) => r.url.endsWith(`source=${source}`)).text;
const fno = parseCsv(csvText("fno")).map(toMasterRow).filter(Boolean);
const equity = parseCsv(csvText("equity")).map(toMasterRow).filter(Boolean);
const indices = parseCsv(csvText("index")).map(toIndexRow).filter(Boolean);
const session = { ...fx.manifest.creds, accessToken: "dummy-indstocks-token" };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => {
  cache.__clear();
  __resetIndmoneyPacing();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("indmoney contract", () => {
  it("is on the strict contract with a session login and no secret credential fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("sessionLogin");
    expect(adapter.credentialFields.filter((f) => FORBIDDEN_SECRET_KEY.test(f))).toEqual([]);
  });

  it("passes every declared capability (and login) against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed")].sort());
  }, 30_000);
});

describe("indmoney session login", () => {
  it("sends the Client ID as x-api-key and the typed MPIN + code once, returning only the token", async () => {
    const s = stub(fx.byCapability.login.responses);
    const out = await adapter.login({ ...fx.manifest.creds, ...fx.byCapability.login.secrets });
    expect(Object.keys(out.session)).toEqual(["accessToken"]);
    expect(out.expiresAt).toBeGreaterThan(Date.now());
    expect(out.expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 3600_000);
    expect(s.calls[0].headers["x-api-key"]).toBe("IND1234567");
    expect(JSON.stringify(out)).not.toMatch(/4321|278460/);
    expect((await runLoginContract(adapter, fx.byCapability.login, fx.manifest.creds)).problems).toEqual([]);
  });

  it("reports a wrong code without echoing the MPIN or code, and never retries", async () => {
    const s = stub([{ method: "POST", url: "https://api.indstocks.com/generate/token", status: 400, json: { message: "Could not validate TOTP. Please try again." } }]);
    const err = await adapter.login({ clientId: "IND1234567", mpin: "4321", totpCode: "111111" }).catch((e) => e);
    expect(err.message).toMatch(/Could not validate TOTP/);
    expect(err.message).not.toMatch(/4321|111111/);
    expect(s.calls).toHaveLength(1);
  });

  it("reads expires_in as an epoch timestamp or a duration", () => {
    const now = Date.UTC(2026, 9, 17);
    expect(expiryFrom(1792281600, now)).toBe(1792281600000);
    expect(expiryFrom(3600, now)).toBe(now + 3600_000);
  });

  it("refuses data calls until logged in, without touching the network", async () => {
    const s = stub([]);
    const res = await adapter.testConnection({ ...fx.manifest.creds });
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/log in/i);
    await expect(adapter.fetchLTP({ ...fx.manifest.creds }, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchOptionChain({ ...fx.manifest.creds }, "NIFTY", fx.manifest.expiry)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("turns a TokenException into SessionRequiredError (422) with the raw token header", async () => {
    const s = stub([{ method: "GET", url: "https://api.indstocks.com/funds", status: 403, json: { status: "error", message: "Unable to validate user token", error_type: "TokenException" } }]);
    const err = await adapter.fetchFunds(session).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(s.calls[0].headers.Authorization).toBe("dummy-indstocks-token");
  });

  it("keeps a UserException (segment not activated) as an upstream error, not a logout", async () => {
    stub([{ method: "GET", url: "https://api.indstocks.com/portfolio/holdings", status: 403, json: { status: "error", message: "Segment not activated", error_type: "UserException" } }]);
    const err = await adapter.fetchHoldings(session).catch((e) => e);
    expect(err).not.toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502 });
  });
});

describe("indmoney symbol mapping", () => {
  it("derives the underlying from TRADING_SYMBOL and reads EXPIRY_DATE month-first", () => {
    expect(expiryIso("09/29/2026 14:00", "29 Sep 2026")).toBe("2026-09-29");
    expect(expiryIso("", "3 Nov 2026")).toBe("2026-11-03");
    expect(tickRupees("5")).toBe(0.05);
    expect(tickRupees("1")).toBe(0.01);
    for (const u of ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"]) expect(optionRows(fno, u).length).toBeGreaterThan(0);
    expect(optionRows(fno, "SENSEX").every((m) => m.exchange === "BFO" && m.scripCode.startsWith("BFO_"))).toBe(true);
    expect(optionRows(fno, "RELIANCE").every((m) => m.instrumentType === "OPTSTK" && m.lotSize === 500)).toBe(true);
    expect(fno.some((m) => m.underlying === "NIFTYNXT50")).toBe(false);
    expect(fno.find((m) => m.instrumentType === "FUTIDX")).toMatchObject({ underlying: "NIFTY", strike: null, optionType: null });
    expect(equity.some((m) => m.tradingSymbol === "774KA37")).toBe(false);
  });

  it("lists NIFTY weekly + monthly and SENSEX weekly expiries", () => {
    expect(listExpiries(fno, "NIFTY")).toEqual(["2026-10-27", "2026-11-03"]);
    expect(listExpiries(fno, "SENSEX")).toEqual(["2026-10-22"]);
  });

  it("maps the documented index names and builds NIDX/BIDX scrip codes", () => {
    expect(spotRow(indices, null, "BANKNIFTY")).toMatchObject({ token: "40000003", scripCode: "NIDX_40000003" });
    expect(spotRow(indices, null, "FINNIFTY")).toMatchObject({ token: "40000100" });
    expect(spotRow(indices, null, "MIDCPNIFTY")).toMatchObject({ token: "40000093" });
    expect(spotRow(indices, null, "BANKEX")).toMatchObject({ scripCode: "BIDX_40000033" });
    expect(spotRow(indices, equity, "RELIANCE")).toMatchObject({ scripCode: "NSE_2885" });
    expect(scripCodeOf({ token: "40000006", exchange: "BSE" }, indices)).toBe("BIDX_40000006");
    expect(scripCodeOf({ token: "823580", exchange: "BFO" }, indices)).toBe("BFO_823580");
  });

  it("builds a SENSEX weekly chain from the master and batched quotes", async () => {
    stub([
      ...fx.byCapability.optionChain.responses.filter((r) => r.url),
      { method: "GET", urlPattern: "quotes/full\\?scrip-codes=BIDX_40000006%2CBFO_823580%2CBFO_823581$", json: { status: "success", data: {
        BIDX_40000006: { live_price: 81234.5 }, BFO_823580: { live_price: 420.5, volume: 5000, market_depth: { BFO_823580: { depth: [{ buy: { price: "420.00", quantity: "20" }, sell: { price: "421.00", quantity: "40" } }] } } }, BFO_823581: { live_price: 180.25, volume: 3000 },
      } } },
    ]);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(session, "SENSEX", "2026-10-22"));
    expect(spotPrice).toBe(81234.5);
    expect(chain).toHaveLength(1);
    expect(chain[0].ce).toMatchObject({ ltp: 420.5, bidPrice: 420, askPrice: 421, volume: 5000 });
    expect(chain[0].pe.ltp).toBe(180.25);
  });

  it("falls back to per-code quotes when the batch is rejected for one unquotable strike", async () => {
    const all = "NIDX_40000001%2CNFO_73871%2CNFO_73872";
    stub([
      ...fx.byCapability.optionChain.responses.filter((r) => r.url),
      { method: "GET", urlPattern: `scrip-codes=${all}$`, status: 400, json: { debug_info: "Invalid scrip codes or mode", message: "Bad Request" } },
      { method: "GET", urlPattern: "scrip-codes=NIDX_40000001$", json: { status: "success", data: { NIDX_40000001: { live_price: 25000 } } } },
      { method: "GET", urlPattern: "scrip-codes=NFO_73871$", json: { status: "success", data: { NFO_73871: { live_price: 210 } } } },
      { method: "GET", urlPattern: "scrip-codes=NFO_73872$", status: 400, json: { debug_info: "Invalid scrip codes or mode", message: "Bad Request" } },
    ]);
    const { chain } = toOptionData(await adapter.fetchOptionChain(session, "NIFTY", "2026-10-27"));
    expect(chain[0].ce.ltp).toBe(210);
    expect(chain[0].pe.ltp).toBe(0);
  });

  it("parses comma-formatted depth strings and maps statuses / exchanges", () => {
    expect(clean("1,102.60")).toBe(1102.6);
    expect(orderStatusOf("O-PENDING")).toBe("OPEN");
    expect(orderStatusOf("INITIATED")).toBe("OPEN");
    expect(orderStatusOf("SUCCESS")).toBe("COMPLETE");
    expect(orderStatusOf("PARTIALLY_EXECUTED")).toBe("PARTIALLY_FILLED");
    expect(orderStatusOf("SL-PENDING")).toBe("TRIGGER_PENDING");
    expect(orderStatusOf("ABORTED")).toBe("REJECTED");
    expect(orderStatusOf("PARTIALLY FILLED - CANCELLED")).toBe("CANCELLED");
    expect(orderStatusOf("something new")).toBe("UNKNOWN");
    expect(exchangeOf("", "DERIVATIVE", "SENSEX")).toBe("BFO");
    expect(exchangeOf("", "DERIVATIVE", "NIFTY")).toBe("NFO");
    expect(exchangeOf("BSE", "EQUITY")).toBe("BSE");
  });
});

describe("indmoney orders", () => {
  const order = { securityId: "73871", exchange: "NFO", side: "SELL", orderType: "LIMIT", product: "INTRADAY", lots: 1, price: 90 };

  it("builds the documented body with algo_id per exchange and units from the resolved lot size", () => {
    expect(adapter.buildOrderBody(order, 65)).toEqual({ txn_type: "SELL", exchange: "NSE", segment: "DERIVATIVE", product: "INTRADAY", order_type: "LIMIT", validity: "DAY", security_id: "73871", qty: 65, algo_id: "99999", is_amo: false, limit_price: 90 });
    expect(adapter.buildOrderBody({ ...order, exchange: "BFO", orderType: "MARKET", price: undefined }, 20)).toMatchObject({ exchange: "BSE", algo_id: "9999999999999999", order_type: "MARKET", qty: 20 });
    expect(adapter.buildOrderBody({ ...order, exchange: "BFO", orderType: "MARKET" }, 20).limit_price).toBeUndefined();
  });

  it("refuses unsupported or unsafe input before any call", () => {
    expect(() => adapter.buildOrderBody({ ...order, orderType: "SL" }, 65)).toThrow(/Smart Order/);
    expect(() => adapter.buildOrderBody(order, 0)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, 65)).toThrow(/F&O/);
    expect(() => adapter.buildModifyBody("XYZ-1", { qty: 1, price: 1 })).toThrow(/order id/);
    expect(adapter.buildModifyBody("DRV-2049", { qty: 75, price: 73 })).toEqual({ order_id: "DRV-2049", segment: "DERIVATIVE", qty: 75, limit_price: 73 });
  });

  it("refuses without a gate, with a forged gate and with a reused gate, before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(session, order, 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.cancelOrder(session, "EQ-93842477", { action: "cancelOrder", brokerId: "indmoney" })).rejects.toBeInstanceOf(OrderGateError);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "indmoney" });
    await adapter.placeOrder(session, { ...order, lots: 0 }, 65, gate).catch(() => {});
    await expect(adapter.placeOrder(session, order, 65, gate)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("indmoney feed", () => {
  class FakeWs extends EventEmitter {
    static last = null;
    constructor(url, opts) {
      super();
      this.url = url;
      this.opts = opts;
      this.sent = [];
      FakeWs.last = this;
    }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.emit("close"); }
  }

  it("connects with the raw token, subscribes SEGMENT:TOKEN codes and maps LTP ticks back to refs", () => {
    const ticks = [];
    const status = [];
    const feed = adapter.createFeed(session, { onTick: (q) => ticks.push(q), onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
    const ws = FakeWs.last;
    expect(ws.url).toBe("wss://ws-prices.indstocks.com/api/v1/ws/prices");
    expect(ws.opts.headers.Authorization).toBe("dummy-indstocks-token");
    feed.subscribe([{ token: "2885", exchange: "NSE" }, { token: "40000001", exchange: "NSE", isIndex: true }]);
    expect(ws.sent).toHaveLength(0); // not open yet
    ws.emit("open");
    expect(ws.sent[0]).toEqual({ action: "subscribe", mode: "ltp", instruments: ["NSE:2885", "NIDX:40000001"] });
    ws.emit("message", Buffer.from(JSON.stringify({ mode: "ltp", instrument: "2885", timestamp: 1750138351089, data: { ltp: 1426 } })));
    ws.emit("message", "heartbeat");
    expect(ticks).toEqual([{ token: "2885", exchange: "NSE", ltp: 1426, open: null, high: null, low: null, close: null, volume: null, oi: null, bid: null, ask: null }]);
    feed.unsubscribe([{ token: "2885", exchange: "NSE" }]);
    expect(ws.sent[1]).toEqual({ action: "unsubscribe", mode: "ltp", instruments: ["NSE:2885"] });
    feed.close();
    expect(status.map((s) => s.connected)).toEqual([true, false]);
  });

  it("parses quote-mode ticks and refuses to open without a session", () => {
    expect(parseTick('{"mode":"quote","instrument":"2885","timestamp":1784185315958,"data":{"open":1295.5,"high":1309.4,"low":1295.5,"close":1305.4,"volume":6228599}}')).toMatchObject({ token: "2885", close: 1305.4, volume: 6228599, ltp: null });
    expect(wsCode({ token: "51011", exchange: "NFO" })).toBe("NFO:51011");
    expect(() => adapter.createFeed({ clientId: "x" }, {}, { WebSocketImpl: FakeWs })).toThrow(SessionRequiredError);
  });
});
