/**
 * Dhan v2 adapter: contract harness over every declared capability, symbol mapping from the official
 * instrument master, the binary feed decoder, error normalisation and the order gate. No network:
 * the harness and createFetchStub answer only from fixtures; the feed uses a fake socket.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dhan from "./dhan.mjs";
import { resetDhanMarketCache } from "./dhanMarket.mjs";
import { parseDhanFeedFrame } from "./dhanFeed.mjs";
import { OrderGateError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";

const fx = loadFixtures("dhan");
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

beforeEach(() => resetDhanMarketCache());
afterEach(() => { globalThis.fetch = realFetch; });

describe("dhan contract", () => {
  it("passes strict validation with no warnings", () => {
    const v = validateAdapter(dhan);
    expect(v).toMatchObject({ ok: true, mode: "strict", errors: [] });
    expect(v.warnings).toEqual([]);
  });

  it("every declared capability returns the normalised shape from its fixture", async () => {
    const report = await runContractHarness(dhan, fx);
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability);
    for (const cap of declaredCapabilities(dhan)) {
      if (cap === "auth" || cap === "feed") continue;
      expect(covered).toContain(cap);
    }
  });
});

describe("dhan symbol mapping", () => {
  it("uses the IDX_I ids from the instrument master for all six indices (SENSEX 51, BANKEX 69)", () => {
    expect(Object.fromEntries(Object.entries(dhan.INDEX_SECURITY_IDS).map(([k, v]) => [k, v.secId]))).toEqual({
      NIFTY: 13, BANKNIFTY: 25, FINNIFTY: 27, MIDCPNIFTY: 442, SENSEX: 51, BANKEX: 69,
    });
    for (const u of Object.values(dhan.UNDERLYING_MAP)) expect(u).toMatchObject({ expirySegment: "IDX_I", ocSegment: "IDX_I" });
  });

  it("asks for SENSEX expiries with UnderlyingScrip 51 on IDX_I and returns them ISO + ascending", async () => {
    const { value } = await withFetch([{
      method: "POST", url: "https://api.dhan.co/v2/optionchain/expirylist", expectBody: { UnderlyingScrip: 51, UnderlyingSeg: "IDX_I" },
      json: { data: ["2026-10-29", "2026-10-22", "2026-11-05"], status: "success" },
    }], () => dhan.fetchExpiryList(fx.manifest.creds, "SENSEX"));
    expect(value).toEqual({ status: "success", data: ["2026-10-22", "2026-10-29", "2026-11-05"] });
  });

  it("maps NIFTY weekly + monthly, SENSEX weekly and a stock option from the master", async () => {
    const { value } = await withFetch(fx.byCapability.instruments.responses, () => dhan.fetchInstruments(fx.manifest.creds));
    const rows = value.data;
    const find = (pred) => rows.find(pred);
    expect(find((r) => r.token === "IDX_I:13")).toMatchObject({ exchange: "NSE", instrumentType: "INDEX", underlying: "NIFTY" });
    expect(find((r) => r.token === "IDX_I:51")).toMatchObject({ exchange: "BSE", instrumentType: "INDEX", underlying: "SENSEX" });
    // NIFTY monthly (27 Oct) and weekly (3 Nov), lot 65, tick in rupees (master carries paise).
    expect(find((r) => r.token === "51440")).toMatchObject({ exchange: "NFO", instrumentType: "OPTIDX", underlying: "NIFTY", expiry: "2026-10-27", strike: 25000, optionType: "CE", lotSize: 65, tickSize: 0.05, tradingSymbol: "NIFTY-Oct2026-25000-CE" });
    expect(find((r) => r.token === "54333")).toMatchObject({ expiry: "2026-11-03", optionType: "PE", underlying: "NIFTY" });
    // SENSEX weekly on BFO: unique DISPLAY_NAME instead of the shared series code BSXOPT.
    expect(find((r) => r.token === "1125429")).toMatchObject({ exchange: "BFO", underlying: "SENSEX", expiry: "2026-10-22", strike: 82000, optionType: "CE", lotSize: 20, tradingSymbol: "SENSEX 22 OCT 82000 CALL" });
    expect(find((r) => r.token === "106737")).toMatchObject({ instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500, strike: 1400 });
    expect(find((r) => r.token === "48699")).toMatchObject({ instrumentType: "FUTIDX", underlying: "BANKNIFTY", strike: null, optionType: null, tickSize: 0.2 });
    expect(find((r) => r.token === "2885")).toMatchObject({ instrumentType: "EQ", exchange: "NSE", tradingSymbol: "RELIANCE", tickSize: 0.1 });
    // Non-canonical index options, debt rows and MCX are left out.
    expect(find((r) => r.underlying === "NIFTYNXT50")).toBeUndefined();
    expect(find((r) => r.token === "1000")).toBeUndefined();
    expect(find((r) => r.token === "483080")).toBeUndefined();
  });

  it("quotes indices by IDX_I token and options by NSE_FNO", async () => {
    const { value } = await withFetch(fx.byCapability.quotes.responses, () => dhan.fetchQuotes(fx.manifest.creds, fx.byCapability.quotes.args[0]));
    expect(value.data).toEqual([
      { token: "49081", exchange: "NFO", ltp: 368.15, open: 0, high: 0, low: 0, close: 368.15, volume: 0, oi: 0, bid: 77, ask: null },
      { token: "IDX_I:13", exchange: "NSE", ltp: 25041.35, open: 24950.1, high: 25080.4, low: 24921.3, close: 24936.15, volume: 0, oi: 0, bid: null, ask: null },
    ]);
  });

  it("refuses intervals Dhan does not offer before any network call", async () => {
    const { calls } = await withFetch([], async () => {
      await expect(dhan.fetchHistorical(fx.manifest.creds, { instrument: { token: "1333", exchange: "NSE" }, interval: "3m", from: "2026-10-01", to: "2026-10-02" })).rejects.toMatchObject({ statusCode: 422 });
      await expect(dhan.fetchHistorical(fx.manifest.creds, { instrument: { token: "1333", exchange: "NSE" }, interval: "5m", from: "2026-01-01", to: "2026-10-02" })).rejects.toThrow(/90 days/);
    });
    expect(calls).toEqual([]);
  });

  it("sends intraday ranges in Dhan's datetime format with the 25/60 style interval code", async () => {
    const { value } = await withFetch([{
      method: "POST", url: "https://api.dhan.co/v2/charts/intraday",
      expectBody: { securityId: "13", exchangeSegment: "IDX_I", instrument: "INDEX", interval: "5", fromDate: "2026-10-16 09:15:00", toDate: "2026-10-16 15:30:00" },
      json: { open: [25000, 25010], high: [25020, 25030], low: [24990, 25000], close: [25010, 25025], volume: [0, 0], timestamp: [1760586300, 1760586000], open_interest: [0, 0] },
    }], () => dhan.fetchHistorical(fx.manifest.creds, { instrument: { token: "IDX_I:13", exchange: "NSE" }, interval: "5m", from: "2026-10-16", to: "2026-10-16" }));
    expect(value.data.map((c) => c.time)).toEqual([1760586000, 1760586300]);
  });
});

describe("dhan testConnection", () => {
  it("reports an inactive Data API plan instead of a false success", async () => {
    const { value } = await withFetch([{ method: "GET", url: "https://api.dhan.co/v2/profile", json: { dhanClientId: "1000000001", dataPlan: "Deactive" } }], () => dhan.testConnection(fx.manifest.creds));
    expect(value.status).toBe("error");
    expect(value.message).toMatch(/Data API plan/);
  });

  it("never echoes the access token in its message", async () => {
    const token = fx.manifest.creds.accessToken;
    const { value } = await withFetch([{ method: "GET", url: "https://api.dhan.co/v2/profile", status: 401, json: { errorType: "Invalid_Authentication", errorCode: "DH-901", errorMessage: "Client ID or user generated access token is invalid or expired." } }], () => dhan.testConnection(fx.manifest.creds));
    expect(value.status).toBe("error");
    expect(value.message).not.toContain(token);
  });
});

describe("dhan feed decoder (official v2 binary layout, float32 prices)", () => {
  const header = (buf, code, len, seg, id) => { buf.writeUInt8(code, 0); buf.writeUInt16LE(len, 1); buf.writeUInt8(seg, 3); buf.writeUInt32LE(id, 4); };

  it("walks a frame with ticker, OI and full packets", () => {
    const ticker = Buffer.alloc(16); header(ticker, 2, 16, 0, 13); ticker.writeFloatLE(25041.35, 8); ticker.writeInt32LE(1760600000, 12);
    const oi = Buffer.alloc(12); header(oi, 5, 12, 2, 49081); oi.writeInt32LE(5123400, 8);
    const full = Buffer.alloc(162); header(full, 8, 162, 2, 49081);
    full.writeFloatLE(182.4, 8); full.writeInt32LE(2500000, 22); full.writeInt32LE(5123400, 34);
    full.writeFloatLE(170, 46); full.writeFloatLE(0, 50); full.writeFloatLE(190, 54); full.writeFloatLE(160.5, 58);
    full.writeInt32LE(150, 62); full.writeInt32LE(75, 66); full.writeFloatLE(181.9, 74); full.writeFloatLE(182.9, 78);
    const packets = parseDhanFeedFrame(Buffer.concat([ticker, oi, full]));
    expect(packets).toHaveLength(3);
    expect(packets[0]).toMatchObject({ code: 2, segment: "IDX_I", securityId: "13", ltp: 25041.35 });
    expect(packets[1]).toMatchObject({ code: 5, segment: "NSE_FNO", oi: 5123400 });
    expect(packets[2]).toMatchObject({ code: 8, ltp: 182.4, volume: 2500000, oi: 5123400, open: 170, high: 190, low: 160.5 });
    expect(packets[2].depth[0]).toMatchObject({ bid: 181.9, ask: 182.9, bidQty: 150, askQty: 75 });
  });

  it("drops a truncated tail instead of reading garbage", () => {
    const ticker = Buffer.alloc(16); header(ticker, 2, 16, 0, 13); ticker.writeFloatLE(100, 8);
    expect(parseDhanFeedFrame(Buffer.concat([ticker, Buffer.alloc(10, 4)]))).toHaveLength(1);
  });

  it("subscribes in Full mode in chunks of 100, emits merged quotes and closes cleanly", () => {
    const sockets = [];
    class FakeWs extends EventEmitter {
      constructor(url) { super(); this.url = url; this.sent = []; this.readyState = 1; sockets.push(this); }
      send(m) { this.sent.push(JSON.parse(m)); }
      close() { this.readyState = 3; this.emit("close"); }
    }
    const ticks = [];
    const status = [];
    const feed = dhan.createFeed(fx.manifest.creds, { onTick: (q) => ticks.push(q), onStatus: (s) => status.push(s) }, { WebSocketImpl: FakeWs });
    const ws = sockets[0];
    expect(ws.url).toMatch(/^wss:\/\/api-feed\.dhan\.co\?version=2&token=.+&clientId=1000000001&authType=2$/);
    ws.emit("open");
    const refs = Array.from({ length: 150 }, (_, i) => ({ token: String(40000 + i), exchange: "NFO" }));
    feed.subscribe([{ token: "IDX_I:13", exchange: "NSE" }, ...refs]);
    expect(ws.sent.map((m) => [m.RequestCode, m.InstrumentCount])).toEqual([[21, 100], [21, 51]]);
    expect(ws.sent[0].InstrumentList[0]).toEqual({ ExchangeSegment: "IDX_I", SecurityId: "13" });
    const ticker = Buffer.alloc(16); header(ticker, 2, 16, 0, 13); ticker.writeFloatLE(25041.35, 8);
    ws.emit("message", ticker, true);
    expect(ticks.at(-1)).toMatchObject({ token: "IDX_I:13", exchange: "NSE", ltp: 25041.35, bid: null });
    feed.unsubscribe([{ token: "IDX_I:13", exchange: "NSE" }]);
    expect(ws.sent.at(-1)).toMatchObject({ RequestCode: 22, InstrumentCount: 1 });
    feed.close();
    expect(ws.sent.at(-1)).toEqual({ RequestCode: 12 });
    expect(sockets).toHaveLength(1); // no reconnect after close()
    expect(status[0]).toEqual({ connected: true });
  });
});

describe("dhan errors and order gate", () => {
  it("maps Dhan's documented codes and keeps refusals at 422", () => {
    expect(dhan.normaliseError(new dhan.DhanApiError(401, '{"errorCode":"DH-901"}'))).toMatchObject({ statusCode: 502, code: "UPSTREAM_AUTH" });
    expect(dhan.normaliseError(new dhan.DhanApiError(200, '{"status":"failed","data":{"805":"Too many requests"}}'))).toMatchObject({ statusCode: 502, code: "UPSTREAM_RATE_LIMIT" });
    expect(dhan.normaliseError(new dhan.DhanApiError(400, '{"errorCode":"DH-905"}'))).toMatchObject({ code: "UPSTREAM_INPUT" });
    expect(dhan.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(dhan.normaliseError(new Error("Dhan API error [500]: tok-abcdef"), { secrets: ["tok-abcdef"] }).message).not.toContain("tok-abcdef");
  });

  it("refuses every order call without a gate before touching the network", async () => {
    const { calls } = await withFetch([], async () => {
      await expect(dhan.placeOrder(fx.manifest.creds, fx.byCapability.placeOrder.args[0], 75)).rejects.toBeInstanceOf(OrderGateError);
      await expect(dhan.modifyOrder(fx.manifest.creds, "1", {})).rejects.toBeInstanceOf(OrderGateError);
      await expect(dhan.cancelOrder(fx.manifest.creds, "1")).rejects.toBeInstanceOf(OrderGateError);
    });
    expect(calls).toEqual([]);
  });
});
