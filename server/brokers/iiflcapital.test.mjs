/**
 * IIFL Capital on the contract harness. No network: fetch is stubbed and the contract-file cache is an
 * in-memory map per test.
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
import * as adapter from "./iiflcapital.mjs";
import { BrokerInputError, FORBIDDEN_SECRET_KEY, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetIiflCapitalAuth, checksumFor, nextIstMidnightMs } from "./iiflcapitalAuth.mjs";
import { expiryIso, listExpiries, optionRows, parseCsv, toMasterRow } from "./iiflcapitalInstruments.mjs";
import { candleTime, iiflDate, oiStrikes } from "./iiflcapitalMarket.mjs";
import { orderStatusOf } from "./iiflcapitalPortfolio.mjs";

const fx = loadFixtures("iiflcapital");
const fileText = (seg) => fx.byCapability.instruments.responses.find((r) => r.url.endsWith(`/${seg}.csv`)).text;
const rows = (seg) => parseCsv(fileText(seg)).map(toMasterRow).filter(Boolean);
const nsefo = rows("NSEFO");
const bsefo = rows("BSEFO");
const indices = rows("INDICES");
const creds = { ...fx.manifest.creds };
const session = fx.byCapability.testConnection.responses[0];
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => {
  cache.__clear();
  __resetIiflCapitalAuth();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("iiflcapital contract", () => {
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

describe("iiflcapital session", () => {
  it("computes the documented checksum: SHA-256(clientId + authCode + appSecret)", () => {
    expect(checksumFor("TEST101", "dummyAuthCode123", "dummyAppSecret456")).toBe(session.expectBody.checkSum);
  });

  it("exchanges the authCode once per day and sends the JWT as a Bearer token", async () => {
    const s = stub([...fx.byCapability.testConnection.responses, { method: "GET", url: "https://api.iiflcapital.com/v1/limits", json: fx.byCapability.funds.responses[1].json }]);
    expect((await adapter.testConnection(creds)).status).toBe("success");
    await adapter.fetchFunds(creds);
    expect(s.calls.filter((c) => c.url.endsWith("/getusersession"))).toHaveLength(1);
    expect(s.calls[1].headers.Authorization).toBe("Bearer eyJhbGciOi.dummy.bx844uFwWA");
    expect(JSON.stringify(s.calls.map((c) => c.body))).not.toContain(creds.appSecret);
  });

  it("uses a pasted userSession without an exchange", async () => {
    const s = stub([{ method: "GET", url: "https://api.iiflcapital.com/v1/profile", json: { status: "Ok", message: "Success", result: {} } }]);
    expect((await adapter.testConnection({ userSession: "pasted.jwt.value" })).status).toBe("success");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers.Authorization).toBe("Bearer pasted.jwt.value");
  });

  it("asks for a fresh authCode when the exchange fails, without echoing secrets", async () => {
    stub([{ method: "POST", url: "https://api.iiflcapital.com/v1/getusersession", json: { status: "Not_Ok", message: "EC055 Unauthorized access dummyAuthCode123" } }]);
    const res = await adapter.testConnection(creds);
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/authCode/);
    expect(res.message).not.toContain("dummyAuthCode123");
    expect(res.message).not.toContain("dummyAppSecret456");
  });

  it("drops the session on a rejected token and maps errors", async () => {
    const s = stub([session, { method: "GET", url: "https://api.iiflcapital.com/v1/limits", status: 401, json: { status: "Not_Ok", message: "EC044 Error : Token is not valid." } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_AUTH");
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    await adapter.fetchFunds(creds).catch(() => {});
    expect(s.calls.filter((c) => c.url.endsWith("/getusersession"))).toHaveLength(2);
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
  });

  it("reads EC920 'No Positions found' as an empty book but keeps EC908 as an error that does not log out", async () => {
    stub([
      session,
      { method: "GET", url: "https://api.iiflcapital.com/v1/positions", json: { status: "Not_Ok", message: "EC920", result: [{ status: "EC920", message: "Error : No Positions found for this user." }] } },
      { method: "GET", url: "https://api.iiflcapital.com/v1/holdings", json: { status: "Not_Ok", message: "EC908 Invalid parameter : 'token' cannot be empty or null." } },
    ]);
    expect((await adapter.fetchPositions(creds)).data).toEqual([]);
    const err = await adapter.fetchHoldings(creds).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_ERROR");
  });

  it("expires sessions at IST midnight", () => {
    const t = Date.UTC(2026, 9, 17, 10, 0);
    expect(nextIstMidnightMs(t)).toBe(Date.UTC(2026, 9, 17, 18, 30));
  });
});

describe("iiflcapital symbol mapping", () => {
  it("maps index options to the six canonical underlyings and reads OTPSTK as a stock option", () => {
    for (const [u, list] of [["NIFTY", nsefo], ["BANKNIFTY", nsefo], ["FINNIFTY", nsefo], ["MIDCPNIFTY", nsefo], ["SENSEX", bsefo], ["BANKEX", bsefo]]) {
      expect(optionRows(list, u).length).toBeGreaterThan(0);
    }
    expect(bsefo.find((m) => m.underlying === "APLAPOLLO")).toMatchObject({ instrumentType: "OPTSTK", exchange: "BFO" });
    expect([...nsefo, ...bsefo].some((m) => m.underlying === "NIFTYNXT50" || m.underlying === "SENSEX50")).toBe(false);
    expect(indices.filter((m) => ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"].includes(m.underlying))).toHaveLength(6);
    expect(expiryIso("29-Dec-2026 23:59")).toBe("2026-12-29");
  });

  it("lists NIFTY weekly + monthly, SENSEX weekly and stock expiries", () => {
    expect(listExpiries(nsefo, "NIFTY")).toEqual(["2026-10-27", "2026-11-03"]);
    expect(listExpiries(bsefo, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(nsefo, "RELIANCE")).toEqual(["2026-10-27"]);
  });

  it("builds a SENSEX weekly chain on BSEFO with the BSEEQ index as spot", async () => {
    stub([
      session, ...fx.byCapability.instruments.responses,
      { method: "POST", url: "https://api.iiflcapital.com/v1/marketdata/marketquotes", expectBody: [{ exchange: "BSEEQ", instrumentId: "999901" }],
        json: { status: "Ok", message: "Success", result: [
          { exchange: "BSEEQ", instrumentId: 999901, ltp: 81234.5 },
          { exchange: "BSEFO", instrumentId: 1163250, ltp: 420.5, tradedVolume: 5000, bestBidPrice: 420, bestAskPrice: 421 },
          { exchange: "BSEFO", instrumentId: 1163251, ltp: 180.25, tradedVolume: 3000, bestBidPrice: 180, bestAskPrice: 180.5 },
        ] } },
      { method: "POST", url: "https://api.iiflcapital.com/v1/marketdata/openinterest", expectBody: { exchange: "BSEFO", instrumentId: "1163250" }, json: { openInterest: 12000 } },
      { method: "POST", url: "https://api.iiflcapital.com/v1/marketdata/openinterest", expectBody: { exchange: "BSEFO", instrumentId: "1163251" }, json: { result: { openInterest: 9000 } } },
    ]);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "SENSEX", "2026-10-22"));
    expect(spotPrice).toBe(81234.5);
    expect(chain[0]).toMatchObject({ strikePrice: 81000, ce: { ltp: 420.5, oi: 12000, bidPrice: 420, askPrice: 421 }, pe: { oi: 9000 } });
  });

  it("fetches OI only for strikes near the spot", () => {
    const strikes = Array.from({ length: 60 }, (_, i) => 24000 + i * 50);
    const near = oiStrikes(strikes, 25010, 3);
    expect([...near].sort((a, b) => a - b)).toEqual([24850, 24900, 24950, 25000, 25050, 25100, 25150]);
  });

  it("refuses an unknown symbol instead of returning a zero LTP", async () => {
    stub([session, ...fx.byCapability.instruments.responses]);
    await expect(adapter.fetchLTP(creds, "NOSUCH")).rejects.toBeInstanceOf(BrokerInputError);
  });

  it("parses IIFL dates and maps order statuses", () => {
    expect(iiflDate("2024-09-19")).toBe("19-Sep-2024");
    expect(candleTime("19-Sep-2024 09:17:00")).toBe(Date.UTC(2024, 8, 19, 3, 47) / 1000);
    expect(orderStatusOf("Open")).toBe("OPEN");
    expect(orderStatusOf("open", 65, 65)).toBe("PARTIALLY_FILLED");
    expect(orderStatusOf("Complete")).toBe("COMPLETE");
    expect(orderStatusOf("cancelled")).toBe("CANCELLED");
    expect(orderStatusOf("Canceled")).toBe("CANCELLED");
    expect(orderStatusOf("rejected")).toBe("REJECTED");
    expect(orderStatusOf("trigger_pending")).toBe("TRIGGER_PENDING");
    expect(orderStatusOf("mystery")).toBe("UNKNOWN");
  });
});

describe("iiflcapital orders", () => {
  const order = { instrumentId: "51440", exchange: "NFO", side: "SELL", orderType: "SL", product: "INTRADAY", lots: 1, price: 90, triggerPrice: 91 };

  it("builds the documented body (strings, REGULAR complexity, price only for LIMIT/SL)", () => {
    expect(adapter.buildOrderBody(order, 65)).toEqual({ instrumentId: "51440", exchange: "NSEFO", transactionType: "SELL", quantity: "65", orderComplexity: "REGULAR", product: "INTRADAY", orderType: "SL", validity: "DAY", price: "90", slTriggerPrice: "91" });
    const mkt = adapter.buildOrderBody({ ...order, orderType: "MARKET", price: undefined, triggerPrice: undefined, marketProtectionPercent: 2 }, 65);
    expect(mkt).toMatchObject({ orderType: "MARKET", marketProtectionPercent: "2" });
    expect(mkt.price).toBeUndefined();
    expect(adapter.buildModifyBody("240919000000041", { price: 7.81 })).toEqual({ price: "7.81" });
  });

  it("refuses bad input before any call", () => {
    expect(() => adapter.buildOrderBody({ ...order, triggerPrice: 89 }, 65)).toThrow(/above the limit/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, 65)).toThrow(/equity/);
    expect(() => adapter.buildOrderBody(order, 0)).toThrow(BrokerInputError);
    expect(() => adapter.buildModifyBody("abc", { price: 1 })).toThrow(/order id/);
    expect(() => adapter.buildModifyBody("240919000000041", {})).toThrow(/Nothing/);
  });

  it("refuses without a gate, with a forged gate and with a reused gate, before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, order, 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.modifyOrder(creds, "240919000000041", { price: 1 }, { action: "modifyOrder", brokerId: "iiflcapital" })).rejects.toBeInstanceOf(OrderGateError);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "iiflcapital" });
    await adapter.cancelOrder(creds, "not-an-id", gate).catch(() => {});
    await expect(adapter.cancelOrder(creds, "240919000000041", gate)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("treats a per-order failure inside an Ok envelope as a refusal", async () => {
    stub([session, { method: "DELETE", url: "https://api.iiflcapital.com/v1/orders/240919000000041", json: { status: "Ok", message: "Success", result: { status: "EC995", message: "Error : There is no order to cancel." } } }]);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "iiflcapital" });
    await expect(adapter.cancelOrder(creds, "240919000000041", gate)).rejects.toThrow(/no order to cancel/);
  });
});
