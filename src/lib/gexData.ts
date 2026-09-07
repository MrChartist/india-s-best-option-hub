// Expected Move calculator — real, operates only on live chain data passed in
// by the caller (see ExpectedMoveWidget.tsx for the consumer).
//
// The GEX (Gamma Exposure) engine that used to live in this file was pulled —
// deferred to a future version — along with the IV Percentile/Term Structure
// widgets that shared its page. See git history for calculateGEX/getGEXSummary
// if that work resumes.
//
// The seeded-random 52-week IV rank generators that used to live in this file
// (generateIVRankData/generateMultiSymbolIVRank) were removed rather than wired
// into a live view — there was no real 52-week IV history source to back them,
// and CONTRIBUTING.md's "no mock data" rule means an honest gap beats a fake
// number. See TopBuildupSignals.tsx for what replaced the widget that used them.

export interface ExpectedMoveData {
  symbol: string;
  spotPrice: number;
  iv: number;
  daysToExpiry: number;
  expectedMove: number;      // ±1σ in points
  expectedMovePercent: number;
  upperBound1SD: number;
  lowerBound1SD: number;
  upperBound2SD: number;
  lowerBound2SD: number;
  straddlePrice: number;     // ATM straddle as market-implied move
}

// ── Expected Move Calculator ──

export function calculateExpectedMove(
  spotPrice: number,
  iv: number,         // annualized IV as percentage (e.g., 13.5)
  daysToExpiry: number,
  straddlePrice?: number
): ExpectedMoveData {
  // Expected Move = Spot × IV% × √(DTE/365)
  const ivDecimal = iv / 100;
  const sqrtTime = Math.sqrt(daysToExpiry / 365);
  const expectedMove = spotPrice * ivDecimal * sqrtTime;
  const expectedMovePercent = ivDecimal * sqrtTime * 100;

  return {
    symbol: "",
    spotPrice,
    iv,
    daysToExpiry,
    expectedMove: Math.round(expectedMove * 100) / 100,
    expectedMovePercent: Math.round(expectedMovePercent * 100) / 100,
    upperBound1SD: Math.round((spotPrice + expectedMove) * 100) / 100,
    lowerBound1SD: Math.round((spotPrice - expectedMove) * 100) / 100,
    upperBound2SD: Math.round((spotPrice + expectedMove * 2) * 100) / 100,
    lowerBound2SD: Math.round((spotPrice - expectedMove * 2) * 100) / 100,
    straddlePrice: straddlePrice || Math.round(expectedMove * 0.85 * 100) / 100, // straddle is usually ~85% of 1SD
  };
}
