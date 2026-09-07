/**
 * Black-Scholes IV solver + Greeks — for brokers whose quote APIs don't return
 * implied volatility or Greeks natively (Zerodha, 5paisa, Alice Blue).
 *
 * Output convention matches Dhan's option-chain response (the app's reference
 * schema): iv as a percentage number (e.g. 14.2, not 0.142), delta/gamma/theta
 * raw decimals, vega per 1% change in vol, theta per calendar day.
 */

const DAYS_PER_YEAR = 365;
const DEFAULT_RATE = 0.065; // ~India 91-day T-bill, used as a stable risk-free proxy

function normCDF(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsPrice({ spot, strike, rate, vol, years, type }) {
  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  if (years <= 0 || vol <= 0) return intrinsic;
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * Math.sqrt(years));
  const d2 = d1 - vol * Math.sqrt(years);
  if (type === "CE") return spot * normCDF(d1) - strike * Math.exp(-rate * years) * normCDF(d2);
  return strike * Math.exp(-rate * years) * normCDF(-d2) - spot * normCDF(-d1);
}

/** Bisection IV solve — stable across deep ITM/OTM where Newton-Raphson can diverge. */
function solveIV({ price, spot, strike, daysToExpiry, type, rate = DEFAULT_RATE }) {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(daysToExpiry >= 0)) return null;
  const years = Math.max(daysToExpiry, 0.25) / DAYS_PER_YEAR;

  const intrinsic = type === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  if (price < intrinsic - 0.01) return null; // below intrinsic value — bad/stale quote

  let lo = 0.001, hi = 5.0;
  const priceAtHi = bsPrice({ spot, strike, rate, vol: hi, years, type });
  if (priceAtHi < price) return null; // even 500% vol can't explain this price

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const p = bsPrice({ spot, strike, rate, vol: mid, years, type });
    if (p > price) hi = mid; else lo = mid;
  }
  const iv = (lo + hi) / 2;
  return iv >= 4.99 ? null : iv;
}

function computeGreeks({ spot, strike, daysToExpiry, type, vol, rate = DEFAULT_RATE }) {
  const years = Math.max(daysToExpiry, 0.25) / DAYS_PER_YEAR;
  if (!(vol > 0) || !(spot > 0) || !(strike > 0)) return { delta: 0, gamma: 0, theta: 0, vega: 0 };

  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * years) / (vol * Math.sqrt(years));
  const d2 = d1 - vol * Math.sqrt(years);
  const pdf = normPDF(d1);

  const delta = type === "CE" ? normCDF(d1) : normCDF(d1) - 1;
  const gamma = pdf / (spot * vol * Math.sqrt(years));
  const vega = (spot * pdf * Math.sqrt(years)) / 100; // per 1 vol-point (1%) change

  const decayTerm = -(spot * pdf * vol) / (2 * Math.sqrt(years));
  const theta = type === "CE"
    ? (decayTerm - rate * strike * Math.exp(-rate * years) * normCDF(d2)) / DAYS_PER_YEAR
    : (decayTerm + rate * strike * Math.exp(-rate * years) * normCDF(-d2)) / DAYS_PER_YEAR;

  return { delta, gamma, theta, vega };
}

/**
 * Given a traded LTP, back out IV then compute Greeks from it.
 * Returns zeros (not nulls) when the price is unusable, so callers can spread
 * the result directly into a leg object without extra null-checking.
 */
export function computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type, rate = DEFAULT_RATE }) {
  const iv = solveIV({ price: ltp, spot, strike, daysToExpiry, type, rate });
  if (iv == null) return { iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  const greeks = computeGreeks({ spot, strike, daysToExpiry, type, vol: iv, rate });
  return { iv: iv * 100, ...greeks };
}

export function daysBetween(fromDate, toDateStr) {
  const to = new Date(`${toDateStr}T15:30:00+05:30`);
  const ms = to.getTime() - fromDate.getTime();
  return ms / (1000 * 60 * 60 * 24);
}
