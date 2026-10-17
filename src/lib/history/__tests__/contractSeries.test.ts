import { describe, expect, it } from "vitest";
import { buildSnapshot, type ChainSnapshot } from "@/lib/snapshotStore";
import { bsPrice, generateSampleChain, greeks } from "@/lib/options";
import { decodeLegs } from "@/components/option-chain/basket";
import {
  contractBasketLeg,
  contractLabel,
  contractPath,
  contractSessionWindow,
  dailyHistoryDates,
  enrichContractSeries,
  extractContractSeries,
  hhmmIST,
  moneyness,
  parseContractParams,
  pickBhavcopyRow,
  summariseSeries,
  type ContractKey,
} from "../contractSeries";
import { encodeLegs } from "@/components/option-chain/basket";

const key: ContractKey = { symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "CE" };

describe("contract routes", () => {
  it("builds and parses the shared URL shape", () => {
    expect(contractPath("nifty", "20-Oct-2026", 25000, "CE")).toBe("/contract/NIFTY/2026-10-20/25000/CE");
    expect(contractPath("M&M", "2026-10-27", 112.5, "PE")).toBe("/contract/M%26M/2026-10-27/112.5/PE");
    expect(parseContractParams({ symbol: "nifty", expiry: "2026-10-20", strike: "25000", type: "ce" })).toEqual({ key });
    expect(parseContractParams({ symbol: "M&M", expiry: "27-Oct-2026", strike: "112.5", type: "PE" })).toEqual({ key: { symbol: "M&M", expiry: "2026-10-27", strike: 112.5, type: "PE" } });
  });

  it("explains invalid links", () => {
    expect(parseContractParams({ symbol: "<script>", expiry: "2026-10-20", strike: "1", type: "CE" })).toHaveProperty("error");
    expect(parseContractParams({ symbol: "NIFTY", expiry: "soon", strike: "1", type: "CE" })).toHaveProperty("error");
    expect(parseContractParams({ symbol: "NIFTY", expiry: "2026-10-20", strike: "-5", type: "CE" })).toHaveProperty("error");
    expect(parseContractParams({ symbol: "NIFTY", expiry: "2026-10-20", strike: "25000", type: "FUT" })).toHaveProperty("error");
  });

  it("labels contracts in Indian style", () => {
    expect(contractLabel(key)).toBe("NIFTY 20 Oct 2026 25,000 CE");
    expect(hhmmIST(Date.UTC(2026, 9, 16, 4, 5))).toBe("09:35");
  });
});

describe("series extraction and Greeks", () => {
  const t0 = Date.UTC(2026, 9, 16, 4, 0); // 09:30 IST, Friday
  const S = 25000;
  const T = (ts: number) => (Date.UTC(2026, 9, 20, 10, 0) - ts) / (365 * 86_400_000);
  const mk = (ts: number, spot: number, ltp: number, oi: number, vol: number, iv: number): ChainSnapshot => ({
    id: String(ts),
    symbol: "NIFTY",
    expiry: "2026-10-20",
    ts,
    spot,
    rows: [
      { strike: 25000, side: "CE", ltp, oi, vol, iv, bid: ltp - 0.5, ask: ltp + 0.5 },
      { strike: 25000, side: "PE", ltp: 100, oi: 1, vol: 1, iv: 12, bid: 99, ask: 101 },
    ],
  });

  it("pulls one strike/side in time order", () => {
    const pts = extractContractSeries([mk(t0 + 60_000, S, 110, 1200, 300, 12.5), mk(t0, S, 100, 1000, 100, 12)], 25000, "CE");
    expect(pts.map((p) => p.ltp)).toEqual([100, 110]);
    expect(extractContractSeries([mk(t0, S, 100, 1, 1, 1)], 25100, "CE")).toEqual([]);
  });

  it("computes interval OI/volume and Greeks with the shared core", () => {
    const pts = extractContractSeries([mk(t0, S, 100, 1000, 100, 12), mk(t0 + 60_000, S + 20, 110, 1200, 300, 12.5)], 25000, "CE");
    const e = enrichContractSeries(pts, key, { r: 0.065, q: 0 });
    expect(e[0]).toMatchObject({ dOi: 0, dVol: 0, ivSource: "feed", mid: 100 });
    expect(e[1]).toMatchObject({ dOi: 200, dVol: 200 });
    const g = greeks({ S: S + 20, K: 25000, T: T(t0 + 60_000), r: 0.065, q: 0, sigma: 0.125, type: "CE" });
    expect(e[1].delta).toBeCloseTo(g.delta, 4);
    expect(e[1].gamma).toBeCloseTo(g.gamma, 8);
    expect(e[1].theta).toBeCloseTo(g.theta, 3);
    expect(e[1].vega).toBeCloseTo(g.vega, 4);
  });

  it("solves IV from the LTP when the feed has none", () => {
    const sigma = 0.15;
    const price = bsPrice({ S, K: 25000, T: T(t0), r: 0.065, q: 0, sigma, type: "CE" });
    const e = enrichContractSeries(extractContractSeries([mk(t0, S, price, 1, 1, 0)], 25000, "CE"), key, { r: 0.065, q: 0 });
    expect(e[0].ivSource).toBe("solved");
    expect(e[0].sigma).toBeCloseTo(sigma, 4);
    const none = enrichContractSeries(extractContractSeries([mk(t0, S, 0, 1, 1, 0)], 25000, "CE"), key);
    expect(none[0].ivSource).toBe("none");
    expect(Number.isNaN(none[0].delta)).toBe(true);
  });

  it("resets interval volume across days and summarises the session", () => {
    const nextDay = t0 + 86_400_000;
    const pts = extractContractSeries([mk(t0, S, 100, 1000, 100, 12), mk(t0 + 60_000, S, 90, 900, 400, 13), mk(nextDay, S, 95, 950, 50, 12)], 25000, "CE");
    const e = enrichContractSeries(pts, key);
    expect(e.map((p) => p.dVol)).toEqual([0, 300, 50]);
    const sum = summariseSeries(e.slice(0, 2));
    expect(sum).toMatchObject({ high: 100, low: 90, ltpChange: -10, oiChange: -100, volume: 300, ivChange: 1 });
    expect(sum.ltpChangePct).toBeCloseTo(-10, 6);
    expect(Number.isNaN(summariseSeries([]).high)).toBe(true);
  });

  it("classifies moneyness with intrinsic and time value", () => {
    expect(moneyness(key, 25200, 260, 50)).toEqual({ state: "ITM", intrinsic: 200, timeValue: 60 });
    expect(moneyness(key, 25010, 120, 50)).toMatchObject({ state: "ATM" });
    expect(moneyness({ ...key, type: "PE" }, 25200, 40, 50)).toEqual({ state: "OTM", intrinsic: 0, timeValue: 40 });
  });
});

