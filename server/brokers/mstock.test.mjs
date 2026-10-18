/**
 * mStock (Mirae Asset) on the contract harness. No network: fetch is stubbed by the harness, node:https (used
 * for mStock's documented GET-with-body reads) is bridged to that same stub, and the instrument cache is an
 * in-memory map per test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:https", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    request(options, onResponse) {
      const req = new EventEmitter();
      let body = "";
      req.write = (chunk) => { body += chunk; };
      req.destroy = (err) => req.emit("error", err);
      req.end = () => {
        globalThis
          .fetch(`https://${options.hostname}${options.path}`, { method: options.method, headers: options.headers, body })
          .then(async (res) => {
            const text = await res.text();
            const out = new EventEmitter();
            out.statusCode = res.status;
            onResponse(out);
            out.emit("data", Buffer.from(text));
            out.emit("end");
          })
          .catch((e) => req.emit("error", e));
      };
      return req;
    },
  };
});

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
import * as adapter from "./mstock.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, normaliseError, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { listExpiries, optionContracts, parseExpiry, spotRef, toInstrument } from "./mstockInstruments.mjs";
import { candleTime } from "./mstockMarket.mjs";
import { mapOrderStatus, mapPosition, mstockTimeToIso } from "./mstockPortfolio.mjs";
import { sessionExpiry, classifyError } from "./mstockAuth.mjs";

const fx = loadFixtures("mstock");
const master = fx.byCapability.instruments.responses[0].json;
const creds = { ...fx.manifest.creds, ...fx.byCapability.optionChain.creds };
const instruments = master.map(toInstrument).filter(Boolean);
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => cache.__clear());
afterEach(() => { globalThis.fetch = realFetch; });

describe("mstock contract", () => {
  it("is on the strict contract with a session login", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    const ran = report.results.map((r) => r.capability).sort();
    expect(ran).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth")].sort());
  });
});

describe("mstock scrip master mapping", () => {
  it("lists NIFTY weekly + monthly, SENSEX weekly, BANKEX and a stock option's expiries", () => {
    expect(listExpiries(instruments, "NIFTY")).toEqual(["2026-10-20", "2026-10-27"]);
    expect(listExpiries(instruments, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(instruments, "BANKEX")).toEqual(["2026-10-29"]);
    expect(listExpiries(instruments, "RELIANCE")).toEqual(["2026-10-27"]);
  });

  it("maps contracts, drops non-canonical index options and finds spot refs", () => {
    expect(optionContracts(instruments, "SENSEX", "2026-10-22")[0]).toMatchObject({ exchange: "BFO", strike: 82700, optionType: "CE", lotSize: 20, tickSize: 0.05 });
    expect(instruments.find((i) => i.token === "50001")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", strike: 1460, lotSize: 500 });
    expect(instruments.find((i) => i.token === "40020")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null, expiry: "2026-10-27" });
    expect(instruments.find((i) => i.token === "60001")).toBeUndefined();
    expect(spotRef(instruments, "SENSEX")).toEqual({ exchange: "BSE", token: "51" });
    expect(spotRef(instruments, "BANKEX")).toEqual({ exchange: "BSE", token: "69" });
    expect(spotRef(instruments, "MIDCPNIFTY")).toEqual({ exchange: "NSE", token: "26074" });
    expect(spotRef(instruments, "RELIANCE")).toEqual({ exchange: "NSE", token: "2885" });
  });

  it("parses every documented expiry and time layout", () => {
    expect(parseExpiry("23Oct2025")).toBe("2025-10-23");
    expect(parseExpiry("2024-Nov-28")).toBe("2024-11-28");
    expect(parseExpiry("07-Nov-2024")).toBe("2024-11-07");
    expect(candleTime("2024-01-01T09:15:00+05")).toBe(Date.UTC(2024, 0, 1, 3, 45) / 1000);
    expect(candleTime("2025-04-04 15:27")).toBe(Date.UTC(2025, 3, 4, 9, 57) / 1000);
    expect(mstockTimeToIso("2024-Nov-06 12:42:18")).toBe("2024-11-06T12:42:18+05:30");
    expect(mstockTimeToIso("10-06-2025 13:08:42")).toBe("2025-06-10T13:08:42+05:30");
  });
});

describe("mstock market data", () => {
  it("builds a NIFTY chain from the master and OHLC quotes with locally solved IV", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    expect(chain.map((c) => c.strikePrice)).toEqual([24950, 25000, 25050]);
    const atm = chain.find((c) => c.strikePrice === 25000);
    expect(atm.ce.ltp).toBe(96.8);
    expect(atm.ce.iv).toBeGreaterThan(1); // percent, solved locally
    expect(atm.ce.oi).toBe(0); // OI is not part of the documented REST quote
  });

  it("sends the documented quote mode and index tokens", async () => {
    const s = stub(fx.byCapability.ltp.responses);
    await adapter.fetchLTP(creds, "SENSEX");
    expect(JSON.parse(s.calls[0].body)).toEqual({ mode: "OHLC", exchangeTokens: { BSE: ["51"] } });
    expect(s.calls[0].headers).toMatchObject({ "X-Mirae-Version": "1", Authorization: "Bearer dummy-jwt", "X-PrivateKey": "dummyApiKey" });
  });

  it("refuses before any download or broker call when not logged in", async () => {
    const s = stub([]);
    await expect(adapter.fetchExpiryList(fx.manifest.creds, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchInstruments(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions(fx.manifest.creds)).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchHistorical(fx.manifest.creds, { instrument: { token: "1", exchange: "NSE" }, interval: "1m", from: "2026-10-16", to: "2026-10-16" })).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("mstock errors", () => {
  it("maps IA401 to a session login, IA403 to an API-key problem and redacts secrets", async () => {
    stub([{ method: "GET", urlPattern: "fundsummary$", status: 401, json: { status: "false", message: "Invalid request. Please try again.", errorcode: "IA401", data: null } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "GET", urlPattern: "fundsummary$", status: 403, json: { status: "false", message: "API is suspended/expired for use.", errorcode: "IA403", data: null } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ code: "UPSTREAM_AUTH", statusCode: 502 });
    expect(classifyError(200, { status: "false", message: "RMS: FUND LIMIT INSUFFICIENT", errorcode: "RS-0111" }, "", "/orders/regular")).toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(normaliseError(new Error("bad dummy-jwt"), { secrets: ["dummy-jwt"] }).message).not.toContain("dummy-jwt");
  });

  it("expires the session at IST midnight or after 12 hours, whichever is first", () => {
    const morning = Date.UTC(2026, 9, 16, 3, 30); // 09:00 IST
    expect(sessionExpiry(morning)).toBe(Date.UTC(2026, 9, 16, 15, 30)); // 21:00 IST (12 h)
    const evening = Date.UTC(2026, 9, 16, 14, 30); // 20:00 IST
    expect(sessionExpiry(evening)).toBe(Date.UTC(2026, 9, 16, 18, 30)); // midnight IST
  });
});

describe("mstock orders and books", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps the documented order statuses and derivative exchanges", () => {
    expect(mapOrderStatus({ orderstatus: "Rejected" })).toBe("REJECTED");
    expect(mapOrderStatus({ orderstatus: "Pending" })).toBe("OPEN");
    expect(mapOrderStatus({ orderstatus: "open", filledshares: "65", unfilledshares: "65" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ orderstatus: "trigger pending" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ orderstatus: "Complete" })).toBe("COMPLETE");
    expect(mapOrderStatus({ orderstatus: "something new" })).toBe("UNKNOWN");
    const pos = mapPosition(fx.byCapability.positions.responses[0].json.data[0]);
    expect(pos).toMatchObject({ exchange: "NFO", product: "INTRADAY", netQty: 65, realisedPnl: 65 * (99.2 - 96.8) });
  });

  it("builds bodies from master lot sizes and validates every enum", () => {
    expect(adapter.buildOrderBody({ ...order, lotSize: 1 }, lot).quantity).toBe("130");
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 94 }, lot)).toMatchObject({ variety: "STOPLOSS", triggerprice: "94" });
    expect(adapter.buildOrderBody({ ...order, orderType: "MARKET", price: undefined, product: "CNC" }, lot)).toMatchObject({ ordertype: "MARKET", price: "0", producttype: "DELIVERY" });
    expect(() => adapter.buildOrderBody({ ...order, product: "MTF" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody({ ...order, validity: "GTC" }, lot)).toThrow(BrokerInputError);
    expect(() => adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_MARKET" }, lot)).toThrow(/triggerPrice/);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrongAction = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "mstock" });
    await expect(adapter.placeOrder(creds, order, lot, wrongAction)).rejects.toBeInstanceOf(OrderGateError);
    const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "angelone" });
    await expect(adapter.placeOrder(creds, order, lot, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
