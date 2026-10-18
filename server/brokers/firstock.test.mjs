/**
 * Firstock on the contract harness. No network (fetch is stubbed); the instrument cache is an in-memory map
 * per test so nothing touches the developer's .cache directory.
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
import * as adapter from "./firstock.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { expiryToIso, isoToDdMonYy, listExpiries, optionContracts, parseCsv, toInstrument } from "./firstockInstruments.mjs";
import { parityStrike, toFirstockTime } from "./firstockMarket.mjs";
import { firstockTimeToIso, mapHolding, mapOrderStatus } from "./firstockPortfolio.mjs";
import { classifyError, sha256Hex } from "./firstockAuth.mjs";

const fx = loadFixtures("firstock");
const csvOf = (cap, file) => fx.byCapability[cap].responses.find((r) => r.url?.includes(`/symbols/${file}?`)).text;
const indices = parseCsv(csvOf("instruments", "Indices")).map(toInstrument).filter(Boolean);
const nfo = parseCsv(csvOf("instruments", "NFO")).map(toInstrument).filter(Boolean);
const creds = { ...fx.manifest.creds, ...fx.byCapability.optionChain.creds };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("firstock contract", () => {
  it("is on the strict contract with a session login", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth")].sort());
  });

  it("hashes the password with SHA-256 before it leaves the machine", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("firstock symbol files", () => {
  it("lists NIFTY weekly + monthly, SENSEX weekly, BANKEX and a stock option's expiries", () => {
    expect(listExpiries(indices, "NIFTY")).toEqual(["2026-10-20", "2026-10-27"]);
    expect(listExpiries(indices, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(indices, "BANKEX")).toEqual(["2026-10-29"]);
    expect(listExpiries(nfo, "RELIANCE")).toEqual(["2026-10-27"]);
  });

  it("maps contracts and drops non-canonical index options", () => {
    expect(optionContracts(indices, "SENSEX", "2026-10-22")[0]).toMatchObject({ exchange: "BFO", strike: 82700, optionType: "CE", lotSize: 20, tradingSymbol: "SENSEX26O2282700CE" });
    expect(indices.find((i) => i.token === "40020")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(indices.find((i) => i.token === "40041")).toBeUndefined(); // NIFTYNXT50 is not a canonical underlying
    expect(nfo.find((i) => i.token === "36343")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", optionType: "PE", lotSize: 500 });
    expect(expiryToIso("08MAY2025")).toBe("2025-05-08");
    expect(isoToDdMonYy("2026-10-20")).toBe("20OCT26");
  });
});

describe("firstock market data", () => {
  it("uses broker IV/Greeks/OI, fills a missing IV locally and takes bid/ask from one quote call", async () => {
    const s = stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 96.8, iv: 13.1, delta: 0.51, oi: 165900, bidPrice: 96.55, askPrice: 96.95 });
    expect(chain.find((c) => c.strikePrice === 25050).ce.iv).toBeGreaterThan(1);
    expect(s.calls.filter((c) => c.url.endsWith("/getMultiQuotes"))).toHaveLength(1);
  });

  it("reports volume as unknown (null), not 0, when no quote carries a traded volume", async () => {
    const responses = structuredClone(fx.byCapability.optionChain.responses);
    const mq = responses.find((r) => String(r.url).endsWith("/getMultiQuotes"));
    // One leg's quote carries a volume; another leg has no quote at all (outside the quoted window).
    mq.json.data = mq.json.data.filter((q) => q.tradingSymbol !== "NIFTY20OCT26P25050").map((q) => (q.tradingSymbol === "NIFTY20OCT26C25000" ? { ...q, volume: "1234" } : q));
    stub(responses);
    const raw = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    expect(raw.data.oc["25000"].ce.volume).toBe(1234);
    expect(raw.data.oc["25050"].pe.volume).toBeNull();
    expect(raw.data.oc["24950"].ce.volume).toBeNull();
    expect(parityStrike([{ strikePrice: "100", optionType: "CE", lastTradedPrice: "9" }, { strikePrice: "100", optionType: "PE", lastTradedPrice: "8" }, { strikePrice: "90", optionType: "CE", lastTradedPrice: "15" }, { strikePrice: "90", optionType: "PE", lastTradedPrice: "2" }])).toBe(100);
  });

  it("lists expiries from the public files before login, but refuses data calls without a session", async () => {
    const s = stub(fx.byCapability.expiries.responses);
    expect((await adapter.fetchExpiryList(fx.manifest.creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
    const before = s.calls.length;
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchQuotes(fx.manifest.creds, [{ token: "1", exchange: "NSE" }])).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls.length).toBe(before);
  });

  it("formats candle times as Firstock expects", () => {
    expect(toFirstockTime("2026-10-16", "09:15:00")).toBe("09:15:00 16-10-2026");
    expect(toFirstockTime("2026-10-16T11:05", "09:15:00")).toBe("11:05:00 16-10-2026");
  });
});

describe("firstock errors", () => {
  it("maps INVALID_JKEY to a session login and rate limits to UPSTREAM_RATE_LIMIT, without guessing from words", async () => {
    expect(classifyError(200, { status: "failed", code: "401", name: "INVALID_JKEY", error: { field: "jKey", message: "jKey parameter is invalid" } }, "/limit")).toBeInstanceOf(SessionRequiredError);
    expect(classifyError(200, { status: "failed", code: "429", name: "RATE_LIMIT_EXCEEDED", error: {} }, "/getMultiQuotes")).toMatchObject({ code: "UPSTREAM_RATE_LIMIT" });
    const notSession = classifyError(200, { status: "failed", code: "400", name: "BAD_REQUEST", error: { field: "tradingSymbol", message: "Invalid token for symbol" } }, "/getQuote");
    expect(notSession).not.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "POST", url: "https://api.firstock.in/V1/limit", json: { status: "failed", code: "401", name: "INVALID_JKEY", error: { field: "jKey", message: "jKey parameter is invalid" } } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it("reads Firstock's timestamp layouts", () => {
    expect(firstockTimeToIso("16-10-2026 09:30:02")).toBe("2026-10-16T09:30:02+05:30");
    expect(firstockTimeToIso("09:30:02 16-10-2026")).toBe("2026-10-16T09:30:02+05:30");
    expect(firstockTimeToIso("1746004054")).toBe("2025-04-30T14:37:34+05:30");
  });
});

describe("firstock orders and books", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps statuses and holdings quantities", () => {
    expect(mapOrderStatus({ status: "REJECTED" })).toBe("REJECTED");
    expect(mapOrderStatus({ status: "OPEN", quantity: "130", fillShares: "65" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ status: "CANCELED" })).toBe("CANCELLED");
    expect(mapOrderStatus({ status: "TRIGGER_PENDING" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ status: "who knows" })).toBe("UNKNOWN");
    const h = mapHolding(fx.byCapability.holdings.responses[0].json.data[1]);
    expect(h).toMatchObject({ tradingSymbol: "YESBANK-EQ", exchange: "NSE", token: "11915", qty: 2, avgPrice: 20.13 });
  });

  it("builds bodies from master lot sizes and requires market protection for market orders", () => {
    expect(adapter.buildOrderBody({ ...order, lotSize: 1 }, lot).quantity).toBe("130");
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(/marketProtectionPercent/);
    expect(adapter.buildOrderBody({ ...order, orderType: "MARKET", marketProtectionPercent: 1 }, lot)).toMatchObject({ priceType: "MKT", price: "0", mkt_protection: "1" });
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 94 }, lot)).toMatchObject({ priceType: "SL-LMT", triggerPrice: "94" });
    expect(() => adapter.buildOrderBody({ ...order, product: "MTF" }, lot)).toThrow(BrokerInputError);
  });

  it("treats a cancel reply with rejreason as a refusal", async () => {
    stub([{ method: "POST", url: "https://api.firstock.in/V1/cancelOrder", json: { status: "success", message: "Order cancellation details", data: { orderNumber: "1", rejreason: "SAF:order is not open to cancel" } } }]);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "firstock" });
    await expect(adapter.cancelOrder(creds, "1", gate)).rejects.toThrow(/not open to cancel/);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrong = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "zebu" });
    await expect(adapter.placeOrder(creds, order, lot, wrong)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
