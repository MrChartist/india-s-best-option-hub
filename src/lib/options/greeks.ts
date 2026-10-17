/**
 * Analytic Greeks for BSM (spot) and Black-76 (forward).
 *
 * Conventions: theta in rupees per calendar day, thetaTrading per trading day
 * (theta * 365/252), vega per 1 vol point, rho per 1% rate, vanna = d(delta)/d(vol point),
 * charm = delta change per calendar day, vomma = d(vega per point)/d(vol point).
 */
import { d1d2, intrinsic } from "./blackScholes";
import { normCdf, normPdf } from "./normal";
import type { Black76Input, Greeks, Leg, PricingInput } from "./types";
import { NAN_GREEKS, ZERO_GREEKS, isLegEnabled, sideSign } from "./types";

const TRADING_DAY_FACTOR = 365 / 252;

function expiredGreeks(S: number, K: number, type: "CE" | "PE"): Greeks {
  const itm = intrinsic(S, K, type) > 0;
  const delta = itm ? (type === "CE" ? 1 : -1) : 0;
  return { ...ZERO_GREEKS, delta };
}

export function greeks(p: PricingInput): Greeks {
  const { S, K, T, r, sigma, type } = p ?? ({} as PricingInput);
  const q = p?.q ?? 0;
  if ([S, K, T, r, q, sigma].some((x) => typeof x !== "number" || Number.isNaN(x)) || S <= 0 || K <= 0) return { ...NAN_GREEKS };
  if (T <= 0 || sigma <= 0) return expiredGreeks(S, K, type);
  const { d1, d2 } = d1d2(S, K, T, r, q, sigma);
  const sqrtT = Math.sqrt(T);
  const dfR = Math.exp(-r * T);
  const dfQ = Math.exp(-q * T);
  const pdf1 = normPdf(d1);
  const isCall = type === "CE";

  const delta = isCall ? dfQ * normCdf(d1) : -dfQ * normCdf(-d1);
  const gamma = (dfQ * pdf1) / (S * sigma * sqrtT);
  const vegaRaw = S * dfQ * pdf1 * sqrtT; // per 1.00 vol
  const thetaYear = isCall
    ? (-S * dfQ * pdf1 * sigma) / (2 * sqrtT) - r * K * dfR * normCdf(d2) + q * S * dfQ * normCdf(d1)
    : (-S * dfQ * pdf1 * sigma) / (2 * sqrtT) + r * K * dfR * normCdf(-d2) - q * S * dfQ * normCdf(-d1);
  const rhoRaw = isCall ? K * T * dfR * normCdf(d2) : -K * T * dfR * normCdf(-d2);
  const vannaRaw = (-dfQ * pdf1 * d2) / sigma;
  const vommaRaw = (vegaRaw * d1 * d2) / sigma;
  // charm = -d(delta)/dT (per year); convert to per calendar day
  const common = (dfQ * pdf1 * (2 * (r - q) * T - d2 * sigma * sqrtT)) / (2 * T * sigma * sqrtT);
  const charmYear = isCall ? q * dfQ * normCdf(d1) - common : -q * dfQ * normCdf(-d1) - common;

  const theta = thetaYear / 365;
  return {
    delta,
    gamma,
    theta,
    thetaTrading: theta * TRADING_DAY_FACTOR,
    vega: vegaRaw / 100,
    rho: rhoRaw / 100,
    vanna: vannaRaw / 100,
    charm: charmYear / 365,
    vomma: vommaRaw / 10000,
  };
}

