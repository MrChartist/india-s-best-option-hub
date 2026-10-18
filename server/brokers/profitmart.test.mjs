/**
 * Profitmart (ProfitMax API, Noren) adapter on the contract harness. No network: fetch is stubbed, and the
 * instrument cache is an in-memory map so nothing touches the developer's .cache directory.
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
import * as adapter from "./profitmart.mjs";
import { OAUTH_LOGIN_URL, REST_ROOT, resetSessions, resolveExpiresAt } from "./profitmartAuth.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { encodeJData } from "./shoonyaNorenCore.mjs";

const fx = loadFixtures("profitmart");
const creds = { ...fx.manifest.creds };
const UID = creds.clientId;
const auth = fx.byCapability.testConnection.responses[0];
const masters = fx.byCapability.instruments.responses.slice(1);
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const restCalls = (s) => s.calls.filter((c) => c.method === "POST" && !c.url.endsWith("/GenAcsTok"));

beforeEach(() => {
  cache.__clear();
  resetSessions();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T05:00:00Z"));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("profitmart contract", () => {
  it("is on the strict contract with no warnings and no feed", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("requestTokenExchange");
    expect(adapter.capabilities.feed).toBeUndefined();
    expect(adapter.createFeed).toBeUndefined();
    expect(adapter.credentialFields).toEqual(["clientId", "apiKey", "apiSecret", "requestCode", "accessToken"]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth").sort());
  });

  it("points at the production host and builds the OAuth login link", () => {
    expect(REST_ROOT).toBe("https://profitmax.profitmart.in/NorenWClientAPI");
    expect(adapter.loginUrl("abc 1")).toBe(`${OAUTH_LOGIN_URL}?client_id=abc%201`);
  });
});

describe("profitmart instruments", () => {
  it("reads the live master layouts (BFO extra columns, BFO_Symbol.txt entry) and keeps SENSEX50 / NIFTYNXT50 out", async () => {
    stub([auth, ...masters]);
    const rows = (await adapter.fetchInstruments(creds)).data;
    expect(rows.find((r) => r.token === "825001")).toMatchObject({ instrumentType: "OPTIDX", underlying: "SENSEX", strike: 82000, optionType: "CE", lotSize: 20, exchange: "BFO", expiry: "2026-10-22" });
    expect(rows.find((r) => r.token === "825101")).toMatchObject({ underlying: "BANKEX", expiry: "2026-10-29" });
    expect(rows.some((r) => r.tradingSymbol.startsWith("SENSEX50"))).toBe(false);
    expect(rows.some((r) => r.tradingSymbol.startsWith("NIFTYNXT50"))).toBe(false);
    expect(rows.some((r) => r.token === "1165536")).toBe(false); // BFO stock option: not served
    expect(rows.find((r) => r.token === "106743")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
    expect(rows.find((r) => r.token === "2885")).toMatchObject({ instrumentType: "EQ", underlying: "RELIANCE", tickSize: 0.1 });
    expect(rows.filter((r) => r.instrumentType === "INDEX")).toHaveLength(6);
  });

  it("lists expiries per underlying", async () => {
    stub([auth, ...masters]);
    expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
    expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
    expect((await adapter.fetchExpiryList(creds, "RELIANCE")).data).toEqual(["2026-10-27"]);
  });
});

describe("profitmart option chain", () => {
  it("builds Dhan-shaped legs with OI change, bid/ask and locally solved IV", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    expect(chain.map((c) => c.strikePrice)).toEqual([24950, 25000, 25050]);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 3165900, oiChange: 233400, bidPrice: 104.85, askPrice: 105.05 });
    expect(atm.ce.iv).toBeGreaterThan(1);
    expect(atm.ce.iv).toBeLessThan(100);
  });
});

describe("profitmart session and transport", () => {
  it("sends a Bearer header and a text/plain jData body (no jKey)", async () => {
    const s = stub(fx.byCapability.funds.responses);
    const r = await adapter.fetchFunds(creds);
    expect(r.data).toMatchObject({ availableCash: 1500000 - 394554, usedMargin: 394554 });
    const [c] = restCalls(s);
    expect(c.headers.Authorization).toBe("Bearer dummyProfitmartAccessToken");
    expect(c.headers["Content-Type"]).toBe("text/plain");
    expect(c.body).not.toContain("jKey");
  });

  it("exchanges the one-time code once, even under concurrent calls", async () => {
    const s = stub([auth, ...fx.byCapability.funds.responses.slice(1), ...fx.byCapability.positions.responses.slice(1)]);
    await Promise.all([adapter.fetchFunds(creds), adapter.fetchPositions(creds), adapter.fetchFunds(creds)]);
    expect(s.calls.filter((c) => c.url === auth.url)).toHaveLength(1);
  });

  it("never re-sends a code after the broker rejects the session", async () => {
    stub([auth, { method: "POST", urlPattern: "/Limits$", json: { stat: "Not_Ok", emsg: "Session Expired :  Invalid Session Key" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    const s = stub([auth, ...fx.byCapability.funds.responses]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(s.calls).toHaveLength(0);
  });

  it("maps a refused code (documented 'invalid verifier' failure) to SessionRequiredError", async () => {
    stub([{ ...auth, json: { stat: "Not_Ok", emsg: "Invalid Input : Invalid verifier", uid: UID } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it("uses a pasted accessToken without a code exchange", async () => {
    const s = stub([{ method: "POST", urlPattern: "/Limits$", json: { stat: "Ok", cash: "1000", marginused: "250" } }]);
    expect((await adapter.fetchFunds({ clientId: UID, accessToken: "pastedToken" })).data).toMatchObject({ availableCash: 750 });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers.Authorization).toBe("Bearer pastedToken");
  });

  it("refuses before any network call when credentials are missing", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList({ clientId: "X" }, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
    expect((await adapter.testConnection({})).status).toBe("error");
    expect(s.calls).toHaveLength(0);
  });

  it("reads expires_in as seconds or an epoch, never past the 05:00 IST reset", () => {
    const now = Date.UTC(2026, 9, 17, 5, 0, 0);
    expect(resolveExpiresAt(28800, now)).toBe(now + 28_800_000);
    expect(resolveExpiresAt(undefined, now)).toBe(Date.UTC(2026, 9, 17, 23, 30, 0));
    expect(resolveExpiresAt(10 * 86400, now)).toBe(Date.UTC(2026, 9, 17, 23, 30, 0));
  });
});

describe("profitmart books", () => {
  it("flattens the documented nested Trade Book array", async () => {
    stub(fx.byCapability.tradeBook.responses);
    const r = await adapter.fetchTradeBook(creds);
    expect(r.data).toEqual([expect.objectContaining({ tradeId: "180", orderId: "26011500000656", tradingSymbol: "EDELWEISS-EQ", side: "BUY", qty: 1, price: 120 })]);
  });

  it("also reads a flat Trade Book and treats 'no data' as empty", async () => {
    stub([{ method: "POST", urlPattern: "/TradeBook$", json: [{ stat: "Ok", exch: "NFO", tsym: "X", norenordno: "1", flid: "2", trantype: "S", flqty: "65", flprc: "10" }] }]);
    expect((await adapter.fetchTradeBook({ clientId: UID, accessToken: "t" })).data[0]).toMatchObject({ side: "SELL", qty: 65 });
    stub([{ method: "POST", urlPattern: "/TradeBook$", json: { stat: "Not_Ok", emsg: "Error Occurred : 5 \"no data\"" } }]);
    expect((await adapter.fetchTradeBook({ clientId: UID, accessToken: "t" })).data).toEqual([]);
  });

  it("maps the documented order book (CANCELED, epoch ordenttm) and holdings", async () => {
    stub(fx.byCapability.orderBook.responses);
    const orders = (await adapter.fetchOrderBook(creds)).data;
    expect(orders[0]).toMatchObject({ status: "PARTIALLY_FILLED", pendingQty: 65, product: "MARGIN" });
    expect(orders[1]).toMatchObject({ status: "CANCELLED", placedAt: "2025-12-11T15:08:10+05:30" });
    stub(fx.byCapability.holdings.responses.slice(1));
    expect((await adapter.fetchHoldings(creds)).data).toEqual([expect.objectContaining({ tradingSymbol: "BALAJEE-EQ", exchange: "NSE", qty: 10, avgPrice: 400 })]);
  });
});

describe("profitmart orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("builds LMT / SL-LMT bodies from the master lot size and refuses market orders and other products", () => {
    expect(adapter.buildOrderBody(UID, order, lot)).toMatchObject({ exch: "NFO", qty: "130", prc: "104.5", prd: "M", trantype: "B", prctyp: "LMT", ret: "DAY" });
    expect(() => adapter.buildOrderBody(UID, order)).toThrow(/resolved lot size/);
    expect(() => adapter.buildOrderBody(UID, { ...order, orderType: "MARKET" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody(UID, { ...order, product: "MTF" }, lot)).toThrow(BrokerInputError);
    expect(adapter.buildOrderBody(UID, { ...order, orderType: "STOP_LOSS", triggerPrice: 100 }, lot)).toMatchObject({ prctyp: "SL-LMT", trgprc: "100" });
    expect(encodeJData({ tsym: "M&M-EQ" })).toBe("{\"tsym\":\"M\\u0026M-EQ\"}");
  });

  it("never sends an order without a fresh gate for this broker and action", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "shoonya" });
    await expect(adapter.placeOrder(creds, order, lot, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
    const wrongAction = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "profitmart" });
    await expect(adapter.placeOrder(creds, order, lot, wrongAction)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.cancelOrder(creds, "1")).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("places with a valid gate and returns the Noren order number", async () => {
    stub(fx.byCapability.placeOrder.responses);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "profitmart" });
    expect(await adapter.placeOrder(creds, order, lot, gate)).toEqual({ orderId: "26101700000017", orderStatus: "UNKNOWN" });
  });
});

describe("profitmart error normalisation", () => {
  it("redacts secrets, keeps 422 for refusals and maps rate limits", () => {
    expect(adapter.normaliseError(new Error("bad dummyProfitmartSecret"), { secrets: ["dummyProfitmartSecret"] }).message).not.toContain("dummyProfitmartSecret");
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(adapter.normaliseError(new Error("Rate_Limited"))).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
  });
});
