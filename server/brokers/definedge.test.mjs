/**
 * Definedge Securities adapter on the contract harness. No network (fetch is stubbed) and the shared instrument
 * cache is a per-test in-memory map. Fixtures are Definedge's own pyintegrate mock responses, re-keyed to
 * October 2026 NIFTY/SENSEX contracts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";

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
import * as adapter from "./definedge.mjs";
import { masterText, parseDerivativeMaster, distinctExpiriesAscending, toInstrument, unzipFirstFile, optionSegment } from "./definedgeInstruments.mjs";
import { parseDefinedgeDateTime, toDefinedgeDateTime } from "./definedgeQuotes.mjs";
import { mapOrderStatus } from "./definedgeOrders.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness, runLoginContract } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";

const fx = loadFixtures("definedge");
const session = fx.byCapability.optionChain.creds;
const creds = { ...fx.manifest.creds, ...session };
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

/** Minimal one-file ZIP (deflate) for the master reader. */
function makeZip(name, text) {
  const data = deflateRawSync(Buffer.from(text));
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(text.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const cdOffset = 30 + n.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + n.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("definedge contract", () => {
  it("is on the strict contract with a session login and no secret credential fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.credentialFields).toEqual(["apiToken", "apiSecret"]);
  });

  it("passes login and every declared capability against the fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed")].sort());
    // expiries reads the master the instruments step already cached, so it legitimately makes no call.
    expect(report.results.filter((r) => !["normaliseError", "expiries"].includes(r.capability) && r.calls === 0)).toEqual([]);
  });

  it("logs in with SHA-256(otp_token + code + api_secret) and keeps no secret", async () => {
    const s = stub(fx.byCapability.login.responses);
    const r = await adapter.login({ ...fx.manifest.creds, totpCode: "123456" });
    expect(r.session).toEqual({ apiSessionKey: "dummy-api-session-key", wsSessionKey: "dummy-ws-key", uid: "DUMMY01", actid: "DUMMY01" });
    expect(s.calls[0].headers).toMatchObject({ api_secret: "dummy-api-secret" });
    const { createHash } = await import("node:crypto");
    expect(JSON.parse(s.calls[1].body).ac).toBe(createHash("sha256").update("dummy-otp-token123456dummy-api-secret").digest("hex"));
    expect(JSON.stringify(r)).not.toContain("dummy-api-secret");
    const again = await runLoginContract(adapter, fx.byCapability.login, fx.manifest.creds);
    expect(again.problems).toEqual([]);
  });

  it("refuses data calls until logged in, without touching the network", async () => {
    const s = stub([]);
    const res = await adapter.testConnection(fx.manifest.creds);
    expect(res).toMatchObject({ status: "error" });
    expect(res.message).toMatch(/log in/i);
    await expect(adapter.fetchLTP(fx.manifest.creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-20")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("maps a 'Session Expired' error body to SessionRequiredError and other errors to 502", async () => {
    stub([{ method: "GET", url: "https://integrate.definedgesecurities.com/dart/v1/limits", json: { status: "ERROR", message: "Session Expired" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    stub([{ method: "GET", url: "https://integrate.definedgesecurities.com/dart/v1/limits", json: { status: "ERROR", message: "Something broke" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("Something broke") });
  });
});

describe("definedge master and symbol mapping", () => {
  const nfo = parseDerivativeMaster(fx.byCapability.instruments.responses[0].text);
  const bfo = parseDerivativeMaster(fx.byCapability.instruments.responses[1].text);

  it("maps NIFTY weekly + monthly, SENSEX weekly and a stock option (strike = raw / (mult * 10^prec))", () => {
    const nifty = nfo.filter((r) => r.symbol === "NIFTY" && r.instrumentType === "OPTIDX");
    expect(distinctExpiriesAscending(nifty)).toEqual(["2026-10-20", "2026-10-27"]);
    expect(toInstrument(nfo.find((r) => r.token === "43210"))).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05, expiry: "2026-10-20" });
    expect(toInstrument(bfo.find((r) => r.token === "870001"))).toMatchObject({ exchange: "BFO", underlying: "SENSEX", strike: 82000, lotSize: 20, expiry: "2026-10-22" });
    expect(toInstrument(nfo.find((r) => r.token === "55001"))).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, lotSize: 500 });
    expect(toInstrument(nfo.find((r) => r.token === "48757"))).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null, tickSize: 0.1 });
    expect(toInstrument(nfo.find((r) => r.token === "56001"))).toBeNull();
    expect(optionSegment("SENSEX")).toBe("BFO");
    expect(optionSegment("RELIANCE")).toBe("NFO");
  });

  it("reads the ZIP masters as well as plain CSV", () => {
    const csv = fx.byCapability.instruments.responses[1].text;
    const zip = makeZip("bsefno.csv", csv);
    expect(unzipFirstFile(zip)).toBe(csv);
    expect(masterText(zip)).toBe(csv);
    expect(masterText(Buffer.from(csv))).toBe(csv);
  });

  it("converts DDMMYYYYHHMM in IST both ways", () => {
    expect(toDefinedgeDateTime(Date.parse("2026-10-16T03:45:00Z"))).toBe("161020260915");
    expect(parseDefinedgeDateTime("161020260915")).toBe(Date.parse("2026-10-16T03:45:00Z") / 1000);
  });

  it("uses the NSE cash master for a stock option's spot", async () => {
    const cashCsv = "NSE,2885,RELIANCE,RELIANCE-EQ,EQ,,5,1,,0,2,1,INE002A01018,1,RELIANCE INDUSTRIES LTD\n";
    stub([
      { method: "GET", url: "https://app.definedgesecurities.com/public/nsecash.zip", text: cashCsv },
      { method: "GET", url: "https://integrate.definedgesecurities.com/dart/v1/quotes/NSE/2885", json: { status: "SUCCESS", ltp: "1460.20" } },
    ]);
    expect((await adapter.fetchLTP(creds, "RELIANCE")).data.last_price).toBe(1460.2);
  });
});

