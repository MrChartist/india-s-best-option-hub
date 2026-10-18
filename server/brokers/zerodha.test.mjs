/**
 * Zerodha (Kite Connect v3) adapter: contract harness over every declared capability, symbol mapping
 * from the instrument dump, chain assembly, status mapping, the binary feed decoder, the redirect-login
 * checksum, error normalisation and the order gate. No network: fetch is stubbed from fixtures and the
 * feed uses a fake socket.
 */
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as zerodha from "./zerodha.mjs";
import { optionUnderlying, resetZerodhaInstrumentCache, SPOT_TICKER } from "./zerodhaInstruments.mjs";
import { kiteOrderStatus } from "./zerodhaOrders.mjs";
import { kiteTimeToEpoch } from "./zerodhaData.mjs";
import { parseKiteFrame } from "./zerodhaFeed.mjs";
import { KiteApiError } from "./zerodhaClient.mjs";
import { OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { toOptionData } from "./contractShapes.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";

const fx = loadFixtures("zerodha");
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

beforeEach(() => resetZerodhaInstrumentCache());
afterEach(() => { globalThis.fetch = realFetch; });

describe("zerodha contract", () => {
  it("passes strict validation with no warnings", () => {
    const v = validateAdapter(zerodha);
    expect(v).toMatchObject({ ok: true, mode: "strict", errors: [] });
    expect(v.warnings).toEqual([]);
    expect(zerodha.capabilities.auth.kind).toBe("oauthRedirect");
    expect(zerodha.credentialFields).toEqual(["apiKey", "apiSecret", "accessToken"]);
  });

  it("every declared capability returns the normalised shape from its fixture", async () => {
    const report = await runContractHarness(zerodha, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability);
    for (const cap of declaredCapabilities(zerodha)) if (cap !== "auth" && cap !== "feed") expect(covered).toContain(cap);
  });

  it("signs every call with token <api_key>:<access_token> and X-Kite-Version 3", async () => {
    const { calls } = await withFetch(fx.byCapability.ltp.responses, () => zerodha.fetchLTP(creds, "NIFTY"));
    expect(calls[0].headers).toMatchObject({ Authorization: "token dummyapikey0001:dummyaccesstoken0001", "X-Kite-Version": "3" });
  });
});

describe("zerodha symbol mapping", () => {
  it("has a spot ticker and an option dump for all six indices", () => {
    expect(SPOT_TICKER).toEqual({
      NIFTY: "NSE:NIFTY 50", BANKNIFTY: "NSE:NIFTY BANK", FINNIFTY: "NSE:NIFTY FIN SERVICE",
      MIDCPNIFTY: "NSE:NIFTY MID SELECT", SENSEX: "BSE:SENSEX", BANKEX: "BSE:BANKEX",
    });
  });

  it("maps NIFTY weekly + monthly, SENSEX weekly, BANKEX and a stock option from the dumps", async () => {
    const { value } = await withFetch(fx.byCapability.instruments.responses, () => zerodha.fetchInstruments(creds));
    const by = (t) => value.data.find((r) => r.token === t);
    expect(by("256265")).toMatchObject({ exchange: "NSE", instrumentType: "INDEX", tradingSymbol: "NIFTY 50", expiry: null });
    expect(by("12010242")).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", underlying: "NIFTY", expiry: "2026-10-27", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05, tradingSymbol: "NIFTY26OCT25000CE" });
    expect(by("12090626")).toMatchObject({ underlying: "NIFTY", expiry: "2026-11-03", optionType: "PE", tradingSymbol: "NIFTY26N0325000PE" });
    expect(by("287960325")).toMatchObject({ exchange: "BFO", underlying: "SENSEX", expiry: "2026-10-22", strike: 82000, lotSize: 20, tradingSymbol: "SENSEX26O2282000CE" });
    expect(by("288040453")).toMatchObject({ underlying: "BANKEX", instrumentType: "OPTIDX" });
    expect(by("17105410")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
    expect(by("12601602")).toMatchObject({ instrumentType: "FUTIDX", underlying: "NIFTY", strike: null, optionType: null });
    expect(by("738561")).toMatchObject({ instrumentType: "EQ", exchange: "NSE", tickSize: 0.1 });
    expect(by("14400002")).toBeUndefined(); // NIFTYNXT50 is not an app underlying
  });

  it("lists SENSEX expiries from the BFO dump (weekly before monthly)", async () => {
    const { value } = await withFetch(fx.byCapability.instruments.responses, () => zerodha.fetchExpiryList(creds, "SENSEX"));
    expect(value.data).toEqual(["2026-10-22", "2026-10-29"]);
  });

  it("supports stock option chains: NFO rows by name, spot from NSE:<symbol>", async () => {
    expect(optionUnderlying("reliance")).toEqual({ exchange: "NFO", name: "RELIANCE", spotKey: "NSE:RELIANCE", isIndex: false });
    expect(optionUnderlying("NIFTY")).toMatchObject({ exchange: "NFO", spotKey: "NSE:NIFTY 50", isIndex: true });
    expect(optionUnderlying("bad symbol!")).toBeNull();
    const { value } = await withFetch(fx.byCapability.instruments.responses, () => zerodha.fetchExpiryList(creds, "RELIANCE"));
    expect(value.data.length).toBeGreaterThan(0);
    await expect(withFetch(fx.byCapability.instruments.responses, () => zerodha.fetchExpiryList(creds, "NOSUCHSTOCK"))).rejects.toThrow(/Unknown symbol for Zerodha/);
  });

  it("builds the chain from the dump + one /quote call that also carries the spot", async () => {
    const { value, calls } = await withFetch(fx.byCapability.optionChain.responses, () => zerodha.fetchOptionChain(creds, "NIFTY", "2026-10-27"));
    expect(calls.filter((c) => c.url.includes("/quote?"))).toHaveLength(1);
    const { spotPrice, chain } = toOptionData(value);
    expect(spotPrice).toBe(25041.35);
    expect(chain.map((r) => r.strikePrice)).toEqual([25000, 25050, 25100]);
    expect(chain[0].ce).toMatchObject({ ltp: 182.4, oi: 5123400, bidPrice: 181.9, askPrice: 182.9 });
    expect(chain[0].ce.iv).toBeGreaterThan(1); // computed, in percent
  });

  it("resolves numeric instrument tokens to EXCHANGE:TRADINGSYMBOL for /quote", async () => {
    const { value, calls } = await withFetch(fx.byCapability.quotes.responses, () => zerodha.fetchQuotes(creds, fx.byCapability.quotes.args[0]));
    const quoteCall = calls.find((c) => c.url.includes("/quote?"));
    expect(new URL(quoteCall.url).searchParams.getAll("i").sort()).toEqual(["NFO:NIFTY26OCT25000CE", "NSE:INFY", "NSE:NIFTY 50"]);
    expect(value.data.find((q) => q.token === "408065")).toMatchObject({ exchange: "NSE", ltp: 1412.95, bid: null, ask: 1412.95, close: 1389.65 });
  });
});

describe("zerodha normalisation", () => {
  it("maps Kite statuses onto the contract", () => {
    expect(kiteOrderStatus("TRIGGER PENDING")).toBe("TRIGGER_PENDING");
    expect(kiteOrderStatus("OPEN", 65)).toBe("PARTIALLY_FILLED");
    expect(kiteOrderStatus("VALIDATION PENDING")).toBe("OPEN");
    expect(kiteOrderStatus("AMO REQ RECEIVED")).toBe("OPEN");
    expect(kiteOrderStatus("CANCELLED AMO")).toBe("CANCELLED");
    expect(kiteOrderStatus("SOMETHING NEW")).toBe("UNKNOWN");
  });

  it("normalises the documented order book sample (rejection reason kept, NRML -> MARGIN)", async () => {
    const { value } = await withFetch(fx.byCapability.orderBook.responses, () => zerodha.fetchOrderBook(creds));
    expect(value.data.map((o) => o.status)).toEqual(["CANCELLED", "COMPLETE", "REJECTED", "TRIGGER_PENDING", "PARTIALLY_FILLED"]);
    expect(value.data[0]).toMatchObject({ exchange: "CDS", product: "MARGIN" });
    expect(value.data[2].statusMessage).toMatch(/Insufficient funds/);
  });

  it("reads candle timestamps with Kite's +0530 offset", () => {
    expect(kiteTimeToEpoch("2017-12-15T09:15:00+0530")).toBe(Date.parse("2017-12-15T03:45:00Z") / 1000);
  });

  it("funds come from the equity segment", async () => {
    const { value } = await withFetch(fx.byCapability.funds.responses, () => zerodha.fetchFunds(creds));
    expect(value.data).toEqual({ availableCash: 99725.05, usedMargin: 145706.55, totalBalance: 245431.6, collateral: 0, withdrawable: null });
  });

  it("holdings count T+1 shares", async () => {
    const { value } = await withFetch(fx.byCapability.holdings.responses, () => zerodha.fetchHoldings(creds));
    expect(value.data[1]).toMatchObject({ tradingSymbol: "SBIN", exchange: "BSE", qty: 18, isin: "INE062A01020" });
  });
});

describe("zerodha errors", () => {
  it("turns a TokenException into UPSTREAM_AUTH with a re-login hint and no token", async () => {
    let err;
    await withFetch([{ method: "GET", url: "https://api.kite.trade/user/margins", status: 403, json: { status: "error", message: "Incorrect `api_key` or `access_token`.", data: null, error_type: "TokenException" } }], async () => {
      err = await zerodha.fetchFunds(creds).catch((e) => e);
    });
    expect(err).toBeInstanceOf(KiteApiError);
    const n = zerodha.normaliseError(err, { secrets: [creds.accessToken] });
    expect(n).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(n.message).toMatch(/fresh access token/);
    expect(n.message).not.toContain(creds.accessToken);
  });

  it("maps 429 to UPSTREAM_RATE_LIMIT and keeps refusals at 422", () => {
    expect(zerodha.normaliseError(new KiteApiError("x", { httpStatus: 429 })).code).toBe("UPSTREAM_RATE_LIMIT");
    expect(zerodha.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
  });

  it("refuses data calls without a token before any network call", async () => {
    const { calls } = await withFetch([], async () => {
      await expect(zerodha.fetchPositions({ apiKey: "k" })).rejects.toMatchObject({ statusCode: 422 });
    });
    expect(calls).toEqual([]);
  });
});

describe("zerodha redirect login", () => {
  it("posts the SHA-256 checksum of api_key + request_token + api_secret, without an auth header", async () => {
    const checksum = createHash("sha256").update("dummyapikey0001reqtok123dummyapisecret0001").digest("hex");
    const { value, calls } = await withFetch([{
      method: "POST", url: "https://api.kite.trade/session/token", expectBody: { api_key: "dummyapikey0001", request_token: "reqtok123", checksum },
      json: { status: "success", data: { user_id: "XX0000", access_token: "newaccesstoken01", public_token: "pub", refresh_token: "", api_key: "dummyapikey0001" } },
    }], () => zerodha.exchangeRequestToken(creds, "reqtok123"));
    expect(value).toEqual({ accessToken: "newaccesstoken01", userId: "XX0000" });
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body).not.toContain("dummyapisecret0001");
  });
});

describe("zerodha orders", () => {
  it("refuses every order call without a gate before touching the network", async () => {
    const { calls } = await withFetch([], async () => {
      await expect(zerodha.placeOrder(creds, fx.byCapability.placeOrder.args[0], 65)).rejects.toBeInstanceOf(OrderGateError);
      await expect(zerodha.modifyOrder(creds, "1", { orderType: "LIMIT", price: 1 })).rejects.toBeInstanceOf(OrderGateError);
      await expect(zerodha.cancelOrder(creds, "1")).rejects.toBeInstanceOf(OrderGateError);
    });
    expect(calls).toEqual([]);
  });

  it("sends market_protection=-1 on MARKET/SL-M and maps app products to Kite's", () => {
    const body = zerodha.buildOrderBody({ tradingsymbol: "NIFTY26OCT25000CE", exchange: "NFO", transactionType: "SELL", orderType: "SL-M", triggerPrice: 150, product: "MARGIN", lots: 1 }, 65);
    expect(body).toMatchObject({ product: "NRML", market_protection: -1, trigger_price: 150, quantity: 65, price: 0 });
    expect(zerodha.buildOrderBody({ tradingsymbol: "X", transactionType: "BUY", orderType: "LIMIT", price: 10, lots: 1 }, 65).market_protection).toBeUndefined();
    expect(() => zerodha.buildOrderBody({ tradingsymbol: "X", transactionType: "BUY", orderType: "MARKET", lots: 1, marketProtection: 0 }, 65)).toThrow(/marketProtection/);
  });

  it("validates modify bodies", () => {
    expect(zerodha.buildModifyBody({ orderType: "SL", price: 101, triggerPrice: 100 })).toEqual({ order_type: "SL", validity: "DAY", price: 101, trigger_price: 100 });
    expect(() => zerodha.buildModifyBody({ orderType: "LIMIT" })).toThrow(/price required/);
  });
});

describe("zerodha feed decoder (documented binary layout)", () => {
  const frame = (packets) => {
    const parts = [Buffer.alloc(2)];
    parts[0].writeInt16BE(packets.length, 0);
    for (const p of packets) { const len = Buffer.alloc(2); len.writeInt16BE(p.length, 0); parts.push(len, p); }
    return Buffer.concat(parts);
  };

  it("decodes ltp, index and full packets (paise -> rupees, depth levels)", () => {
    const ltp = Buffer.alloc(8); ltp.writeUInt32BE(408065, 0); ltp.writeInt32BE(141295, 4);
    const idx = Buffer.alloc(28); idx.writeUInt32BE(256265, 0); idx.writeInt32BE(2504135, 4); idx.writeInt32BE(2508040, 8); idx.writeInt32BE(2492130, 12); idx.writeInt32BE(2495010, 16); idx.writeInt32BE(2493615, 20);
    const full = Buffer.alloc(184); full.writeUInt32BE(12010242, 0); full.writeInt32BE(18240, 4); full.writeInt32BE(2500000, 16);
    full.writeInt32BE(17000, 28); full.writeInt32BE(19000, 32); full.writeInt32BE(16050, 36); full.writeInt32BE(20060, 40); full.writeInt32BE(5123400, 48);
    full.writeInt32BE(150, 64); full.writeInt32BE(18190, 68); full.writeInt16BE(3, 72);
    full.writeInt32BE(75, 124); full.writeInt32BE(18290, 128); full.writeInt16BE(2, 132);
    const out = parseKiteFrame(frame([ltp, idx, full]));
    expect(out[0]).toEqual({ token: "408065", kind: "ltp", ltp: 1412.95 });
    expect(out[1]).toMatchObject({ token: "256265", kind: "index", ltp: 25041.35, close: 24936.15 });
    expect(out[2]).toMatchObject({ kind: "full", ltp: 182.4, volume: 2500000, open: 170, close: 200.6, oi: 5123400 });
    expect(out[2].bids[0]).toEqual({ qty: 150, price: 181.9, orders: 3 });
    expect(out[2].asks[0]).toEqual({ qty: 75, price: 182.9, orders: 2 });
  });

  it("ignores 1-byte heartbeats", () => {
    expect(parseKiteFrame(Buffer.alloc(1))).toEqual([]);
  });

  it("subscribes in full mode, emits merged quotes and stops reconnecting on a refused handshake", () => {
    const sockets = [];
    class FakeWs extends EventEmitter {
      constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 1; sockets.push(this); }
      send(m) { this.sent.push(JSON.parse(m)); }
      close() { this.readyState = 3; this.emit("close"); }
    }
    const ticks = [];
    const status = [];
    const feed = zerodha.createFeed(creds, { onTick: (q) => ticks.push(q), onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
    const ws = sockets[0];
    expect(ws.url).toBe("wss://ws.kite.trade?api_key=dummyapikey0001&access_token=dummyaccesstoken0001");
    ws.emit("open");
    feed.subscribe([{ token: "408065", exchange: "NSE" }]);
    expect(ws.sent).toEqual([{ a: "subscribe", v: [408065] }, { a: "mode", v: ["full", [408065]] }]);
    const ltp = Buffer.alloc(8); ltp.writeUInt32BE(408065, 0); ltp.writeInt32BE(141295, 4);
    ws.emit("message", frame([ltp]), true);
    expect(ticks[0]).toMatchObject({ token: "408065", exchange: "NSE", ltp: 1412.95, bid: null });
    ws.emit("unexpected-response", {}, { statusCode: 403 });
    ws.close();
    expect(status.at(-1)).toMatchObject({ connected: false });
    expect(status.some((s) => /fresh access token/.test(s.reason ?? ""))).toBe(true);
    expect(sockets).toHaveLength(1);
    feed.close();
  });
});
