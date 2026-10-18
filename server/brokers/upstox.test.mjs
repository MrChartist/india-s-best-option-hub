/**
 * Upstox adapter: contract harness over every declared capability, index keys and instrument mapping,
 * the native chain (IV already in percent), status mapping, the protobuf feed decoder, OAuth code
 * exchange, error normalisation and the order gate. No network: fetch is stubbed from fixtures and the
 * feed uses a fake socket.
 */
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as upstox from "./upstox.mjs";
import { INDEX_KEYS, decodeMaster, istDate, resetUpstoxInstrumentCache } from "./upstoxInstruments.mjs";
import { upstoxOrderStatus } from "./upstoxOrders.mjs";
import { upstoxProduct } from "./upstoxData.mjs";
import { checkFeedUri, decodeUpstoxFeed } from "./upstoxFeed.mjs";
import { UpstoxApiError } from "./upstoxClient.mjs";
import { OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";

const fx = loadFixtures("upstox");
const creds = fx.manifest.creds;
const realFetch = globalThis.fetch;

async function withFetch(responses, fn) {
  const stub = createFetchStub(responses);
  globalThis.fetch = stub.fetch;
  try {
    return { value: await fn(), calls: stub.calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

beforeEach(() => resetUpstoxInstrumentCache());
afterEach(() => { globalThis.fetch = realFetch; });

describe("upstox contract", () => {
  it("passes strict validation with no warnings", () => {
    const v = validateAdapter(upstox);
    expect(v).toMatchObject({ ok: true, mode: "strict", errors: [] });
    expect(v.warnings).toEqual([]);
    expect(upstox.capabilities.auth.kind).toBe("oauthRedirect");
  });

  it("every declared capability returns the normalised shape from its fixture", async () => {
    const report = await runContractHarness(upstox, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability);
    for (const cap of declaredCapabilities(upstox)) if (cap !== "auth" && cap !== "feed") expect(covered).toContain(cap);
  });

  it("sends the bearer token and never downloads the instrument master for data calls", async () => {
    const { calls } = await withFetch(fx.byCapability.ltp.responses, () => upstox.fetchLTP(creds, "NIFTY"));
    expect(calls).toHaveLength(1);
    expect(calls[0].headers).toMatchObject({ Authorization: "Bearer dummy.upstox.access.token.0001", Accept: "application/json" });
  });
});

describe("upstox symbol mapping", () => {
  it("has fixed keys for all six indices (BANKEX added)", () => {
    expect(INDEX_KEYS).toEqual({
      NIFTY: "NSE_INDEX|Nifty 50", BANKNIFTY: "NSE_INDEX|Nifty Bank", FINNIFTY: "NSE_INDEX|Nifty Fin Service",
      MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT", SENSEX: "BSE_INDEX|SENSEX", BANKEX: "BSE_INDEX|BANKEX",
    });
  });

  it("converts the BOD epoch-ms expiry (23:59:59 IST) to the IST calendar date", () => {
    expect(istDate(1793125799000)).toBe("2026-10-27");
    expect(istDate("2026-11-03")).toBe("2026-11-03");
  });

  it("maps NIFTY weekly + monthly, SENSEX weekly, BANKEX and a stock option from the BOD file", async () => {
    const { value } = await withFetch(fx.byCapability.instruments.responses, () => upstox.fetchInstruments(creds));
    const by = (t) => value.data.find((r) => r.token === t);
    expect(by("NSE_INDEX|Nifty 50")).toMatchObject({ exchange: "NSE", instrumentType: "INDEX", underlying: "NIFTY" });
    expect(by("NSE_FO|51440")).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", underlying: "NIFTY", expiry: "2026-10-27", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05 });
    expect(by("NSE_FO|54333")).toMatchObject({ expiry: "2026-11-03", optionType: "PE" });
    expect(by("BSE_FO|1124300")).toMatchObject({ exchange: "BFO", underlying: "SENSEX", expiry: "2026-10-22", lotSize: 20 });
    expect(by("BSE_FO|1101751")).toMatchObject({ underlying: "BANKEX", instrumentType: "OPTIDX" });
    expect(by("NSE_FO|106737")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
    expect(by("NSE_FO|48699")).toMatchObject({ instrumentType: "FUTIDX", tickSize: 0.2 });
    expect(by("NSE_EQ|INE002A01018")).toMatchObject({ instrumentType: "EQ", tradingSymbol: "RELIANCE", tickSize: 0.1 });
    expect(by("NSE_FO|65207")).toBeUndefined(); // NIFTYNXT50
    expect(by("BSE_EQ|INE053F08270")).toBeUndefined(); // debt group F
    expect(by("MCX_FO|579520")).toBeUndefined();
  });

  it("gunzips the real .json.gz body and also accepts plain JSON", () => {
    const rows = [{ segment: "NSE_INDEX", instrument_key: "NSE_INDEX|Nifty 50" }];
    expect(decodeMaster(gzipSync(Buffer.from(JSON.stringify(rows))))).toEqual(rows);
    expect(decodeMaster(Buffer.from(JSON.stringify(rows)))).toEqual(rows);
  });

  it("asks for SENSEX expiries with the BSE_INDEX key", async () => {
    const { value } = await withFetch([{ method: "GET", url: "https://api.upstox.com/v2/option/contract?instrument_key=BSE_INDEX%7CSENSEX", json: { status: "success", data: [{ expiry: "2026-10-29" }, { expiry: "2026-10-22" }, { expiry: "2026-10-22" }] } }], () => upstox.fetchExpiryList(creds, "SENSEX"));
    expect(value.data).toEqual(["2026-10-22", "2026-10-29"]);
  });

  it("passes broker IV through as a percentage and derives oi_chg from prev_oi", async () => {
    const { value } = await withFetch(fx.byCapability.optionChain.responses, () => upstox.fetchOptionChain(creds, "NIFTY", "2026-10-27"));
    const { spotPrice, chain } = toOptionData(value);
    expect(spotPrice).toBe(25041.35);
    expect(chain[0].ce).toMatchObject({ ltp: 182.4, iv: 12.8, delta: 0.56, oiChange: 233400, bidPrice: 181.9, askPrice: 182.9 });
    // A genuinely low IV (1.5%) is no longer multiplied by 100.
    const low = await withFetch([{ method: "GET", urlPattern: "/v2/option/chain", json: { status: "success", data: [{ strike_price: 100, underlying_spot_price: 100, call_options: { market_data: { ltp: 1 }, option_greeks: { iv: 1.5 } } }] } }], () => upstox.fetchOptionChain(creds, "NIFTY", "2026-10-27"));
    expect(low.value.data.oc["100"].ce.iv).toBe(1.5);
  });
});

describe("upstox normalisation", () => {
  it("maps statuses and products", () => {
    expect(upstoxOrderStatus("trigger pending")).toBe("TRIGGER_PENDING");
    expect(upstoxOrderStatus("open", 10)).toBe("PARTIALLY_FILLED");
    expect(upstoxOrderStatus("after market order req received")).toBe("OPEN");
    expect(upstoxOrderStatus("cancelled after market order")).toBe("CANCELLED");
    expect(upstoxOrderStatus("whatever")).toBe("UNKNOWN");
    expect(upstoxProduct("D", "NSE")).toBe("CNC");
    expect(upstoxProduct("D", "NFO")).toBe("MARGIN");
    expect(upstoxProduct("I", "NFO")).toBe("INTRADAY");
  });

  it("normalises the documented order book sample", async () => {
    const { value } = await withFetch(fx.byCapability.orderBook.responses, () => upstox.fetchOrderBook(creds));
    expect(value.data.map((o) => o.status)).toEqual(["COMPLETE", "REJECTED", "CANCELLED", "TRIGGER_PENDING"]);
    expect(value.data[1]).toMatchObject({ exchange: "NFO", product: "INTRADAY", statusMessage: expect.stringMatching(/add Rs/) });
    expect(value.data[2]).toMatchObject({ exchange: "BFO", product: "MARGIN" });
  });

  it("returns candles oldest first", async () => {
    const { value } = await withFetch(fx.byCapability.historical.responses, () => upstox.fetchHistorical(creds, fx.byCapability.historical.args[0]));
    const times = value.data.map((c) => c.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("adds today's intraday candles when the range ends today", async () => {
    const now = Date.parse("2026-10-16T08:00:00Z");
    const { value, calls } = await withFetch([
      { method: "GET", url: "https://api.upstox.com/v3/historical-candle/NSE_INDEX%7CNifty%2050/minutes/5/2026-10-16/2026-10-15", json: { status: "success", data: { candles: [["2026-10-15T15:25:00+05:30", 1, 2, 0.5, 1.5, 0, 0]] } } },
      { method: "GET", url: "https://api.upstox.com/v3/historical-candle/intraday/NSE_INDEX%7CNifty%2050/minutes/5", json: { status: "success", data: { candles: [["2026-10-16T09:20:00+05:30", 2, 3, 1.5, 2.5, 0, 0], ["2026-10-16T09:15:00+05:30", 1.5, 2, 1, 2, 0, 0]] } } },
    ], () => upstox.fetchHistorical(creds, { instrument: { token: "NSE_INDEX|Nifty 50", exchange: "NSE" }, interval: "5m", from: "2026-10-15", to: "2026-10-16" }, { now }));
    expect(calls).toHaveLength(2);
    expect(value.data).toHaveLength(3);
    expect(value.data[0].time).toBeLessThan(value.data[2].time);
  });
});

describe("upstox errors", () => {
  it("turns UDAPI100050 into UPSTREAM_AUTH with a re-login hint and no token", async () => {
    let err;
    await withFetch([{ method: "GET", url: "https://api.upstox.com/v2/user/get-funds-and-margin", status: 401, json: { status: "error", errors: [{ errorCode: "UDAPI100050", message: "Invalid token used to access API", propertyPath: null, invalidValue: null }] } }], async () => {
      err = await upstox.fetchFunds(creds).catch((e) => e);
    });
    expect(err).toBeInstanceOf(UpstoxApiError);
    const n = upstox.normaliseError(err, { secrets: [creds.accessToken] });
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(n.message).toMatch(/3:30 AM IST/);
    expect(n.message).not.toContain(creds.accessToken);
  });

  it("maps rate limits and keeps refusals at 422", () => {
    expect(upstox.normaliseError(new UpstoxApiError("x", { httpStatus: 429, errorCode: "UDAPI10005" })).code).toBe("UPSTREAM_RATE_LIMIT");
    expect(upstox.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
  });

  it("refuses data calls without a token, and malformed keys, before any network call", async () => {
    const { calls } = await withFetch([], async () => {
      await expect(upstox.fetchPositions({})).rejects.toMatchObject({ statusCode: 422 });
      await expect(upstox.fetchQuotes(creds, [{ token: "NIFTY", exchange: "NSE" }])).rejects.toMatchObject({ statusCode: 422 });
    });
    expect(calls).toEqual([]);
  });
});

describe("upstox OAuth code exchange", () => {
  it("posts code, client id/secret, redirect URI and grant type, and returns only the token", async () => {
    const { value, calls } = await withFetch([{
      method: "POST", url: "https://api.upstox.com/v2/login/authorization/token",
      expectBody: { code: "mk404x", client_id: "dummy-api-key-0001", client_secret: "dummy-api-secret-0001", redirect_uri: "https://127.0.0.1/cb", grant_type: "authorization_code" },
      json: { email: "x", exchanges: ["NSE"], products: ["D"], broker: "UPSTOX", user_id: "******", user_name: "x", order_types: ["MARKET"], user_type: "individual", poa: false, is_active: true, access_token: "fresh.token.value", extended_token: null },
    }], () => upstox.exchangeAuthCode(creds, { code: "mk404x", redirectUri: "https://127.0.0.1/cb" }));
    expect(value).toEqual({ accessToken: "fresh.token.value" });
    expect(calls[0].headers.Authorization).toBeUndefined();
  });
});

describe("upstox orders", () => {
  it("refuses every order call without a gate before touching the network", async () => {
    const { calls } = await withFetch([], async () => {
      await expect(upstox.placeOrder(creds, fx.byCapability.placeOrder.args[0], 65)).rejects.toBeInstanceOf(OrderGateError);
      await expect(upstox.modifyOrder(creds, "1", { orderType: "LIMIT", price: 1 })).rejects.toBeInstanceOf(OrderGateError);
      await expect(upstox.cancelOrder(creds, "1")).rejects.toBeInstanceOf(OrderGateError);
    });
    expect(calls).toEqual([]);
  });

  it("builds v3 bodies: lot size from the master, protection on MARKET/SL-M, MCX refused", () => {
    const body = upstox.buildOrderBody({ instrumentKey: "NSE_FO|51441", transactionType: "SELL", orderType: "SL-M", triggerPrice: 150, product: "MARGIN", lots: 1, lotSize: 999 }, 65);
    expect(body).toMatchObject({ quantity: 65, product: "D", market_protection: -1, trigger_price: 150, price: 0, slice: false });
    expect(() => upstox.buildOrderBody({ instrumentKey: "NSE_FO|1", transactionType: "BUY", orderType: "LIMIT", price: 1, lots: 1 })).toThrow(/resolved lot size/);
    // Whole lots only: 0.5 x 65 would send 33 (not a lot multiple); 1.004 would be silently rounded.
    expect(() => upstox.buildOrderBody({ instrumentKey: "NSE_FO|1", transactionType: "BUY", orderType: "LIMIT", price: 1, lots: 0.5 }, 65)).toThrow(/whole number/);
    expect(() => upstox.buildOrderBody({ instrumentKey: "NSE_FO|1", transactionType: "BUY", orderType: "LIMIT", price: 1, lots: 1.004 }, 65)).toThrow(/whole number/);
    expect(() => upstox.buildOrderBody({ instrumentKey: "MCX_FO|579520", transactionType: "BUY", orderType: "LIMIT", price: 1, lots: 1 }, 30)).toThrow(/MCX/);
    expect(() => upstox.buildOrderBody({ instrumentKey: "NSE_FO|1", transactionType: "BUY", orderType: "MARKET", lots: 1, marketProtection: 30 }, 65)).toThrow(/marketProtection/);
  });
});

// ── protobuf helpers for the feed test (wire format per the official MarketDataFeed.proto) ──
const varint = (n) => { const out = []; let v = n; while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); return Buffer.from(out); };
const fld = (no, wt, payload) => Buffer.concat([varint(no * 8 + wt), payload]);
const lenField = (no, buf) => fld(no, 2, Buffer.concat([varint(buf.length), buf]));
const dblField = (no, x) => { const b = Buffer.alloc(8); b.writeDoubleLE(x, 0); return fld(no, 1, b); };
const intField = (no, x) => fld(no, 0, varint(x));
const ltpc = (ltp, cp) => Buffer.concat([dblField(1, ltp), intField(2, 1760608799000), intField(3, 65), dblField(4, cp)]);

describe("upstox feed (protobuf FeedResponse)", () => {
  it("decodes ltpc and full market feeds", () => {
    const quote = Buffer.concat([intField(1, 150), dblField(2, 181.9), intField(3, 75), dblField(4, 182.9)]);
    const ohlc1d = Buffer.concat([lenField(1, Buffer.from("1d")), dblField(2, 170), dblField(3, 190), dblField(4, 160.5), dblField(5, 182.4), intField(6, 2500000), intField(7, 1760572800000)]);
    const mff = Buffer.concat([lenField(1, ltpc(182.4, 200.6)), lenField(2, lenField(1, quote)), lenField(4, lenField(1, ohlc1d)), intField(6, 2500000), dblField(7, 5123400)]);
    const feedFull = Buffer.concat([lenField(2, lenField(1, mff)), intField(4, 1)]);
    const feedLtpc = lenField(1, ltpc(25041.35, 24936.15));
    const entry = (key, feed) => lenField(2, Buffer.concat([lenField(1, Buffer.from(key)), lenField(2, feed)]));
    const msg = Buffer.concat([intField(1, 1), entry("NSE_FO|51440", feedFull), entry("NSE_INDEX|Nifty 50", feedLtpc), intField(3, 1760608800000)]);
    const ticks = decodeUpstoxFeed(msg);
    expect(ticks).toEqual([
      { key: "NSE_FO|51440", ltp: 182.4, cp: 200.6, open: 170, high: 190, low: 160.5, bid: 181.9, ask: 182.9, volume: 2500000, oi: 5123400 },
      { key: "NSE_INDEX|Nifty 50", ltp: 25041.35, cp: 24936.15 },
    ]);
  });

  it("only connects to wss URLs on upstox.com", () => {
    expect(checkFeedUri("wss://wsfeeder-api.upstox.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=x&code=y")).toMatch(/^wss:/);
    expect(() => checkFeedUri("wss://evil.example.com/feed")).toThrow(/outside upstox\.com/);
    expect(() => checkFeedUri("https://api.upstox.com/feed")).toThrow();
  });

  it("authorises, subscribes in full mode with binary JSON frames, emits quotes and closes", async () => {
    const sockets = [];
    class FakeWs extends EventEmitter {
      constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 1; sockets.push(this); }
      send(m) { expect(Buffer.isBuffer(m)).toBe(true); this.sent.push(JSON.parse(m.toString())); }
      close() { this.readyState = 3; this.emit("close"); }
    }
    const stub = createFetchStub([{ method: "GET", url: "https://api.upstox.com/v3/feed/market-data-feed/authorize", json: { status: "success", data: { authorized_redirect_uri: "wss://xyz.upstox.com/market-data-feeder/v3/upstox-developer-api/feeds?requestId=r&code=c" } } }]);
    globalThis.fetch = stub.fetch;
    const ticks = [];
    const feed = upstox.createFeed(creds, { onTick: (q) => ticks.push(q) }, { WebSocketImpl: FakeWs });
    await new Promise((r) => setTimeout(r, 0));
    const ws = sockets[0];
    expect(ws.url).toMatch(/^wss:\/\/xyz\.upstox\.com\//);
    ws.emit("open");
    feed.subscribe([{ token: "NSE_INDEX|Nifty 50", exchange: "NSE" }]);
    expect(ws.sent[0]).toMatchObject({ method: "sub", data: { mode: "full", instrumentKeys: ["NSE_INDEX|Nifty 50"] } });
    const entry = lenField(2, Buffer.concat([lenField(1, Buffer.from("NSE_INDEX|Nifty 50")), lenField(2, lenField(1, ltpc(25041.35, 24936.15)))]));
    ws.emit("message", Buffer.concat([intField(1, 1), entry]));
    expect(ticks[0]).toMatchObject({ token: "NSE_INDEX|Nifty 50", exchange: "NSE", ltp: 25041.35, close: 24936.15 });
    feed.close();
    expect(sockets).toHaveLength(1);
  });
});
