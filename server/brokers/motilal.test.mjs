/**
 * Motilal Oswal adapter on the contract harness. No network (fetch is stubbed) and the shared instrument cache is
 * replaced by a per-test in-memory map. Login itself is also covered by sessionLogin.test.mjs.
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
import * as adapter from "./motilal.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { compactFo, expiryFromScripname, listExpiries, parseCsv, strikeMapForExpiry, toInstrument } from "./motilalInstruments.mjs";
import { mapOrderStatus, mapTrade, mapFunds } from "./motilalPortfolio.mjs";
import { readLtpData } from "./motilalMarket.mjs";

const fx = loadFixtures("motilal");
const csvOf = (name) => fx.byCapability.instruments.responses.find((r) => r.url.endsWith(`name=${name}`)).text;
const nsefo = compactFo(parseCsv(csvOf("NSEFO")), "NSEFO");
const bsefo = compactFo(parseCsv(csvOf("BSEFO")), "BSEFO");
const session = fx.byCapability.optionChain.creds;
const creds = { ...fx.manifest.creds, ...session };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const opts = (rows, root) => rows.filter((r) => r.root === root && r.optType);

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("motilal contract", () => {
  it("is on the strict contract with a session login", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed")].sort());
    expect(report.results.filter((r) => !["normaliseError", "expiries"].includes(r.capability) && r.calls === 0)).toEqual([]);
  });
});

describe("motilal scrip master mapping", () => {
  it("reads the expiry from the scripname", () => {
    expect(expiryFromScripname("BANKNIFTY 03-Feb-2022 PE 32300")).toBe("2022-02-03");
    expect(expiryFromScripname("NIFTY 20-Oct-2026 CE 25000")).toBe("2026-10-20");
    expect(expiryFromScripname("RELIANCE")).toBeNull();
  });

  it("lists NIFTY weekly + monthly, SENSEX (BSX) weekly, BANKEX (BKX) and stock expiries", () => {
    expect(listExpiries(opts(nsefo, "NIFTY"))).toEqual(["2026-10-20", "2026-10-27"]);
    expect(listExpiries(opts(bsefo, "SENSEX"))).toEqual(["2026-10-22"]);
    expect(listExpiries(opts(bsefo, "BANKEX"))).toEqual(["2026-10-29"]);
    expect(listExpiries(opts(nsefo, "RELIANCE"))).toEqual(["2026-10-27"]);
  });

  it("maps instruments with lot sizes and drops non-canonical index options", () => {
    expect(strikeMapForExpiry(opts(nsefo, "NIFTY"), "2026-10-20").get("25000")).toEqual({
      ce: { token: "52826", exchangename: "NSEFO", lotSize: 65 }, pe: { token: "52827", exchangename: "NSEFO", lotSize: 65 },
    });
    expect(toInstrument(bsefo[0])).toMatchObject({ exchange: "BFO", underlying: "SENSEX", instrumentType: "OPTIDX", strike: 82000, lotSize: 20 });
    expect(toInstrument(nsefo.find((r) => r.token === "55001"))).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
    expect(toInstrument(nsefo.find((r) => r.token === "53002"))).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(toInstrument(nsefo.find((r) => r.token === "56001"))).toBeNull();
  });
});

describe("motilal market data and books", () => {
  it("converts getltpdata paise to rupees and builds the chain with locally solved greeks", async () => {
    expect(readLtpData({ status: "SUCCESS", data: { ltp: 3224, bid: 3230, ask: 3239, volume: 7017 } })).toMatchObject({ ltp: 32.24, bid: 32.3, ask: 32.39, volume: 7017 });
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 0, volume: 543025, bidPrice: 104.55, askPrice: 104.85 });
    expect(atm.ce.iv).toBeGreaterThan(1);
  });

  it("marks OI unavailable instead of sending zeros, and windows the chain around ATM", async () => {
    expect(adapter.capabilities.optionChain.oi).toBe(false);
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    for (const e of Object.values(r.data.oc)) for (const leg of [e.ce, e.pe].filter(Boolean)) expect(leg).not.toHaveProperty("oi");
    const entries = Array.from({ length: 100 }, (_, i) => [String(20000 + i * 100), {}]);
    const picked = adapter.strikesAroundAtm(entries, 25012, 15).map(([k]) => Number(k));
    expect(picked).toHaveLength(31);
    expect(picked[15]).toBe(25000);
    expect(adapter.strikesAroundAtm(entries, 99999, 15).at(-1)[0]).toBe("29900");
    expect(adapter.strikesAroundAtm(entries.slice(0, 10), 25012, 15)).toHaveLength(10);
  });

  it("refuses before any download or broker call when not logged in", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList(fx.manifest.creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("maps MO8002 (token expired) to SessionRequiredError and an empty book code to an empty list", async () => {
    stub([{ method: "POST", urlPattern: "getorderbook$", json: { status: "FAILURE", message: "Token Expired", errorcode: "MO8002", data: null } }]);
    await expect(adapter.fetchOrderBook(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "POST", urlPattern: "getorderbook$", json: { status: "FAILURE", message: "Order Not Found", errorcode: "MO1013", data: null } }]);
    await expect(adapter.fetchOrderBook(creds)).resolves.toEqual({ status: "success", data: [] });
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "motilal" });
    stub([{ method: "POST", urlPattern: "placeorder$", json: { status: "ERROR", message: "Invalid Product Type Parameter", errorcode: "MO1057" } }]);
    const err = await adapter.placeOrder(creds, fx.byCapability.placeOrder.args[0], 65, gate).catch((e) => e);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502, code: "UPSTREAM_INPUT" });
  });

  it("scales trade-book prices by precision and maps funds from the margin summary", () => {
    expect(mapTrade({ tradeprice: 278400, tradeqty: 20, precision: 2, tradeno: "1", uniqueorderid: "U1", exchange: "MCX" })).toMatchObject({ price: 2784, qty: 20, exchange: "MCX" });
    expect(mapFunds(fx.byCapability.funds.responses[0].json.data)).toEqual({ availableCash: 239872.5, usedMargin: 10127.5, totalBalance: 250000, collateral: 0, withdrawable: null });
  });

  it("normalises errors with secrets redacted", () => {
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(adapter.normaliseError(new Error("Motilal Oswal login failed: Invalid TOTP (errorcode: MO1093)"))).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(adapter.normaliseError(new Error("auth dummy-auth-token bad"), { secrets: ["dummy-auth-token"] }).message).not.toContain("dummy-auth-token");
  });
});

describe("motilal orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the documented order statuses", () => {
    expect(mapOrderStatus({ orderstatus: "Traded" })).toBe("COMPLETE");
    expect(mapOrderStatus({ orderstatus: "Confirm" })).toBe("OPEN");
    expect(mapOrderStatus({ orderstatus: "Sent" })).toBe("OPEN");
    expect(mapOrderStatus({ orderstatus: "Partial" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ orderstatus: "Cancel" })).toBe("CANCELLED");
    expect(mapOrderStatus({ orderstatus: "ERROR" })).toBe("REJECTED");
    expect(mapOrderStatus({ orderstatus: "Unknown" })).toBe("UNKNOWN");
  });

  it("sends quantity in lots, F&O as NORMAL only, priced orders only", () => {
    expect(adapter.buildOrderBody(order, lot)).toMatchObject({ exchange: "NSEFO", producttype: "NORMAL", quantityinlot: 2, ordertype: "LIMIT", orderduration: "DAY" });
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 100 }, lot)).toMatchObject({ ordertype: "STOPLOSS", triggerprice: 100 });
    expect(() => adapter.buildOrderBody({ ...order, product: "INTRADAY" }, lot)).toThrow(/NORMAL/);
    expect(adapter.buildOrderBody({ ...order, exchange: "NSE", token: "1660", product: "INTRADAY" }, 1)).toMatchObject({ exchange: "NSE", producttype: "VALUEPLUS" });
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
  });

  it("refuses a modify quantity that is not a whole number of lots", () => {
    const row = fx.byCapability.orderBook.responses[0].json.data[0];
    expect(() => adapter.buildModifyBody(row, { price: 100, qty: 100 })).toThrow(/multiple of the lot size/);
    expect(adapter.buildModifyBody(row, { price: 100, qty: 195 })).toMatchObject({ newquantityinlot: 3, lastmodifiedtime: "20-Oct-2026 10:05:01" });
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrong = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "kotak" });
    await expect(adapter.placeOrder(creds, order, lot, wrong)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
