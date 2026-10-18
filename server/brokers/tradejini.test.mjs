/**
 * Tradejini on the contract harness. No network: fetch is stubbed from fixtures, the instrument cache is an in-memory
 * map, and globalThis.WebSocket is a fake that answers NxtradStream subscriptions with binary frames encoded to the
 * official SDK's packet spec from each fixture's `streamTicks`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { deflateSync } from "node:zlib";
import * as cache from "../lib/instrumentCache.mjs";
import * as adapter from "./tradejini.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { parseFrame } from "./tradejiniCodec.mjs";
import { parseCsv, splitId, toInstrument } from "./tradejiniInstruments.mjs";
import { MAX_INSTRUMENTS_PER_CONN, __resetTradejiniStreams } from "./tradejiniStream.mjs";
import { orderStatusOf } from "./tradejiniPortfolio.mjs";

const fx = loadFixtures("tradejini");
const creds = { ...fx.manifest.creds, ...fx.byCapability.testConnection.creds };
const master = fx.byCapability.instruments.responses;
const TICKS = fx.byCapability.optionChain.streamTicks;
const realFetch = globalThis.fetch;
const realWs = globalThis.WebSocket;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

// ── frame encoder (official SDK spec: u16 len | u8 pktType | fieldId(u8) + value, ascending ids) ──
const SEG = { NSE: 1, BSE: 2, NFO: 3, BFO: 4 };
const L1_FIELDS = [[29, "ltp", "p"], [30, "open", "p"], [31, "high", "p"], [32, "low", "p"], [33, "close", "p"], [40, "vol", "u32"], [44, "OI", "u32"], [49, "bidPrice", "p"], [52, "askPrice", "p"], [58, "prevOI", "u32"], [70, "spotPrice", "p"]];
const GREEK_FIELDS = [[64, "iv"], [65, "delta"], [66, "gamma"], [67, "theta"], [69, "vega"]];

function packet(type, symbol, tick) {
  const [token, exch] = symbol.split("_");
  const parts = [Buffer.from([26, SEG[exch]])];
  const t = Buffer.alloc(5); t.writeUInt8(27, 0); t.writeInt32LE(Number(token), 1); parts.push(t);
  if (type === 10) {
    for (const [id, key, kind] of L1_FIELDS) {
      if (tick[key] === undefined) continue;
      const b = Buffer.alloc(5); b.writeUInt8(id, 0);
      if (kind === "p") b.writeInt32LE(Math.round(tick[key] * 100), 1); else b.writeUInt32LE(tick[key], 1);
      parts.push(b);
    }
  } else {
    for (const [id, key] of GREEK_FIELDS) {
      if (tick[key] === undefined) continue;
      const b = Buffer.alloc(9); b.writeUInt8(id, 0); b.writeDoubleLE(tick[key], 1); parts.push(b);
    }
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(3); head.writeUInt16LE(body.length + 3, 0); head.writeUInt8(type, 2);
  return Buffer.concat([head, body]);
}

function frame(packets, { zlib = false } = {}) {
  const payload = zlib ? deflateSync(Buffer.concat(packets)) : Buffer.concat(packets);
  const head = Buffer.alloc(6); head.writeInt32LE(payload.length + 6, 0); head.writeUInt8(1, 4); head.writeUInt8(zlib ? 100 : 0, 5);
  const buf = Buffer.concat([head, payload]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    FakeWebSocket.instances.push(this);
    setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }
  send(text) {
    this.sent.push(text);
    const req = JSON.parse(String(text).trim());
    if (req.action !== "sub") return;
    const type = req.type === "L1" ? 10 : req.type === "greeks" ? 17 : null;
    if (!type) return;
    const pkts = req.tokens.map((x) => x.t).filter((s) => TICKS[s] && (type === 10 || TICKS[s].iv !== undefined)).map((s) => packet(type, s, TICKS[s]));
    if (pkts.length) setTimeout(() => this.emit("message", { data: frame(pkts) }), 0);
  }
  close() { this.readyState = 3; this.emit("close", { code: 1000 }); }
}

beforeAll(() => { globalThis.WebSocket = FakeWebSocket; });
afterAll(() => { globalThis.WebSocket = realWs; });
beforeEach(() => {
  cache.__clear();
  __resetTradejiniStreams();
  FakeWebSocket.instances = [];
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("tradejini contract", () => {
  it("is on the strict contract as a session-login broker", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.credentialFields).toEqual(["apiKey"]);
    expect(adapter.capabilities.auth.loginFields.map((f) => f.key)).toEqual(["password", "totpCode"]);
  });

  it("passes every declared capability against the fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability).sort();
    expect(covered).toEqual(["login", ...declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed")].sort());
  }, 30_000);
});

describe("tradejini session", () => {
  it("refuses data calls without a session before any download or socket", async () => {
    const s = stub([]);
    await expect(adapter.fetchOptionChain({ apiKey: "k" }, "NIFTY", "2026-10-20")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchLTP({ apiKey: "k" }, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchPositions({ apiKey: "k", sessionToken: "t", sessionExpiresAt: String(Date.now() - 1) })).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("maps a 401 to SessionRequiredError (no automatic re-login) and sends the paired bearer token", async () => {
    const s = stub([{ method: "GET", url: "https://api.tradejini.com/v2/api/oms/limits", status: 401, json: { s: "error", msg: "Unauthorized" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers.Authorization).toBe("Bearer dummyApiKey:dummy-access-token");
  });

  it("connects the stream with the documented URL and token", async () => {
    stub(master);
    await adapter.fetchLTP(creds, "NIFTY");
    expect(FakeWebSocket.instances[0].url).toBe("wss://api.tradejini.com/v2.1/stream?version=3.1&token=dummyApiKey%3Adummy-access-token");
  });
});

describe("tradejini instruments and symbols", () => {
  it("splits symIds by idFormat and builds stream keys from excToken + exchange", () => {
    expect(splitId("OPTIDX_NIFTY_NFO_2026-10-20_25000_CE", "instrument_symbol_exchange_expiry_strike_optType")).toEqual({ instrument: "OPTIDX", symbol: "NIFTY", exchange: "NFO", expiry: "2026-10-20", strike: "25000", optType: "CE" });
    const idx = toInstrument("Index", { id: "IDX_-51_BSE", dispName: "SENSEX", excToken: "-51", symbol: "SENSEX" });
    expect(idx).toMatchObject({ instrumentType: "INDEX", underlying: "SENSEX", exchange: "BSE", streamKey: "-51_BSE" });
    const rows = parseCsv(master.find((r) => r.url.endsWith("/BSEOptions")).text).map((r) => toInstrument("BSEOptions", r));
    expect(rows[0]).toMatchObject({ token: "OPTIDX_SENSEX_BFO_2026-10-22_82000_CE", underlying: "SENSEX", expiry: "2026-10-22", strike: 82000, optionType: "CE", lotSize: 20, streamKey: "1163531_BFO" });
    expect(rows[2]).toMatchObject({ underlying: "BANKEX" });
  });

  it("lists NIFTY weekly + monthly, SENSEX weekly and stock-option expiries; drops unmapped indices", async () => {
    stub(master);
    expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
    expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
    expect((await adapter.fetchExpiryList(creds, "RELIANCE")).data).toEqual(["2026-10-27"]);
    const all = (await adapter.fetchInstruments(creds)).data;
    expect(all.some((r) => r.underlying === "NIFTYNXT50")).toBe(false);
    expect(all.find((r) => r.token === "FUTIDX_NIFTY_NFO_2026-10-27")).toMatchObject({ instrumentType: "FUTIDX", strike: null });
    await expect(adapter.fetchExpiryList(creds, "BAD SYMBOL")).rejects.toBeInstanceOf(BrokerInputError);
  });

  it("builds the chain from stream ticks with broker greeks (fraction IV scaled) and computed fallback", async () => {
    stub(master);
    const res = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(res);
    expect(spotPrice).toBe(25041.35);
    expect(chain[0].ce).toMatchObject({ ltp: 120.5, oi: 1312350, oiChange: 94825, iv: 13.13, delta: 0.53, bidPrice: 120.35, askPrice: 120.6 });
    expect(chain[0].pe.iv).toBeCloseTo(13.8, 6); // 0.138 on the wire
    expect(chain[1].ce.iv).toBeGreaterThan(1); // no greeks tick -> Black-Scholes
  });
});

describe("tradejini stream", () => {
  it("sends the full list in one frame on every change (replacement semantics)", async () => {
    stub(master);
    await adapter.fetchLTP(creds, "NIFTY");
    await adapter.fetchQuotes(creds, [{ token: "EQT_RELIANCE_EQ_NSE", exchange: "NSE" }]);
    const l1 = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s)).filter((r) => r.type === "L1");
    expect(l1).toHaveLength(2);
    expect(l1[1].tokens.map((x) => x.t)).toEqual(["-1_NSE", "2885_NSE"]);
    expect(FakeWebSocket.instances[0].sent.every((s) => s.endsWith("\n"))).toBe(true);
  });

  it("decodes zlib frames and the ttv double without losing later fields", () => {
    const ttv = Buffer.alloc(9); ttv.writeUInt8(41, 0); ttv.writeDoubleLE(123456.5, 1);
    const p = packet(10, "47029_NFO", { ltp: 120.5, vol: 10 });
    const withTtv = Buffer.concat([p, ttv, Buffer.from([44]), Buffer.from(new Uint32Array([999]).buffer)]);
    withTtv.writeUInt16LE(withTtv.length, 0);
    const [tick] = parseFrame(Buffer.from(frame([withTtv], { zlib: true })));
    expect(tick).toMatchObject({ symbol: "47029_NFO", exchSeg: "NFO", ltp: 120.5, vol: 10, ttv: 123456.5, OI: 999 });
  });

  it("feeds subscribed quotes to createFeed and stops after close", async () => {
    stub(master);
    const ticks = [];
    const feed = adapter.createFeed(creds, { onTick: (q) => ticks.push(q) });
    feed.subscribe([{ token: "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE", exchange: "NFO" }]);
    await vi.waitFor(() => expect(ticks.length).toBeGreaterThan(0));
    expect(ticks[0]).toMatchObject({ token: "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE", exchange: "NFO", ltp: 120.5, oi: 1312350 });
    feed.close();
    const last = JSON.parse(FakeWebSocket.instances[0].sent.at(-1));
    expect(last).toEqual({ type: "L1", action: "unsub" });
  });

  it("caps a single request at the per-connection limit", async () => {
    stub(master);
    const keys = Array.from({ length: MAX_INSTRUMENTS_PER_CONN + 1 }, (_, i) => `${i}_NFO`);
    const { subscribeAndCollect } = await import("./tradejiniStream.mjs");
    await expect(subscribeAndCollect(creds, keys, { windowMs: 0 })).rejects.toThrow(/at most/);
  });
});

describe("tradejini portfolio and orders", () => {
  it("maps order statuses including partial fills and stop orders", async () => {
    stub(fx.byCapability.orderBook.responses);
    const orders = (await adapter.fetchOrderBook(creds)).data;
    expect(orders.map((o) => o.status)).toEqual(["COMPLETE", "PARTIALLY_FILLED", "REJECTED", "TRIGGER_PENDING", "CANCELLED"]);
    expect(orders[2].statusMessage).toBe("RMS: Margin Exceeds");
    expect(orders[0]).toMatchObject({ exchange: "NFO", product: "MARGIN", orderType: "LIMIT", tradingSymbol: "NIFTY 20OCT 25000 CE" });
    expect(orderStatusOf({ status: "weird" })).toBe("UNKNOWN");
  });

  it("builds the documented order body from the master row", async () => {
    stub(master);
    const rows = (await adapter.fetchInstruments(creds)).data;
    const { findByToken } = await import("./tradejiniInstruments.mjs");
    const inst = await findByToken("OPTIDX_SENSEX_BFO_2026-10-22_82000_PE");
    expect(adapter.buildOrderBody({ token: inst.token, exchange: "BFO", side: "SELL", orderType: "SL", product: "INTRADAY", lots: 3, price: 279, triggerPrice: 280 }, 20, inst)).toEqual({
      symId: "OPTIDX_SENSEX_BFO_2026-10-22_82000_PE", qty: 60, side: "sell", product: "intraday", validity: "day", type: "stoplimit", limitPrice: 279, trigPrice: 280,
    });
    expect(adapter.buildOrderBody({ token: inst.token, exchange: "BFO", side: "BUY", orderType: "MARKET", product: "MARGIN", lots: 1, marketProtectionPercent: 2 }, 20, inst)).toMatchObject({ type: "market", mktProt: 2 });
    expect(() => adapter.buildOrderBody({ token: inst.token, exchange: "BFO", side: "BUY", product: "CNC", lots: 1, price: 1 }, 20, inst)).toThrow(/CNC/);
    expect(() => adapter.buildOrderBody({ token: inst.token, exchange: "BFO", side: "BUY", lots: 1, price: 1 }, 0, inst)).toThrow(/lot size/);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("refuses every order call without a valid gate before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, fx.byCapability.placeOrder.args[0], 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.cancelOrder(creds, "261016000000082", { action: "cancelOrder", brokerId: "tradejini" })).rejects.toBeInstanceOf(OrderGateError);
    const wrongBroker = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "modifyOrder", brokerId: "samco" });
    await expect(adapter.modifyOrder(creds, "261016000000080", { qty: 65, price: 1 }, wrongBroker)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("normalises upstream errors and redacts secrets", () => {
    const n = adapter.normaliseError(new Error("Tradejini error [429]: too many requests for dummy-access-token"), { secrets: ["dummy-access-token"] });
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    expect(n.message).not.toContain("dummy-access-token");
    expect(adapter.normaliseError(new Error("Tradejini error [400]: Input validation failed")).code).toBe("UPSTREAM_INPUT");
  });
});
