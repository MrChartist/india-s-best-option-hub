import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import { buildSymbolMarket, chainPCR, strikeOI } from "../alertContext";

describe("buildSymbolMarket", () => {
  const now = toISTDate("2026-10-16", "11:00");
  const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now });
  const feed = {
    symbol: "NIFTY",
    expiry: "2026-10-20",
    chain,
    spot: 25_000,
    asOf: now.getTime(),
    lotSize: 65,
    mode: "live" as const,
  };

  it("computes PCR, ATM IV, max pain and walls from the chain", () => {
    const history = Array.from({ length: 40 }, (_, i) => 8 + i * 0.4);
    const m = buildSymbolMarket(feed, { now, ivHistory: history, withFlip: true });
    expect(m).not.toBeNull();
    expect(m!.pcr).toBeCloseTo(chainPCR(chain));
    expect(m!.atmIv).toBeGreaterThan(5);
    expect(m!.ivp).not.toBeNull();
    expect(m!.maxPain).toBeGreaterThan(0);
    expect(m!.strikes).toHaveLength(strikeOI(chain).length);
    expect(m!.gammaFlip === null || Number.isFinite(m!.gammaFlip)).toBe(true);
  });

  it("never builds context from sample feeds", () => {
    expect(buildSymbolMarket({ ...feed, mode: "sample" })).toBeNull();
  });

  it("leaves IVP null without history", () => {
    expect(buildSymbolMarket(feed, { now })!.ivp).toBeNull();
  });
});

import { isChainRow, isUsableFeed } from "../alertContext";

describe("alert context guards and extras", () => {
  const now = toISTDate("2026-10-16", "11:00");
  const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now });
  const feed = {
    symbol: "NIFTY",
    expiry: "2026-10-20",
    chain,
    spot: 25_000,
    asOf: now.getTime(),
    lotSize: 65,
    mode: "recorded" as const,
  };

  it("guards feeds and rows instead of trusting them", () => {
    expect(isUsableFeed(feed)).toBe(true);
    expect(isUsableFeed({ ...feed, spot: 0 })).toBe(false);
    expect(isUsableFeed({ ...feed, chain: [] })).toBe(false);
    expect(isUsableFeed({ ...feed, mode: "sample" })).toBe(false);
    expect(isUsableFeed(null)).toBe(false);
    expect(isChainRow({ strikePrice: 1, ce: {}, pe: {} })).toBe(true);
    expect(isChainRow({ strikePrice: "1" })).toBe(false);
    const withJunk = { ...feed, chain: [...chain, { strikePrice: NaN } as unknown as (typeof chain)[number]] };
    expect(buildSymbolMarket(withJunk, { now })!.strikes).toHaveLength(chain.length);
  });

  it("adds per-strike quotes, the expiry and the tide when prints are given", () => {
    const m = buildSymbolMarket(feed, { now, prints: [] })!;
    expect(m.expiry).toBe("2026-10-20");
    expect(m.quotes).toHaveLength(chain.length);
    expect(m.tideNet).toBeUndefined();
  });
});
