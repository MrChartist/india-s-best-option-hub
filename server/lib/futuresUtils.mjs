/** Pure helpers for interpreting futures price/OI moves — shared by the
 * futures-quotes backend endpoint and (via the same label set) the frontend scanner. */

/**
 * Standard NSE F&O buildup classification. Thresholds guard against
 * classifying sub-noise wobbles (e.g. 0.01% price tick) as a real signal.
 */
export function classifyBuildup(priceChangePercent, oiChangePercent) {
  if (!Number.isFinite(priceChangePercent) || !Number.isFinite(oiChangePercent)) return "Neutral";
  const priceUp = priceChangePercent > 0.05;
  const priceDown = priceChangePercent < -0.05;
  const oiUp = oiChangePercent > 0.5;
  const oiDown = oiChangePercent < -0.5;
  if (priceUp && oiUp) return "Long Buildup";
  if (priceDown && oiUp) return "Short Buildup";
  if (priceUp && oiDown) return "Short Covering";
  if (priceDown && oiDown) return "Long Unwinding";
  return "Neutral";
}

export function computeBasis(futuresLtp, spotLtp) {
  if (!Number.isFinite(futuresLtp) || !Number.isFinite(spotLtp) || spotLtp === 0) {
    return { basis: null, basisPercent: null };
  }
  const basis = Math.round((futuresLtp - spotLtp) * 100) / 100;
  const basisPercent = Math.round((basis / spotLtp) * 10000) / 100;
  return { basis, basisPercent };
}
