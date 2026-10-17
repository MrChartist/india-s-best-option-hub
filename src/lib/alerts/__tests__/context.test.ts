import { describe, expect, it } from "vitest";
import { generateSampleChain, toISTDate } from "@/lib/options";
import type { FlowPrint } from "@/lib/flow/types";
import type { TrackedPosition } from "@/lib/positionStore";
import { ANY_SYMBOL, buildPortfolio, latestTideNet, strikeQuotes } from "@/lib/alerts";

const now = toISTDate("2026-10-16", "11:00");
const { chain } = generateSampleChain({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-20", now });

const pos = (o: Partial<TrackedPosition>): TrackedPosition => ({
  id: "p1",
  symbol: "NIFTY",
  type: "CE",
  action: "BUY",
  strike: 25_000,
  lots: 2,
  entryPrice: 100,
  currentPrice: 0,
  lotSize: 65,
  entryDate: "16 Oct",
  expiry: "2026-10-20",
  pnl: 0,
  pnlPercent: 0,
  delta: 0,
  theta: 0,
  iv: 0,
  ...o,
});

describe("buildPortfolio", () => {
  const feed = { symbol: "NIFTY", expiry: "2026-10-20", asOf: 1234, chain };
  const row = chain.find((r) => r.strikePrice === 25_000)!;

  it("marks legs from the live chain with signed quantity", () => {
    const p = buildPortfolio([pos({}), pos({ id: "p2", action: "SELL", type: "PE", lots: 1 })], [feed]);
    const qty = 2 * 65;
    const expectedPnl = (row.ce.ltp - 100) * qty + (100 - row.pe.ltp) * 65;
    expect(p.NIFTY.pnl).toBeCloseTo(expectedPnl, 6);
    expect(p.NIFTY.delta).toBeCloseTo(row.ce.delta * qty - row.pe.delta * 65, 6);
    expect(p[ANY_SYMBOL]).toEqual(p.NIFTY);
    expect(p.NIFTY).toMatchObject({ legs: 2, marked: 2, ts: 1234 });
  });

  it("leaves legs unmarked when the expiry or underlying has no live chain", () => {
    const p = buildPortfolio(
      [pos({}), pos({ id: "p3", expiry: "2026-10-27" }), pos({ id: "p4", symbol: "TCS", strike: 4000 })],
      [feed],
    );
    expect(p.NIFTY).toMatchObject({ legs: 2, marked: 1 });
    expect(p.TCS).toMatchObject({ legs: 1, marked: 0, pnl: 0, ts: 0 });
    expect(p[ANY_SYMBOL]).toMatchObject({ legs: 3, marked: 1 });
  });

  it("ignores malformed positions", () => {
    expect(buildPortfolio([pos({ lots: 0 })], [feed])).toEqual({});
  });
});

describe("strikeQuotes and latestTideNet", () => {
  it("maps chain rows to quotes", () => {
    const q = strikeQuotes(chain);
    expect(q).toHaveLength(chain.length);
    expect(q[0]).toMatchObject({ strike: chain[0].strikePrice, ce: { ltp: chain[0].ce.ltp } });
  });

  it("takes the latest cumulative net premium for one symbol", () => {
    const p = (ts: number, o: Partial<FlowPrint>): FlowPrint =>
      ({
        id: `p${ts}`,
        ts,
        fromTs: ts - 1,
        symbol: "NIFTY",
        expiry: "2026-10-20",
        strike: 25_000,
        type: "CE",
        dVol: 1,
        premium: 100,
        ltp: 1,
        bid: 1,
        ask: 1,
        aggressor: "ASK",
        aggressorBasis: "quote",
        dOI: 1,
        tag: "OPENING",
        dte: 3,
        moneyness: "ATM",
        spot: 25_000,
        lotSize: 65,
        ...o,
      }) as FlowPrint;
    const prints = [p(1, {}), p(2, { type: "PE", premium: 300 }), p(3, { symbol: "BANKNIFTY", premium: 9_999 })];
    expect(latestTideNet(prints, "NIFTY")).toBe(100 - 300);
    expect(latestTideNet(prints, "SENSEX")).toBeUndefined();
  });
});
