/**
 * OI Analysis Utility Functions
 * 
 * Pure computation functions for Option Chain analysis.
 * These operate on live chain data — no mock data involved.
 */

// Re-export the OptionData type for convenience
export type { OptionData, OptionLegData } from "./mockData";
import type { OptionData } from "./mockData";

// ── Max Pain Calculator ──

export function getMaxPain(chain: OptionData[]): number {
  if (chain.length === 0) return 0;

  let minPain = Infinity;
  let maxPainStrike = chain[0]?.strikePrice || 0;

  for (const option of chain) {
    let totalPain = 0;
    for (const other of chain) {
      if (other.strikePrice < option.strikePrice) {
        totalPain += other.ce.oi * (option.strikePrice - other.strikePrice);
      } else if (other.strikePrice > option.strikePrice) {
        totalPain += other.pe.oi * (other.strikePrice - option.strikePrice);
      }
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = option.strikePrice;
    }
  }

  return maxPainStrike;
}

// ── Delta OI (OI × Delta directional exposure) ──

export interface DeltaOIData {
  strike: number;
  ceDeltaOI: number;
  peDeltaOI: number;
  netDeltaOI: number;
}

export function getDeltaOI(chain: OptionData[], spotPrice: number, stepSize: number): DeltaOIData[] {
  return chain
    .filter(o => o.ce.oi > 30000 || o.pe.oi > 30000)
    .map(o => {
      const ceDeltaOI = Math.round(o.ce.oi * o.ce.delta);
      const peDeltaOI = Math.round(o.pe.oi * o.pe.delta); // delta is negative for puts
      return {
        strike: o.strikePrice,
        ceDeltaOI: Math.round(ceDeltaOI / 1000),
        peDeltaOI: Math.round(peDeltaOI / 1000),
        netDeltaOI: Math.round((ceDeltaOI + peDeltaOI) / 1000),
      };
    });
}

// ── Strike-wise PCR ──

export interface StrikePCRData {
  strike: number;
  pcr: number;
  ceOI: number;
  peOI: number;
  distance: number;
}

export function getStrikePCR(chain: OptionData[], spotPrice: number): StrikePCRData[] {
  return chain
    .filter(o => o.ce.oi > 10000 && o.pe.oi > 10000)
    .map(o => ({
      strike: o.strikePrice,
      pcr: Math.round((o.pe.oi / o.ce.oi) * 100) / 100,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      distance: Math.round(((o.strikePrice - spotPrice) / spotPrice) * 10000) / 100,
    }));
}

// ── ATM Zone Analysis (nearest N strikes) ──

export interface ATMZoneData {
  strikes: number;
  totalCEOI: number;
  totalPEOI: number;
  pcr: number;
  totalCEOIChg: number;
  totalPEOIChg: number;
  ceOIChgPercent: number;
  peOIChgPercent: number;
  pcrChange: number;
  strikeData: {
    strike: number;
    ceOI: number;
    peOI: number;
    pcr: number;
    ceOIChg: number;
    peOIChg: number;
    ceOIChgPct: number;
    peOIChgPct: number;
  }[];
}

export function getATMZoneAnalysis(chain: OptionData[], spotPrice: number, stepSize: number, numStrikes: number = 5): ATMZoneData {
  const atmStrike = Math.round(spotPrice / stepSize) * stepSize;
  const halfRange = Math.floor(numStrikes / 2);
  const zoneStrikes = chain.filter(o => {
    const strikeDist = Math.abs(o.strikePrice - atmStrike) / stepSize;
    return strikeDist <= halfRange;
  });

  const totalCEOI = zoneStrikes.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = zoneStrikes.reduce((s, o) => s + o.pe.oi, 0);
  const totalCEOIChg = zoneStrikes.reduce((s, o) => s + o.ce.oiChange, 0);
  const totalPEOIChg = zoneStrikes.reduce((s, o) => s + o.pe.oiChange, 0);

  return {
    strikes: numStrikes,
    totalCEOI,
    totalPEOI,
    pcr: totalCEOI > 0 ? Math.round((totalPEOI / totalCEOI) * 100) / 100 : 0,
    totalCEOIChg,
    totalPEOIChg,
    ceOIChgPercent: totalCEOI > 0 ? Math.round((totalCEOIChg / totalCEOI) * 10000) / 100 : 0,
    peOIChgPercent: totalPEOI > 0 ? Math.round((totalPEOIChg / totalPEOI) * 10000) / 100 : 0,
    pcrChange: totalCEOIChg !== 0 ? Math.round((totalPEOIChg / Math.abs(totalCEOIChg)) * 100) / 100 : 0,
    strikeData: zoneStrikes.map(o => ({
      strike: o.strikePrice,
      ceOI: o.ce.oi,
      peOI: o.pe.oi,
      pcr: o.ce.oi > 0 ? Math.round((o.pe.oi / o.ce.oi) * 100) / 100 : 0,
      ceOIChg: o.ce.oiChange,
      peOIChg: o.pe.oiChange,
      ceOIChgPct: o.ce.oi > 0 ? Math.round((o.ce.oiChange / o.ce.oi) * 10000) / 100 : 0,
      peOIChgPct: o.pe.oi > 0 ? Math.round((o.pe.oiChange / o.pe.oi) * 10000) / 100 : 0,
    })),
  };
}

