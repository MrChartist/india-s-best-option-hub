import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchLiveOptionChain,
  fetchProxyHealth,
  parseAllIndices,
  parseChainMulti,
  parseDhanOptionChain,
  parseFIIDII,
  parseNSEFnOStocks,
  parseNSEIndices,
  parseNSEOptionChain,
  toExpiryDate,
  toExpiryDates,
  testDhanConnection,
} from "@/lib/marketApi";
import type { ChainMultiDTO, NSEOptionChainDTO } from "@/lib/types/market";

describe("parseDhanOptionChain", () => {
  it("returns empty chain for null/undefined input", () => {
    expect(parseDhanOptionChain(null).chain).toHaveLength(0);
    expect(parseDhanOptionChain(undefined).spotPrice).toBe(0);
  });

  it("returns empty chain for empty oc object", () => {
    const result = parseDhanOptionChain({ data: { oc: {}, last_price: 24000 }, status: "success" });
    expect(result.chain).toHaveLength(0);
    expect(result.spotPrice).toBe(24000);
  });

  it("parses Dhan API v1 format (flat fields)", () => {
    const result = parseDhanOptionChain({
      status: "success",
      data: {
        last_price: 24100,
        oc: {
          "24000": {
            ce: { ltp: 150, oi: 500000, volume: 100000, iv: 15.5, delta: 0.55, gamma: 0.01, theta: -5, vega: 10 },
            pe: { ltp: 80, oi: 600000, volume: 80000, iv: 16.2, delta: -0.45, gamma: 0.01, theta: -4, vega: 9 },
          },
          "24200": {
            ce: { ltp: 50, oi: 300000, volume: 60000, iv: 14.8, delta: 0.35, gamma: 0.008, theta: -3, vega: 8 },
            pe: { ltp: 200, oi: 400000, volume: 90000, iv: 17.1, delta: -0.65, gamma: 0.008, theta: -6, vega: 11 },
          },
        },
      },
    });
    expect(result.chain).toHaveLength(2);
    expect(result.spotPrice).toBe(24100);
    expect(result.chain[0].strikePrice).toBe(24000);
    expect(result.chain[0].ce.ltp).toBe(150);
    expect(result.chain[0].ce.iv).toBe(15.5);
    expect(result.chain[0].ce.delta).toBe(0.55);
    expect(result.chain[0].ce.oiChange).toBe(0);
    expect(result.totalCEOI).toBe(800000);
    expect(result.totalPEOI).toBe(1000000);
  });

  it("parses Dhan API v2 format with change, prevClose, quantities and security id", () => {
    const result = parseDhanOptionChain({
      status: "success",
      data: {
        last_price: 24500,
        oc: {
          "24400.000000": {
            ce: {
              last_price: 200,
              previous_close_price: 160,
              oi: 100000,
              previous_oi: 90000,
              volume: 50000,
              implied_volatility: 18.5,
              top_bid_price: 199,
              top_ask_price: 201,
              top_bid_quantity: 750,
              top_ask_quantity: 1125,
              security_id: 43210,
              greeks: { delta: 0.6, gamma: 0.015, theta: -8, vega: 12 },
            },
            pe: {
              last_price: 120,
              oi: 80000,
              previous_oi: 85000,
              volume: 40000,
              implied_volatility: 19.2,
              top_bid_price: 119,
              top_ask_price: 121,
              greeks: { delta: -0.4, gamma: 0.015, theta: -6, vega: 11 },
            },
          },
        },
      },
    });
    const row = result.chain[0];
    expect(row.strikePrice).toBe(24400);
    expect(row.ce.ltp).toBe(200);
    expect(row.ce.iv).toBe(18.5);
    expect(row.ce.delta).toBe(0.6);
    expect(row.ce.oiChange).toBe(10000);
    expect(row.ce.bidPrice).toBe(199);
    expect(row.ce.prevClose).toBe(160);
    expect(row.ce.change).toBe(40);
    expect(row.ce.pChange).toBe(25);
    expect(row.ce.bidQty).toBe(750);
    expect(row.ce.askQty).toBe(1125);
    expect(row.ce.securityId).toBe("43210");
    expect(row.pe.oiChange).toBe(-5000);
    expect(row.pe.change).toBeUndefined();
  });

  it("keeps a zero greek instead of falling through to the flat field", () => {
    const result = parseDhanOptionChain({ status: "success", data: { oc: { "100": { ce: { ltp: 1, delta: 0.9, greeks: { delta: 0 } } } } } });
    expect(result.chain[0].ce.delta).toBe(0);
  });

  it("sorts by strike and drops invalid strike keys", () => {
    const result = parseDhanOptionChain({
      status: "success",
      data: { last_price: 24000, oc: { "24200": { ce: { ltp: 10 } }, abc: { ce: { ltp: 1 } }, "23800": { pe: { ltp: 10 } }, "24000": {} } },
    });
    expect(result.chain.map((r) => r.strikePrice)).toEqual([23800, 24000, 24200]);
    expect(result.chain[1].ce.ltp).toBe(0);
  });
});

