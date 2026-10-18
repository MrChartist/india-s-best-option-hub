/**
 * ICICI Direct (Breeze) on the contract harness. No network: fetch is stubbed (the GET-with-body transport routes
 * through the stub whenever global fetch is replaced) and the master cache is an in-memory map per test.
 */
import { createHash } from "node:crypto";
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
import * as adapter from "./icicidirect.mjs";
import { BrokerInputError, FORBIDDEN_SECRET_KEY, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetIciciDirect, breezeTimestamp, checksumFor, nextIstMidnightMs } from "./icicidirectAuth.mjs";
import { expiryIso, getMaster, listExpiries, splitCsvLine } from "./icicidirectInstruments.mjs";
import { candleTime } from "./icicidirectMarket.mjs";
import { istIso, orderStatusOf } from "./icicidirectPortfolio.mjs";
import { getWithBody } from "./icicidirectHttp.mjs";

const fx = loadFixtures("icicidirect");
const creds = { ...fx.manifest.creds };
const session = fx.byCapability.testConnection.responses[0];
const API = "https://api.icicidirect.com/breezeapi/api/v1";
const masterResponse = fx.byCapability.instruments.responses[0];
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const gate = (action) => issueOrderGate({ verdict: { ok: true }, liveArmed: true, action, brokerId: "icicidirect" });

