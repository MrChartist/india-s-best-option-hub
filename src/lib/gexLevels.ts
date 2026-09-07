// Per-strike Gamma Exposure (GEX) and dealer-positioning levels — derived
// entirely from the live option chain's real per-strike gamma × OI. No mock
// data, no random fallback: when the chain carries no real Greeks (see the
// NSE-fallback note in getGexLevels below), this reports "no levels" rather
// than presenting a meaningless number as if it were real.

import type { OptionData } from "./mockData";

export interface StrikeGEX {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
}

export interface SecondaryLevel {
  strike: number;
  netGEX: number;
  side: "call" | "put";
}

export interface GexLevels {
  callWall: number;
  putWall: number;
  /** Interpolated gamma-flip price; null when the chain has no sign crossing. */
  zeroGamma: number | null;
  /** Next-most-notable strikes by |netGEX|, excluding callWall/putWall. */
  secondaryLevels: SecondaryLevel[];
  byStrike: StrikeGEX[];
}

const SECONDARY_LEVEL_COUNT = 4;

/**
 * Per-strike GEX in ₹ Crore notional — gamma × OI × lot size × spot² × 0.01,
 * the standard "dealer dollar-gamma per 1% underlying move" convention. Puts
 * are signed negative (dealers are typically short gamma against put OI).
 */
export function calculateStrikeGEX(chain: OptionData[], spotPrice: number, lotSize: number): StrikeGEX[] {
  const spotSq = spotPrice * spotPrice;
  return chain
    .map((row) => {
      const callGEX = (row.ce.gamma * row.ce.oi * lotSize * spotSq * 0.01) / 1e7;
      const putGEX = -(row.pe.gamma * row.pe.oi * lotSize * spotSq * 0.01) / 1e7;
      return { strike: row.strikePrice, callGEX, putGEX, netGEX: callGEX + putGEX };
    })
    .sort((a, b) => a.strike - b.strike);
}

export function getGexLevels(chain: OptionData[], spotPrice: number, lotSize: number): GexLevels | null {
  if (chain.length === 0 || spotPrice <= 0) return null;

  // NSE's fallback chain (used when no broker is connected — see
  // parseNSEOptionChain in marketApi.ts) carries no Greeks at all; every
  // gamma is hardcoded to 0 because NSE's payload doesn't include them.
  // Computing "levels" over an all-zero array would just be argmax(0) — the
  // first strike in the chain — presented as if it meant something. Bail out.
  const totalAbsGamma = chain.reduce((s, o) => s + Math.abs(o.ce.gamma) + Math.abs(o.pe.gamma), 0);
  if (totalAbsGamma === 0) return null;

  const byStrike = calculateStrikeGEX(chain, spotPrice, lotSize);

  let callWall = byStrike[0].strike;
  let maxCallGEX = -Infinity;
  let putWall = byStrike[0].strike;
  let maxAbsPutGEX = -Infinity;
  for (const s of byStrike) {
    if (s.callGEX > maxCallGEX) {
      maxCallGEX = s.callGEX;
      callWall = s.strike;
    }
    if (Math.abs(s.putGEX) > maxAbsPutGEX) {
      maxAbsPutGEX = Math.abs(s.putGEX);
      putWall = s.strike;
    }
  }

  // Zero Gamma: the (interpolated) strike where cumulative net GEX flips
  // sign — the dealer long/short-gamma boundary. A noisy chain can cross
  // more than once; keep whichever crossing sits nearest spot, since that's
  // the one actually relevant to current price action.
  let zeroGamma: number | null = null;
  let minDistToSpot = Infinity;
  for (let i = 1; i < byStrike.length; i++) {
    const prev = byStrike[i - 1];
    const curr = byStrike[i];
    const crosses = (prev.netGEX < 0 && curr.netGEX >= 0) || (prev.netGEX >= 0 && curr.netGEX < 0);
    if (!crosses) continue;
    const denom = Math.abs(prev.netGEX) + Math.abs(curr.netGEX);
    const frac = denom === 0 ? 0.5 : Math.abs(prev.netGEX) / denom;
    const interpolated = prev.strike + frac * (curr.strike - prev.strike);
    const dist = Math.abs(interpolated - spotPrice);
    if (dist < minDistToSpot) {
      minDistToSpot = dist;
      zeroGamma = interpolated;
    }
  }

  const excluded = new Set([callWall, putWall]);
  const secondaryLevels: SecondaryLevel[] = byStrike
    .filter((s) => !excluded.has(s.strike))
    .sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
    .slice(0, SECONDARY_LEVEL_COUNT)
    .map((s) => ({ strike: s.strike, netGEX: s.netGEX, side: s.netGEX >= 0 ? ("call" as const) : ("put" as const) }));

  return { callWall, putWall, zeroGamma, secondaryLevels, byStrike };
}
