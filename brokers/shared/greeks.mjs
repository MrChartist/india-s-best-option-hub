/**
 * Black-Scholes-Merton: closed-form Greeks + Newton-Raphson IV solver.
 * Used by adapters whose broker does not return IV/Greeks (e.g. Kite Connect).
 *
 * Conventions:
 *   - r is the annualized risk-free rate (default 6.5% — Indian context)
 *   - q is the annualized dividend yield (default 0; indices ≈ 0)
 *   - T is time to expiry in YEARS
 *   - σ (sigma) is annualized implied volatility (decimal, e.g. 0.18 = 18%)
 *   - All prices in INR
 */

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF */
function pdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Abramowitz-Stegun 7.1.26 cumulative normal */
function cdf(x) {
  // |x| should be modest in finance; this is good to ~1e-7
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Compute closed-form BSM price + Greeks.
 * @param {"CE"|"PE"} type
 * @param {number} S spot
 * @param {number} K strike
 * @param {number} T years
 * @param {number} r risk-free rate
 * @param {number} q dividend yield
 * @param {number} sigma implied volatility (decimal)
 */
export function bsmGreeks(type, S, K, T, r, q, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    const intrinsic = type === "CE" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: 0, gamma: 0, theta: 0, vega: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const Nd1 = cdf(d1);
  const Nd2 = cdf(d2);
  const nd1 = pdf(d1);

  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);

  let price, delta, theta;
  if (type === "CE") {
    price = S * eqT * Nd1 - K * erT * Nd2;
    delta = eqT * Nd1;
    theta = (-(S * eqT * nd1 * sigma) / (2 * sqrtT) - r * K * erT * Nd2 + q * S * eqT * Nd1) / 365;
  } else {
    price = K * erT * cdf(-d2) - S * eqT * cdf(-d1);
    delta = -eqT * cdf(-d1);
    theta = (-(S * eqT * nd1 * sigma) / (2 * sqrtT) + r * K * erT * cdf(-d2) - q * S * eqT * cdf(-d1)) / 365;
  }

  const gamma = (eqT * nd1) / (S * sigma * sqrtT);
  const vega = (S * eqT * nd1 * sqrtT) / 100; // per 1% change in IV

  return { price, delta, gamma, theta, vega };
}

/**
 * Newton-Raphson IV solver. Returns IV in decimal (e.g. 0.182 for 18.2%) or 0 if it can't converge.
 * @param {"CE"|"PE"} type
 * @param {number} marketPrice mid-price of the option
 * @param {number} S
 * @param {number} K
 * @param {number} T years
 * @param {number} r
 * @param {number} q
 */
export function impliedVolatility(type, marketPrice, S, K, T, r = 0.065, q = 0) {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return 0;
  if (T <= 0 || S <= 0 || K <= 0) return 0;

  // Intrinsic floor — if market price below intrinsic, can't solve
  const intrinsic = type === "CE" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (marketPrice <= intrinsic) return 0;

  // Initial guess via Brenner-Subrahmanyam (works well ATM)
  let sigma = Math.sqrt((2 * Math.PI) / T) * (marketPrice / S);
  if (!Number.isFinite(sigma) || sigma <= 0) sigma = 0.3;
  sigma = Math.min(Math.max(sigma, 0.01), 5.0);

  const MAX_ITER = 50;
  const TOL = 1e-4;

  for (let i = 0; i < MAX_ITER; i++) {
    const { price, vega } = bsmGreeks(type, S, K, T, r, q, sigma);
    const diff = price - marketPrice;
    if (Math.abs(diff) < TOL) return sigma;
    const vegaPerUnit = vega * 100; // bsmGreeks returns per-1% — convert back to per-unit
    if (vegaPerUnit < 1e-8) break;
    sigma = sigma - diff / vegaPerUnit;
    if (!Number.isFinite(sigma) || sigma <= 0) {
      sigma = 0.3;
      break;
    }
    if (sigma > 5.0) sigma = 5.0;
  }

  return sigma > 0.01 && sigma < 5 ? sigma : 0;
}

/**
 * High-level helper: given option market data, compute IV + Greeks in one shot.
 * Returns the unified leg shape (iv as percentage, others raw).
 * @param {"CE"|"PE"} type
 * @param {number} mid mid-price (or LTP fallback)
 * @param {number} S spot
 * @param {number} K strike
 * @param {Date|number|string} expiryDate
 * @param {number} [r] risk-free rate (default 6.5%)
 */
export function computeLegMetrics(type, mid, S, K, expiryDate, r = 0.065) {
  const expiryMs = typeof expiryDate === "number"
    ? expiryDate
    : new Date(expiryDate).getTime();
  const T = Math.max((expiryMs - Date.now()) / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24));
  const iv = impliedVolatility(type, mid, S, K, T, r, 0);
  if (iv <= 0) return { iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };

  const { delta, gamma, theta, vega } = bsmGreeks(type, S, K, T, r, 0, iv);
  return {
    iv: iv * 100, // store as percentage to match Dhan's convention
    delta,
    gamma,
    theta,
    vega,
  };
}
