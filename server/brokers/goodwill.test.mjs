/**
 * Goodwill on the contract harness. No network: fetch is stubbed, the WebSocket is a fake and the master cache
 * is an in-memory map per test.
 */
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
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
import * as adapter from "./goodwill.mjs";
import { BrokerInputError, FORBIDDEN_SECRET_KEY, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetGoodwill, signatureFor } from "./goodwillAuth.mjs";
import { mapOrder, mapPosition } from "./goodwillPortfolio.mjs";

const fx = loadFixtures("goodwill");
const creds = { ...fx.manifest.creds };
const session = fx.byCapability.testConnection.responses[0];
const API = "https://api.gwcindia.in/v1";
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const gate = (action) => issueOrderGate({ verdict: { ok: true }, liveArmed: true, action, brokerId: "goodwill" });

beforeEach(() => {
  cache.__clear();
  __resetGoodwill({ pacing: false });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("goodwill contract", () => {
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
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => !["auth", "feed"].includes(c)).sort());
  }, 30_000);
});

describe("goodwill session", () => {
  it("computes the documented signature: SHA-256(api_key + request_token + api_secret)", () => {
    expect(signatureFor("xxxxx", "5ca9e0b42c4e94759030e850", "yyyyy")).toBe(createHash("sha256").update("xxxxx5ca9e0b42c4e94759030e850yyyyy").digest("hex"));
    expect(signatureFor(creds.apiKey, creds.requestToken, creds.apiSecret)).toBe(session.expectBody.signature);
  });

  it("exchanges the request token once and sends x-api-key plus the Bearer token", async () => {
    const s = stub([...fx.byCapability.testConnection.responses, fx.byCapability.funds.responses[1]]);
    expect(await adapter.testConnection(creds)).toEqual({ status: "success", message: "Goodwill connected (TEST)" });
    await adapter.fetchFunds(creds);
    expect(s.calls.filter((c) => c.url.endsWith("/login-response"))).toHaveLength(1);
    expect(s.calls[1].headers).toMatchObject({ "x-api-key": creds.apiKey, Authorization: "Bearer 8a5e32e1126025fefbcefc88eb6eb9a9" });
    expect(JSON.stringify(s.calls.map((c) => c.body))).not.toContain(creds.apiSecret);
  });

  it("uses a pasted access token without an exchange", async () => {
    const s = stub([{ method: "GET", url: `${API}/profile`, json: { status: "success", data: {} } }]);
    expect((await adapter.testConnection({ apiKey: creds.apiKey, accessToken: "pasted-token" })).status).toBe("success");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers.Authorization).toBe("Bearer pasted-token");
  });

  it("asks for a fresh request token when the exchange is refused, without echoing secrets", async () => {
    const s = stub([{ method: "POST", url: `${API}/login-response`, json: { status: "error", error_msg: `Invalid Request Token ${creds.requestToken}`, error_type: "E" } }]);
    const res = await adapter.testConnection(creds);
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/request_token/);
    expect(res.message).not.toContain(creds.requestToken);
    await adapter.testConnection(creds);
    expect(s.calls).toHaveLength(1); // a refused code is never sent again
  });

  it("drops the session when Goodwill rejects it", async () => {
    const s = stub([session, { method: "GET", url: `${API}/balance`, json: { status: "error", error_msg: "Session Expired : Invalid Session Key", error_type: "E" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    await adapter.fetchFunds(creds).catch(() => {});
    expect(s.calls.filter((c) => c.url.endsWith("/login-response"))).toHaveLength(1);
  });

  it("reads a 'no data' error as an empty book", async () => {
    stub([session, { method: "GET", url: `${API}/orderbook`, json: { status: "error", error_msg: "No Data", error_type: "E" } }]);
    expect((await adapter.fetchOrderBook(creds)).data).toEqual([]);
  });
});

describe("goodwill data", () => {
  it("builds a NIFTY chain from per-contract quotes with computed Greeks", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-11-03"));
    expect(spotPrice).toBe(25012.35);
    expect(chain.map((r) => r.strikePrice)).toEqual([25000, 25050]);
    expect(chain[0].ce.ltp).toBe(182.4);
    expect(chain[0].ce.iv).toBeGreaterThan(1);
  });

  it("refuses SENSEX/BANKEX chains (no BFO master) and unknown symbols", async () => {
    stub([session, ...fx.byCapability.instruments.responses, { method: "POST", url: `${API}/getquote`, json: { status: "success", data: { last_price: "0" } } }]);
    await expect(adapter.fetchOptionChain(creds, "SENSEX", "2026-10-29")).rejects.toThrow(/BSE F&O/);
    expect((await adapter.fetchExpiryList(creds, "BANKEX")).data).toEqual([]);
    await expect(adapter.fetchLTP(creds, "NOSUCH")).rejects.toBeInstanceOf(BrokerInputError);
    await expect(adapter.fetchLTP(creds, "NIFTY")).rejects.toThrow(/no price/);
  });

  it("caps one-by-one quote requests", async () => {
    const refs = Array.from({ length: 51 }, (_, i) => ({ token: String(1000 + i), exchange: "NSE" }));
    await expect(adapter.fetchQuotes(creds, refs)).rejects.toThrow(/at most 50/);
  });

  it("maps products, short positions and Noren order statuses", () => {
    expect(mapPosition({ exchange: "NFO", product: "NRML", tsym: "X", token: "1", netqty: "-65", netsellavgprc: "190", netbuyavgprc: "0", realisedprofitloss: "0", unrealisedprofitloss: "494" }))
      .toMatchObject({ product: "MARGIN", netQty: -65, avgPrice: 190, pnl: 494 });
    expect(mapOrder({ nstordno: "1", status: "open", qty: "65", fillshares: "20", pricetype: "SL-L", product: "MIS", orderentrytime: "13:10:32 14-03-2023" }))
      .toMatchObject({ status: "PARTIALLY_FILLED", pendingQty: 45, orderType: "SL", product: "INTRADAY", placedAt: "2023-03-14T13:10:32+05:30" });
    expect(mapOrder({ nstordno: "1", status: "rejected", rejreason: "RMS" })).toMatchObject({ status: "REJECTED", statusMessage: "RMS", pendingQty: 0 });
  });
});

describe("goodwill orders", () => {
  const order = { tradingSymbol: "NIFTY03NOV26C25000", exchange: "NFO", side: "SELL", orderType: "SL", product: "INTRADAY", lots: 2, price: 90, triggerPrice: 91 };

  it("builds the documented string body", () => {
    expect(adapter.buildOrderBody(order, 65)).toEqual({ tsym: "NIFTY03NOV26C25000", exchange: "NFO", trantype: "S", validity: "DAY", pricetype: "SL-L", qty: "130", discqty: "0", price: "90", trgprc: "91", product: "MIS", amo: "NO" });
    expect(adapter.buildOrderBody({ ...order, orderType: "MARKET", price: undefined, triggerPrice: undefined }, 65)).toMatchObject({ pricetype: "MKT", price: "0", trgprc: "0" });
  });

  it("refuses bad input before any call", async () => {
    expect(() => adapter.buildOrderBody({ ...order, triggerPrice: 89 }, 65)).toThrow(/below the limit/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, 65)).toThrow(/F&O/);
    expect(() => adapter.buildOrderBody({ ...order, exchange: "BFO" }, 65)).toThrow(/exchange/);
    expect(() => adapter.buildOrderBody(order, 0)).toThrow(BrokerInputError);
    expect(() => adapter.buildModifyBody(undefined, { price: 1 })).toThrow(/order book/);
    const s = stub([]);
    await expect(adapter.placeOrder(creds, { ...order, token: "35008", lots: 0 }, 65, gate("placeOrder"))).rejects.toBeInstanceOf(BrokerInputError);
    expect(s.calls).toHaveLength(0);
  });

  it("refuses an instrument that is not in the master", async () => {
    stub([session, ...fx.byCapability.instruments.responses]);
    await expect(adapter.placeOrder(creds, { ...order, token: "999999" }, 65, gate("placeOrder"))).rejects.toThrow(/not in the instrument master/);
  });

  it("refuses without a gate, with a forged gate and with a reused gate, before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, order, 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.modifyOrder(creds, "23031400017243", { price: 1 }, { action: "modifyOrder", brokerId: "goodwill" })).rejects.toBeInstanceOf(OrderGateError);
    const g = gate("cancelOrder");
    await adapter.cancelOrder(creds, "abc", g).catch(() => {});
    await expect(adapter.cancelOrder(creds, "220106000024964", g)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("goodwill feed", () => {
  class FakeWs extends EventEmitter {
    constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 1; FakeWs.last = this; }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; this.emit("close"); }
  }

  it("connects with the login's usersessionid, merges tk/tf and emits contract quotes", async () => {
    stub([session]);
    FakeWs.last = undefined;
    const ticks = [];
    const status = [];
    const feed = adapter.createFeed(creds, { onTick: (q) => ticks.push(q), onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
    feed.subscribe([{ token: "35008", exchange: "NFO" }]);
    await vi.waitFor(() => expect(FakeWs.last).toBeDefined());
    const ws = FakeWs.last;
    expect(ws.url).toBe("wss://giga.gwcindia.in/NorenWSTP/");
    ws.emit("open");
    expect(ws.sent[0]).toEqual({ t: "c", uid: "GQ1A0007", actid: "GQ1A0007", source: "API", susertoken: "3279379865" });
    ws.emit("message", JSON.stringify({ t: "ck", uid: "GQ1A0007", s: "Ok" }));
    expect(ws.sent[1]).toEqual({ t: "t", k: "NFO|35008" });
    ws.emit("message", JSON.stringify({ t: "tk", e: "NFO", tk: "35008", lp: "182.40", o: "170", h: "190", l: "165", c: "175", v: "1000", oi: "51100", bp1: "182.35", sp1: "182.45" }));
    ws.emit("message", JSON.stringify({ t: "tf", e: "NFO", tk: "35008", lp: "183.00" }));
    expect(ticks.at(-1)).toEqual({ token: "35008", exchange: "NFO", ltp: 183, open: 170, high: 190, low: 165, close: 175, volume: 1000, oi: 51100, bid: 182.35, ask: 182.45 });
    feed.unsubscribe([{ token: "35008", exchange: "NFO" }]);
    expect(ws.sent.at(-1)).toEqual({ t: "u", k: "NFO|35008" });
    feed.close();
    expect(status[0]).toEqual({ connected: true });
  });

  it("stops for good on a Not_Ok connect ack", async () => {
    FakeWs.last = undefined;
    const status = [];
    adapter.createFeed({ apiKey: "k", accessToken: "pasted", clientId: "GQ1A0007", userSessionId: "123" }, { onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
    await vi.waitFor(() => expect(FakeWs.last).toBeDefined());
    FakeWs.last.emit("open");
    FakeWs.last.emit("message", JSON.stringify({ t: "ck", s: "Not_Ok" }));
    expect(status.at(-1).reason).toMatch(/refused/);
  });

  it("refuses to open a feed with no session", () => {
    expect(() => adapter.createFeed({ apiKey: "k" }, {}, { WebSocketImpl: FakeWs })).toThrow(SessionRequiredError);
  });
});
