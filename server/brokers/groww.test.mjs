/**
 * Groww on the contract harness. No network: fetch is stubbed and the instrument cache is an in-memory map
 * per test, so nothing touches the developer's .cache directory.
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
import * as adapter from "./groww.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetGrowwAuth, checksumFor, nextIst6AmMs } from "./growwAuth.mjs";
import { listExpiries, optionRows, parseCsv, spotRow, toMasterRow } from "./growwInstruments.mjs";
import { candleTime, parseOhlc } from "./growwMarket.mjs";
import { exchangeOf, orderStatusOf } from "./growwPortfolio.mjs";

const fx = loadFixtures("groww");
const csv = fx.byCapability.instruments.responses[0].text;
const master = parseCsv(csv).map(toMasterRow).filter(Boolean);
const creds = { ...fx.manifest.creds };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => {
  cache.__clear();
  __resetGrowwAuth();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("groww contract", () => {
  it("is on the strict contract with no secret credential fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("apiKeyToken");
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth").sort());
  }, 30_000);
});

describe("groww auth", () => {
  it("refuses a logged-out caller before downloading the instrument master", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList({}, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchOptionChain({ apiKey: "only-key" }, "NIFTY", "2026-10-20")).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("computes the documented checksum: SHA-256(secret + epoch seconds)", () => {
    expect(checksumFor("abc", "")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("expires sessions at the next 6:00 AM IST", () => {
    const fiveAmIst = Date.UTC(2026, 9, 17, 5, 0) - 5.5 * 3600_000;
    expect(nextIst6AmMs(fiveAmIst)).toBe(Date.UTC(2026, 9, 17, 6, 0) - 5.5 * 3600_000);
    const sevenAmIst = Date.UTC(2026, 9, 17, 7, 0) - 5.5 * 3600_000;
    expect(nextIst6AmMs(sevenAmIst)).toBe(Date.UTC(2026, 9, 18, 6, 0) - 5.5 * 3600_000);
  });

  it("sends the documented headers and uses a pasted access token without a token exchange", async () => {
    const s = stub([{ method: "GET", url: "https://api.groww.in/v1/user/detail", json: { status: "SUCCESS", payload: { active_segments: ["CASH"] } } }]);
    const res = await adapter.testConnection({ accessToken: "pasted-token-123" });
    expect(res.status).toBe("success");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers).toMatchObject({ Authorization: "Bearer pasted-token-123", Accept: "application/json", "X-API-VERSION": "1.0" });
  });

  it("re-exchanges the key pair once on a 401 and caches the session by a hash, not the raw values", async () => {
    let n = 0;
    const s = stub([
      { method: "POST", url: "https://api.groww.in/v1/token/api/access", json: { token: "t-1" } },
    ]);
    const inner = s.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/v1/user/detail")) {
        n++;
        return new Response(JSON.stringify(n === 1 ? { status: "FAILURE", error: { code: "GA005", message: "x" } } : { status: "SUCCESS", payload: {} }), { status: n === 1 ? 401 : 200 });
      }
      return inner(url, init);
    };
    const res = await adapter.testConnection(creds);
    expect(res.status).toBe("success");
    expect(s.calls.filter((c) => c.url.endsWith("/token/api/access"))).toHaveLength(2);
    expect(JSON.stringify(s.calls.map((c) => c.body))).not.toContain(creds.apiSecret);
  });

  it("reports a rejected pasted token as an upstream auth error (no retry, no secret in the message)", async () => {
    stub([{ method: "GET", url: "https://api.groww.in/v1/positions/user", status: 401, json: { status: "FAILURE", error: { code: "GA005", message: "User not authorised" } } }]);
    const err = await adapter.fetchPositions({ accessToken: "expired-token-xyz" }).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_AUTH");
    expect(adapter.normaliseError(err, { secrets: ["expired-token-xyz"] })).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(err.message).not.toContain("expired-token-xyz");
  });

  it("maps rate limiting and session errors through normaliseError", async () => {
    stub([{ method: "GET", url: "https://api.groww.in/v1/holdings/user", status: 429, json: { status: "FAILURE", error: { code: "GA003", message: "Too many requests" } } }]);
    const err = await adapter.fetchHoldings({ accessToken: "tok-abcdef" }).catch((e) => e);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(adapter.normaliseError(new Error("boom S3cretValue"), { secrets: ["S3cretValue"] }).message).not.toContain("S3cretValue");
  });
});

describe("groww symbol mapping", () => {
  it("maps the six index underlyings, stock options and drops non-canonical index derivatives and commodities", () => {
    const opts = (u) => optionRows(master, u);
    for (const u of ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"]) expect(opts(u).length).toBeGreaterThan(0);
    expect(opts("NIFTY").every((m) => m.instrumentType === "OPTIDX" && m.exchange === "NFO")).toBe(true);
    expect(opts("SENSEX").every((m) => m.exchange === "BFO" && m.lotSize === 20)).toBe(true);
    expect(opts("RELIANCE").every((m) => m.instrumentType === "OPTSTK" && m.lotSize === 500)).toBe(true);
    expect(master.some((m) => m.underlying === "NIFTYNXT50")).toBe(false);
    expect(master.some((m) => m.tradingSymbol.startsWith("CRUDEOIL"))).toBe(false);
    const fut = master.find((m) => m.tradingSymbol === "NIFTY26OCTFUT");
    expect(fut).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null, expiry: "2026-10-27" });
  });

  it("lists NIFTY weekly + monthly and SENSEX weekly expiries in ISO order", () => {
    expect(listExpiries(master, "NIFTY")).toEqual(["2026-10-27", "2026-11-03"]);
    expect(listExpiries(master, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(master, "RELIANCE")).toEqual(["2026-10-27"]);
  });

  it("finds the spot rows Groww quotes indices by (MIDCPNIFTY is NIFTYMIDSELECT)", () => {
    expect(spotRow(master, "MIDCPNIFTY")).toMatchObject({ growwExchange: "NSE", tradingSymbol: "NIFTYMIDSELECT" });
    expect(spotRow(master, "SENSEX")).toMatchObject({ growwExchange: "BSE", tradingSymbol: "SENSEX" });
    expect(spotRow(master, "RELIANCE")).toMatchObject({ growwExchange: "NSE", instrumentType: "EQ" });
  });

  it("requests SENSEX chains on BSE and returns broker IV in percent", async () => {
    stub([
      ...fx.byCapability.optionChain.responses.filter((r) => !r.url?.includes("/option-chain/")),
      { method: "GET", url: "https://api.groww.in/v1/option-chain/exchange/BSE/underlying/SENSEX?expiry_date=2026-10-22",
        json: { status: "SUCCESS", payload: { underlying_ltp: 81234.5, strikes: { 81000: { CE: { greeks: { delta: 0.55, gamma: 0.0004, theta: -30, vega: 20, rho: 3, iv: 11.9 }, trading_symbol: "SENSEX26O2281000CE", ltp: 420.5, open_interest: 12000, volume: 5000 } } } } } },
    ]);
    const res = await adapter.fetchOptionChain(creds, "SENSEX", "2026-10-22");
    const { spotPrice, chain } = toOptionData(res);
    expect(spotPrice).toBe(81234.5);
    expect(chain[0]).toMatchObject({ strikePrice: 81000, ce: { ltp: 420.5, iv: 11.9, oi: 12000 } });
  });

  it("picks the nearest expiry when none is given and refuses unknown symbols before any API call", async () => {
    const s = stub(fx.byCapability.optionChain.responses.filter((r) => !r.url?.includes("/option-chain/")).concat([
      { method: "GET", url: "https://api.groww.in/v1/option-chain/exchange/NSE/underlying/NIFTY?expiry_date=2026-10-27", json: { status: "SUCCESS", payload: { underlying_ltp: 25000, strikes: {} } } },
    ]));
    await adapter.fetchOptionChain(creds, "NIFTY");
    expect(s.calls.some((c) => c.url.includes("expiry_date=2026-10-27"))).toBe(true);
    await expect(adapter.fetchOptionChain(creds, "NOSUCH", "2026-10-27")).rejects.toBeInstanceOf(BrokerInputError);
  });

  it("parses Groww's string OHLC and IST candle timestamps", () => {
    expect(parseOhlc("{open: 149.50,high: 150.50,low: 148.50,close: 149.50}")).toEqual({ open: 149.5, high: 150.5, low: 148.5, close: 149.5 });
    expect(candleTime("2025-09-24T10:30:00")).toBe(Date.UTC(2025, 8, 24, 5, 0) / 1000);
    expect(candleTime(1633072800)).toBe(1633072800);
  });

  it("maps order statuses and exchanges", () => {
    expect(orderStatusOf("ACKED")).toBe("OPEN");
    expect(orderStatusOf("OPEN", 5, 5)).toBe("PARTIALLY_FILLED");
    expect(orderStatusOf("TRIGGER_PENDING")).toBe("TRIGGER_PENDING");
    expect(orderStatusOf("DELIVERY_AWAITED")).toBe("COMPLETE");
    expect(orderStatusOf("FAILED")).toBe("REJECTED");
    expect(orderStatusOf("CANCELLATION_REQUESTED")).toBe("OPEN");
    expect(orderStatusOf("weird")).toBe("UNKNOWN");
    expect(exchangeOf("BSE", "FNO")).toBe("BFO");
    expect(exchangeOf("NSE", undefined, "NIFTY26OCT25000CE")).toBe("NFO");
    expect(exchangeOf("NSE", undefined, "RELIANCE")).toBe("NSE");
  });
});

describe("groww orders", () => {
  const order = { tradingSymbol: "NIFTY26OCT25000CE", exchange: "NFO", side: "SELL", orderType: "SL", product: "INTRADAY", lots: 1, price: 90, triggerPrice: 91 };

  it("builds the documented create body with units from the resolved lot size", () => {
    const body = adapter.buildOrderBody(order, 65, "ABCD1234EFGH");
    expect(body).toEqual({ trading_symbol: "NIFTY26OCT25000CE", quantity: 65, price: 90, trigger_price: 91, validity: "DAY", exchange: "NSE", segment: "FNO", product: "MIS", order_type: "SL", transaction_type: "SELL", order_reference_id: "ABCD1234EFGH" });
    expect(adapter.buildOrderBody({ ...order, orderType: "SL-M", price: undefined }, 65, "ABCD1234EFGH")).toMatchObject({ order_type: "SL_M", price: 0, trigger_price: 91 });
  });

  it("refuses bad input before any call", () => {
    expect(() => adapter.buildOrderBody(order, 0)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody({ ...order, validity: "IOC" }, 65)).toThrow(/DAY/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, 65)).toThrow(/F&O/);
    expect(() => adapter.buildOrderBody({ ...order, exchange: "MCX" }, 65)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody({ ...order, orderType: "SL", triggerPrice: undefined }, 65)).toThrow(/triggerPrice/);
  });

  it("refuses without a gate, with a forged gate and with a reused gate, before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, order, 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.cancelOrder(creds, "GMK39038RDT490CCVRO", { action: "cancelOrder", brokerId: "groww" })).rejects.toBeInstanceOf(OrderGateError);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "groww" });
    await adapter.placeOrder(creds, { ...order, lots: 0 }, 65, gate).catch(() => {});
    await expect(adapter.placeOrder(creds, order, 65, gate)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
