import { describe, expect, it } from "vitest";
import { atmIV, atmStraddle, forwardFromSpot, generateSampleChain, getDividendYield, timeToExpiryYears, toISTDate } from "@/lib/options";
import { snapshotToChain } from "@/lib/snapshotStore";
import { analyseStraddle, straddleSeries } from "./expiryMath";
import { SAMPLE_SESSION_R, sampleSessionAnchor, simulateExpirySession } from "./expirySample";

const CASES = [
  { symbol: "NIFTY", spot: 25_012.4, expiry: "2026-11-03", now: toISTDate("2026-11-03", "11:47") },
  { symbol: "SENSEX", spot: 82_140, expiry: "2026-11-05", now: toISTDate("2026-11-04", "14:05") },
  { symbol: "BANKNIFTY", spot: 56_230, expiry: "2026-11-24", now: toISTDate("2026-11-04", "20:30") },
];

describe("simulateExpirySession anchoring", () => {
  for (const c of CASES) {
    it(`ends on the sample chain's ATM straddle (${c.symbol}, ${c.now.toISOString()})`, () => {
      const snaps = simulateExpirySession({ symbol: c.symbol, spot: c.spot, expiry: c.expiry, now: c.now });
      expect(snaps.length).toBeGreaterThan(10);
      const { chain } = generateSampleChain({ symbol: c.symbol, spot: c.spot, expiry: c.expiry, now: c.now });
      const last = snaps[snaps.length - 1];
      expect(last.spot).toBe(c.spot);

      const fromChain = atmStraddle(chain, c.spot);
      const fromSession = atmStraddle(snapshotToChain(last), last.spot);
      expect(fromSession.strike).toBe(fromChain.strike);
      expect(fromSession.straddle).toBe(fromChain.straddle);

      // The straddle panels (floating ATM) report the same number at "now".
      const a = analyseStraddle(snaps, { expiry: c.expiry, r: SAMPLE_SESSION_R });
      expect(a.last!.strike).toBe(fromChain.strike);
      expect(a.last!.straddle).toBeCloseTo(fromChain.straddle, 9);

      // Every leg of the last snapshot is the chain's quote.
      const row = chain.find((r) => r.strikePrice === fromChain.strike)!;
      const ce = last.rows.find((r) => r.strike === row.strikePrice && r.side === "CE")!;
      expect(ce.ltp).toBe(row.ce.ltp);
      expect(ce.iv).toBe(row.ce.iv);
      expect(ce.oi).toBe(row.ce.oi);
    });
  }

  it("opens with an IV a little above the chain's ATM IV", () => {
    const c = CASES[0];
    const snaps = simulateExpirySession({ symbol: c.symbol, spot: c.spot, expiry: c.expiry, now: c.now });
    const anchor = sampleSessionAnchor(c);
    const q = getDividendYield(c.symbol);
    const ivNow = atmIV(anchor.chain, forwardFromSpot(c.spot, timeToExpiryYears(c.expiry, c.now), SAMPLE_SESSION_R, q));
    const first = snaps[0];
    const ivOpen = atmIV(snapshotToChain(first), forwardFromSpot(first.spot, timeToExpiryYears(c.expiry, new Date(first.ts)), SAMPLE_SESSION_R, q));
    expect(ivOpen / ivNow).toBeGreaterThan(1.005);
    expect(ivOpen / ivNow).toBeLessThan(1.1);
  });

  it("is deterministic and decays through an expiry day", () => {
    const now = toISTDate("2026-11-03", "15:25");
    const a = simulateExpirySession({ symbol: "NIFTY", spot: 25_000, expiry: "2026-11-03", now });
    const b = simulateExpirySession({ symbol: "NIFTY", spot: 25_000, expiry: "2026-11-03", now });
    expect(a).toEqual(b);
    const pts = straddleSeries(a);
    expect(pts[0].straddle).toBeGreaterThan(pts[pts.length - 1].straddle * 1.5);
  });

  it("returns nothing for unusable inputs or an expired contract", () => {
    expect(simulateExpirySession({ symbol: "NIFTY", spot: 0, expiry: "2026-11-03" })).toEqual([]);
    expect(simulateExpirySession({ symbol: "NIFTY", spot: 25_000, expiry: "" })).toEqual([]);
    expect(simulateExpirySession({ symbol: "NIFTY", spot: 25_000, expiry: "2026-10-27", now: toISTDate("2026-11-04", "12:00") })).toEqual([]);
  });
});