const nseLegacy: NSEOptionChainDTO = {
  records: {
    expiryDates: ["08-May-2026", "15-May-2026"],
    strikePrices: [24000, 24100],
    data: [
      {
        strikePrice: 24000,
        expiryDate: "08-May-2026",
        CE: { lastPrice: 150, change: 10, pChange: 7.14, openInterest: 500000, changeinOpenInterest: 10000, totalTradedVolume: 100000, impliedVolatility: 15.5, bidQty: 75, bidprice: 149, askQty: 150, askPrice: 151, underlyingValue: 24050, identifier: "OPTIDXNIFTY08-05-2026CE24000.00" },
        PE: { lastPrice: 80, openInterest: 600000, changeinOpenInterest: -5000, totalTradedVolume: 80000, impliedVolatility: 16, bidprice: 79, askPrice: 81, underlyingValue: 24050 },
      },
      {
        strikePrice: 24100,
        expiryDate: "08-May-2026",
        CE: { lastPrice: 100, openInterest: 300000, changeinOpenInterest: 8000, totalTradedVolume: 60000, impliedVolatility: 14.5, bidprice: 99, askPrice: 101, underlyingValue: 24050 },
        PE: { lastPrice: 130, openInterest: 400000, changeinOpenInterest: 12000, totalTradedVolume: 70000, impliedVolatility: 17, bidprice: 129, askPrice: 131, underlyingValue: 24050 },
      },
      {
        strikePrice: 24000,
        expiryDate: "15-May-2026",
        CE: { lastPrice: 210, openInterest: 1000, changeinOpenInterest: 0, totalTradedVolume: 10, impliedVolatility: 15, bidprice: 0, askPrice: 0 },
      },
    ],
  },
  filtered: { CE: { totOI: 800000, totVol: 160000 }, PE: { totOI: 1000000, totVol: 150000 } },
};

