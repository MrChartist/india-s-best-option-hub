/**
 * Nubra adapter on the contract harness. No network (fetch is stubbed) and the shared instrument cache is a
 * per-test in-memory map. Fixtures follow the official REST API V3 docs' sample payloads (paise integers).
 * Login itself is also covered by sessionLogin.test.mjs.
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
import * as adapter from "./nubra.mjs";
import { contractExchange, istDate, toInstrument, underlyingRef } from "./nubraInstruments.mjs";
import { mapStatus } from "./nubraOrders.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";

const fx = loadFixtures("nubra");
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

describe("nubra contract", () => {
  it("is on the strict contract with a session login", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("passes login and every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed")].sort());
    expect(report.results.filter((r) => r.capability !== "normaliseError" && r.calls === 0)).toEqual([]);
  });

  it("sends the TOTP as an integer with the stable device id, then the MPIN with the auth token", async () => {
    const s = stub(fx.byCapability.login.responses);
    const r = await adapter.login({ ...fx.manifest.creds, mpin: "135790", totpCode: "123456" });
    expect(Object.keys(r.session)).toEqual(["sessionToken"]);
    expect(r.expiresAt).toBe(4102444800 * 1000 - 60_000);
    expect(JSON.parse(s.calls[0].body)).toEqual({ phone: "9999999999", totp: 123456, otp: "" });
    expect(s.calls[1].headers).toMatchObject({ Authorization: "Bearer dummy-auth-token", "x-device-id": "OPTIONSDESK" });
  });

  it("maps HTTP 440 to SessionRequiredError and 400 { error } to a 502 with Nubra's text", async () => {
    stub([{ method: "GET", url: "https://api.nubra.io/sentinel/portfolio/user_funds_and_margin", status: 440, json: { error: "session expired", nubra_error_code: "" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    stub([{ method: "GET", url: "https://api.nubra.io/sentinel/portfolio/user_funds_and_margin", status: 400, json: { error: "Enter valid inputs to proceed.", nubra_error_code: "" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("Enter valid inputs") });
  });

  it("refuses every data call before the network when not logged in", async () => {
    const s = stub([]);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchExpiryList({ ...creds, sessionExpiresAt: String(Date.now() - 1000) }, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("nubra symbol mapping", () => {
  const nse = fx.byCapability.instruments.responses[0].json.refdata;
  const bse = fx.byCapability.instruments.responses[1].json.refdata;
  const by = (rows, id) => toInstrument(rows.find((r) => r.ref_id === id));

  it("maps NIFTY weekly + monthly, SENSEX weekly, a stock option and cash rows (ref_id is the token)", () => {
    expect(by(nse, 739119)).toMatchObject({ token: "739119", exchange: "NFO", instrumentType: "OPTIDX", underlying: "NIFTY", strike: 25000, expiry: "2026-10-20", lotSize: 65, tickSize: 0.05 });
    expect(by(nse, 741001)).toMatchObject({ expiry: "2026-10-27", instrumentType: "OPTIDX" });
    expect(by(bse, 847001)).toMatchObject({ exchange: "BFO", underlying: "SENSEX", strike: 82000, lotSize: 20, expiry: "2026-10-22" });
    expect(by(nse, 752001)).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, lotSize: 500 });
    expect(by(nse, 741500)).toMatchObject({ instrumentType: "FUTIDX", strike: null, tickSize: 0.1 });
    expect(by(nse, 70115)).toMatchObject({ instrumentType: "EQ", exchange: "NSE", expiry: null });
    expect(by(nse, 753001)).toBeNull();
  });

  it("routes SENSEX to BSE and everything else to NSE, and dates the refdata in IST", () => {
    expect(underlyingRef("SENSEX")).toMatchObject({ asset: "SENSEX", exchange: "BSE", isIndex: true });
    expect(underlyingRef("RELIANCE")).toMatchObject({ exchange: "NSE", isIndex: false });
    expect(contractExchange("NSE", true)).toBe("NFO");
    expect(contractExchange("BSE", false)).toBe("BSE");
    expect(istDate(Date.parse("2026-10-16T19:00:00Z"))).toBe("2026-10-17");
  });

  it("asks BSE for SENSEX chains", async () => {
    const s = stub([{ method: "GET", url: "https://api.nubra.io/optionchains/SENSEX?exchange=BSE", json: { chain: { asset: "SENSEX", all_expiries: ["20261029", "20261022"] } } }]);
    expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22", "2026-10-29"]);
    expect(s.calls[0].headers).toMatchObject({ Authorization: "Bearer dummy-nubra-session-token", "x-device-id": "OPTIONSDESK" });
  });
});

describe("nubra option chain", () => {
  it("keeps native greeks, solves null IV, treats a fractional IV as percent and has no bid/ask", async () => {
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(r);
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 2168400, volume: 12070630, delta: 0.51, theta: -15.1, bidPrice: 0, askPrice: 0 });
    expect(atm.ce.iv).toBeGreaterThan(1);
    expect(chain.find((c) => c.strikePrice === 25050).ce.iv).toBeCloseTo(14.12, 2);
    expect(chain.find((c) => c.strikePrice === 25050).pe.delta).toBeLessThan(0); // no native greeks -> solved
    expect(r.data.oc["25000"].ce.security_id).toBe("739119");
  });

  it("rejects unsupported history intervals before any call", async () => {
    const s = stub([]);
    await expect(adapter.fetchHistorical(creds, { instrument: { token: "NIFTY", exchange: "NSE" }, interval: "2h", from: "2026-10-16", to: "2026-10-16" })).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("nubra orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the order-book buckets", () => {
    expect(mapStatus("open", { filledQty: 0, orderQty: 65 })).toBe("OPEN");
    expect(mapStatus("open", { filledQty: 65, orderQty: 130 })).toBe("PARTIALLY_FILLED");
    expect(mapStatus("executed")).toBe("COMPLETE");
    expect(mapStatus("cancelled")).toBe("CANCELLED");
    expect(mapStatus("rejected")).toBe("REJECTED");
    expect(mapStatus("expired")).toBe("EXPIRED");
    expect(mapStatus("gtt")).toBe("TRIGGER_PENDING");
  });

  it("reads single orders from every bucket and skips strategy orders", async () => {
    stub(fx.byCapability.orderBook.responses);
    const r = await adapter.fetchOrderBook(creds);
    expect(r.data.map((o) => [o.orderId, o.status, o.exchange, o.product])).toEqual([
      ["11303", "CANCELLED", "NSE", "CNC"],
      ["11290", "COMPLETE", "NFO", "INTRADAY"],
      ["11304", "PARTIALLY_FILLED", "NFO", "INTRADAY"],
    ]);
    expect(r.data[2]).toMatchObject({ price: 98.5, qty: 130, filledQty: 65, pendingQty: 65 });
  });

  it("builds LIMIT DAY orders in paise with IDAY/CNC delivery and needs a master lot size", () => {
    expect(adapter.buildOrderBody(order, lot).orders[0]).toMatchObject({ refId: 739119, qty: 130, entryPrice: 9850, deliveryType: "IDAY" });
    expect(adapter.buildOrderBody({ ...order, product: "MARGIN" }, lot).orders[0].deliveryType).toBe("CNC");
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, lot)).toThrow(/cash equity/);
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(/limit order/);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.placeOrder(creds, order, lot, { action: "placeOrder", brokerId: "nubra" })).rejects.toBeInstanceOf(OrderGateError);
    const used = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "nubra" });
    stub([...fx.byCapability.cancelOrder.responses]);
    await adapter.cancelOrder(creds, "11305", used);
    await expect(adapter.cancelOrder(creds, "11305", used)).rejects.toBeInstanceOf(OrderGateError); // single use
    expect(s.calls).toHaveLength(0);
  });
});
