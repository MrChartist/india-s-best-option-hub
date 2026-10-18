/**
 * Pocketful on the contract harness. No network: fetch is stubbed from the official-doc fixtures, the instrument cache
 * is an in-memory map, and globalThis.WebSocket is a fake that answers "marketdata" subscriptions with detailed
 * packets laid out like the official SDK's packetDecoder (big-endian, prices in paise) from `streamTicks`.
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

import * as cache from "../lib/instrumentCache.mjs";
import * as adapter from "./pocketful.mjs";
import { BrokerInputError, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetPocketfulAuth } from "./pocketfulAuth.mjs";
import { parseCsv, pocketfulExpiryToIso, toInstrument } from "./pocketfulInstruments.mjs";
import { fixPaise, istStampToSec, toIstLocal } from "./pocketfulMarket.mjs";
import { decodeDetailedMarketData } from "./pocketfulPacketDecoder.mjs";
import { mapFunds, orderStatusOf } from "./pocketfulPortfolio.mjs";
import { __resetPocketfulStreams } from "./pocketfulWs.mjs";

const fx = loadFixtures("pocketful");
const creds = { ...fx.manifest.creds };
const master = fx.byCapability.instruments.responses;
const TICKS = fx.byCapability.optionChain.streamTicks;
const realFetch = globalThis.fetch;
const realWs = globalThis.WebSocket;
const IST = 5.5 * 3600_000;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

/** Detailed marketdata packet (mode 1), 102 bytes, offsets per the official SDK decoder. */
function detailedPacket(exchangeCode, token, t) {
  const b = Buffer.alloc(102);
  const p = (v) => Math.round((v ?? 0) * 100);
  b.writeInt8(1, 0); b.writeInt8(exchangeCode, 1); b.writeUInt32BE(token, 2);
  b.writeUInt32BE(p(t.ltp), 6); b.writeUInt32BE(t.vol ?? 0, 18);
  b.writeUInt32BE(p(t.bid), 22); b.writeUInt32BE(p(t.ask), 30);
  b.writeUInt32BE(p(t.open), 62); b.writeUInt32BE(p(t.high), 66); b.writeUInt32BE(p(t.low), 70); b.writeUInt32BE(p(t.close), 74);
  b.writeUInt32BE(t.oi ?? 0, 94); b.writeUInt32BE(t.ioi ?? 0, 98);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
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
    const req = JSON.parse(text);
    if (req.a !== "subscribe" || req.m !== "marketdata") return;
    for (const [code, token] of req.v) {
      const t = TICKS[`${code}|${token}`];
      if (t) setTimeout(() => this.emit("message", { data: detailedPacket(code, token, t) }), 0);
    }
  }
  close() { this.readyState = 3; this.emit("close", {}); }
}

