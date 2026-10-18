/**
 * Kotak Neo adapter on the contract harness. No network (fetch is stubbed) and the shared instrument cache is
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
import * as adapter from "./kotak.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { compactSegment, distinctExpiriesAscending, expiryIso, parseCsv, spotTargets, toInstrument } from "./kotakInstruments.mjs";
import { mapOrderStatus, mapPosition, bookRows } from "./kotakPortfolio.mjs";
import { safeKotakFileUrl } from "./kotakAuth.mjs";

const fx = loadFixtures("kotak");
const responseFor = (cap, re) => fx.byCapability[cap].responses.find((r) => re.test(r.url ?? r.urlPattern ?? ""));
const nseFo = compactSegment(parseCsv(responseFor("instruments", /nse_fo\.csv$/).text), "nse_fo");
const bseFo = compactSegment(parseCsv(responseFor("instruments", /bse_fo\.csv$/).text), "bse_fo");
const session = fx.byCapability.optionChain.creds;
const creds = { ...fx.manifest.creds, ...session };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const optionsOf = (rows, root) => rows.filter((r) => r.root === root && r.optType);

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("kotak contract", () => {
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

describe("kotak scrip master mapping", () => {
  it("applies the 1980 epoch offset to nse_fo and reads bse_fo as Unix seconds", () => {
    expect(expiryIso(1368109800, "nse_fo")).toBe("2023-05-09"); // the SDK sample FINNIFTY2350917550PE
    expect(expiryIso(1792659600, "bse_fo")).toBe("2026-10-22");
    expect(expiryIso(-1, "nse_fo")).toBeNull();
  });

  it("lists NIFTY weekly + monthly, SENSEX weekly and stock expiries in ISO order", () => {
    expect(distinctExpiriesAscending(optionsOf(nseFo, "NIFTY"))).toEqual(["2026-10-20", "2026-10-27"]);
    expect(distinctExpiriesAscending(optionsOf(bseFo, "SENSEX"))).toEqual(["2026-10-22"]);
    expect(distinctExpiriesAscending(optionsOf(nseFo, "RELIANCE"))).toEqual(["2026-10-27"]);
  });

  it("converts paise strikes (including 1.755e+06 style) and tick sizes, and maps stocks to OPTSTK", () => {
    expect(nseFo.find((r) => r.token === "40003")).toMatchObject({ strike: 25050, tickSize: 0.05, lotSize: 65 });
    expect(toInstrument(nseFo.find((r) => r.token === "43001"))).toMatchObject({ exchange: "NFO", instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, optionType: "CE", lotSize: 500 });
    expect(toInstrument(bseFo[0])).toMatchObject({ exchange: "BFO", instrumentType: "OPTIDX", underlying: "SENSEX", strike: 82000 });
    expect(toInstrument(nseFo.find((r) => r.token === "41002"))).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null, tickSize: 0.1 });
    expect(toInstrument(nseFo.find((r) => r.token === "44001"))).toBeNull();
  });

  it("finds spot targets: index names for indices, pAssetCode on nse_cm for stocks", () => {
    expect(spotTargets("NIFTY")).toEqual([{ exchSeg: "nse_cm", query: "Nifty 50" }]);
    expect(spotTargets("SENSEX")).toEqual([{ exchSeg: "bse_cm", query: "SENSEX" }]);
    expect(spotTargets("MIDCPNIFTY").length).toBeGreaterThan(1);
    expect(spotTargets("RELIANCE", optionsOf(nseFo, "RELIANCE"))).toEqual([{ exchSeg: "nse_cm", query: "2885" }]);
  });

  it("only downloads scrip-master CSVs from https kotaksecurities.com hosts", () => {
    expect(safeKotakFileUrl("https://lapi.kotaksecurities.com/x/nse_fo.csv")).toBe("https://lapi.kotaksecurities.com/x/nse_fo.csv");
    for (const badUrl of ["http://lapi.kotaksecurities.com/a.csv", "https://kotaksecurities.com.evil.example/a.csv", "https://evil.example/kotaksecurities.com/nse_fo.csv"]) {
      expect(safeKotakFileUrl(badUrl)).toBeNull();
    }
  });

  it("refuses a file-paths answer pointing outside kotaksecurities.com", async () => {
    stub([{ method: "GET", urlPattern: "masterscrip/file-paths$", json: { filesPaths: ["https://evil.example/nse_fo.csv"] } }]);
    await expect(adapter.fetchExpiryList(creds, "NIFTY")).rejects.toThrow(/kotaksecurities\.com/);
  });
});

describe("kotak market data and books", () => {
  it("builds the chain with OI, bid/ask from quotes and locally solved greeks", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 165900, volume: 543025, bidPrice: 104.55, askPrice: 104.85 });
    expect(atm.ce.iv).toBeGreaterThan(1);
  });

  it("refuses before any download or broker call when not logged in", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList(fx.manifest.creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("maps HTTP 403 on a trade call to SessionRequiredError and 429 to UPSTREAM_RATE_LIMIT", async () => {
    stub([{ method: "GET", urlPattern: "quick/user/orders", status: 403, json: { stat: "Not_Ok", emsg: "Invalid session, please re-login to continue", stCode: 403 } }]);
    await expect(adapter.fetchOrderBook(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "GET", urlPattern: "quick/user/orders", status: 429, json: { stat: "Not_Ok", emsg: "too many request received", stCode: 429 } }]);
    await expect(adapter.fetchOrderBook(creds)).rejects.toMatchObject({ code: "UPSTREAM_RATE_LIMIT", statusCode: 502 });
  });

  it("reads an empty book and computes positions per the documented formulas", () => {
    expect(bookRows({ stat: "Not_Ok", emsg: "No Data", stCode: 5203 }, "orders")).toEqual([]);
    expect(() => bookRows({ stat: "Not_Ok", emsg: "Something broke" }, "orders")).toThrow(/Something broke/);
    const [open, closed] = fx.byCapability.positions.responses[0].json.data;
    expect(mapPosition(open, 110.2)).toMatchObject({ netQty: 130, avgPrice: 104.5, ltp: 110.2, pnl: 741, realisedPnl: 0, unrealisedPnl: 741, product: "MARGIN" });
    expect(mapPosition(closed)).toMatchObject({ netQty: 0, avgPrice: 0, pnl: 0.21, realisedPnl: 0.21, product: "CNC" });
  });

  it("normalises errors with secrets redacted", () => {
    expect(adapter.normaliseError(new Error("Kotak quotes HTTP 429"))).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(adapter.normaliseError(new Error("token dummy.trade.token bad"), { secrets: ["dummy.trade.token"] }).message).not.toContain("dummy.trade.token");
  });
});

describe("kotak orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the order statuses", () => {
    expect(mapOrderStatus({ ordSt: "complete" })).toBe("COMPLETE");
    expect(mapOrderStatus({ ordSt: "open" })).toBe("OPEN");
    expect(mapOrderStatus({ ordSt: "open", fldQty: 65, unFldSz: 65 })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ ordSt: "trigger pending" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ ordSt: "rejected" })).toBe("REJECTED");
    expect(mapOrderStatus({ ordSt: "cancelled" })).toBe("CANCELLED");
    expect(mapOrderStatus({ ordSt: "brand new state" })).toBe("UNKNOWN");
  });

  it("builds priced orders with the documented short codes and a master lot size", () => {
    expect(adapter.buildOrderBody(order, lot)).toMatchObject({ es: "nse_fo", pc: "NRML", pt: "L", qt: "130", rt: "DAY", tt: "B", ts: "NIFTY26O2025000CE" });
    expect(adapter.buildOrderBody({ ...order, product: "INTRADAY", orderType: "STOPLOSS_LIMIT", triggerPrice: 100 }, lot)).toMatchObject({ pc: "MIS", pt: "SL", tp: "100" });
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, lot)).toThrow(/cash only/);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrong = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "fivepaisa" });
    await expect(adapter.placeOrder(creds, order, lot, wrong)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("surfaces a Not_Ok order reply as an upstream error", async () => {
    stub([{ method: "POST", urlPattern: "quick/order/rule/ms/place", json: { stat: "Not_Ok", emsg: "RMS:Margin Exceeds", stCode: 1005 } }]);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "kotak" });
    await expect(adapter.placeOrder(creds, order, lot, gate)).rejects.toThrow(/Margin Exceeds/);
  });
});