export function greeks76(p: Black76Input): Greeks {
  const { F, K, T, r, sigma, type } = p ?? ({} as Black76Input);
  if ([F, K, T, r, sigma].some((x) => typeof x !== "number" || Number.isNaN(x)) || F <= 0 || K <= 0) return { ...NAN_GREEKS };
  if (T <= 0 || sigma <= 0) return expiredGreeks(F, K, type);
  const { d1, d2 } = d1d2(F, K, T, 0, 0, sigma);
  const sqrtT = Math.sqrt(T);
  const df = Math.exp(-r * T);
  const pdf1 = normPdf(d1);
  const isCall = type === "CE";

  const delta = isCall ? df * normCdf(d1) : -df * normCdf(-d1);
  const gamma = (df * pdf1) / (F * sigma * sqrtT);
  const vegaRaw = F * df * pdf1 * sqrtT;
  const price = isCall ? df * (F * normCdf(d1) - K * normCdf(d2)) : df * (K * normCdf(-d2) - F * normCdf(-d1));
  // dV/dt (calendar time passing) = -dV/dT, with dV/dT = vega*sigma/(2T) - r*V
  const thetaYear = -((F * df * pdf1 * sigma) / (2 * sqrtT)) + r * price;
  const rhoRaw = -T * price; // F held fixed
  const vannaRaw = (-df * pdf1 * d2) / sigma;
  const vommaRaw = (vegaRaw * d1 * d2) / sigma;
  // delta = ±df*N(±d1); d(delta)/dT = -r*delta ± df*pdf1*dd1/dT, dd1/dT = -d2/(2T)
  const dd1dT = -d2 / (2 * T);
  const dDeltadT = -r * delta + df * pdf1 * dd1dT; // same sign for call and put
  const charmYear = -dDeltadT;

  const theta = thetaYear / 365;
  return {
    delta,
    gamma,
    theta,
    thetaTrading: theta * TRADING_DAY_FACTOR,
    vega: vegaRaw / 100,
    rho: rhoRaw / 100,
    vanna: vannaRaw / 100,
    charm: charmYear / 365,
    vomma: vommaRaw / 10000,
  };
}

/**
 * Black-76 Greeks re-expressed with SPOT held fixed, for index options settled on spot.
 *
 * greeks76 holds the forward F fixed as time passes. A trader's theta holds spot fixed, and then
 * F = S·e^{bT} drifts (b = r − q, the cost of carry, implied here from F/S). Writing V(S, t) =
 * V76(F(S, T), T) and differentiating:
 *   Δ_S = c·Δ_F,  Γ_S = c²·Γ_F,  with c = dF/dS = F/S
 *   Θ_S = Θ_F − b·F·Δ_F                     (dF/dt|S = −b·F)
 *   charm_S = c·(charm_F − b·F·Γ_F) − b·c·Δ_F (all per year before the per-day scaling)
 *   vanna_S = c·vanna_F,  rho_S = rho_F + T·F·Δ_F (dF/dr|S = T·F)
 * Vega and vomma are unchanged (F does not depend on σ). With b = r − q this matches BSM `greeks`
 * with dividend yield q exactly.
 */
export function greeks76Spot(p: Black76Input, S: number): Greeks {
  const g = greeks76(p);
  const { F, T } = p ?? ({} as Black76Input);
  if (!(typeof S === "number" && Number.isFinite(S) && S > 0) || !(T > 0) || !(F > 0) || !(p.sigma > 0)) return g;
  const c = F / S;
  const b = Math.log(c) / T;
  // Per-day theta/charm adjustments (greeks76 already divides its year values by 365).
  const thetaAdj = (b * F * g.delta) / 365;
  const theta = g.theta - thetaAdj;
  // greeks76 gamma is per 1 rupee of F; charm per calendar day.
  const charm = c * (g.charm - (b * F * g.gamma) / 365) - (b * c * g.delta) / 365;
  return {
    ...g,
    delta: g.delta * c,
    gamma: g.gamma * c * c,
    theta,
    thetaTrading: theta * TRADING_DAY_FACTOR,
    vanna: g.vanna * c,
    rho: g.rho + (T * F * g.delta) / 100,
    charm,
  };
}

/** Position Greeks: signed (SELL = -1), scaled by lots*lotSize. Disabled legs are skipped. */
export function positionGreeks(legs: Array<Leg & { greeks: Greeks }>): Greeks {
  const out: Greeks = { ...ZERO_GREEKS };
  const keys = Object.keys(out) as Array<keyof Greeks>;
  for (const leg of Array.isArray(legs) ? legs : []) {
    if (!leg || !isLegEnabled(leg) || !leg.greeks) continue;
    const mult = sideSign(leg.side) * (Number(leg.lots) || 0) * (Number(leg.lotSize) || 0);
    for (const k of keys) {
      const v = leg.greeks[k];
      if (Number.isFinite(v)) out[k] += v * mult;
    }
  }
  return out;
}