beforeEach(() => {
  cache.__clear();
  __resetIciciDirect({ pacing: false });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("icicidirect contract", () => {
  it("is on the strict contract with no password/PIN/TOTP fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("requestTokenExchange");
    expect(adapter.credentialFields.filter((f) => FORBIDDEN_SECRET_KEY.test(f))).toEqual([]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth").sort());
  }, 30_000);
});

describe("icicidirect session and signing", () => {
  it("formats the timestamp with zeroed milliseconds and checksums timestamp + body + secret", () => {
    expect(breezeTimestamp(Date.UTC(2026, 9, 19, 4, 12, 33, 987))).toBe("2026-10-19T04:12:33.000Z");
    const ts = "2026-10-19T04:12:33.000Z";
    expect(checksumFor(ts, "{}", "s3cret")).toBe(createHash("sha256").update(`${ts}{}s3cret`).digest("hex"));
  });

  it("exchanges the API_Session once (GET with a JSON body, no auth headers) and signs later calls", async () => {
    const s = stub([...fx.byCapability.testConnection.responses]);
    expect((await adapter.testConnection(creds)).status).toBe("success");
    await adapter.fetchFunds(creds);
    const details = s.calls.filter((c) => c.url.endsWith("/customerdetails"));
    expect(details).toHaveLength(1);
    expect(details[0].method).toBe("GET");
    expect(JSON.parse(details[0].body)).toEqual({ SessionToken: creds.apiSession, AppKey: creds.appKey });
    expect(details[0].headers["X-SessionToken"]).toBeUndefined();
    const funds = s.calls[1];
    expect(funds.method).toBe("GET");
    expect(funds.body).toBe("{}");
    expect(funds.headers["X-AppKey"]).toBe(creds.appKey);
    expect(funds.headers["X-SessionToken"]).toBe(session.json.Success.session_token);
    expect(funds.headers["X-Checksum"]).toBe(`token ${checksumFor(funds.headers["X-Timestamp"], "{}", creds.secretKey)}`);
    expect(JSON.stringify(s.calls.map((c) => [c.body, c.headers]))).not.toContain(creds.secretKey);
  });

  it("uses a pasted session token without an exchange", async () => {
    const s = stub([{ method: "GET", url: `${API}/funds`, json: { Success: {}, Status: 200, Error: null } }]);
    expect((await adapter.testConnection({ appKey: creds.appKey, secretKey: creds.secretKey, accessToken: "cGFzdGVkOjEyMw==" })).status).toBe("success");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers["X-SessionToken"]).toBe("cGFzdGVkOjEyMw==");
  });

  it("asks for a fresh API_Session when CustomerDetails refuses it, without echoing secrets", async () => {
    const s = stub([{ method: "GET", url: `${API}/customerdetails`, json: { Success: null, Status: 5, Error: `Public Key does not exist. ${creds.apiSession}` } }]);
    const res = await adapter.testConnection(creds);
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/API_Session/);
    expect(res.message).not.toContain(creds.apiSession);
    await adapter.testConnection(creds);
    expect(s.calls).toHaveLength(1);
  });

  it("drops the session on 401 and maps it to SESSION_LOGIN_REQUIRED", async () => {
    const s = stub([session, { method: "GET", url: `${API}/funds`, status: 401, json: { Success: null, Status: 401, Error: "Unauthorized" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    await adapter.fetchFunds(creds).catch(() => {});
    expect(s.calls.filter((c) => c.url.endsWith("/customerdetails"))).toHaveLength(1);
  });

  it("refuses without AppKey and secret before any call, and expires at IST midnight", async () => {
    const s = stub([]);
    await expect(adapter.fetchFunds({ accessToken: "x" })).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
    expect(nextIstMidnightMs(Date.UTC(2026, 9, 19, 10, 0))).toBe(Date.UTC(2026, 9, 19, 18, 30));
  });

  it("refuses to send a GET body anywhere but api.icicidirect.com when fetch is the real one", async () => {
    globalThis.fetch = realFetch;
    await expect(getWithBody("https://example.com/x", { body: "{}" })).rejects.toThrow(/refused/);
    await expect(getWithBody("http://api.icicidirect.com/x", { body: "{}" })).rejects.toThrow(/refused/);
  });
});

describe("icicidirect symbols and data", () => {
  it("maps Breeze stock codes onto canonical underlyings and reads the quoted master", async () => {
    stub([masterResponse]);
    const master = await getMaster();
    expect(listExpiries(master, "NIFTY")).toEqual(["2026-10-27", "2026-11-03"]);
    for (const u of ["BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "RELIANCE"]) expect(listExpiries(master, u)).toEqual(["2026-10-27"]);
    expect(master.fno.some((m) => m.breezeCode === "NIFNEX")).toBe(false);
    expect(master.fno.find((m) => m.token === "35008")).toMatchObject({ breezeCode: "NIFTY", tickSize: 0.05, lotSize: 65, strike: 25000, optionType: "CE" });
    expect(master.nse.find((m) => m.token === "2885")).toMatchObject({ breezeCode: "RELIND", tradingSymbol: "RELIANCE", tickSize: 0.1 });
    expect(master.nse.some((m) => m.breezeCode === "ACRTEC" || m.breezeCode === "NIFTY")).toBe(false);
    expect(splitCsvLine('"a, b", "c",d')).toEqual(["a, b", "c", "d"]);
    expect(expiryIso("06-FEB-25")).toBe("2025-02-06");
  });

  it("builds the chain from two OptionChain calls with OI, OI change, bid/ask and computed Greeks", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-11-03"));
    expect(spotPrice).toBe(25012.35);
    expect(chain[0]).toMatchObject({ strikePrice: 25000, ce: { ltp: 182.4, oi: 5110000, oiChange: 120000, bidPrice: 181.9, askPrice: 182.9 }, pe: { ltp: 160.05, oi: 5128500 } });
    expect(chain[0].ce.iv).toBeGreaterThan(1);
  });

  it("refuses BSE symbols, unknown symbols and too many quotes", async () => {
    stub([session, masterResponse]);
    await expect(adapter.fetchOptionChain(creds, "SENSEX", "2026-10-29")).rejects.toThrow(/BSE is not available/);
    await expect(adapter.fetchLTP(creds, "NOSUCH")).rejects.toBeInstanceOf(BrokerInputError);
    await expect(adapter.fetchQuotes(creds, Array.from({ length: 21 }, (_, i) => ({ token: String(i + 1), exchange: "NSE" })))).rejects.toThrow(/at most 20/);
    await expect(adapter.fetchQuotes(creds, [{ token: "500325", exchange: "BSE" }])).rejects.toThrow(/unsupported/);
  });

  it("parses IST candle times, order times and the documented order statuses", () => {
    expect(candleTime("2025-02-03 09:21:00")).toBe(Date.UTC(2025, 1, 3, 3, 51) / 1000);
    expect(istIso("05-Feb-2025 09:26")).toBe("2025-02-05T09:26:00+05:30");
    expect(orderStatusOf("Ordered")).toBe("OPEN");
    expect(orderStatusOf("Queued")).toBe("OPEN");
    expect(orderStatusOf("Partially Executed")).toBe("PARTIALLY_FILLED");
    expect(orderStatusOf("Executed")).toBe("COMPLETE");
    expect(orderStatusOf("Partially Executed And Cancelled")).toBe("CANCELLED");
    expect(orderStatusOf("Partially Executed And Expired")).toBe("EXPIRED");
    expect(orderStatusOf("Rejected")).toBe("REJECTED");
    expect(orderStatusOf("Freezed")).toBe("UNKNOWN");
  });

  it("finds tokens for positions and orders through the master", async () => {
    stub(fx.byCapability.positions.responses);
    const [p] = (await adapter.fetchPositions(creds)).data;
    expect(p).toMatchObject({ token: "35008", exchange: "NFO", product: "MARGIN", netQty: 65, ltp: 182.4 });
    expect(p.pnl).toBeCloseTo(2106);
    cache.__clear();
    __resetIciciDirect({ pacing: false });
    stub(fx.byCapability.orderBook.responses);
    const orders = (await adapter.fetchOrderBook(creds)).data;
    expect(orders.find((o) => o.exchange === "NSE")).toMatchObject({ token: "1660", status: "COMPLETE", filledQty: 1, product: "CNC" });
    expect(orders.find((o) => o.exchange === "NFO")).toMatchObject({ token: "35008", status: "OPEN", pendingQty: 65, placedAt: "2026-10-19T09:26:00+05:30" });
  });
});

describe("icicidirect orders", () => {
  const order = { token: "35008", exchange: "NFO", side: "SELL", orderType: "SL", product: "MARGIN", lots: 2, price: 90, triggerPrice: 91 };

  it("refuses market orders, intraday products and BSE before any call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, { ...order, orderType: "MARKET" }, 65, gate("placeOrder"))).rejects.toThrow(/market orders/);
    await expect(adapter.placeOrder(creds, { ...order, orderType: "SL-M" }, 65, gate("placeOrder"))).rejects.toThrow(/market orders/);
    await expect(adapter.placeOrder(creds, { ...order, exchange: "BFO" }, 65, gate("placeOrder"))).rejects.toThrow(/BSE/);
    await expect(adapter.placeOrder(creds, { ...order, lots: 0 }, 65, gate("placeOrder"))).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
  });

  it("builds the documented body from the master row", async () => {
    stub([masterResponse]);
    const master = await getMaster();
    const row = master.fno.find((m) => m.token === "35008");
    expect(adapter.buildOrderBody(row, order, 65)).toEqual({ stock_code: "NIFTY", exchange_code: "NFO", product: "options", action: "sell", order_type: "stoploss", stoploss: "91", quantity: "130", price: "90", validity: "day", disclosed_quantity: "0", expiry_date: "2026-11-03T06:00:00.000Z", right: "call", strike_price: "25000" });
    expect(() => adapter.buildOrderBody(row, { ...order, product: "INTRADAY" }, 65)).toThrow(/MARGIN only/);
    expect(() => adapter.buildOrderBody(row, { ...order, triggerPrice: 89 }, 65)).toThrow(/below the limit/);
    const eq = master.nse.find((m) => m.token === "2885");
    expect(adapter.buildOrderBody(eq, { side: "BUY", orderType: "LIMIT", product: "CNC", lots: 3, price: 1400, tag: "my tag!" }, 1)).toMatchObject({ stock_code: "RELIND", exchange_code: "NSE", product: "cash", quantity: "3", expiry_date: "", right: "others", user_remark: "mytag" });
  });

  it("refuses without a gate, with a forged gate and with a reused gate, before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, order, 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.modifyOrder(creds, "20261019N300001234", { price: 1 }, { action: "modifyOrder", brokerId: "icicidirect" })).rejects.toBeInstanceOf(OrderGateError);
    const g = gate("cancelOrder");
    await adapter.cancelOrder(creds, "bad id", g).catch(() => {});
    await expect(adapter.cancelOrder(creds, "20261019N300001234", g)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("refuses to modify or cancel an order that is not in today's book", async () => {
    stub([session, { method: "GET", url: `${API}/order`, json: { Success: [], Status: 200, Error: null } }]);
    await expect(adapter.cancelOrder(creds, "20261019N300009999", gate("cancelOrder"))).rejects.toThrow(/not in today's order book/);
  });
});