describe("builder and paper-trade legs", () => {
  it("uses the mid price and a decimal IV, and round-trips through encodeLegs", () => {
    const leg = contractBasketLeg(key, "SELL", { ltp: 101, iv: 12.34, bidPrice: 100, askPrice: 101 });
    expect(leg).toEqual({ symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "CE", side: "SELL", lots: 1, premium: 100.5, iv: 0.1234 });
    expect(decodeLegs(encodeLegs([leg]))).toEqual([leg]);
    expect(contractBasketLeg(key, "BUY", undefined)).toMatchObject({ premium: 0, iv: null });
    expect(contractBasketLeg(key, "BUY", { ltp: 5, iv: 0, bidPrice: 0, askPrice: 0 })).toMatchObject({ premium: 5, iv: null });
  });
});

describe("daily history helpers", () => {
  it("lists trading days before today, or including today after 19:00 IST, up to expiry", () => {
    const sat = new Date("2026-10-17T06:00:00Z");
    const days = dailyHistoryDates(sat, 5);
    expect(days).toHaveLength(5);
    expect(days[days.length - 1]).toBe("2026-10-16");
    expect(days).not.toContain("2026-10-11");
    expect(dailyHistoryDates(new Date("2026-10-16T14:00:00Z"), 1)).toEqual(["2026-10-16"]); // Fri 19:30 IST
    expect(dailyHistoryDates(new Date("2026-10-16T12:00:00Z"), 1)).toEqual(["2026-10-15"]); // Fri 17:30 IST
    expect(dailyHistoryDates(sat, 5, "2026-10-14").every((d) => d <= "2026-10-14")).toBe(true);
  });

  it("chooses today's session once open, else the previous trading day", () => {
    expect(contractSessionWindow(new Date("2026-10-16T05:00:00Z"))).toMatchObject({ date: "2026-10-16", isToday: true, to: Date.parse("2026-10-16T05:00:00Z") });
    const sat = contractSessionWindow(new Date("2026-10-17T05:00:00Z"));
    expect(sat).toMatchObject({ date: "2026-10-16", isToday: false, to: Date.parse("2026-10-16T10:05:00Z") });
    expect(sat.from).toBe(Date.parse("2026-10-16T03:30:00Z"));
  });

  it("picks the contract's bhavcopy row", () => {
    const rows = [
      { symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "PE" as const, close: 1, settle: 1, oi: 1, chgOi: 1, volume: 1, underlyingClose: 1 },
      { symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, type: "CE" as const, close: 120.5, settle: 121, oi: 5000, chgOi: -300, volume: 9000, underlyingClose: 25010 },
    ];
    expect(pickBhavcopyRow(rows, key, "2026-10-16")).toEqual({ date: "2026-10-16", close: 120.5, settle: 121, oi: 5000, chgOi: -300, volume: 9000, underlyingClose: 25010 });
    expect(pickBhavcopyRow(rows, { ...key, strike: 25050 }, "2026-10-16")).toBeNull();
    expect(pickBhavcopyRow(null, key, "x")).toBeNull();
  });
});

describe("snapshots built from a sample chain", () => {
  it("extract cleanly", () => {
    const now = new Date("2026-10-16T06:00:00Z");
    const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25000, expiry: "2026-10-20", now });
    const snap = buildSnapshot("NIFTY", "2026-10-20", 25000, chain, now.getTime());
    const [p] = extractContractSeries([snap], 25000, "PE");
    expect(p.ltp).toBe(chain.find((r) => r.strikePrice === 25000)?.pe.ltp);
  });
});
