import { describe, expect, it } from "vitest";
import {
  buildSuggestedLegs,
  netPremiumPerUnit,
  pickExpiry,
  strikeOffset,
  suggestionFor,
  SUGGESTION_META,
} from "../suggest";
import { sampleSuggestionChain } from "../suggestChain";
import { nearBanRows, presetCounts } from "../presets";
import { sampleRows } from "../sample";
import type { ScreenerRow } from "../metrics";

const NOW = new Date("2026-10-15T05:00:00Z"); // Thu 15 Oct 2026, 10:30 IST

function row(p: Partial<ScreenerRow>): ScreenerRow {
  return {
    ...sampleRows()[0],
    symbol: "RELIANCE",
    kind: "STOCK",
    ltp: 1400,
    atmIv: 28,
    ivHvRatio: 1.1,
    buildup: "NEUTRAL",
    ...p,
  };
}

describe("suggestionFor", () => {
  it("follows the active preset", () => {
    expect(suggestionFor(row({}), "iv-crush")?.kind).toBe("short-strangle");
    expect(suggestionFor(row({}), "cheap-vol")?.kind).toBe("long-straddle");
    expect(suggestionFor(row({}), "long-buildup")?.kind).toBe("bull-call-spread");
    expect(suggestionFor(row({}), "short-buildup")?.kind).toBe("bear-put-spread");
  });

  it("falls back to the row's own signals without a preset", () => {
    expect(suggestionFor(row({ ivHvRatio: 1.45 }), null)?.kind).toBe("short-strangle");
    expect(suggestionFor(row({ ivHvRatio: 0.8 }), null)?.kind).toBe("long-straddle");
    expect(suggestionFor(row({ ivHvRatio: 1.1, buildup: "LONG_BUILDUP" }), null)?.kind).toBe("bull-call-spread");
    expect(suggestionFor(row({ ivHvRatio: null, buildup: "SHORT_BUILDUP" }), null)?.kind).toBe("bear-put-spread");
    expect(suggestionFor(row({ ivHvRatio: 1.1, buildup: "SHORT_COVERING" }), null)).toBeNull();
    // A preset with no structure (near ban) uses the row's signals.
    expect(suggestionFor(row({ ivHvRatio: 0.9 }), "near-ban")?.kind).toBe("long-straddle");
  });

  it("explains the IV/HV ratio in the rationale", () => {
    expect(suggestionFor(row({ ivHvRatio: 1.52 }), "iv-crush")?.rationale).toMatch(/1\.52× the 20-day HV/);
  });
});

describe("pickExpiry", () => {
  it("skips an expiry with fewer than five days left", () => {
    // RELIANCE monthly: Tue 27 Oct 2026 is 12 days out, so it is used.
    expect(pickExpiry("RELIANCE", NOW)).toBe("2026-10-27");
    // On 24 Oct only 3 days remain, so the November monthly is chosen (Tue 24 Nov is a holiday, so Mon 23 Nov).
    expect(pickExpiry("RELIANCE", new Date("2026-10-24T05:00:00Z"))).toBe("2026-11-23");
  });
});

