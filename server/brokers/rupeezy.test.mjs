/**
 * Rupeezy (Vortex) on the contract harness. No network: fetch is stubbed, the WebSocket is a fake and the
 * instrument-master cache is an in-memory map per test.
 */
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
import * as adapter from "./rupeezy.mjs";
import { BrokerInputError, FORBIDDEN_SECRET_KEY, OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { __resetRupeezy, checksumFor } from "./rupeezyAuth.mjs";
import { listExpiries, parseMasterCsv, toInstrument } from "./rupeezyInstruments.mjs";
import { istDayEpoch } from "./rupeezyMarket.mjs";
import { mapPosition, orderStatusOf } from "./rupeezyPortfolio.mjs";
import { decodeMessage } from "./rupeezyFeed.mjs";

const fx = loadFixtures("rupeezy");
const creds = { ...fx.manifest.creds };
const session = fx.byCapability.testConnection.responses[0];
const master = parseMasterCsv(fx.byCapability.instruments.responses[0].text).map(toInstrument).filter(Boolean);
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const gate = (action) => issueOrderGate({ verdict: { ok: true }, liveArmed: true, action, brokerId: "rupeezy" });

beforeEach(() => {
  cache.__clear();
  __resetRupeezy({ pacing: false });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("rupeezy contract", () => {
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

describe("rupeezy session", () => {
  it("computes the documented checksum: SHA-256(application_id + auth + x-api-key)", () => {
    expect(checksumFor(creds.applicationId, creds.authToken, creds.apiKey)).toBe(session.expectBody.checksum);
  });

  it("exchanges the auth value once and sends x-api-key plus the Bearer token", async () => {
    const s = stub([...fx.byCapability.testConnection.responses, fx.byCapability.funds.responses[1]]);
    expect((await adapter.testConnection(creds)).status).toBe("success");
    await adapter.fetchFunds(creds);
    expect(s.calls.filter((c) => c.url.endsWith("/user/session"))).toHaveLength(1);
    expect(s.calls[0].headers["x-api-key"]).toBe(creds.apiKey);
    expect(s.calls[1].headers.Authorization).toBe(`Bearer ${session.json.data.access_token}`);
    expect(s.calls[1].headers["x-api-key"]).toBe(creds.apiKey);
    expect(JSON.stringify(s.calls.map((c) => c.body))).not.toContain(creds.apiKey);
  });

  it("uses a pasted access token without an exchange", async () => {
    const s = stub([{ method: "GET", url: "https://vortex-api.rupeezy.in/v2/user/funds", json: { nse: {} } }]);
    expect((await adapter.testConnection({ apiKey: creds.apiKey, accessToken: "pasted.jwt.value" })).status).toBe("success");
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].headers.Authorization).toBe("Bearer pasted.jwt.value");
  });

  it("asks for a fresh auth value when the exchange is refused, without echoing secrets, and never resends it", async () => {
    const s = stub([{ method: "POST", url: "https://vortex-api.rupeezy.in/v2/user/session", status: 400, json: { status: "error", code: "e-101", message: `invalid token dummyAuthToken123 for dummyXApiKey789` } }]);
    const res = await adapter.testConnection(creds);
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/auth/);
    expect(res.message).not.toContain(creds.authToken);
    expect(res.message).not.toContain(creds.apiKey);
    await adapter.testConnection(creds);
    expect(s.calls).toHaveLength(1);
  });

  it("drops the session on 401 and maps it to SESSION_LOGIN_REQUIRED", async () => {
    const s = stub([session, { method: "GET", url: "https://vortex-api.rupeezy.in/v2/user/funds", status: 401, json: { status: "error", message: "unauthorised" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(err).toBeInstanceOf(SessionRequiredError);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    await adapter.fetchFunds(creds).catch(() => {});
    expect(s.calls.filter((c) => c.url.endsWith("/user/session"))).toHaveLength(1);
  });

  it("maps 429 to a rate-limit error", async () => {
    stub([session, { method: "GET", url: "https://vortex-api.rupeezy.in/v2/user/funds", status: 429, json: { status: "error", message: "Too many requests" } }]);
    const err = await adapter.fetchFunds(creds).catch((e) => e);
    expect(adapter.normaliseError(err)).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
  });

  it("refuses without an API key before any call", async () => {
    const s = stub([]);
    await expect(adapter.fetchFunds({ accessToken: "x.y.z" })).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });
});

describe("rupeezy symbols and data", () => {
  it("maps the six canonical indices, paise ticks and NSE/BSE derivatives", () => {
    const idx = master.filter((m) => m.instrumentType === "INDEX").map((m) => m.underlying).sort();
    expect(idx).toEqual(["BANKEX", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTY", "SENSEX"]);
    expect(master.find((m) => m.token === "864588")).toMatchObject({ exchange: "BFO", underlying: "SENSEX", optionType: "CE", strike: 81000, lotSize: 20, tickSize: 0.05 });
    expect(master.find((m) => m.token === "2885")).toMatchObject({ exchange: "NSE", instrumentType: "EQ", tickSize: 0.1 });
    expect(master.some((m) => m.underlying === "NIFTYNXT50" || m.underlying === "CRUDEOIL" || (m.exchange === "BSE" && m.instrumentType === "EQ"))).toBe(false);
    expect(listExpiries(master, "NIFTY")).toEqual(["2026-10-27", "2026-11-03"]);
    expect(listExpiries(master, "SENSEX")).toEqual(["2026-10-29"]);
  });

  it("reads broker IV (percent), per-leg delta and OI change from day_first_tick_oi", async () => {
    stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-11-03"));
    expect(spotPrice).toBe(25586);
    expect(chain[0]).toMatchObject({ strikePrice: 25000, ce: { ltp: 717.45, oi: 51100, oiChange: 1100, iv: 15.04, delta: 0.86 }, pe: { delta: -0.14, oiChange: 12850 } });
    expect(chain[1].ce.oiChange).toBe(0);
  });

  it("asks for a SENSEX chain on BSE_EQ with the index token", async () => {
    const s = stub([session, fx.byCapability.instruments.responses[0], { method: "POST", url: "https://vortex-api.rupeezy.in/v2/strategies/option_chain", expectBody: { symbol: "SENSEX", token: 19000, exchange: "BSE_EQ", expiry_date: "20261029" },
      json: { status: "success", response: { options: { list: [{ strike_price: 81000, iv: 12, CE: { token: 864588, ltp: 420 }, PE: { token: 864589, ltp: 180 } }] }, parent: { ltp: 81234.5 } } } }]);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "SENSEX", "2026-10-29"));
    expect(spotPrice).toBe(81234.5);
    expect(chain).toHaveLength(1);
    expect(s.calls).toHaveLength(3);
  });

  it("refuses an unknown symbol and a missing price", async () => {
    stub([session, fx.byCapability.instruments.responses[0], { method: "GET", urlPattern: "/data/quotes", json: { status: "success", data: {} } }]);
    await expect(adapter.fetchLTP(creds, "NOSUCH")).rejects.toBeInstanceOf(BrokerInputError);
    await expect(adapter.fetchLTP(creds, "NIFTY")).rejects.toThrow(/no price/);
  });

  it("sorts newest-first candles and converts IST days to epoch seconds", async () => {
    stub(fx.byCapability.historical.responses);
    const r = await adapter.fetchHistorical(creds, fx.byCapability.historical.args[0]);
    expect(r.data.map((c) => c.time)).toEqual([1792143000, 1792143300, 1792143600]);
    expect(istDayEpoch("2026-10-16")).toBe(Date.UTC(2026, 9, 15, 18, 30) / 1000);
    await expect(adapter.fetchHistorical(creds, { ...fx.byCapability.historical.args[0], interval: "2h" })).rejects.toBeInstanceOf(BrokerInputError);
  });

  it("marks open positions to the LTP and books exited ones", async () => {
    stub(fx.byCapability.positions.responses);
    const [open, exited] = (await adapter.fetchPositions(creds)).data;
    expect(open).toMatchObject({ tradingSymbol: "NIFTY26OCT25000CE", exchange: "NFO", product: "INTRADAY", netQty: 65, ltp: 110.1, realisedPnl: null });
    expect(open.pnl).toBeCloseTo(390);
    expect(exited).toMatchObject({ exchange: "NSE", product: "MTF", netQty: 0, pnl: 10, realisedPnl: 10 });
    expect(mapPosition({ exchange: "MCX_FO", quantity: 2, lot_size: 100, multiplier: 1, token: 1 }).netQty).toBe(200);
  });

  it("maps order statuses", () => {
    expect(orderStatusOf("PENDING")).toBe("OPEN");
    expect(orderStatusOf("OMSXMITTED")).toBe("OPEN");
    expect(orderStatusOf("PENDING", 20, 45)).toBe("PARTIALLY_FILLED");
    expect(orderStatusOf("EXECUTED")).toBe("COMPLETE");
    expect(orderStatusOf("COMPLETED")).toBe("COMPLETE");
    expect(orderStatusOf("CANCELLED")).toBe("CANCELLED");
    expect(orderStatusOf("REJECTED")).toBe("REJECTED");
    expect(orderStatusOf("TRIGGER PENDING")).toBe("TRIGGER_PENDING");
    expect(orderStatusOf("mystery")).toBe("UNKNOWN");
  });
});

describe("rupeezy orders", () => {
  const order = { token: "51440", exchange: "NFO", side: "SELL", orderType: "SL", product: "MARGIN", lots: 2, price: 90, triggerPrice: 91 };

  it("builds the documented body (units on F&O, DELIVERY as the F&O carry product, price 0 for market)", () => {
    expect(adapter.buildOrderBody(order, 65)).toEqual({ exchange: "NSE_FO", token: 51440, transaction_type: "SELL", product: "DELIVERY", variety: "SL", quantity: 130, price: 90, trigger_price: 91, disclosed_quantity: 0, validity: "DAY", is_amo: false });
    const mkt = adapter.buildOrderBody({ ...order, orderType: "MARKET", product: "INTRADAY", price: undefined, triggerPrice: undefined }, 65);
    expect(mkt).toMatchObject({ variety: "RL-MKT", price: 0, trigger_price: 0, product: "INTRADAY" });
    expect(adapter.buildOrderBody({ token: "2885", exchange: "NSE", side: "BUY", orderType: "LIMIT", product: "CNC", lots: 3, price: 1400 }, 1)).toMatchObject({ exchange: "NSE_EQ", product: "DELIVERY", quantity: 3 });
  });

  it("refuses bad input before any call", () => {
    expect(() => adapter.buildOrderBody({ ...order, triggerPrice: 89 }, 65)).toThrow(/above the limit/);
    expect(() => adapter.buildOrderBody({ ...order, product: "CNC" }, 65)).toThrow(/F&O/);
    expect(() => adapter.buildOrderBody({ ...order, exchange: "NSE", product: "MTF", token: "2885" }, 1)).not.toThrow();
    expect(() => adapter.buildOrderBody({ ...order, exchange: "BSE", product: "MTF", token: "500325" }, 1)).toThrow(/MTF/);
    expect(() => adapter.buildOrderBody(order, 0)).toThrow(BrokerInputError);
    expect(() => adapter.buildModifyBody({ variety: "RL", transaction_type: "BUY", order_price: 10, total_quantity: 1 }, { orderType: "SL", triggerPrice: 9 })).toThrow(/stop-loss/);
    expect(() => adapter.buildModifyBody({ variety: "RL" }, {})).toThrow(/Nothing/);
  });

  it("carries traded_quantity from the latest history row into a modify", () => {
    const body = adapter.buildModifyBody({ variety: "RL", transaction_type: "BUY", total_quantity: 100, traded_quantity: 20, order_price: 10, validity: "DAY" }, { price: 10.5 });
    expect(body).toEqual({ variety: "RL", quantity: 100, traded_quantity: 20, price: 10.5, trigger_price: 0, disclosed_quantity: 0, validity: "DAY" });
  });

  it("refuses without a gate, with a forged gate and with a reused gate, before any network call", async () => {
    const s = stub([]);
    await expect(adapter.placeOrder(creds, order, 65)).rejects.toBeInstanceOf(OrderGateError);
    await expect(adapter.modifyOrder(creds, "NXAAE00003K3", { price: 1 }, { action: "modifyOrder", brokerId: "rupeezy" })).rejects.toBeInstanceOf(OrderGateError);
    const g = gate("cancelOrder");
    await adapter.cancelOrder(creds, "bad id!", g).catch(() => {});
    await expect(adapter.cancelOrder(creds, "NXAAE00003K3", g)).rejects.toBeInstanceOf(OrderGateError);
    const other = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "iiflcapital" });
    await expect(adapter.cancelOrder(creds, "NXAAE00003K3", other)).rejects.toBeInstanceOf(OrderGateError);
    expect(s.calls).toHaveLength(0);
  });

  it("surfaces a documented order error", async () => {
    stub([session, { method: "POST", url: "https://vortex-api.rupeezy.in/v2/trading/orders/regular", status: 400, json: { status: "error", code: "e-103", message: "Only AMO allowed in AMO timing for segment : 1" } }]);
    await expect(adapter.placeOrder(creds, order, 65, gate("placeOrder"))).rejects.toThrow(/e-103.*AMO/);
  });
});

describe("rupeezy feed", () => {
  function packet(len, { exchange = "NSE_FO", token = 51440, ltp = 104.1, oi = 15450, bid = 102.15, ask = 106.55 } = {}) {
    const b = Buffer.alloc(len);
    b.write(exchange, 0, "latin1");
    b.writeInt32LE(token, 10);
    b.writeDoubleLE(ltp, 14);
    if (len >= 62) { b.writeDoubleLE(100.15, 26); b.writeDoubleLE(299.85, 34); b.writeDoubleLE(0.05, 42); b.writeDoubleLE(99.8, 50); b.writeInt32LE(23700, 58); }
    if (len === 266) { b.writeInt32LE(oi, 94); b.writeDoubleLE(bid, 98); b.writeInt32LE(150, 106); b.writeDoubleLE(ask, 178); }
    return b;
  }
  const frame = (...packets) => {
    const head = Buffer.alloc(2);
    head.writeUInt16LE(packets.length, 0);
    return Buffer.concat([head, ...packets.flatMap((p) => { const l = Buffer.alloc(2); l.writeUInt16LE(p.length, 0); return [l, p]; })]);
  };

  it("decodes ltp, ohlcv and full packets from one frame", () => {
    const quotes = decodeMessage(frame(packet(22, { token: 26000, exchange: "NSE_EQ", ltp: 25586 }), packet(62), packet(266)));
    expect(quotes).toHaveLength(3);
    expect(quotes[0]).toEqual({ exchange: "NSE_EQ", token: "26000", ltp: 25586 });
    expect(quotes[1]).toMatchObject({ open: 100.15, high: 299.85, close: 99.8, volume: 23700 });
    expect(quotes[2]).toMatchObject({ oi: 15450, bid: 102.15, ask: 106.55 });
    expect(decodeMessage(Buffer.alloc(1))).toEqual([]);
    expect(decodeMessage(frame(packet(22)).subarray(0, 10))).toEqual([]);
  });

  it("subscribes with text frames, emits contract quotes and ignores order-update text", async () => {
    class FakeWs extends EventEmitter {
      constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 1; FakeWs.last = this; }
      send(m) { this.sent.push(JSON.parse(m)); }
      close() { this.readyState = 3; this.emit("close"); }
    }
    stub([session]);
    const ticks = [];
    const status = [];
    const feed = adapter.createFeed(creds, { onTick: (q) => ticks.push(q), onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
    feed.subscribe([{ token: "51440", exchange: "NFO" }, { token: "x", exchange: "NFO" }]);
    await vi.waitFor(() => expect(FakeWs.last).toBeDefined());
    const ws = FakeWs.last;
    expect(ws.url).toBe(`wss://wire.rupeezy.in/ws?auth_token=${encodeURIComponent(session.json.data.access_token)}`);
    ws.emit("open");
    expect(ws.sent).toEqual([{ exchange: "NSE_FO", token: 51440, mode: "full", message_type: "subscribe" }]);
    ws.emit("message", frame(packet(266)), true);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "order", data: {} })), false);
    expect(ticks).toEqual([{ token: "51440", exchange: "NFO", ltp: 104.1, open: 100.15, high: 299.85, low: 0.05, close: 99.8, volume: 23700, oi: 15450, bid: 102.15, ask: 106.55 }]);
    feed.unsubscribe([{ token: "51440", exchange: "NFO" }]);
    expect(ws.sent.at(-1)).toMatchObject({ message_type: "unsubscribe", token: 51440 });
    feed.close();
    expect(status[0]).toEqual({ connected: true });
  });

  it("refuses to open a feed with no session", () => {
    expect(() => adapter.createFeed({ apiKey: "k" }, {}, { WebSocketImpl: class {} })).toThrow(SessionRequiredError);
  });
});
