/**
 * The generic broker proxy's endpoint table: every read capability any of the 33 adapters declares is
 * reachable, order endpoints are classified so the proxy can refuse them, and query input is validated
 * before an adapter is called. Pure functions; no network.
 */
import { describe, expect, it } from "vitest";
import { createBrokerRegistry } from "./registry.mjs";
import { BrokerInputError, declaredCapabilities } from "./contract.mjs";
import {
  BROKER_PROXY_ENDPOINTS, MAX_INSTRUMENT_ROWS, MAX_QUOTE_REFS, ORDER_ENDPOINTS, argsKey, capabilityMethod, describeAdapter,
  filterInstruments, hasBrokerData, parseBrokerArgs, parseInstrumentFilter, resolveBrokerEndpoint,
} from "./brokerProxyRoutes.mjs";

const registry = createBrokerRegistry();
const q = (o) => new URLSearchParams(o);

describe("endpoint table", () => {
  it("covers every declared read capability of every adapter except auth, feed and normaliseError", () => {
    const reachable = new Set(BROKER_PROXY_ENDPOINTS.map((e) => resolveBrokerEndpoint(e).capability));
    reachable.add("testConnection"); // its own route, /api/broker-test-connection
    for (const id of registry.list()) {
      for (const cap of declaredCapabilities(registry.get(id))) {
        if (["auth", "feed", "normaliseError", "placeOrder", "modifyOrder", "cancelOrder"].includes(cap)) continue;
        expect(reachable.has(cap), `${id}.${cap}`).toBe(true);
      }
    }
  });

  it("classifies order endpoints as orders and never lists them as proxy endpoints", () => {
    for (const e of Object.keys(ORDER_ENDPOINTS)) {
      expect(resolveBrokerEndpoint(e)?.kind).toBe("order");
      expect(BROKER_PROXY_ENDPOINTS).not.toContain(e);
    }
    expect(resolveBrokerEndpoint("positions")).toEqual({ kind: "portfolio", capability: "positions" });
    expect(resolveBrokerEndpoint("option-chain")).toEqual({ kind: "market", capability: "optionChain" });
    expect(resolveBrokerEndpoint("__proto__")).toBeNull();
    expect(resolveBrokerEndpoint(undefined)).toBeNull();
  });

  it("only reaches capabilities a strict adapter declares", () => {
    expect(capabilityMethod(registry.get("kotak"), "historical")).toBeNull();
    expect(capabilityMethod(registry.get("nubra"), "tradeBook")).toBeNull();
    expect(capabilityMethod(registry.get("zerodha"), "orderBook")).toBe("fetchOrderBook");
    expect(capabilityMethod(registry.get("zerodha"), "nope")).toBeNull();
    expect(capabilityMethod({ fetchQuotes() {} }, "quotes")).toBe("fetchQuotes");
  });

  it("describes all 33 adapters with orders disabled", () => {
    const list = registry.list().map((id) => describeAdapter(registry.get(id)));
    expect(list).toHaveLength(33);
    for (const d of list) {
      expect(d.ordersEnabled).toBe(false);
      expect(d.authKind).toMatch(/apiKeyToken|oauthRedirect|requestTokenExchange|sessionLogin/);
      expect(d.endpoints).toEqual(expect.arrayContaining(["option-chain", "expiry-list", "ltp"]));
    }
  });
});

