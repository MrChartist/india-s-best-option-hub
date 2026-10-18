/**
 * Samco on the contract harness. No network: fetch is stubbed from the official-doc fixtures and the instrument
 * cache is an in-memory map per test, so nothing touches the developer's .cache directory.
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
import * as adapter from "./samco.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetSamcoSessions, nextIst8AmMs } from "./samcoAuth.mjs";
import { parseScripMaster, samcoExpiryToIso } from "./samcoInstruments.mjs";
import { istToEpochSec, num, toIstStamp } from "./samcoMarket.mjs";
import { orderStatusOf } from "./samcoPortfolio.mjs";

const fx = loadFixtures("samco");
const creds = { ...fx.manifest.creds };
const masterCsv = fx.byCapability.instruments.responses[0].text;
const session = fx.byCapability.testConnection.responses[0];
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const IST = 5.5 * 3600_000;

beforeEach(() => {
  cache.__clear();
  __resetSamcoSessions();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("samco contract", () => {
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

describe("samco auth", () => {
  it("expires sessions at the NEXT 08:00 IST (same day before 08:00)", () => {
    const sevenAm = Date.UTC(2026, 9, 17, 7, 0) - IST;
    expect(nextIst8AmMs(sevenAm)).toBe(Date.UTC(2026, 9, 17, 8, 0) - IST);
    const ninePm = Date.UTC(2026, 9, 17, 21, 0) - IST;
    expect(nextIst8AmMs(ninePm)).toBe(Date.UTC(2026, 9, 18, 8, 0) - IST);
  });

  it("sends the session token header and reuses one session across calls", async () => {
    const s = stub(fx.byCapability.ltp.responses);
    await adapter.fetchLTP(creds, "NIFTY");
    await adapter.fetchLTP(creds, "NIFTY");
    expect(s.calls.filter((c) => c.url.endsWith("/session/token"))).toHaveLength(1);
    expect(s.calls[1].headers["x-session-token"]).toBe("dummy-session-jwt");
  });

  it("re-logs in once when a read is refused with 401, but never retries an order", async () => {
    const quote = fx.byCapability.ltp.responses[1];
    let n = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith("/session/token")) return new Response(JSON.stringify(session.json), { status: 200 });
      n += 1;
      if (n === 1) return new Response(JSON.stringify({ status: "Failure", statusMessage: "Session Expired" }), { status: 401 });
      if (init?.method === "POST") throw new Error("must not retry an order");
      return new Response(JSON.stringify(quote.json), { status: 200 });
    };
    expect((await adapter.fetchLTP(creds, "NIFTY")).data.last_price).toBe(25041.35);

    n = 0;
    cache.__clear();
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (String(url).endsWith("/session/token")) return new Response(JSON.stringify(session.json), { status: 200 });
      if (String(url).endsWith(".csv")) return new Response(masterCsv, { status: 200 });
      return new Response(JSON.stringify({ status: "Failure", statusMessage: "The IP is not the registered static IP", errorCode: "EOAUTH009" }), { status: 403 });
    };
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "samco" });
    const order = fx.byCapability.placeOrder.args[0];
    const err = await adapter.placeOrder(creds, order, 65, gate).catch((e) => e);
    expect(adapter.normaliseError(err).code).toBe("UPSTREAM_IP_NOT_ALLOWED");
    expect(calls.filter((u) => u.endsWith("/order/placeOrder"))).toHaveLength(1);
  });

  it("refuses missing credentials before any network call", async () => {
    const s = stub([]);
    const res = await adapter.testConnection({ apiKey: "only-key" });
    expect(res.status).toBe("error");
    expect(s.calls).toHaveLength(0);
  });
});

describe("samco instruments and symbols", () => {
  const rows = parseScripMaster(masterCsv);

  it("parses DD/MM/YY expiries and maps NFO/BFO instrument codes", () => {
    expect(samcoExpiryToIso("20/10/26")).toBe("2026-10-20");
    const sensex = rows.find((r) => r.token === "1125419_BFO");
    expect(sensex).toMatchObject({ underlying: "SENSEX", instrumentType: "OPTIDX", exchange: "BFO", expiry: "2026-10-22", strike: 82000, optionType: "CE", lotSize: 20 });
    expect(rows.find((r) => r.token === "1155242_BFO")).toMatchObject({ underlying: "BANKEX", instrumentType: "OPTIDX" });
    expect(rows.find((r) => r.token === "44001_NFO")).toMatchObject({ underlying: "RELIANCE", instrumentType: "OPTSTK", lotSize: 500 });
    expect(rows.find((r) => r.token === "48704_NFO")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(rows.some((r) => r.exchange === "MFO")).toBe(false);
  });

  it("lists NIFTY weekly + monthly, SENSEX weekly and stock-option expiries ascending", async () => {
    const s = stub([fx.byCapability.instruments.responses[0], session]);
    // Without credentials it refuses before the instrument master is downloaded.
    await expect(adapter.fetchExpiryList({}, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
    expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
    expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
    expect((await adapter.fetchExpiryList(creds, "reliance")).data).toEqual(["2026-10-27"]);
    await expect(adapter.fetchExpiryList(creds, "NIFTY 50!")).rejects.toBeInstanceOf(BrokerInputError);
  });

  it("asks the native chain for SENSEX on BFO", async () => {
    const s = stub([fx.byCapability.instruments.responses[0], session,
      { method: "GET", urlPattern: "optionChain\\?exchange=BFO&searchSymbolName=SENSEX&expiryDate=2026-10-22$", json: { status: "Success", optionChainDetails: [] } },
      { method: "GET", urlPattern: "indexQuote\\?indexName=SENSEX$", json: { status: "Success", indexDetails: [{ spotPrice: 82100.5 }] } },
      { method: "POST", urlPattern: "multiQuote$", json: { status: "Success", multiQuotes: [{ symbol: "1125419_BFO", lastTradePrice: "300.00", openInterest: "1000", previousOpenInterest: "800", totalTradeVolume: "5000", bidPrice: "299.5", askPrice: "300.5" }] } },
    ]);
    const res = await adapter.fetchOptionChain(creds, "SENSEX", "2026-10-22");
    expect(res.data.last_price).toBe(82100.5);
    // Native chain was empty, so the master + multiQuote fallback filled the leg with computed greeks.
    const ce = res.data.oc["82000"].ce;
    expect(ce).toMatchObject({ last_price: 300, oi: 1000, previous_oi: 800, bid_price: 299.5, ask_price: 300.5 });
    expect(ce.iv).toBeGreaterThan(1);
    expect(s.calls.find((c) => c.url.endsWith("/quote/multiQuote")).body).toBe(JSON.stringify({ BFO: ["SENSEX26O2282000CE", "SENSEX26O2282000PE"] }));
  });

  it("maps the native chain onto the app's OptionData with broker IV in percent", async () => {
    stub(fx.byCapability.optionChain.responses);
    const res = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(res);
    expect(spotPrice).toBe(25041.35);
    expect(chain[0]).toMatchObject({ strikePrice: 25000, ce: { ltp: 120.5, oi: 1312350, oiChange: 94825, iv: 13.1337, delta: 0.53, bidPrice: 120.35, askPrice: 120.6 } });
  });
});

describe("samco parsing helpers", () => {
  it("reads numbers with thousands separators", () => {
    expect(num("1,550.00")).toBe(1550);
    expect(num("--")).toBe(0);
  });
  it("converts IST candle stamps to epoch seconds and request bounds to IST", () => {
    expect(istToEpochSec("2026-10-16 09:15:00")).toBe((Date.UTC(2026, 9, 16, 9, 15) - IST) / 1000);
    expect(toIstStamp("2026-10-16")).toBe("2026-10-16 00:00:00");
    expect(toIstStamp("2026-10-16T03:45:00Z")).toBe("2026-10-16 09:15:00");
  });
  it("maps order statuses", () => {
    expect(["Complete", "Pending", "Rejected", "Cancelled", "Trigger Pending", "weird"].map(orderStatusOf)).toEqual(["COMPLETE", "OPEN", "REJECTED", "CANCELLED", "TRIGGER_PENDING", "UNKNOWN"]);
  });
  it("normalises the order book, positions and funds", async () => {
    stub(fx.byCapability.orderBook.responses);
    const orders = (await adapter.fetchOrderBook(creds)).data;
    expect(orders.map((o) => o.status)).toEqual(["COMPLETE", "PARTIALLY_FILLED", "REJECTED", "TRIGGER_PENDING"]);
    expect(orders[2].statusMessage).toBe("Insufficient funds");
    expect(orders[0]).toMatchObject({ product: "MARGIN", orderType: "LIMIT", token: "40001_NFO" });
    stub(fx.byCapability.positions.responses);
    const pos = (await adapter.fetchPositions(creds)).data;
    expect(pos[0]).toMatchObject({ ltp: 1550, netQty: 18, product: "CNC", pnl: -182.7 });
    expect(pos[1]).toMatchObject({ exchange: "NFO", netQty: -65, product: "MARGIN" });
    stub(fx.byCapability.funds.responses);
    expect((await adapter.fetchFunds(creds)).data).toEqual({ availableCash: 109797.5, usedMargin: 15202.5, totalBalance: 125000, collateral: null, withdrawable: null });
  });
  it("treats an empty book reported as Failure + 'No ... found' as an empty list", async () => {
    stub([session, { method: "GET", url: "https://tradeapi.samco.in/order/orderBook", json: { status: "Failure", statusMessage: "No orders found" } }]);
    expect((await adapter.fetchOrderBook(creds)).data).toEqual([]);
  });
});

describe("samco orders", () => {
  const instrument = parseScripMaster(masterCsv).find((r) => r.token === "40001_NFO");
  const equity = parseScripMaster(masterCsv).find((r) => r.token === "2885_NSE");

  it("builds the documented body from the master row and the resolved lot size", () => {
    expect(adapter.buildOrderBody({ token: "40001_NFO", exchange: "NFO", side: "SELL", orderType: "SL", product: "INTRADAY", lots: 1, price: 117.95, triggerPrice: 118.5 }, 65, instrument)).toEqual({
      symbolName: "NIFTY20OCT2625000CE", exchange: "NFO", transactionType: "SELL", orderType: "SL", quantity: "65", price: "117.95", triggerPrice: "118.50", orderValidity: "DAY", productType: "MIS", afterMarketOrderFlag: "NO",
    });
    expect(adapter.buildOrderBody({ token: "2885_NSE", exchange: "NSE", side: "BUY", product: "CNC", lots: 3, price: 1200 }, 1, equity).symbolName).toBe("RELIANCE");
  });

  it("refuses MARKET, a missing lot size and mismatched products", () => {
    const base = { token: "40001_NFO", exchange: "NFO", side: "BUY", product: "MARGIN", lots: 1, price: 100 };
    expect(() => adapter.buildOrderBody({ ...base, orderType: "MARKET" }, 65, instrument)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody(base, undefined, instrument)).toThrow(/lot size/);
    expect(() => adapter.buildOrderBody({ ...base, product: "CNC" }, 65, instrument)).toThrow(/CNC/);
    expect(() => adapter.buildOrderBody({ ...base, exchange: "BFO" }, 65, instrument)).toThrow(/exchange/);
  });

  it("refuses every order call without a valid gate before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, fx.byCapability.placeOrder.args[0], 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.cancelOrder(creds, "261016000000004", { action: "cancelOrder", brokerId: "samco" })).rejects.toBeInstanceOf(OrderGateError);
    const dhanGate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "modifyOrder", brokerId: "dhan" });
    await expect(adapter.modifyOrder(creds, "261016000131756", { qty: 65, price: 1 }, dhanGate)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("samco errors", () => {
  it("maps upstream codes and redacts secrets", () => {
    const n = adapter.normaliseError(new Error("Samco error [401] EOAUTH008: Invalid API secret for dummyAesApiSecret"), { secrets: ["dummyAesApiSecret"] });
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(n.message).not.toContain("dummyAesApiSecret");
    expect(adapter.normaliseError(new Error("Samco error [429]: Too many requests")).code).toBe("UPSTREAM_RATE_LIMIT");
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
  });
});
