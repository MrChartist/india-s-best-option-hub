/**
 * Angel One adapter on the contract harness. No network (fetch is stubbed), and the shared instrument
 * cache is replaced by a per-test in-memory map so nothing touches the developer's .cache directory.
 * Login itself is covered by sessionLogin.test.mjs; this file covers every data and order capability.
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
import * as adapter from "./angelone.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { listExpiries, optionRowsForExpiry, indexSpotToken, toInstrument } from "./angeloneInstruments.mjs";
import { mapOrderStatus } from "./angeloneOrders.mjs";

const fx = loadFixtures("angelone");
const master = fx.byCapability.instruments.responses[0].json;
const session = fx.byCapability.optionChain.creds;
const creds = { ...fx.manifest.creds, ...session };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("angelone contract", () => {
  it("is on the strict contract with a session login", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed")].sort());
    // expiries reads the master the instruments step already cached, so it legitimately makes no call.
    expect(report.results.filter((r) => !["normaliseError", "expiries"].includes(r.capability) && r.calls === 0)).toEqual([]);
  });
});

describe("angelone scrip master mapping", () => {
  it("lists NIFTY weekly + monthly, SENSEX weekly and stock expiries in ISO order", () => {
    expect(listExpiries(master, "NIFTY")).toEqual(["2026-10-20", "2026-10-27"]);
    expect(listExpiries(master, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(master, "BANKEX")).toEqual(["2026-10-29"]);
    expect(listExpiries(master, "RELIANCE")).toEqual(["2026-10-27"]);
  });

  it("converts paise strikes and finds spot tokens for indices and stocks", () => {
    const rows = optionRowsForExpiry(master, "NIFTY", "2026-10-27");
    expect(rows).toEqual([{ token: "51440", strike: 25000, type: "ce", exch_seg: "NFO", symbol: "NIFTY27OCT2625000CE" }]);
    expect(optionRowsForExpiry(master, "SENSEX", "2026-10-22")[0]).toMatchObject({ strike: 82000, exch_seg: "BFO" });
    expect(indexSpotToken(master, "SENSEX")).toEqual({ token: "99919000", exch_seg: "BSE" });
    expect(indexSpotToken(master, "BANKEX")).toEqual({ token: "99919012", exch_seg: "BSE" });
    expect(indexSpotToken(master, "RELIANCE")).toEqual({ token: "2885", exch_seg: "NSE" });
  });

  it("maps instruments with tick size in rupees and drops non-canonical index options", () => {
    const stock = toInstrument(master.find((r) => r.token === "106743"));
    expect(stock).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, optionType: "CE", lotSize: 500, tickSize: 0.05, expiry: "2026-10-27" });
    expect(toInstrument(master.find((r) => r.token === "48699"))).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null, tickSize: 0.2 });
    expect(toInstrument(master.find((r) => r.token === "90003"))).toBeNull();
  });
});

describe("angelone option chain", () => {
  it("uses broker greeks where optionGreek covers the strike and Black-Scholes elsewhere", async () => {
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(r);
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, iv: 13.1, delta: 0.51, oi: 165900, volume: 543025, bidPrice: 104.55, askPrice: 104.85 });
    const far = chain.find((c) => c.strikePrice === 25050);
    expect(far.ce.iv).toBeGreaterThan(0); // not in the optionGreek fixture -> solved locally
  });

  it("refuses before any download or broker call when not logged in", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList(fx.manifest.creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("maps AG8002 (token expired) to SessionRequiredError and a rate-limit 403 to UPSTREAM_RATE_LIMIT", async () => {
    stub([{ method: "GET", urlPattern: "getRMS$", json: { status: false, message: "Token Expired", errorcode: "AG8002", data: null } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "GET", urlPattern: "getRMS$", status: 403, text: "Access denied because of exceeding access rate" }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ code: "UPSTREAM_RATE_LIMIT", statusCode: 502 });
  });
});

describe("angelone orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the documented order-status strings", () => {
    expect(mapOrderStatus({ orderstatus: "complete" })).toBe("COMPLETE");
    expect(mapOrderStatus({ orderstatus: "trigger pending" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ orderstatus: "open", filledshares: "65", unfilledshares: "65" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ orderstatus: "after market order req received" })).toBe("OPEN");
    expect(mapOrderStatus({ orderstatus: "rejected" })).toBe("REJECTED");
    expect(mapOrderStatus({ orderstatus: "something new" })).toBe("UNKNOWN");
  });

  it("refuses market and IOC-style orders (Angel One API rule from 1 April 2026) and needs a master lot size", () => {
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_MARKET" }, lot)).toThrow(/market orders/);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(adapter.buildOrderBody({ ...order, lotSize: 1 }, lot).quantity).toBe("130");
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 100 }, lot)).toMatchObject({ variety: "STOPLOSS", triggerprice: "100" });
  });

  const bookRow = (o) => ({ variety: "NORMAL", ordertype: "LIMIT", producttype: "INTRADAY", tradingsymbol: "SBIN-EQ", symboltoken: "3045", exchange: "NSE", orderstatus: "open", ...o });
  const book = (rows) => ({ method: "GET", urlPattern: "getOrderBook$", json: { status: true, message: "SUCCESS", errorcode: "", data: rows } });
  const ack = (path, id) => ({ method: "POST", urlPattern: `${path}$`, json: { status: true, message: "SUCCESS", errorcode: "", data: { orderid: id } } });
  const gateFor = (action) => issueOrderGate({ verdict: { ok: true }, liveArmed: true, action, brokerId: "angelone" });

  it("builds a modify body with every key SmartAPI's modifyOrder sample carries", () => {
    const body = adapter.buildModifyBody("201020000000080", { tradingSymbol: "SBIN-EQ", token: "3045", exchange: "NSE", orderType: "LIMIT", product: "INTRADAY", price: 194, qty: 1 });
    for (const k of ["variety", "orderid", "ordertype", "producttype", "duration", "price", "quantity", "tradingsymbol", "symboltoken", "exchange"]) expect(body, k).toHaveProperty(k);
    expect(body).toMatchObject({ tradingsymbol: "SBIN-EQ", symboltoken: "3045", exchange: "NSE" });
    expect(() => adapter.buildModifyBody("1", { tradingSymbol: "SBIN-EQ", token: "x", exchange: "NSE", price: 1, qty: 1 })).toThrow(/symbol token/);
    expect(() => adapter.buildModifyBody("1", { tradingSymbol: "SBIN-EQ", token: "3045", exchange: "NYSE", price: 1, qty: 1 })).toThrow(/exchange/);
  });

  it("fills the modify instrument keys from a fresh order-book row when the caller omits them", async () => {
    const s = stub([book([bookRow({ orderid: "77" })]), ack("modifyOrder", "77")]);
    await adapter.modifyOrder(creds, "77", { orderType: "LIMIT", product: "INTRADAY", price: 195, qty: 1 }, gateFor("modifyOrder"));
    const sent = JSON.parse(s.calls.find((c) => c.url.endsWith("modifyOrder")).body);
    expect(sent).toMatchObject({ orderid: "77", tradingsymbol: "SBIN-EQ", symboltoken: "3045", exchange: "NSE" });
  });

  it("cancels a resting stop-loss order with its own STOPLOSS variety, read from the order book", async () => {
    const s = stub([book([bookRow({ orderid: "88", variety: "STOPLOSS", ordertype: "STOPLOSS_LIMIT", orderstatus: "trigger pending" })]), ack("cancelOrder", "88")]);
    await adapter.cancelOrder(creds, "88", gateFor("cancelOrder"));
    expect(JSON.parse(s.calls.find((c) => c.url.endsWith("cancelOrder")).body)).toEqual({ variety: "STOPLOSS", orderid: "88" });
    // An explicit variety is used as given, with no book read.
    const s2 = stub([ack("cancelOrder", "88")]);
    await adapter.cancelOrder(creds, "88", { variety: "STOPLOSS" }, gateFor("cancelOrder"));
    expect(s2.calls).toHaveLength(1);
    // An order that is not in the book is refused rather than cancelled under a guessed variety.
    const s3 = stub([book([])]);
    await expect(adapter.cancelOrder(creds, "99", gateFor("cancelOrder"))).rejects.toBeInstanceOf(BrokerInputError);
    expect(s3.calls.filter((c) => c.url.endsWith("cancelOrder"))).toHaveLength(0);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrong = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "angelone" });
    await expect(adapter.placeOrder(creds, order, lot, wrong)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
