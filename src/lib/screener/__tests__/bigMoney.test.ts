import { describe, expect, it } from "vitest";
import { dealValue, oiJumps, parseDealsPayload, parseOiSpurtsPayload, summariseDeals } from "../bigMoney";
import { sampleBanList, sampleDeals, sampleMwpl, sampleRows, seededRandom } from "../sample";

describe("deals", () => {
  it("parses and summarises", () => {
    const deals = parseDealsPayload([
      { date: "2026-10-17", symbol: "TCS", name: "TCS", client: "X", side: "BUY", qty: 100, price: 3000 },
      { date: "2026-10-17", symbol: "TCS", client: "Y", side: "SELL", qty: 50, price: 3000 },
      { symbol: "INFY", side: "SELL", qty: 10, price: 1500 },
      { symbol: "", qty: 1, price: 1 },
      { symbol: "BAD", qty: 0, price: 1 },
    ]);
    expect(deals).toHaveLength(3);
    expect(dealValue(deals[0])).toBe(300000);
    const s = summariseDeals(deals);
    expect(s[0]).toMatchObject({ symbol: "TCS", net: 150000, deals: 2 });
    expect(s[1]).toMatchObject({ symbol: "INFY", net: -15000 });
    expect(parseDealsPayload(null)).toEqual([]);
  });
});

describe("oi spurts and jumps", () => {
  it("parses spurts", () => {
    const r = parseOiSpurtsPayload([{ symbol: "zomato", chgOiPct: 12, latestOi: 5 }, { symbol: "X" }]);
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe("ETERNAL");
  });
  it("filters jumps above 10%", () => {
    const j = oiJumps([
      { symbol: "A", oiChangePct: 12, changePct: 1, oiSource: "futures-eod" },
      { symbol: "B", oiChangePct: 10, changePct: 1, oiSource: "oi-spurts" },
      { symbol: "C", oiChangePct: 25, changePct: -2, oiSource: "oi-spurts" },
      { symbol: "D", oiChangePct: null, changePct: 0, oiSource: null },
    ]);
    expect(j.map((x) => x.symbol)).toEqual(["C", "A"]);
    expect(j[1].source).toBe("futures-eod");
  });
});

describe("sample data", () => {
  it("is deterministic and labelled", () => {
    const a = sampleRows(5);
    const b = sampleRows(5);
    expect(a).toEqual(b);
    expect(a.every((r) => r.isSample)).toBe(true);
    expect(new Set(a.map((r) => r.symbol)).size).toBe(a.length);
    expect(sampleMwpl(5)[0].mwplPct).toBeGreaterThanOrEqual(sampleMwpl(5)[1].mwplPct);
    expect(sampleBanList("2026-10-17", 5).symbols).toEqual(a.filter((r) => r.banned).map((r) => r.symbol).sort());
    expect(sampleDeals("block", "2026-10-17")).toHaveLength(5);
    const r = seededRandom(1);
    const x = r();
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(1);
  });
});
