/**
 * Alice Blue (Open API V2) adapter on the contract harness. No network (fetch is stubbed), and the shared
 * instrument cache is replaced by a per-test in-memory map so nothing touches the developer's .cache directory.
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
import * as adapter from "./aliceblue.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { checksumFor, clearSessions } from "./aliceblueAuth.mjs";
import { parseCsv, toInstrument } from "./aliceblueInstruments.mjs";
import { mapOrderStatus } from "./aliceblueOrders.mjs";

const fx = loadFixtures("aliceblue");
const creds = fx.manifest.creds;
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => { cache.__clear(); clearSessions(); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("aliceblue contract", () => {
  it("refuses a logged-out caller before downloading the contract masters", async () => {
    const s = stub([]);
    await expect(adapter.fetchInstruments({ userId: "AB1234", appCode: "X", apiSecret: "secret-value" })).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("is on the strict contract, storing no password/PIN/TOTP", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("requestTokenExchange");
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed").sort());
    expect(report.results.filter((r) => r.capability !== "normaliseError" && r.calls === 0)).toEqual([]);
  });
});

describe("aliceblue session exchange", () => {
  it("sends the documented checksum once and reuses the session", async () => {
    expect(checksumFor({ userId: "AB1234", authCode: "x", apiSecret: "y" })).toMatch(/^[0-9a-f]{64}$/);
    const s = stub(fx.byCapability.funds.responses);
    await adapter.fetchFunds(creds);
    await adapter.fetchFunds(creds);
    expect(s.calls.filter((c) => c.url.endsWith("/vendor/getUserDetails"))).toHaveLength(1);
    expect(s.calls[1].headers.Authorization).toBe("Bearer dummy.alice.user.session");
    expect(JSON.stringify(s.calls.map((c) => c.body))).not.toContain(creds.apiSecret);
  });

  it("asks the user to log in again when the authCode is missing, rejected or the session expires", async () => {
    const s = stub([]);
    await expect(adapter.fetchFunds({ ...creds, authCode: "" })).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
    stub([{ method: "POST", urlPattern: "getUserDetails$", json: { stat: "Not_ok", emsg: "Invalid auth code" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    const [session] = fx.byCapability.funds.responses;
    stub([session, { method: "GET", urlPattern: "/limits$", status: 401, json: { status: "Not_ok", message: "EC087 Session Expired" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    const r = await adapter.testConnection({ ...creds, authCode: "" });
    expect(r.status).toBe("error");
    expect(r.message).not.toContain(creds.apiSecret);
  });
});

describe("aliceblue market data", () => {
  it("builds the native chain with OI change from pdoi, NFO volumes and the NSE index spot", async () => {
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(r);
    expect(spotPrice).toBe(25012.15);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 165900, oiChange: 9975, volume: 543025 });
    expect(atm.ce.iv).toBeGreaterThan(1); // percent, solved locally
  });

  it("derives a BSE index spot by put-call parity (no documented BSE quote)", () => {
    const oc = { 82000: { ce: { last_price: 210 }, pe: { last_price: 190 } }, 82100: { ce: { last_price: 150 }, pe: { last_price: 240 } } };
    expect(adapter.paritySpot(oc)).toBe(82020); // undiscounted forward
    // Discounted to spot: S = K*e^(-rT) + C - P.
    const years = 7 / 365;
    expect(adapter.paritySpot(oc, { rate: 0.065, years })).toBeCloseTo(82000 * Math.exp(-0.065 * years) + 20, 1);
  });

  it("leaves previous_oi out when Alice Blue omits or blanks pdoi, so OI change is not the whole OI", async () => {
    const responses = JSON.parse(JSON.stringify(fx.byCapability.optionChain.responses), (k, v) => (k === "pdoi" ? "" : v));
    stub(responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const legs = Object.values(r.data.oc).flatMap((s) => Object.values(s));
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.every((l) => !("previous_oi" in l))).toBe(true);
    expect(toOptionData(r).chain.every((c) => c.ce.oiChange === 0 && c.pe.oiChange === 0)).toBe(true);
  });

  it("maps expiry codes, chain targets and leg strikes (NIFTY weekly + monthly, SENSEX, stock)", () => {
    expect(adapter.abExpiryToIso("25AUG26")).toBe("2026-08-25");
    expect(adapter.isoToAbExpiry("2026-10-20")).toBe("20OCT26");
    expect(adapter.chainTarget("SENSEX")).toEqual({ underlying: "SENSEX", exch: "bse_fo" });
    expect(adapter.chainTarget("RELIANCE")).toEqual({ underlying: "RELIANCE", exch: "nse_fo" });
    expect(adapter.legStrike({ forInsName: "NIFTY 25th AUG 23600 CE" })).toBe(23600);
    expect(adapter.legStrike({ tradingsymbol: "NIFTY25AUG26P23600" })).toBe(23600);
    expect(adapter.legStrike({ forInsName: "SENSEX 22nd OCT 82000 CE", tradingsymbol: "SENSEX26O2282000CE" })).toBe(82000);
  });

  it("maps V2 contract-master rows from both NFO and BFO layouts", () => {
    const [nfo, bfo] = fx.byCapability.instruments.responses.map((r) => parseCsv(r.text));
    const weekly = toInstrument(nfo.find((r) => r.token === "47425"));
    expect(weekly).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", expiry: "2026-10-20", strike: 25000, optionType: "CE", lotSize: 65, tradingSymbol: "NIFTY20OCT26C25000" });
    expect(toInstrument(nfo.find((r) => r.token === "51440"))).toMatchObject({ expiry: "2026-10-27" });
    expect(toInstrument(bfo.find((r) => r.token === "1125429"))).toMatchObject({ exchange: "BFO", instrumentType: "OPTIDX", underlying: "SENSEX", expiry: "2026-10-22", lotSize: 20, tradingSymbol: "SENSEX26O2282000CE" });
    expect(toInstrument(bfo.find((r) => r.token === "1163268"))).toMatchObject({ instrumentType: "OPTSTK", underlying: "APLAPOLLO" });
    expect(toInstrument(nfo.find((r) => r.token === "106737"))).toMatchObject({ instrumentType: "OPTSTK", lotSize: 500 });
    expect(toInstrument(nfo.find((r) => r.token === "90003"))).toBeNull();
  });

  it("only offers the documented history resolutions", async () => {
    await expect(adapter.fetchHistorical(creds, { instrument: { token: "22", exchange: "NSE" }, interval: "5m", from: "2026-01-01", to: "2026-01-02" })).rejects.toBeInstanceOf(BrokerInputError);
  });
});

describe("aliceblue orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("builds the documented one-element array and refuses unverified F&O carry-forward", () => {
    const [body] = adapter.buildOrderBody(order, lot);
    expect(body).toMatchObject({ instrumentId: "47425", quantity: 130, product: "INTRADAY", orderComplexity: "REGULAR" });
    expect(() => adapter.buildOrderBody({ ...order, product: "MARGIN" }, lot)).toThrow(/Unsupported Alice Blue product/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, lot)).toThrow(/Unsupported Alice Blue product/);
    expect(adapter.buildOrderBody({ ...order, exchange: "NSE", product: "CNC" }, 1)[0].product).toBe("LONGTERM");
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(adapter.buildOrderBody({ ...order, orderType: "SL", triggerPrice: 100 }, lot)[0]).toMatchObject({ orderType: "SL", slTriggerPrice: 100 });
  });

  it("maps order statuses", () => {
    expect(mapOrderStatus({ orderStatus: "REJECTED" })).toBe("REJECTED");
    expect(mapOrderStatus({ orderStatus: "open", filledQuantity: 10, pendingQuantity: 20 })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ orderStatus: "complete" })).toBe("COMPLETE");
    expect(mapOrderStatus({ orderStatus: "trigger pending" })).toBe("TRIGGER_PENDING");
  });

  it("never sends an order without a fresh gate", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const stale = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "aliceblue", now: Date.now() - 60_000 });
    await expect(adapter.placeOrder(creds, order, lot, stale)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