beforeAll(() => { globalThis.WebSocket = FakeWebSocket; });
afterAll(() => { globalThis.WebSocket = realWs; });
beforeEach(() => {
  cache.__clear();
  __resetPocketfulAuth();
  __resetPocketfulStreams();
  FakeWebSocket.instances = [];
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("pocketful contract", () => {
  it("is on the strict contract with no secret credential fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.credentialFields).toEqual(["accessToken", "clientId"]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability).sort();
    expect(covered).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed").sort());
  }, 30_000);
});

describe("pocketful auth", () => {
  it("sends the documented headers to the official base URL", async () => {
    const s = stub(fx.byCapability.testConnection.responses);
    expect((await adapter.testConnection(creds)).status).toBe("success");
    expect(s.calls[0].url).toBe("https://algo.pocketful.in/api/v1/user/profile?client_id=DUMMY1");
    expect(s.calls[0].headers).toMatchObject({ "x-authorization-token": "dummy-access-token", "x-device-type": "WEB" });
  });

  it("looks the client id up once when it is not saved", async () => {
    const s = stub([
      { method: "GET", url: "https://algo.pocketful.in/api/v1/user/trading_info", json: { status: "success", data: { client_id: "LOOKED1" } } },
      { method: "GET", urlPattern: "/api/v2/funds/view\\?client_id=LOOKED1&type=all$", json: fx.byCapability.funds.responses[0].json },
    ]);
    await adapter.fetchFunds({ accessToken: "t1" });
    await adapter.fetchFunds({ accessToken: "t1" });
    expect(s.calls.filter((c) => c.url.endsWith("trading_info"))).toHaveLength(1);
  });

  it("maps 401 to UPSTREAM_AUTH and refuses a missing token before any call", async () => {
    stub([{ method: "GET", urlPattern: "/api/v1/holdings", status: 401, json: { status: "error", message: "Request Unauthorised", error_code: 40000 } }]);
    const err = await adapter.fetchHoldings(creds).catch((e) => e);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    const s = stub([]);
    expect((await adapter.testConnection({})).status).toBe("error");
    expect(s.calls).toHaveLength(0);
  });
});

describe("pocketful instruments and symbols", () => {
  it("parses '27-Oct-2026' without a timezone shift", () => {
    expect(pocketfulExpiryToIso("27-Oct-2026")).toBe("2026-10-27");
    expect(pocketfulExpiryToIso("5-Nov-2026")).toBe("2026-11-05");
  });

  it("maps index spots, BFO codes, stock options and futures", () => {
    const row = (line) => toInstrument(parseCsv(`exchange_token,trading_symbol,company_name,close_price,expiry,strike,tick_size,lot_size,instrument_name,option_type,segment,exchange\n${line}`)[0]);
    expect(row("12,BANKEX,BANKEX,62899.26,,0.0000,0.0000,0,,,IDX,BSE")).toMatchObject({ instrumentType: "INDEX", underlying: "BANKEX", exchangeCode: 6 });
    expect(row("1125419,SENSEX26O2282000CE,SENSEX,300,22-Oct-2026,82000.0000,0.0500,20,IO,CE,IO,BFO")).toMatchObject({ instrumentType: "OPTIDX", underlying: "SENSEX", expiry: "2026-10-22", strike: 82000, lotSize: 20, exchangeCode: 7 });
    expect(row("48704,NIFTY26OCTFUT,NIFTY,25119.2,27-Oct-2026,-0.0100,0.1000,65,FUTIDX,XX,XX,NFO")).toMatchObject({ instrumentType: "FUTIDX", strike: null, optionType: null });
    expect(row('2885,RELIANCE-EQ,"RELIANCE INDUSTRIES, LTD",1211.2,,0.0000,0.1000,1,EQ,,EQ,NSE')).toMatchObject({ instrumentType: "EQ", underlying: "RELIANCE" });
    expect(row("43501,NIFTYNXT5026OCT70000CE,NIFTYNXT50,80,27-Oct-2026,70000.0000,0.0500,25,OPTIDX,CE,XX,NFO")).toBeNull();
  });

  it("lists NIFTY weekly + monthly, SENSEX weekly and stock-option expiries ascending", async () => {
    stub(master);
    expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
    expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
    expect((await adapter.fetchExpiryList(creds, "BANKEX")).data).toEqual(["2026-10-29"]);
    expect((await adapter.fetchExpiryList(creds, "RELIANCE")).data).toEqual(["2026-10-27"]);
    await expect(adapter.fetchExpiryList(creds, "BAD SYMBOL")).rejects.toBeInstanceOf(BrokerInputError);
  });

  it("builds the chain from feed ticks (paise scaled) with computed greeks", async () => {
    stub(master);
    const res = await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20");
    const { spotPrice, chain } = toOptionData(res);
    expect(spotPrice).toBe(25041.35);
    expect(chain[0].ce).toMatchObject({ ltp: 120.5, oi: 1312350, oiChange: 94825, bidPrice: 120.35, askPrice: 120.6 });
    expect(chain[0].ce.iv).toBeGreaterThan(1);
    expect(FakeWebSocket.instances[0].url).toBe("wss://algo.pocketful.in/ws/v1/feeds?login_id=DUMMY1&access_token=dummy-access-token");
    const sub = JSON.parse(FakeWebSocket.instances[0].sent[0]);
    expect(sub).toMatchObject({ a: "subscribe", m: "marketdata" });
    expect(sub.v).toContainEqual([1, 26000]);
  });

  it("subscribes SENSEX legs on BFO (code 7) with the BSE index (code 6)", async () => {
    stub(master);
    const res = await adapter.fetchOptionChain(creds, "SENSEX", "2026-10-22");
    const v = FakeWebSocket.instances[0].sent.map((s) => JSON.parse(s)).flatMap((m) => m.v || []);
    expect(v).toEqual(expect.arrayContaining([[7, 1125419], [7, 1125420], [6, 1]]));
    expect(res.data.last_price).toBe(82100.5);
    expect(res.data.oc["82000"].pe).toMatchObject({ last_price: 280, oi: 900, previous_oi: 950 });
  });
});

describe("pocketful parsing helpers", () => {
  it("decodes the detailed packet with paise prices", () => {
    const t = decodeDetailedMarketData(Buffer.from(detailedPacket(1, 1333, { ltp: 1448.95, bid: 1448.9, ask: 1448.95, vol: 8014246, oi: 0 })));
    expect(t).toMatchObject({ exchangeCode: 1, instrumentToken: 1333, lastTradedPrice: 1448.95, bestBidPrice: 1448.9, tradeVolume: 8014246 });
    expect(decodeDetailedMarketData(Buffer.alloc(50))).toBeNull();
  });
  it("scales paise bid/ask only when they are clearly paise", () => {
    expect(fixPaise(1285, 12.9)).toBe(12.85);
    expect(fixPaise(120.35, 120.5)).toBe(120.35);
  });
  it("reads history stamps as IST wall clock and sends IST bounds", () => {
    expect(istStampToSec("2026-10-16T09:15:00Z")).toBe((Date.UTC(2026, 9, 16, 9, 15) - IST) / 1000);
    expect(toIstLocal("2026-10-16T03:45:00Z")).toBe("2026-10-16T09:15:00");
  });
  it("maps funds rows and order statuses", () => {
    expect(mapFunds(fx.byCapability.funds.responses[0].json.data)).toEqual({ availableCash: 109797.5, usedMargin: 15202.5, totalBalance: 125000, collateral: 0, withdrawable: null });
    expect(["PENDING", "AMO_REQ_RECEIVED", "COMPLETE", "REJECTED", "AMO_CANCEL_CONFIRMED", "??"].map((s) => orderStatusOf({ order_status: s }))).toEqual(["OPEN", "OPEN", "COMPLETE", "REJECTED", "CANCELLED", "UNKNOWN"]);
  });
  it("merges pending and completed books", async () => {
    stub(fx.byCapability.orderBook.responses);
    const orders = (await adapter.fetchOrderBook(creds)).data;
    expect(orders.map((o) => o.status)).toEqual(["PARTIALLY_FILLED", "OPEN", "TRIGGER_PENDING", "COMPLETE", "REJECTED", "CANCELLED"]);
    expect(orders[4].statusMessage).toBe("RMS: margin exceeds");
    expect(orders[0]).toMatchObject({ product: "MARGIN", exchange: "NFO", token: "40001", pendingQty: 65 });
  });
  it("computes position MTM from cash flow and LTP", async () => {
    stub(fx.byCapability.positions.responses);
    const pos = (await adapter.fetchPositions(creds)).data;
    expect(pos[0]).toMatchObject({ netQty: -65, avgPrice: 120, ltp: 120.5, pnl: 7800 - 65 * 120.5, product: "MARGIN" });
    expect(pos[1]).toMatchObject({ exchange: "MCX", netQty: 0, pnl: 18, realisedPnl: 18 });
  });
});

describe("pocketful feed", () => {
  it("streams subscribed quotes and unsubscribes on close", async () => {
    stub(master);
    const ticks = [];
    const feed = adapter.createFeed(creds, { onTick: (q) => ticks.push(q) });
    feed.subscribe([{ token: "40001", exchange: "NFO" }]);
    await vi.waitFor(() => expect(ticks.length).toBeGreaterThan(0));
    expect(ticks[0]).toMatchObject({ token: "40001", exchange: "NFO", ltp: 120.5, oi: 1312350, bid: 120.35 });
    feed.close();
    expect(JSON.parse(FakeWebSocket.instances[0].sent.at(-1))).toEqual({ a: "unsubscribe", v: [[2, 40001]], m: "marketdata" });
  });
});

describe("pocketful orders", () => {
  it("builds the documented body and refuses MARKET", async () => {
    stub(master);
    const { findByRef } = await import("./pocketfulInstruments.mjs");
    const inst = await findByRef({ token: "1125420", exchange: "BFO" });
    expect(adapter.buildOrderBody({ token: "1125420", exchange: "BFO", side: "SELL", orderType: "SL", product: "INTRADAY", lots: 3, price: 279, triggerPrice: 280 }, 20, inst, "DUMMY1", 7)).toEqual({
      exchange: "BFO", instrument_token: "1125420", client_id: "DUMMY1", amo: false, quantity: 60, disclosed_quantity: 0, validity: "DAY", product: "MIS", order_side: "SELL", device: "WEB", user_order_id: 7, execution_type: "REGULAR", order_type: "SL", price: 279, trigger_price: 280,
    });
    expect(() => adapter.buildOrderBody({ token: "1125420", exchange: "BFO", side: "BUY", orderType: "MARKET", lots: 1 }, 20, inst, "DUMMY1")).toThrow(/LIMIT or SL/);
    expect(() => adapter.buildOrderBody({ token: "1125420", exchange: "BFO", side: "BUY", lots: 1, price: 1 }, undefined, inst, "DUMMY1")).toThrow(/lot size/);
  });

  it("refuses every order call without a valid gate before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, fx.byCapability.placeOrder.args[0], 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.cancelOrder(creds, "2026101644", { action: "cancelOrder", brokerId: "pocketful" })).rejects.toBeInstanceOf(OrderGateError);
    const other = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "modifyOrder", brokerId: "samco" });
    await expect(adapter.modifyOrder(creds, "2026101643", { qty: 65, price: 1 }, other)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("normalises documented error codes and redacts secrets", () => {
    const n = adapter.normaliseError(new Error("Pocketful error [400] 45000: Invalid Price for dummy-access-token"), { secrets: ["dummy-access-token"] });
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_INPUT" });
    expect(n.message).not.toContain("dummy-access-token");
    expect(adapter.normaliseError(new Error("Pocketful error [429]: rate limit")).code).toBe("UPSTREAM_RATE_LIMIT");
    expect(adapter.normaliseError(new SessionRequiredError()).statusCode).toBe(422);
  });
});