describe("buildSuggestedLegs on a sample chain", () => {
  const r = row({});
  const expiry = pickExpiry(r.symbol, NOW) as string;
  const model = sampleSuggestionChain(r, expiry, NOW);

  it("builds a sample model around the row's price", () => {
    expect(model).not.toBeNull();
    expect(model!.rows.length).toBeGreaterThan(20);
    expect(Math.abs(model!.atmStrike - 1400)).toBeLessThanOrEqual(10);
  });

  it("short strangle: sells two OTM legs and buys wings further out", () => {
    const s = buildSuggestedLegs({ ...SUGGESTION_META["short-strangle"], rationale: "" }, model!, r.symbol, expiry);
    expect(s.error).toBeUndefined();
    expect(s.legs).toHaveLength(4);
    const [ceS, peS, ceL, peL] = s.legs;
    expect([ceS.side, ceS.type, peS.side, peS.type]).toEqual(["SELL", "CE", "SELL", "PE"]);
    expect([ceL.side, ceL.type, peL.side, peL.type]).toEqual(["BUY", "CE", "BUY", "PE"]);
    expect(ceS.strike).toBeGreaterThan(model!.spot);
    expect(peS.strike).toBeLessThan(model!.spot);
    expect(ceL.strike).toBeGreaterThan(ceS.strike);
    expect(peL.strike).toBeLessThan(peS.strike);
    // Roughly 16 delta: the short call's delta is between 0.08 and 0.3.
    const ceRow = model!.rows.find((x) => x.strike === ceS.strike)!;
    expect(ceRow.ce.leg.delta).toBeGreaterThan(0.08);
    expect(ceRow.ce.leg.delta).toBeLessThan(0.3);
    expect(s.legs.every((l) => l.symbol === "RELIANCE" && l.expiry === expiry && l.lots === 1)).toBe(true);
    // An iron condor collects a credit.
    expect(netPremiumPerUnit(s.legs).net).toBeGreaterThan(0);
  });

  it("long straddle: buys the ATM call and put", () => {
    const s = buildSuggestedLegs({ ...SUGGESTION_META["long-straddle"], rationale: "" }, model!, r.symbol, expiry);
    expect(s.legs.map((l) => `${l.side} ${l.type} ${l.strike}`)).toEqual([
      `BUY CE ${model!.atmStrike}`,
      `BUY PE ${model!.atmStrike}`,
    ]);
    expect(netPremiumPerUnit(s.legs).net).toBeLessThan(0);
  });

  it("bull call and bear put spreads are debit spreads away from ATM", () => {
    const bull = buildSuggestedLegs(
      { ...SUGGESTION_META["bull-call-spread"], rationale: "" },
      model!,
      r.symbol,
      expiry,
    ).legs;
    expect(bull.map((l) => `${l.side} ${l.type}`)).toEqual(["BUY CE", "SELL CE"]);
    expect(bull[1].strike).toBeGreaterThan(bull[0].strike);
    expect(netPremiumPerUnit(bull).net).toBeLessThan(0);
    const bear = buildSuggestedLegs(
      { ...SUGGESTION_META["bear-put-spread"], rationale: "" },
      model!,
      r.symbol,
      expiry,
    ).legs;
    expect(bear.map((l) => `${l.side} ${l.type}`)).toEqual(["BUY PE", "SELL PE"]);
    expect(bear[1].strike).toBeLessThan(bear[0].strike);
  });

  it("reports an error instead of legs when the chain is too thin", () => {
    const thin = { ...model!, rows: model!.rows.slice(0, 3) };
    const s = buildSuggestedLegs({ ...SUGGESTION_META["long-straddle"], rationale: "" }, thin, r.symbol, expiry);
    expect(s.legs).toEqual([]);
    expect(s.error).toMatch(/too few strikes/);
  });

  it("strikeOffset clamps to the listed strikes", () => {
    const first = model!.rows[0].strike;
    expect(strikeOffset(model!.rows, first, -3)).toBe(first);
    expect(strikeOffset(model!.rows, first, 1)).toBe(model!.rows[1].strike);
    expect(strikeOffset(model!.rows, -1, 1)).toBeNaN();
  });
});

describe("netPremiumPerUnit", () => {
  it("counts credits positive and flags unpriced legs", () => {
    const base = { symbol: "X", expiry: "2026-10-27", strike: 100, type: "CE" as const, lots: 1, iv: null };
    expect(
      netPremiumPerUnit([
        { ...base, side: "SELL", premium: 10 },
        { ...base, side: "BUY", premium: 4.5 },
      ]),
    ).toEqual({ net: 5.5, unpriced: 0 });
    expect(netPremiumPerUnit([{ ...base, side: "BUY", premium: 0 }]).unpriced).toBe(1);
  });
});

describe("near-ban preset", () => {
  it("excludes banned names so it matches the KPI tile", () => {
    const rows = sampleRows();
    const kpi = rows.filter((r) => !r.banned && r.mwplPct !== null && r.mwplPct >= 80).length;
    expect(rows.some((r) => r.banned)).toBe(true);
    expect(nearBanRows(rows)).toHaveLength(kpi);
    expect(presetCounts(rows)["near-ban"]).toBe(kpi);
    expect(nearBanRows(rows).every((r) => !r.banned)).toBe(true);
  });
});