describe("definedge option chain", () => {
  it("windows the master, prices legs one quote each and backfills OI from minute history", async () => {
    stub(fx.byCapability.optionChain.responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(r);
    expect(spotPrice).toBe(25012.15);
    expect(chain.map((c) => c.strikePrice)).toEqual([24950, 25000, 25050]);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce).toMatchObject({ ltp: 104.95, oi: 2168400, volume: 12070630, bidPrice: 104.9, askPrice: 105 });
    expect(atm.ce.iv).toBeGreaterThan(0);
  });

  it("supports only 1m and 1d history", async () => {
    const s = stub([]);
    await expect(adapter.fetchHistorical(creds, { instrument: { token: "43210", exchange: "NFO" }, interval: "5m", from: "2026-10-16", to: "2026-10-16" })).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("definedge orders", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the documented order statuses", () => {
    expect(mapOrderStatus({ order_status: "NEW" })).toBe("OPEN");
    expect(mapOrderStatus({ order_status: "OPEN", filled_qty: "65" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ order_status: "REPLACED" })).toBe("OPEN");
    expect(mapOrderStatus({ order_status: "TRIGGER PENDING" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ order_status: "CANCELED" })).toBe("CANCELLED");
    expect(mapOrderStatus({ order_status: "COMPLETE" })).toBe("COMPLETE");
    expect(mapOrderStatus({ order_status: "REJECTED" })).toBe("REJECTED");
    expect(mapOrderStatus({ order_status: "??" })).toBe("UNKNOWN");
  });

  it("builds limit / SL-limit orders with the documented product codes and trigger rules", () => {
    expect(adapter.buildOrderBody(order, lot)).toMatchObject({ product_type: "NORMAL", quantity: 130, price_type: "LIMIT", validity: "DAY" });
    expect(adapter.buildOrderBody(order, lot, "12345").algo_id).toBe("12345");
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, lot)).toThrow(/limit order/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, lot)).toThrow(/cash equity only/);
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(() => adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 99 }, lot)).toThrow(/trigger price cannot be above/);
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 98 }, lot)).toMatchObject({ price_type: "SL-LIMIT", trigger_price: 98 });
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const forged = { action: "placeOrder", brokerId: "definedge" };
    await expect(adapter.placeOrder(creds, order, lot, forged)).rejects.toBeInstanceOf(OrderGateError);
    const other = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "arrow" });
    await expect(adapter.placeOrder(creds, order, lot, other)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