describe("parseNSEOptionChain", () => {
  it("returns empty for malformed input", () => {
    const result = parseNSEOptionChain({});
    expect(result.chain).toHaveLength(0);
    expect(result.expiry).toBe("");
  });

  it("parses the legacy format and normalises expiries to ISO", () => {
    const result = parseNSEOptionChain(nseLegacy);
    expect(result.chain).toHaveLength(2);
    expect(result.spotPrice).toBe(24050);
    expect(result.expiries.map((e) => e.value)).toEqual(["2026-05-08", "2026-05-15"]);
    expect(result.expiries[0].label).toMatch(/8 May 2026|08 May 2026/);
    expect(result.expiry).toBe("2026-05-08");
    expect(result.totalCEOI).toBe(800000);
    expect(result.chain[0].ce.ltp).toBe(150);
    expect(result.chain[0].ce.change).toBe(10);
    expect(result.chain[0].ce.pChange).toBe(7.14);
    expect(result.chain[0].ce.prevClose).toBe(140);
    expect(result.chain[0].ce.bidQty).toBe(75);
    expect(result.chain[0].ce.securityId).toContain("NIFTY");
    expect(result.chain[0].pe.oiChange).toBe(-5000);
  });

  it("selects a later expiry by ISO or NSE format and sums its own OI", () => {
    const iso = parseNSEOptionChain(nseLegacy, "2026-05-15");
    const nse = parseNSEOptionChain(nseLegacy, "15-May-2026");
    expect(iso.expiry).toBe("2026-05-15");
    expect(nse.expiry).toBe("2026-05-15");
    expect(iso.chain).toHaveLength(1);
    expect(iso.chain[0].ce.ltp).toBe(210);
    expect(iso.totalCEOI).toBe(1000); // not the near-expiry filtered total
  });

  it("accepts the option-chain-v3 shape (expiryDates per row, lower-case pchange)", () => {
    const result = parseNSEOptionChain({
      records: {
        underlyingValue: 25010,
        data: [{ strikePrice: 25000, expiryDates: "20-Oct-2026", CE: { lastPrice: 90, pchange: -3.2, openInterest: 10 }, PE: { lastPrice: 70, openInterest: 12 } }],
      },
    });
    expect(result.expiry).toBe("2026-10-20");
    expect(result.spotPrice).toBe(25010);
    expect(result.chain[0].ce.pChange).toBe(-3.2);
    expect(result.totalPEOI).toBe(12);
  });
});

describe("expiry helpers", () => {
  it("normalises formats and counts IST calendar days", () => {
    const now = new Date("2026-10-17T04:00:00Z");
    expect(toExpiryDate("20-Oct-2026", now)).toMatchObject({ value: "2026-10-20", daysToExpiry: 3 });
    expect(toExpiryDate("2026-10-17", now)?.daysToExpiry).toBe(0);
    expect(toExpiryDate("garbage", now)).toBeNull();
  });

  it("dedupes and sorts", () => {
    expect(toExpiryDates(["27-Oct-2026", "2026-10-20", "20-Oct-2026", "x"]).map((e) => e.value)).toEqual(["2026-10-20", "2026-10-27"]);
  });
});

describe("other parsers", () => {
  it("parseNSEIndices maps the F&O index names", () => {
    const rows = parseNSEIndices({
      data: [
        { index: "NIFTY 50", last: 25000, variation: 100, percentChange: 0.4, previousClose: 24900 },
        { index: "NIFTY MIDCAP SELECT", last: 13000 },
        { index: "NIFTY IT", last: 40000 },
      ],
    });
    expect(rows.map((r) => r.symbol)).toEqual(["NIFTY", "MIDCPNIFTY"]);
    expect(rows[0].prevClose).toBe(24900);
    expect(rows[1].open).toBe(13000);
  });

  it("parseAllIndices extracts VIX, sectors and breadth", () => {
    const snap = parseAllIndices({
      data: [
        { index: "INDIA VIX", last: 12.5, variation: -0.3, percentChange: -2.3 },
        { index: "NIFTY IT", last: 40000, percentChange: 1.2 },
        { index: "NIFTY 50", last: 25000, advances: "30", declines: "19", unchanged: "1" },
      ],
    });
    expect(snap?.vix?.value).toBe(12.5);
    expect(snap?.sectors[0]).toMatchObject({ name: "IT", change: 1.2 });
    expect(snap?.advances).toBe(30);
    expect(parseAllIndices({ data: [] })).toBeNull();
  });

  it("parseNSEFnOStocks and parseFIIDII clean numbers", () => {
    expect(parseNSEFnOStocks({ data: [{ symbol: "NIFTY 50", lastPrice: 1 }, { symbol: "SBIN", lastPrice: 800, pChange: 1.5, openInterest: 9 }] })).toHaveLength(1);
    expect(parseFIIDII({ data: [{ category: "FII/FPI", buyValue: "1,234.5", sellValue: "1,000", netValue: "234.5" }] })[0].buyValue).toBe(1234.5);
  });

  it("parseChainMulti validates and sorts", () => {
    const dto: ChainMultiDTO = {
      symbol: "nifty",
      spot: 25000,
      expiries: [
        { expiry: "2026-10-27", chain: [{ strikePrice: 25100, ce: { ltp: 1, oi: 1, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 }, pe: { ltp: 2, oi: 1, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 } }] },
        { expiry: "2026-10-20", chain: [] },
      ],
    };
    const r = parseChainMulti(dto);
    expect(r?.symbol).toBe("NIFTY");
    expect(r?.expiries).toHaveLength(1);
    expect(parseChainMulti(null)).toBeNull();
  });
});

