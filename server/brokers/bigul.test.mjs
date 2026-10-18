/**
 * Bigul on the contract harness. No network: fetch is stubbed from the official-doc fixtures, the instrument cache is
 * an in-memory map, and globalThis.WebSocket is a fake HSM server that accepts the connect frame and answers
 * subscriptions with binary snapshot records built here from `streamTicks` (layout per Bigul's official Python SDK).
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
import * as adapter from "./bigul.mjs";
import { OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { nextBigulExpiryMs } from "./bigulAuth.mjs";
import {
  DEPTH_FIELDS, INDEX_FIELDS, NO_VALUE, SCRIP_FIELDS, WS_URL, __resetBigulFeeds, applyRecord, connectFrame, decodeData, modeFrame, readConnectReply,
  readFields, subscribeFrame,
} from "./bigulFeed.mjs";
import { bigulExpiryToIso, cashRow, derivRow, parseCsv } from "./bigulInstruments.mjs";
import { nearestStrikes, toDepth } from "./bigulMarket.mjs";
import { mapFunds, mapHolding } from "./bigulPortfolio.mjs";

const fx = loadFixtures("bigul");
const SESSION = { ...fx.manifest.creds, sessionToken: "dummy.bigul.jwt.token" };
const master = fx.byCapability.instruments.responses;
const TICKS = fx.byCapability.optionChain.streamTicks;
const realFetch = globalThis.fetch;
const realWs = globalThis.WebSocket;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};

// ── fake HSM server ──

const PRICE_POS = { sf: new Set([0, 6, 7, 11, 13, 14, 15, 16, 17, 18, 19, 20]), if: new Set([0, 1, 3, 4, 5, 6, 7]), dp: new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) };
const NAMES = { sf: SCRIP_FIELDS, if: INDEX_FIELDS, dp: DEPTH_FIELDS };
const short = (s) => { const b = Buffer.from(s, "utf8"); return Buffer.concat([Buffer.from([b.length]), b]); };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

function rawValues(key, tick, precision = 2) {
  const kind = key.slice(0, 2);
  return NAMES[kind].map((name, i) => (tick[name] === undefined ? NO_VALUE : PRICE_POS[kind].has(i) ? Math.round(tick[name] * 10 ** precision) : tick[name]));
}
function snapshotRecord(topic, key, tick) {
  const vals = rawValues(key, tick);
  return Buffer.concat([Buffer.from([0x53]), u16(topic), short(key), Buffer.from([vals.length]), ...vals.map(u32), u16(0), u16(1), Buffer.from([2]),
    short(key.split("|")[1]), short(key.split("|")[2]), short(key)]);
}
const updateRecord = (topic, vals) => Buffer.concat([Buffer.from([0x55]), u16(topic), Buffer.from([vals.length]), ...vals.map(u32)]);
function dataFrame(messageNo, records) {
  const body = Buffer.concat([u32(messageNo), u16(records.length), ...records]);
  return Buffer.concat([u16(body.length + 1), Buffer.from([6]), body]);
}
function connectReply(ok, ackEvery = 0) {
  const fields = [Buffer.concat([Buffer.from([1]), u16(1), Buffer.from(ok ? "K" : "N")]), Buffer.concat([Buffer.from([2]), u16(4), u32(ackEvery)])];
  const body = Buffer.concat(fields);
  return Buffer.concat([u16(body.length + 2), Buffer.from([1, 2]), body]);
}
const arrayBuf = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

class FakeWebSocket {
  static instances = [];
  static accept = true;
  static ackEvery = 0;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = {};
    this.topic = 0;
    this.msgNo = 0;
    FakeWebSocket.instances.push(this);
    setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }
  push(buf) { setTimeout(() => this.emit("message", { data: arrayBuf(buf) }), 0); }
  send(frame) {
    this.sent.push(frame);
    if (typeof frame === "string") return;
    const type = frame[2];
    if (type === 1) return this.push(connectReply(FakeWebSocket.accept, FakeWebSocket.ackEvery));
    if (type !== 4) return;
    const list = readFields(frame).get(1);
    const keys = [];
    for (let at = 2, n = 0; n < list.readUInt16BE(0); n++) { keys.push(list.toString("ascii", at + 1, at + 1 + list[at])); at += 1 + list[at]; }
    const recs = keys.filter((k) => TICKS[k]).map((k) => snapshotRecord(++this.topic, k, TICKS[k]));
    if (recs.length) this.push(dataFrame(++this.msgNo, recs));
  }
  close() { this.readyState = 3; this.emit("close", {}); }
}

beforeAll(() => { globalThis.WebSocket = FakeWebSocket; });
afterAll(() => { globalThis.WebSocket = realWs; });
beforeEach(() => {
  cache.__clear();
  __resetBigulFeeds();
  FakeWebSocket.instances = [];
  FakeWebSocket.accept = true;
  FakeWebSocket.ackEvery = 0;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("bigul contract", () => {
  it("is on the strict contract with no secret credential fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.credentialFields).toEqual(["apiKey", "apiSecret", "clientCode"]);
    expect(adapter.capabilities.auth.loginFields).toEqual([{ key: "totpCode", label: "6-digit TOTP code", kind: "totp" }]);
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability).filter((c) => c !== "login").sort();
    expect(covered).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth" && c !== "feed").sort());
  }, 30_000);
});

describe("bigul auth", () => {
  it("logs in with the app headers and returns only the token, expiring before 00:30 IST", async () => {
    const s = stub(fx.byCapability.login.responses);
    const r = await adapter.login({ ...fx.manifest.creds, totpCode: "123456" });
    expect(r.session).toEqual({ sessionToken: "dummy.bigul.jwt.token" });
    expect(s.calls[0].headers).toMatchObject({ "x-api-key": "dummyAppKey", "x-api-secret": "dummyAppSecret" });
    expect(r.expiresAt).toBeLessThanOrEqual(nextBigulExpiryMs());
  });

  it("reports a rejected code (HTTP 200, status false) without echoing it", async () => {
    stub([{ method: "POST", url: "https://capi.bigul.co/api/v1/auth/connect/login", status: 200, json: { status: false, message: "Invalid TOTP.", data: null, error: "" } }]);
    const err = await adapter.login({ ...fx.manifest.creds, totpCode: "654321" }).catch((e) => e);
    const n = adapter.normaliseError(err, { secrets: ["654321"] });
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(n.message).toContain("Invalid TOTP");
    expect(n.message).not.toContain("654321");
  });

  it("computes the 00:30 IST expiry on both sides of midnight", () => {
    expect(new Date(nextBigulExpiryMs(Date.parse("2026-10-18T22:00:00+05:30"))).toISOString()).toBe("2026-10-18T19:00:00.000Z");
    expect(new Date(nextBigulExpiryMs(Date.parse("2026-10-19T00:10:00+05:30"))).toISOString()).toBe("2026-10-18T19:00:00.000Z");
    expect(new Date(nextBigulExpiryMs(Date.parse("2026-10-19T00:40:00+05:30"))).toISOString()).toBe("2026-10-19T19:00:00.000Z");
  });

  it("sends the bearer token and maps 401 to SessionRequiredError and 403 to UPSTREAM_AUTH", async () => {
    const s = stub(fx.byCapability.testConnection.responses);
    expect((await adapter.testConnection(SESSION)).status).toBe("success");
    expect(s.calls[0].headers).toMatchObject({ Authorization: "Bearer dummy.bigul.jwt.token", "x-api-key": "dummyAppKey" });
    stub([{ method: "POST", urlPattern: "/order/get-holdings$", status: 401, json: { status: false, message: "Invalid or expired token. Please re-authenticate." } }]);
    await expect(adapter.fetchHoldings(SESSION)).rejects.toBeInstanceOf(SessionRequiredError);
    stub([{ method: "POST", urlPattern: "/order/get-holdings$", status: 403, json: { status: false, message: "Access denied: API key/secret invalid, or the requesting IP address is not authorized." } }]);
    expect(adapter.normaliseError(await adapter.fetchHoldings(SESSION).catch((e) => e))).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
  });

  it("refuses data calls before login without any network call", async () => {
    const s = stub([]);
    await expect(adapter.fetchOptionChain(fx.manifest.creds, "NIFTY", "2026-10-20")).rejects.toBeInstanceOf(SessionRequiredError);
    expect((await adapter.testConnection(fx.manifest.creds)).status).toBe("error");
    expect(s.calls).toHaveLength(0);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("bigul master", () => {
  it("reads ISO, epoch-1980 and Desc expiries", () => {
    expect(bigulExpiryToIso("2026-10-27 14:30:00")).toBe("2026-10-27");
    expect(bigulExpiryToIso("2026-10-29")).toBe("2026-10-29");
    // Docs samples: "BANKNIFTY 25AUG26 FUT" 1472135400, "SENSEX 30JUL26 ..." 1469836800.
    expect(bigulExpiryToIso("1472135400")).toBe("2026-08-25");
    expect(bigulExpiryToIso("", "1469836800")).toBe("2026-07-30");
    expect(bigulExpiryToIso("", "", "ICICIBANK 28JUL26 1440.0 CE")).toBe("2026-07-28");
  });

  it("maps index derivatives by ULToken and skips spreads and non-canonical indices", () => {
    const head = "Exch,ScripCode,ScripCodeDaily,ScripCodeIntraday,Name,ULToken,OFISType,CPType,ExpiryDate,StrikePrice,CALevel,MinimumLotQuantity,Desc,TradingSymbol,PrevOI,SERIES,OPTION_TYPE,EXPIRY_DATE,OI_PREV,OI,FREEZEQTY,DECIMAL_PRECISION,LOTSIZE,STATUSEXCH,PRICEQUOTEUNIT,PRICEQUOTEQUANTITY,LOTNUMERATOR,LOTDENOMINATOR,DELIVERYUNIT,MAXSINGLETRANQTY,IsFuture,IsOption,TickSize";
    const rows = parseCsv([head,
      "N,35083,35083,35083,NIFTY 50,26000,2,4,1483021800,17400.0,0,65,NIFTY 29DEC26 17400.0 PE,NIFTY26DEC17400PE,0,OPTIDX,PE,2026-12-29 14:30:00,0,0,3511.0,0,65.0,,,,,,,,0,0,5.0",
      "N,48705,48705,48705,NIFTY NEXT 50,26013,1,0,1477578600,-0.01,0,25,NIFTYNXT50 27OCT26 FUT,NIFTYNXT5026OCTFUT,18650,FUTIDX,XX,2026-10-27 14:30:00,18650,18650,1126.0,0,25.0,,,,,,,,0,0,20.0",
      "N,48704 58875,48704 58875,48704 58875,NIFTY,,0,0,1477578600,-0.01,0,,NIFTY 27OCT26 SPREAD,NIFTY26OCT26DECFUT,0,SP-FUTIDX,XX,2026-10-27 14:30:00,0,0,,0,,,,,,,,,0,0,",
    ].join("\n")).map((r) => derivRow(r, "NFO"));
    expect(rows[0]).toMatchObject({ token: "35083", underlying: "NIFTY", instrumentType: "OPTIDX", expiry: "2026-12-29", strike: 17400, optionType: "PE", lotSize: 65, tickSize: 0.05, segment: "nse_fo" });
    expect(rows[1]).toBeNull();
    expect(rows[2]).toBeNull();
  });

  it("keeps index feed names and NSE equities only", () => {
    expect(cashRow({ ScripCode: "26000", Name: "Nifty 50", SERIES: "INDEX" }, "NSE")).toMatchObject({ underlying: "NIFTY", feedName: "Nifty 50", instrumentType: "INDEX" });
    expect(cashRow({ ScripCode: "26008", Name: "Nifty IT", SERIES: "INDEX" }, "NSE")).toBeNull();
    expect(cashRow({ ScripCode: "500325", Name: "RELIANCE", TradingSymbol: "RELIANCE", SERIES: "A" }, "BSE")).toBeNull();
    expect(cashRow({ ScripCode: "2885", Name: "RELIANCE", TradingSymbol: "RELIANCE-EQ", SERIES: "EQ", TickSize: "10.0", MinimumLotQty: "1" }, "NSE"))
      .toMatchObject({ underlying: "RELIANCE", tickSize: 0.1, instrumentType: "EQ" });
  });
});

describe("bigul feed codec", () => {
  it("lays out the connect, mode and subscribe frames as the SDK does", () => {
    const c = connectFrame("tok", "API");
    expect(c.readUInt16BE(0)).toBe(c.length - 2);
    expect([c[2], c[3]]).toEqual([1, 4]);
    expect([...readFields(c)].map(([id, v]) => [id, v.toString("latin1")])).toEqual([[1, "tok"], [2, "N"], [3, "\u0001"], [4, "API"]]);
    const m = modeFrame(1, true);
    expect([m[2], m[3]]).toEqual([12, 2]);
    expect(readFields(m).get(1).readBigUInt64BE(0)).toBe(2n);
    expect(readFields(m).get(2).toString()).toBe("F");
    const s = subscribeFrame(["sf|nse_fo|40001", "if|nse_cm|Nifty 50"], 1);
    const list = readFields(s).get(1);
    expect([s[2], list.readUInt16BE(0), list[2], list.toString("ascii", 3, 3 + list[2])]).toEqual([4, 2, 15, "sf|nse_fo|40001"]);
    expect(readFields(s).get(2)[0]).toBe(1);
  });

  it("decodes snapshots and updates, scales prices and ignores the no-value marker", () => {
    const snap = decodeData(dataFrame(7, [snapshotRecord(3, "sf|nse_fo|40001", { ltp: 120.5, volume: 10, oi: 500, close: 116.5 })]));
    expect(snap.messageNo).toBe(7);
    const topic = { key: snap.records[0].key, raw: [], multiplier: snap.records[0].multiplier, precision: snap.records[0].precision };
    expect(applyRecord(topic, snap.records[0].values)).toMatchObject({ ltp: 120.5, volume: 10, oi: 500, close: 116.5 });
    const upd = decodeData(dataFrame(8, [updateRecord(3, [12100, 15, ...Array(19).fill(NO_VALUE)])]));
    expect(applyRecord(topic, upd.records[0].values)).toMatchObject({ ltp: 121, volume: 15, oi: 500, close: 116.5 });
    expect(readConnectReply(connectReply(true, 5))).toEqual({ ok: true, ackEvery: 5 });
  });

  it("acknowledges every N data frames when the server asks for it", async () => {
    FakeWebSocket.ackEvery = 1;
    stub(master);
    await adapter.fetchLTP(SESSION, "NIFTY");
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe(WS_URL);
    expect(ws.sent.some((f) => typeof f !== "string" && f[2] === 3)).toBe(true);
  });

  it("turns a rejected feed connect into SessionRequiredError", async () => {
    FakeWebSocket.accept = false;
    stub(master);
    await expect(adapter.fetchLTP(SESSION, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
  });
});

describe("bigul market data", () => {
  it("builds the chain from feed ticks with computed IV, previous-day OI and the index spot", async () => {
    stub(master);
    const r = await adapter.fetchOptionChain(SESSION, "NIFTY", "2026-10-20");
    expect(r.data.last_price).toBe(25041.35);
    const ce = r.data.oc["25000"].ce;
    expect(ce).toMatchObject({ last_price: 120.5, oi: 1312350, previous_oi: 1217525, bid_price: 120.35, ask_price: 120.6, security_id: "40001" });
    expect(r.data.oc["25100"].pe.previous_oi).toBeUndefined();
    const { chain } = toOptionData(r);
    expect(chain[0].ce.oiChange).toBe(1312350 - 1217525);
    const subs = FakeWebSocket.instances[0].sent.filter((f) => typeof f !== "string" && f[2] === 4);
    expect(subs.length).toBe(1);
  });

  it("returns SENSEX LTP from the BSE index key and depth with order counts", async () => {
    stub(master);
    expect((await adapter.fetchLTP(SESSION, "SENSEX")).data.last_price).toBe(82015.61);
    const d = await adapter.fetchDepth(SESSION, { token: "40001", exchange: "NFO" });
    expect(d.data.bids).toEqual([{ price: 120.35, qty: 650, orders: 3 }, { price: 120.3, qty: 1300, orders: 5 }]);
    expect(d.data.asks[0]).toEqual({ price: 120.6, qty: 975, orders: 4 });
  });

  it("keeps the strikes nearest the spot", () => {
    const strikes = Array.from({ length: 200 }, (_, i) => 20000 + i * 50);
    const kept = nearestStrikes(strikes, 25010, 10);
    expect(kept).toHaveLength(10);
    expect(kept).toContain(25000);
    expect(nearestStrikes([1, 2, 3], 0, 10)).toEqual([1, 2, 3]);
    expect(toDepth({ bidPrice1: 10, bidQty1: 5 }).asks).toEqual([]);
  });

  it("streams contract quotes through createFeed", async () => {
    stub(master);
    const ticks = [];
    const feed = adapter.createFeed(SESSION, { onTick: (q) => ticks.push(q) });
    feed.subscribe([{ token: "2885", exchange: "NSE" }]);
    await vi.waitFor(() => expect(ticks.length).toBeGreaterThan(0));
    expect(ticks[0]).toMatchObject({ token: "2885", exchange: "NSE", ltp: 1215.4, close: 1211.2 });
    feed.close();
  });
});

describe("bigul portfolio", () => {
  it("fills position tokens from the master and marks them to the feed LTP", async () => {
    stub(fx.byCapability.positions.responses);
    const [p] = (await adapter.fetchPositions(SESSION)).data;
    expect(p).toMatchObject({ tradingSymbol: "BANKNIFTY26OCTFUT", exchange: "NFO", token: "58067", product: "MARGIN", netQty: 35, avgPrice: 55544.4, ltp: 56110.4 });
    expect(p.pnl).toBeCloseTo(35 * 56110.4 - 1944054, 2);
  });

  it("reads an empty book reply as an empty list", async () => {
    stub([{ method: "POST", urlPattern: "/order/order-book$", status: 200, json: { status: false, message: "No Data Found", data: null } }]);
    expect((await adapter.fetchOrderBook(SESSION)).data).toEqual([]);
  });

  it("maps holdings and funds", () => {
    expect(mapHolding({ nseTrdSym: "RELIANCE-EQ", ex1: "nse_cm", tok1: "2885", hldQty: "10", prc: "1300", clprc: "0.00" })).toMatchObject({ exchange: "NSE", token: "2885", qty: 10, ltp: null, pnl: null });
    expect(mapFunds({ CollateralValue: "1000", AmountUtilizedPrsnt: "250" })).toEqual({ availableCash: 750, usedMargin: 250, totalBalance: 1000, collateral: null, withdrawable: null });
    expect(mapFunds({ Net: "900", CollateralValue: "1000", AmountUtilizedPrsnt: "250" }).availableCash).toBe(900);
  });
});

describe("bigul orders", () => {
  const nifty = { token: "40001", exchange: "NFO", segment: "nse_fo", tradingSymbol: "NIFTY26O2025000CE", instrumentType: "OPTIDX" };
  const order = { token: "40001", exchange: "NFO", side: "SELL", orderType: "SL", product: "INTRADAY", validity: "IOC", lots: 2, price: 100, triggerPrice: 101 };

  it("builds a priced order from master data", () => {
    expect(adapter.buildOrderBody(order, 65, nifty)).toMatchObject({ es: "nse_fo", pc: "MIS", pt: "SL", pr: "100", tp: "101", qt: "130", rt: "IOC", tk: "40001", ts: "NIFTY26O2025000CE", tt: "S", am: "NO", dq: "0" });
  });

  it("refuses market orders, CNC on F&O, a missing lot size and an unknown instrument", () => {
    expect(() => adapter.buildOrderBody({ ...order, orderType: "MARKET" }, 65, nifty)).toThrow(/LIMIT or SL/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, 65, nifty)).toThrow(/CNC/);
    expect(() => adapter.buildOrderBody(order, 0, nifty)).toThrow(/lot size/);
    expect(() => adapter.buildOrderBody(order, 65, null)).toThrow(/not found/);
  });

  it("refuses without a gate before any call, and places with a valid gate", async () => {
    const s = stub(fx.byCapability.placeOrder.responses);
    const [o, lot] = fx.byCapability.placeOrder.args;
    await expect(adapter.placeOrder(SESSION, o, lot)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "bigul" });
    expect(await adapter.placeOrder(SESSION, o, lot, gate)).toEqual({ orderId: "1310111898", orderStatus: "UNKNOWN" });
  });

  it("resends the live order on modify", () => {
    const row = { nOrdNo: "1", exSeg: "nse_cm", prod: "CNC", tok: "2885", trdSym: "RELIANCE-EQ", trnsTp: "B" };
    expect(adapter.buildModifyBody(row, { qty: 5, price: 1200 })).toMatchObject({ no: "1", vd: "DAY", es: "nse_cm", pc: "CNC", pt: "L", qt: "5", tk: "2885", ts: "RELIANCE-EQ", tt: "B", sr: "RELIANCE-EQ" });
    expect(() => adapter.buildModifyBody(null, { qty: 5, price: 1 })).toThrow(/order book/);
  });
});
