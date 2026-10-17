/**
 * Deterministic SAMPLE option chain (clearly labelled source: "sample").
 * Black-76 consistent prices on the forward, a put skew, OI humps near ATM with
 * extra OI on round strikes, a realistic bid/ask spread and day changes.
 * Never present this as live data.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import { black76Price } from "./blackScholes";
import { greeks76 } from "./greeks";
import { getContractSpec, getStrikeStep } from "./instruments";
import { getDividendYield } from "./marketParams";
import { mulberry32 } from "./probability";
import { timeToExpiryYears } from "./time";
import type { OptionType } from "./types";

export type SampleLeg = OptionLegData & { change: number; pChange: number };

const TICK = 0.05;
const roundTick = (x: number) => Math.max(TICK, Math.round(x / TICK) * TICK);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Smile: IV as a function of standardised log-moneyness z = ln(K/F)/(σ√T); higher on the put wing. */
export function sampleSmile(atmIv: number, z: number): number {
  const iv = atmIv * (1 - 0.07 * z + 0.015 * z * z);
  return Math.min(Math.max(iv, atmIv * 0.6), atmIv * 3);
}

export function generateSampleChain(o: {
  symbol: string;
  spot: number;
  expiry: string;
  atmIv?: number;
  strikes?: number;
  now?: Date;
  seed?: number;
}): { chain: OptionData[]; spotPrice: number; source: "sample" } {
  const spot = Number(o?.spot);
  if (!o || !(spot > 0)) return { chain: [], spotPrice: 0, source: "sample" };
  const symbol = o.symbol || "NIFTY";
  const atmIv = o.atmIv && o.atmIv > 0 ? o.atmIv : 0.14;
  const n = Math.max(5, Math.min(201, Math.round(o.strikes ?? 41)));
  const rand = mulberry32((o.seed ?? 7) ^ Math.round(spot));
  const spec = getContractSpec(symbol);
  const step = spec?.strikeStep ?? getStrikeStep(symbol);
  const isIndex = spec ? spec.kind === "INDEX" : true;
  const r = 0.065;
  const q = getDividendYield(symbol);
  const Traw = timeToExpiryYears(o.expiry, o.now ?? new Date());
  const T = Number.isFinite(Traw) && Traw > 0 ? Traw : 1 / (365 * 24);
  const F = spot * Math.exp((r - q) * T);
  const atm = Math.round(spot / step) * step;
  const half = Math.floor(n / 2);
  const sdT = atmIv * Math.sqrt(T);
  const peakOi = isIndex ? 120_000 : 6_000;
  const width = Math.max(step * 4, spot * Math.max(sdT, 0.01) * 1.5);
  const roundEvery = step * 10;

  const makeLeg = (K: number, type: OptionType, iv: number): SampleLeg => {
    const theo = black76Price({ F, K, T, r, sigma: iv, type });
    const ltp = roundTick(theo);
    const g = greeks76({ F, K, T, r, sigma: iv, type });
    const spread = roundTick(Math.max(TICK, ltp * (0.004 + 0.01 * rand())));
    const bid = Math.max(TICK, roundTick(ltp - spread / 2));
    const ask = roundTick(bid + spread);
    const centre = type === "CE" ? atm + step * 2 : atm - step * 2;
    const hump = Math.exp(-(((K - centre) / width) ** 2));
    const roundBoost = K % roundEvery === 0 ? 1.6 : 1;
    const oi = Math.round(peakOi * (0.05 + hump) * roundBoost * (0.75 + 0.5 * rand()));
    const oiChange = Math.round(oi * (rand() - 0.4) * 0.3);
    const volume = Math.round(oi * (0.8 + 2.5 * hump) * (0.6 + 0.8 * rand()));
    const prev = Math.max(TICK, ltp * (1 + (rand() - 0.5) * 0.3));
    const change = round2(ltp - prev);
    return {
      ltp: round2(ltp),
      oi,
      oiChange,
      volume,
      iv: round2(iv * 100),
      delta: Math.round(g.delta * 1e4) / 1e4,
      gamma: Math.round(g.gamma * 1e6) / 1e6,
      theta: round2(g.theta),
      vega: round2(g.vega),
      bidPrice: round2(bid),
      askPrice: round2(ask),
      change,
      pChange: round2((change / prev) * 100),
    };
  };

  const chain: OptionData[] = [];
  for (let i = -half; i <= half; i++) {
    const K = atm + i * step;
    if (K <= 0) continue;
    const z = Math.log(K / F) / Math.max(sdT, 1e-6);
    const iv = sampleSmile(atmIv, z);
    chain.push({ strikePrice: K, ce: makeLeg(K, "CE", iv), pe: makeLeg(K, "PE", iv) });
  }
  return { chain, spotPrice: spot, source: "sample" };
}