describe("input validation", () => {
  it("parses quotes refs and rejects bad ones", () => {
    const refs = JSON.stringify([{ token: "NSE:NIFTY 50", exchange: "nse" }, { token: "49081", exchange: "NFO" }]);
    expect(parseBrokerArgs("quotes", q({ refs }))).toEqual([[{ token: "NSE:NIFTY 50", exchange: "NSE" }, { token: "49081", exchange: "NFO" }]]);
    expect(argsKey("quotes", q({ refs }))).toBe("NSE|NSE:NIFTY 50,NFO|49081");
    for (const bad of ["", "{}", "[]", JSON.stringify([{ token: "1", exchange: "XYZ" }]), JSON.stringify([{ token: "a\nb", exchange: "NSE" }])]) {
      expect(() => parseBrokerArgs("quotes", q({ refs: bad })), bad).toThrow(BrokerInputError);
    }
    const tooMany = JSON.stringify(Array.from({ length: MAX_QUOTE_REFS + 1 }, (_, n) => ({ token: String(n), exchange: "NFO" })));
    expect(() => parseBrokerArgs("quotes", q({ refs: tooMany }))).toThrow(/between 1 and/);
  });

  it("accepts every real token style but refuses path and query injection with a 422", () => {
    for (const ok of ["49081", "IDX_I:13", "NSE:NIFTY 50", "2885_NSE", "IDX-13", "NSE_FO|51440", "NSE:M&M-EQ", "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE"]) {
      expect(parseBrokerArgs("depth", q({ token: ok, exchange: "NSE" }))[0].token, ok).toBe(ok);
    }
    for (const bad of ["../x", "1/2", "1?x=1", "1#f", "1%2F", "a,b", "..", "x..y", "a\\b"]) {
      let err;
      try { parseBrokerArgs("depth", q({ token: bad, exchange: "NSE" })); } catch (e) { err = e; }
      expect(err, bad).toBeInstanceOf(BrokerInputError);
      expect(err.statusCode, bad).toBe(422);
      expect(() => parseBrokerArgs("historical", q({ token: bad, exchange: "NSE", interval: "1d", from: "2026-10-01", to: "2026-10-02" })), bad).toThrow(BrokerInputError);
    }
  });

  it("parses depth and historical requests", () => {
    expect(parseBrokerArgs("depth", q({ token: "49081", exchange: "NFO" }))).toEqual([{ token: "49081", exchange: "NFO" }]);
    expect(argsKey("depth", q({ token: "49081", exchange: "NFO" }))).toBe("NFO|49081");
    const h = q({ token: "1333", exchange: "NSE", interval: "5m", from: "2026-10-01", to: "2026-10-02 15:30" });
    expect(parseBrokerArgs("historical", h)).toEqual([{ instrument: { token: "1333", exchange: "NSE" }, interval: "5m", from: "2026-10-01", to: "2026-10-02 15:30" }]);
    expect(argsKey("historical", h)).toBe("NSE|1333|5m|2026-10-01|2026-10-02 15:30");
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "2h", from: "2026-10-01", to: "2026-10-02" }))).toThrow(/interval/);
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1d", from: "01-10-2026", to: "2026-10-02" }))).toThrow(/YYYY/);
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1d", from: "2026-10-05", to: "2026-10-02" }))).toThrow(/after/);
    // Span and year caps stop one request fanning out into hundreds of chunked upstream calls.
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1m", from: "1900-01-01", to: "2026-10-02" }))).toThrow(/between/);
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1d", from: "2026-10-01", to: "9999-10-02" }))).toThrow(/between/);
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1m", from: "2026-01-01", to: "2026-10-02" }))).toThrow(/too long/);
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1d", from: "2010-01-01", to: "2026-10-02" }))).toThrow(/too long/);
    expect(() => parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1d", from: "2026-02-31", to: "2026-03-02" }))).toThrow(/calendar/);
    expect(parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "15m", from: "2026-08-10", to: "2026-10-02" }))[0].interval).toBe("15m");
    expect(parseBrokerArgs("historical", q({ token: "1", exchange: "NSE", interval: "1d", from: "2021-06-01", to: "2026-10-02" }))[0].interval).toBe("1d");
    expect(parseBrokerArgs("positions", q({}))).toEqual([]);
    expect(argsKey("positions", q({}))).toBe("");
  });

  it("filters and caps instruments", () => {
    expect(parseInstrumentFilter(q({ underlying: "nifty", instrumentType: "OPTIDX", expiry: "2026-10-20" }))).toEqual({ underlying: "NIFTY", instrumentType: "OPTIDX", expiry: "2026-10-20" });
    expect(argsKey("instruments", q({ underlying: "NIFTY" }))).toBe("NIFTY||");
    expect(() => parseInstrumentFilter(q({}))).toThrow(BrokerInputError);
    expect(() => parseInstrumentFilter(q({ underlying: "NIFTY", instrumentType: "X" }))).toThrow(BrokerInputError);
    expect(() => parseInstrumentFilter(q({ underlying: "NIFTY", expiry: "20-10-2026" }))).toThrow(BrokerInputError);
    const rows = Array.from({ length: MAX_INSTRUMENT_ROWS + 5 }, () => ({ underlying: "NIFTY", instrumentType: "OPTIDX", expiry: "2026-10-20" }));
    rows.push({ underlying: "BANKNIFTY", instrumentType: "OPTIDX", expiry: "2026-10-20" });
    const out = filterInstruments({ data: rows }, { underlying: "NIFTY", instrumentType: "OPTIDX", expiry: "2026-10-20" });
    expect(out.data).toHaveLength(MAX_INSTRUMENT_ROWS);
    expect(out).toMatchObject({ truncated: true, total: MAX_INSTRUMENT_ROWS + 5 });
    expect(filterInstruments(null, { underlying: "NIFTY" }).data).toEqual([]);
  });

  it("knows when a result carries data worth caching", () => {
    expect(hasBrokerData("ltp", { data: { last_price: 0 } })).toBe(false);
    expect(hasBrokerData("ltp", { data: { last_price: 10 } })).toBe(true);
    expect(hasBrokerData("optionChain", { data: { oc: {} } })).toBe(false);
    expect(hasBrokerData("optionChain", { data: { oc: { 100: {} } } })).toBe(true);
    expect(hasBrokerData("quotes", { data: [] })).toBe(false);
    expect(hasBrokerData("depth", { data: { bids: [], asks: [] } })).toBe(true);
    expect(hasBrokerData("funds", { data: {} })).toBe(true);
    expect(hasBrokerData("funds", null)).toBe(false);
  });
});
