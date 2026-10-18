/**
 * Zebu (MYNT) on the contract harness. No network (fetch is stubbed); the instrument cache is an in-memory
 * map and the OAuth session cache is reset per test.
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
import * as adapter from "./zebu.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { listExpiries, optionContracts, parseCsv, toInstrument, nearestFuture } from "./zebuInstruments.mjs";
import { unzipFirstEntry } from "./zebuZip.mjs";
import { norenTime, selectStrikeWindow } from "./zebuMarket.mjs";
import { mapHolding, mapOrderStatus, norenTimeToIso } from "./zebuPortfolio.mjs";
import { encodeJData, resetSessions } from "./zebuAuth.mjs";

const fx = loadFixtures("zebu");
const masterText = (exch) => unzipFirstEntry(Buffer.from(fx.byCapability.instruments.responses.find((r) => r.url?.endsWith(`/${exch}_symbols.txt.zip`)).text, "latin1"));
const nfo = parseCsv(masterText("NFO")).map(toInstrument).filter(Boolean);
const bfo = parseCsv(masterText("BFO")).map(toInstrument).filter(Boolean);
const nse = parseCsv(masterText("NSE")).map(toInstrument).filter(Boolean);
const creds = fx.manifest.creds;
const genAcsTok = fx.byCapability.testConnection.responses[0];
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

beforeEach(() => { cache.__clear(); resetSessions(); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("zebu contract", () => {
  it("is on the strict contract with a request-token exchange", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth").sort());
  });
});

describe("zebu masters", () => {
  it("lists NIFTY weekly + monthly, SENSEX weekly, BANKEX and stock expiries", () => {
    expect(listExpiries(nfo, "NIFTY")).toEqual(["2026-10-20", "2026-10-27"]);
    expect(listExpiries(bfo, "SENSEX")).toEqual(["2026-10-22"]);
    expect(listExpiries(bfo, "BANKEX")).toEqual(["2026-10-29"]);
    expect(listExpiries(nfo, "RELIANCE")).toEqual(["2026-10-27"]);
    expect(listExpiries(bfo, "ETERNAL")).toEqual(["2026-10-29"]);
  });

  it("maps BFO product codes, never mixing SENSEX 50 into SENSEX", () => {
    expect(optionContracts(bfo, "SENSEX", "2026-10-22").map((c) => c.tradingSymbol)).toEqual(["SENSEX26O2282700CE", "SENSEX26O2282700PE"]);
    expect(bfo.find((i) => i.token === "884500")).toBeUndefined();
    expect(nfo.find((i) => i.token === "61473")).toBeUndefined();
    expect(nse.find((i) => i.token === "26000")).toMatchObject({ instrumentType: "INDEX", underlying: "NIFTY" });
    expect(nse.find((i) => i.token === "978323")).toBeUndefined();
    expect(nearestFuture(nfo, "MIDCPNIFTY", "2026-10-16")).toMatchObject({ token: "40031" });
    expect(selectStrikeWindow(optionContracts(nfo, "NIFTY", "2026-10-20"), 25010, 0).map((c) => c.strike)).toEqual([25000, 25000]);
  });

  it("reads Noren time layouts and escapes & in jData", () => {
    expect(norenTime("16-10-2026 09:15:00")).toBe(Date.UTC(2026, 9, 16, 3, 45) / 1000);
    expect(norenTime("21-SEP-2022")).toBe(Date.UTC(2022, 8, 20, 18, 30) / 1000);
    expect(norenTimeToIso("19:59:32 13-12-2020")).toBe("2020-12-13T19:59:32+05:30");
    expect(norenTimeToIso("01-01-1980 00:00:00")).toBeNull();
    expect(encodeJData({ tsym: "M&M-EQ" })).toBe('{"tsym":"M\\u0026M-EQ"}');
  });
});

describe("zebu session", () => {
  it("exchanges the single-use code once even when many quotes run in parallel", async () => {
    const s = stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    expect(chain.find((c) => c.strikePrice === 25000).ce).toMatchObject({ ltp: 96.8, oi: 165900, bidPrice: 96.55, askPrice: 96.95 });
    expect(chain.find((c) => c.strikePrice === 25000).ce.iv).toBeGreaterThan(1);
    expect(s.calls.filter((c) => c.url.endsWith("/GenAcsTok"))).toHaveLength(1);
    const master = s.calls.find((c) => c.url.endsWith("NFO_symbols.txt.zip"));
    expect(master.headers).toMatchObject({ Authorization: "Bearer dummyZebuAccessToken" });
  });

  it("reads GetQuotes poi as previous OI, so OI change works as on the other Noren brokers", async () => {
    const responses = structuredClone(fx.byCapability.optionChain.responses);
    const leg = responses.find((r) => r.json && typeof r.json === "object" && r.json.tsym === "NIFTY20OCT26C25000");
    leg.json.poi = "150000";
    stub(responses);
    const r = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    expect(r.data.oc["25000"].ce.previous_oi).toBe(150000);
    expect(toOptionData(r).chain.find((c) => c.strikePrice === 25000).ce.oiChange).toBe(165900 - 150000);
  });

  it("refreshes with the refresh token when the access token is rejected, then gives up cleanly", async () => {
    const expired = { stat: "Not_Ok", emsg: "Session Expired :  Invalid Session Key" };
    stub([genAcsTok, { method: "POST", url: "https://go.mynt.in/NorenWClientAPI/Limits", json: expired },
      { method: "POST", url: "https://go.mynt.in/NorenWClientAPI/RefreshToken", json: { stat: "Ok", access_token: "renewed", expires_in: "3600" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    const s = stub([]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError); // spent: no retry storm
    expect(s.calls).toHaveLength(0);
  });

  it("asks for a fresh code when the exchange fails, and refuses missing credentials locally", async () => {
    stub([{ method: "POST", url: "https://go.mynt.in/NorenWClientAPI/GenAcsTok", json: { stat: "Not_Ok", emsg: "Invalid authorization code" } }]);
    await expect(adapter.fetchPositions(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect((await adapter.testConnection({ ...creds, authCode: "" })).status).toBe("error");
    await expect(adapter.fetchPositions({ ...creds, authCode: "" })).rejects.toBeInstanceOf(BrokerInputError);
  });
});

describe("zebu orders and books", () => {
  const [order, lot] = fx.byCapability.placeOrder.args;

  it("maps statuses and holding quantities per the documented formula", () => {
    expect(mapOrderStatus({ status: "OPEN" })).toBe("OPEN");
    expect(mapOrderStatus({ status: "Open", qty: "130", fillshares: "65" })).toBe("PARTIALLY_FILLED");
    expect(mapOrderStatus({ status: "REJECT" })).toBe("REJECTED");
    expect(mapOrderStatus({ status: "CANCELED" })).toBe("CANCELLED");
    expect(mapOrderStatus({ status: "TRIGGER_PENDING" })).toBe("TRIGGER_PENDING");
    expect(mapOrderStatus({ status: "?" })).toBe("UNKNOWN");
    expect(mapHolding(fx.byCapability.holdings.responses[1].json[1])).toMatchObject({ tradingSymbol: "ACC-EQ", token: "22", qty: 10, avgPrice: 1400 });
  });

  it("builds bodies from master lot sizes with documented codes only", () => {
    expect(adapter.buildOrderBody({ ...order, lotSize: 1 }, lot)).toMatchObject({ qty: "130", prd: "M", prctyp: "LMT", trantype: "B", ret: "DAY" });
    expect(adapter.buildOrderBody(order, lot)).not.toHaveProperty("ordersource");
    expect(() => adapter.buildOrderBody(order)).toThrow(/resolved lot size/);
    expect(adapter.buildOrderBody({ ...order, orderType: "STOPLOSS_LIMIT", triggerPrice: 94 }, lot)).toMatchObject({ prctyp: "SL-LMT", trgprc: "94" });
    expect(() => adapter.buildOrderBody({ ...order, exchange: "BFO", orderType: "MARKET" }, lot)).toThrow(/marketProtectionPercent/);
    expect(() => adapter.buildOrderBody({ ...order, product: "MTF" }, lot)).toThrow(BrokerInputError);
  });

  it("never sends an order without a fresh gate for this broker", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    await expect(adapter.placeOrder(creds, order, lot)).rejects.toBeInstanceOf(OrderGateError);
    const wrong = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "shoonya" });
    await expect(adapter.placeOrder(creds, order, lot, wrong)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});