describe("fetchLiveOptionChain source fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("falls back to NSE when Dhan returns an empty 'success' chain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("dhan-proxy")) return json({ status: "success", data: { oc: {} } });
        return json(nseLegacy);
      }),
    );
    const r = await fetchLiveOptionChain("NIFTY");
    expect(r.source).toBe("nse");
    expect(r.chain).toHaveLength(2);
    expect(r.stale).toBe(false);
  });

  it("falls back to NSE when the proxy reports a Dhan error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("dhan-proxy") ? json({ status: "error", reason: "no keys" }, 502) : json(nseLegacy))),
    );
    const r = await fetchLiveOptionChain("NIFTY", "2026-05-15");
    expect(r.source).toBe("nse");
    expect(r.expiry).toBe("2026-05-15");
  });

  it("uses a fresh Dhan chain and tags its expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("expiry-list")) return json({ status: "success", data: ["2026-10-20", "2026-10-27"] });
        if (url.includes("dhan-proxy")) return json({ status: "success", expiry: "2026-10-20", data: { last_price: 25000, oc: { "25000": { ce: { last_price: 100 }, pe: { last_price: 90 } } } } });
        throw new Error("NSE should not be called");
      }),
    );
    const r = await fetchLiveOptionChain("NIFTY");
    expect(r.source).toBe("dhan");
    expect(r.expiry).toBe("2026-10-20");
    expect(r.expiries).toHaveLength(2);
  });

  it("throws when every source fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(fetchLiveOptionChain("NIFTY")).rejects.toThrow();
  });
});

describe("proxy reachability gate integration", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    const proxy = await import("@/lib/api/proxyClient");
    proxy.setProxyGateEnabled(false);
    proxy.resetProxyGate();
  });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("fetchProxyHealth sends /health straight through and resets the gate on success", async () => {
    const proxy = await import("@/lib/api/proxyClient");
    proxy.setProxyGateEnabled(true);
    proxy.resetProxyGate();
    const fetchMock = vi.fn(async () => json({ status: "ok", dhanConfigured: false }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProxyHealth()).resolves.toMatchObject({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(proxy.getProxyStatus().status).toBe("online");
  });

  it("fetchProxyHealth skips the network inside the backoff window", async () => {
    const proxy = await import("@/lib/api/proxyClient");
    proxy.setProxyGateEnabled(true);
    proxy.resetProxyGate();
    proxy.markProxyOffline();
    const fetchMock = vi.fn(async () => json({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchProxyHealth()).rejects.toThrow("Proxy unreachable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("testDhanConnection reports an unreachable proxy and a readable result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(testDhanConnection()).resolves.toMatchObject({ status: "error", message: expect.stringMatching(/npm run proxy/) });
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "success", message: "Connected" })));
    await expect(testDhanConnection()).resolves.toEqual({ status: "success", message: "Connected" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 502 })));
    await expect(testDhanConnection()).resolves.toMatchObject({ status: "error", message: expect.stringMatching(/HTTP 502/) });
  });
});
