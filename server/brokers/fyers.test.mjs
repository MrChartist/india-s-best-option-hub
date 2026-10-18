/**
 * Fyers adapter on the contract harness. No network: fetch is stubbed by the harness / createFetchStub,
 * and the shared instrument cache is replaced with a per-test in-memory map so nothing is read from or
 * written to the developer's .cache directory.
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
import * as adapter from "./fyers.mjs";
import { OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { checkChainExpiry, parseExpiryData, parseOptionTicker } from "./fyersChain.mjs";
import { parseFoMaster } from "./fyersInstruments.mjs";
import { fyersError } from "./fyersClient.mjs";

const fx = loadFixtures("fyers");
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("fyers contract", () => {
  it("is on the strict contract", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("oauthRedirect");
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    // Every declared capability (auth and feed need no fixture) was actually exercised.
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed").sort());
    expect(report.results.filter((r) => r.capability !== "normaliseError").every((r) => r.calls > 0)).toBe(true);
  });
});

describe("fyers market data", () => {
  it("builds the NIFTY chain with broker greeks (IV already in percent) and OI change", async () => {
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(r);
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, iv: 13.1, delta: 0.51, oiChange: 9975, bidPrice: 104.55, askPrice: 104.85, volume: 543025 });
    expect(atm.pe.iv).toBe(13.6);
  });

  it("fetches a later (monthly) expiry by its epoch and checks the tickers match", async () => {
    const s = stub(fx.byCapability._chainMonthly.responses);
    const r = await adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-27");
    expect(Object.keys(r.data.oc)).toHaveLength(3);
    expect(s.calls[1].url).toContain("timestamp=1793095200");
  });

  it("refuses a chain whose tickers belong to another expiry", async () => {
    const [nearest] = fx.byCapability._chainMonthly.responses;
    stub([nearest, { ...nearest, urlPattern: "timestamp=1793095200$" }]);
    await expect(adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-27")).rejects.toThrow(/different expiry/);
  });

  it("maps index and stock underlyings", () => {
    expect(adapter.resolveUnderlying("NIFTY")).toEqual({ ticker: "NSE:NIFTY50-INDEX", root: "NIFTY" });
    expect(adapter.resolveUnderlying("SENSEX")).toEqual({ ticker: "BSE:SENSEX-INDEX", root: "SENSEX" });
    expect(adapter.resolveUnderlying("BANKEX").ticker).toBe("BSE:BANKEX-INDEX");
    expect(adapter.resolveUnderlying("reliance")).toEqual({ ticker: "NSE:RELIANCE-EQ", root: "RELIANCE" });
    expect(() => adapter.resolveUnderlying("BAD SYMBOL")).toThrow();
  });
});

describe("fyers symbology (official Appendix -> Symbology format)", () => {
  it("parses NIFTY weekly and monthly, SENSEX weekly and a stock option", () => {
    expect(parseOptionTicker("NSE:NIFTY26O2025000CE", "NIFTY")).toMatchObject({ yy: "26", month: 10, day: 20, monthly: false, strike: 25000, optionType: "CE" });
    expect(parseOptionTicker("NSE:NIFTY26OCT25000PE", "NIFTY")).toMatchObject({ yy: "26", month: 10, day: null, monthly: true, strike: 25000, optionType: "PE" });
    expect(parseOptionTicker("NSE:NIFTY2611325000CE", "NIFTY")).toMatchObject({ month: 1, day: 13, strike: 25000 });
    expect(parseOptionTicker("BSE:SENSEX26O2282000CE", "SENSEX")).toMatchObject({ month: 10, day: 22, strike: 82000 });
    expect(parseOptionTicker("NSE:RELIANCE26OCT1400CE", "RELIANCE")).toMatchObject({ monthly: true, strike: 1400 });
    expect(parseOptionTicker("NSE:NIFTYNXT5026OCT70000CE", "NIFTY")).toBeNull();
  });

  it("matches a monthly ticker only to the last expiry of its month", () => {
    const expiries = parseExpiryData([{ date: "20-10-2026", expiry: "1792490400" }, { date: "27-10-2026", expiry: "1793095200" }]);
    const monthlyRow = [{ option_type: "CE", symbol: "NSE:NIFTY26OCT25000CE" }];
    expect(checkChainExpiry(monthlyRow, { underlying: "NIFTY", expiryIso: "2026-10-27", expiries })).toBe(true);
    expect(checkChainExpiry(monthlyRow, { underlying: "NIFTY", expiryIso: "2026-10-20", expiries })).toBe(false);
  });

  it("maps the F&O master: IST expiry from epoch, canonical index underlyings only", () => {
    const rows = parseFoMaster(fx.byCapability.instruments.responses.map((r) => r.text).join(""));
    const weekly = rows.find((r) => r.token === "NSE:NIFTY26O1925000CE");
    expect(weekly).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", expiry: "2026-10-19", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05 });
    expect(rows.find((r) => r.token === "BSE:SENSEX26O2282000CE")).toMatchObject({ exchange: "BFO", expiry: "2026-10-22", lotSize: 20 });
    expect(rows.find((r) => r.token === "NSE:RELIANCE26OCT1400CE")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
    expect(rows.find((r) => r.token === "NSE:BANKNIFTY26OCTFUT")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(rows.some((r) => r.underlying === "NIFTYNXT50")).toBe(false);
  });
});

describe("fyers errors and sessions", () => {
  it("maps token codes to SessionRequiredError and rate limits to UPSTREAM_RATE_LIMIT", () => {
    for (const code of [-8, -15, -16, -17]) expect(fyersError(401, { s: "error", code, message: "x" }, "/p")).toBeInstanceOf(SessionRequiredError);
    expect(fyersError(429, { s: "error", code: -429 }, "/p").code).toBe("UPSTREAM_RATE_LIMIT");
    expect(fyersError(400, { s: "error", code: -300, message: "Invalid symbol" }, "/p").statusCode).toBe(502);
  });

  it("asks for a fresh token before any network call when none is saved", async () => {
    const s = stub([]);
    await expect(adapter.fetchLTP({ appId: "X-100" }, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    expect((await adapter.testConnection({})).status).toBe("error");
    expect(s.calls).toHaveLength(0);
  });

  it("never puts the access token in an error message", async () => {
    stub([{ method: "GET", urlPattern: "/api/v3/profile$", status: 401, json: { s: "error", code: -16, message: "Could not authenticate the user" } }]);
    const r = await adapter.testConnection(fx.manifest.creds);
    expect(r.status).toBe("error");
    expect(r.message).not.toContain(fx.manifest.creds.accessToken);
    const n = adapter.normaliseError(new SessionRequiredError());
    expect(n).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
  });
});

describe("fyers order gate", () => {
  const order = fx.byCapability.placeOrder.args;

  it("refuses orders without a valid gate before any network call", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(fx.manifest.creds, ...order)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.placeOrder(fx.manifest.creds, ...order, { action: "placeOrder", brokerId: "fyers" })).rejects.toBeInstanceOf(OrderGateError);
    const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "dhan" });
    await expect(adapter.placeOrder(fx.manifest.creds, ...order, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("sends the documented body once the gate is valid and reports UNKNOWN until the book is read", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "fyers" });
    expect(await adapter.placeOrder(fx.manifest.creds, ...order, gate)).toEqual({ orderId: "808058117761", orderStatus: "UNKNOWN" });
    expect(JSON.parse(s.calls[0].body).qty).toBe(130);
  });
});