// ── IV Analysis Utilities ──

/**
 * Calculate current ATM IV from chain
 */
export function getATMIV(chain: OptionData[], spotPrice: number): { atmIV: number; atmStrike: number } {
  if (chain.length === 0) return { atmIV: 0, atmStrike: 0 };
  const sorted = [...chain].sort((a, b) =>
    Math.abs(a.strikePrice - spotPrice) - Math.abs(b.strikePrice - spotPrice)
  );
  const atm = sorted[0];
  const atmIV = (atm.ce.iv + atm.pe.iv) / 2;
  return { atmIV, atmStrike: atm.strikePrice };
}

/**
 * Calculate IV percentile from current chain's IV distribution across strikes
 * (uses cross-strike IV distribution as a proxy for historical percentile)
 */
export function getIVPercentileFromChain(chain: OptionData[], spotPrice: number): {
  percentile: number;
  rank: number;
  min: number;
  max: number;
  mean: number;
  atmIV: number;
} {
  if (chain.length === 0) return { percentile: 0, rank: 0, min: 0, max: 0, mean: 0, atmIV: 0 };

  const { atmIV } = getATMIV(chain, spotPrice);
  
  // Use all strike IVs for distribution
  const allIVs = chain
    .flatMap(o => [o.ce.iv, o.pe.iv])
    .filter(iv => iv > 0);
  
  if (allIVs.length === 0) return { percentile: 0, rank: 0, min: 0, max: 0, mean: 0, atmIV };

  const sorted = [...allIVs].sort((a, b) => a - b);
  const below = sorted.filter(v => v < atmIV).length;
  const percentile = Math.round((below / sorted.length) * 100);
  const min = Math.min(...allIVs);
  const max = Math.max(...allIVs);
  const mean = allIVs.reduce((s, v) => s + v, 0) / allIVs.length;
  const rank = max > min ? Math.round(((atmIV - min) / (max - min)) * 100) : 50;

  return {
    percentile,
    rank,
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    atmIV: Math.round(atmIV * 100) / 100,
  };
}

/**
 * IV Skew data for IV smile chart
 */
export function getIVSkew(chain: OptionData[]): {
  strike: number;
  callIV: number;
  putIV: number;
  avgIV: number;
}[] {
  return chain
    .filter(o => o.ce.iv > 0 || o.pe.iv > 0)
    .map(o => ({
      strike: o.strikePrice,
      callIV: o.ce.iv,
      putIV: o.pe.iv,
      avgIV: (o.ce.iv + o.pe.iv) / 2,
    }));
}

/**
 * Calculate PCR from chain data
 */
export function calculatePCR(chain: OptionData[]): {
  pcrOI: number;
  pcrVolume: number;
  totalCEOI: number;
  totalPEOI: number;
  totalCEVol: number;
  totalPEVol: number;
  signal: string;
  signalColor: string;
} {
  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const totalCEVol = chain.reduce((s, o) => s + o.ce.volume, 0);
  const totalPEVol = chain.reduce((s, o) => s + o.pe.volume, 0);
  
  const pcrOI = totalCEOI > 0 ? Math.round((totalPEOI / totalCEOI) * 100) / 100 : 0;
  const pcrVolume = totalCEVol > 0 ? Math.round((totalPEVol / totalCEVol) * 100) / 100 : 0;
  
  const signal = pcrOI > 1.3 ? "Strong Bullish" : pcrOI > 1.0 ? "Bullish" : pcrOI > 0.7 ? "Neutral" : pcrOI > 0.5 ? "Bearish" : "Strong Bearish";
  const signalColor = pcrOI > 1.0 ? "text-bullish" : pcrOI > 0.7 ? "text-warning" : "text-bearish";

  return { pcrOI, pcrVolume, totalCEOI, totalPEOI, totalCEVol, totalPEVol, signal, signalColor };
}
