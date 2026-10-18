/**
 * 5paisa adapter on the contract harness. No network (fetch is stubbed) and the shared instrument cache is
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
import * as adapter from "./fivepaisa.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { canonicalIndexName, compactMaster, expiryToIso, listExpiries, parseCsv, spotScripInfo, strikeMapForExpiry, toInstrument } from "./fivepaisaInstruments.mjs";
import { readSnapshotRow, istToEpochSeconds } from "./fivepaisaMarket.mjs";
import { mapOrderStatus, contractProduct } from "./fivepaisaPortfolio.mjs";

const fx = loadFixtures("fivepaisa");
const masterResp = fx.byCapability.instruments.responses[0];
const master = compactMaster(parseCsv(masterResp.text));
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

describe("fivepaisa contract", () => {
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

describe("fivepaisa scrip master mapping", () => {
  it("lists NIFTY weekly + monthly, SENSEX weekly and stock expiries in ISO order", () => {
    expect(listExpiries(master, "NIFTY")).toEqual(["2026-10-20", "2026-10-27"]);
    expect(listExpiries(master, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(master, "RELIANCE")).toEqual(["2026-10-27"]);
  });

  it("maps index display names onto the canonical underlyings and finds spot ScripCodes", () => {
    expect(canonicalIndexName("NIFTY 50")).toBe("NIFTY");
    expect(canonicalIndexName("Nifty Fin Service")).toBe("FINNIFTY");
    expect(canonicalIndexName("BSE BANKEX")).toBe("BANKEX");
    expect(spotScripInfo(master, "NIFTY")).toEqual({ scripCode: "999920000", exch: "N", exchType: "C" });
    expect(spotScripInfo(master, "SENSEX")).toEqual({ scripCode: "999901", exch: "B", exchType: "C" });
    expect(spotScripInfo(master, "RELIANCE")).toEqual({ scripCode: "2885", exch: "N", exchType: "C" });
    expect(master.equities.map((e) => e.root)).toEqual(["RELIANCE"]); // ITC has no F&O row in the fixture
  });

  it("builds per-expiry strike maps with SENSEX on BSE and stock options as OPTSTK", () => {
    const weekly = strikeMapForExpiry(master, "NIFTY", "2026-10-20");
    expect([...weekly.keys()].sort()).toEqual(["24950", "25000", "25050"]);
    expect(weekly.get("25000").ce).toMatchObject({ scripCode: "51401", exch: "N", lotSize: 65 });
    expect(strikeMapForExpiry(master, "SENSEX", "2026-10-22").get("82000").pe).toMatchObject({ scripCode: "861002", exch: "B" });
    const stock = toInstrument(master.derivatives.find((d) => d.scripCode === "60001"));
    expect(stock).toMatchObject({ exchange: "NFO", instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, optionType: "CE", lotSize: 500, expiry: "2026-10-27" });
    expect(toInstrument(master.derivatives.find((d) => d.scripCode === "52002"))).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(toInstrument(master.derivatives.find((d) => d.scripCode === "60500"))).toBeNull(); // NIFTYNXT50 is not canonical
  });

  it("parses the expiry formats 5paisa uses", () => {
    expect(expiryToIso("2026-10-20 14:30:00")).toBe("2026-10-20");
    expect(expiryToIso("/Date(1792486800000+0530)/")).toBe("2026-10-20");
    expect(expiryToIso("20 Oct 2026")).toBe("2026-10-20");
    expect(expiryToIso("")).toBeNull();
  });
});

describe("fivepaisa market data", () => {
  it("builds the chain from snapshots with locally solved greeks", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, volume: 543025, bidPrice: 0, askPrice: 0 });
    expect(atm.ce.iv).toBeGreaterThan(1); // percent, not a fraction
  });

  it("never reports OI as zero when the snapshot has none, and leaves out legs with no snapshot row", async () => {
    expect(adapter.capabilities.optionChain.oi).toBe(false);
    const responses = structuredClone(fx.byCapability.optionChain.responses);
    const snap = responses.find((r) => String(r.url ?? r.urlPattern ?? "").includes("MarketSnapshot"));
    const rows = snap.json.body.Data;
    const dropped = rows.find((r) => r !== rows[0]);
    snap.json.body.Data = rows.filter((r) => r !== dropped);
    stub(responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const legs = Object.values(r.data.oc).flatMap((e) => [e.ce, e.pe]).filter(Boolean);
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) expect(leg).not.toHaveProperty("oi");
    expect(legs.some((leg) => leg.security_id === String(dropped.Token ?? dropped.ScripCode))).toBe(false);
  });

  it("reads both snapshot spellings (doc sample LastRate/TotalQty and LastTradedPrice/Volume/OpenInterest)", () => {
    expect(readSnapshotRow({ Exch: "N", Token: 1, LastRate: 10, TotalQty: 5 })).toMatchObject({ key: "N|1", ltp: 10, volume: 5, oi: null });
    expect(readSnapshotRow({ Exchange: "N", ScripCode: 2, LastTradedPrice: 11, Volume: 6, OpenInterest: 700 })).toMatchObject({ key: "N|2", ltp: 11, volume: 6, oi: 700 });
  });

  it("reads IST candle timestamps and refuses unsupported intervals before any call", async () => {
    expect(istToEpochSeconds("2026-10-16T09:15:00")).toBe(Date.parse("2026-10-16T03:45:00Z") / 1000);
    const s = stub([]);
    await expect(adapter.fetchHistorical(creds, { instrument: { token: "1630", exchange: "NSE" }, interval: "3m", from: "2026-10-01", to: "2026-10-02" })).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
  });

  it("refuses before any download or broker call when not logged in", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList(fx.manifest.creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("maps body.Status 9 (Invalid Session) to SessionRequiredError and a bad user key to UPSTREAM_AUTH", async () => {
    stub([{ method: "POST", urlPattern: "V4/Margin$", json: { body: { Message: "Invalid Session", Status: 9 }, head: { status: "0", statusDescription: "Fail" } } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "POST", urlPattern: "V4/Margin$", json: { body: null, head: { responseCode: "5PMarginV4", status: "2", statusDescription: "Invalid head parameters." } } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ code: "UPSTREAM_AUTH", statusCode: 502 });
    stub([{ method: "POST", urlPattern: "V4/OrderBook$", json: { body: { Message: "No Order found for this Client.", OrderBookDetail: [], Status: 1 }, head: { status: "0" } } }]);
    await expect(adapter.fetchOrderBook(creds)).resolves.toEqual({ status: "success", data: [] });
  });

  it("normalises errors with secrets redacted", () => {
    expect(adapter.normaliseError(new Error("5paisa API [/V4/Margin] error (HTTP 429): slow down"))).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(adapter.normaliseError(new Error("key dummyUserKey refused"), { secrets: ["dummyUserKey"] }).message).not.toContain("dummyUserKey");
  });
});

describe("fivepaisa orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the documented order statuses and products", () => {
    expect(mapOrderStatus({ OrderStatus: "Fully Executed" })).toBe("COMPLETE");
    expect(mapOrderStatus({ OrderStatus: "Pending" })).toBe("OPEN");
    expect(mapOrderStatus({ OrderStatus: "Pending", TradedQty: 65, PendingQty: 65 })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ OrderStatus: "Pending", WithSL: "Y", SLTriggered: "N" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ OrderStatus: "Rejected by Exch" })).toBe("REJECTED");
    expect(mapOrderStatus({ OrderStatus: "AH Cancelled" })).toBe("CANCELLED");
    expect(mapOrderStatus({ OrderStatus: "Something new" })).toBe("UNKNOWN");
    expect(contractProduct("D", "D")).toBe("MARGIN");
    expect(contractProduct("D", "C")).toBe("CNC");
    expect(contractProduct("I", "D")).toBe("INTRADAY");
  });

  it("builds priced orders only, with quantity from the master lot size", () => {
    const body = adapter.buildOrderBody(order, lot, "MRCFIXED01");
    expect(body).toMatchObject({ Exchange: "N", ExchangeType: "D", ScripCode: 51401, OrderType: "B", Qty: 130, IsIntraday: false, RemoteOrderID: "MRCFIXED01", AlgoID: 0 });
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, lot)).toThrow(/cash only/);
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 100 }, lot).StopLossPrice).toBe(100);
    expect(adapter.buildOrderBody({ ...order, product: "INTRADAY" }, lot).IsIntraday).toBe(true);
  });

  it("surfaces an RMS rejection carried in an HTTP 200 body", async () => {
    stub([{ method: "POST", urlPattern: "PlaceOrderRequest$", json: { body: { BrokerOrderID: 0, Message: "Insufficient margin", Status: 1, RMSResponseCode: -15 }, head: { status: "0", statusDescription: "Success" } } }]);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "fivepaisa" });
    await expect(adapter.placeOrder(creds, order, lot, gate)).rejects.toThrow(/Insufficient margin/);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrong = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "kotak" });
    await expect(adapter.placeOrder(creds, order, lot, wrong)).rejects.toBeInstanceOf(OrderGateError);
    const used = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "fivepaisa" });
    await expect(adapter.placeOrder(creds, order, lot, used)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
