/**
 * Deterministic SAMPLE option chain (clearly labelled source: "sample").
 * Black-76 consistent prices on the forward, a put skew, a realistic bid/ask spread and day changes.
 *
 * Open interest is seeded per symbol and expiry so every underlying and expiry looks different but
 * is stable across reloads and spot ticks:
 *  - the OI centre sits 0.5–1.5σ (at least two strikes) above or below spot, so max pain is not at spot;
 *  - the call wall (above the centre) and the put wall (below it) have different distances, widths
 *    and heights, with extra OI on round strikes;
 *  - total put OI ÷ total call OI (PCR) is set somewhere in 0.6–1.4.
 * Never present this as live data.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import { black76Price } from "./blackScholes";
import { greeks76 } from "./greeks";
import { getContractSpec, getStrikeStep, normalizeSymbol } from "./instruments";
import { getDividendYield } from "./marketParams";
import { mulberry32 } from "./probability";
import { timeToExpiryYears } from "./time";
import type { OptionType } from "./types";

export type SampleLeg = OptionLegData & { change: number; pChange: number };

const TICK = 0.05;
const roundTick = (x: number) => Math.max(TICK, Math.round(x / TICK) * TICK);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** 32-bit FNV-1a hash of a string (stable seeds for sample data). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed for a sample chain: a hash of the canonical symbol and the expiry, mixed with an optional extra seed. */
export function sampleSeed(symbol: string, expiry: string, extra = 0): number {
  const base = fnv1a(`${normalizeSymbol(symbol || "NIFTY")}|${String(expiry ?? "")}`);
  return (base ^ Math.imul(Number.isFinite(extra) ? Math.round(extra) : 0, 0x9e3779b1)) >>> 0;
}

/**
 * Default ATM IV (decimal) for a sample chain when none is passed: indices 13–15%, stocks 20–30%,
 * fixed per symbol so a symbol always shows the same level. Unknown symbols are treated as stocks.
 */
export function defaultSampleIv(symbol: string): number {
  const sym = normalizeSymbol(symbol || "NIFTY");
  const u = fnv1a(`iv|${sym}`) / 4294967296;
  const index = getContractSpec(sym)?.kind === "INDEX";
  const iv = index ? 0.13 + 0.02 * u : 0.2 + 0.1 * u;
  return Math.round(iv * 1000) / 1000;
}

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
  const atmIv = o.atmIv && o.atmIv > 0 ? o.atmIv : defaultSampleIv(symbol);
  const n = Math.max(5, Math.min(201, Math.round(o.strikes ?? 41)));
  const seed = sampleSeed(symbol, o.expiry, o.seed ?? 0);
  const layout = mulberry32(seed);
  const rand = mulberry32(seed ^ 0x5bd1e995);
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

  // Seeded OI layout: centre off spot by 0.5–1.5σ (≥ 2 strikes), asymmetric walls, PCR 0.6–1.4.
  const sigmaPts = spot * Math.max(sdT, 0.004);
  const dir = layout() < 0.5 ? -1 : 1;
  // Keep the centre and both walls inside the listed strikes (a far-dated 1σ can exceed the range).
  const reach = Math.max(2, Math.floor(half * 0.4)) * step;
  const offset = dir * Math.min(Math.max((0.5 + layout()) * sigmaPts, 2 * step), reach);
  const oiCentre = Math.round((spot + offset) / step) * step;
  const gap = () => step * Math.max(1, Math.round(Math.min((0.3 + 0.7 * layout()) * sigmaPts, reach) / step));
  const ceGap = gap();
  const peGap = gap();
  const ceWidth = width * (0.3 + 0.25 * layout());
  const peWidth = width * (0.3 + 0.25 * layout());
  const pcrTarget = 0.6 + 0.8 * layout();

  const makeLeg = (K: number, type: OptionType, iv: number): SampleLeg => {
    const theo = black76Price({ F, K, T, r, sigma: iv, type });
    const ltp = roundTick(theo);
    const g = greeks76({ F, K, T, r, sigma: iv, type });
    const spread = roundTick(Math.max(TICK, ltp * (0.004 + 0.01 * rand())));
    const bid = Math.max(TICK, roundTick(ltp - spread / 2));
    const ask = roundTick(bid + spread);
    const centre = type === "CE" ? oiCentre + ceGap : oiCentre - peGap;
    const w = type === "CE" ? ceWidth : peWidth;
    const hump = Math.exp(-(((K - centre) / w) ** 2));
    const roundBoost = K % roundEvery === 0 ? 1.15 : 1;
    const oi = Math.round(peakOi * (0.05 + hump) * roundBoost * (0.88 + 0.24 * rand()));
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

  // Scale put OI (with its change and volume) so the chain's PCR lands on the seeded target.
  const ceOi = chain.reduce((a, r) => a + r.ce.oi, 0);
  const peOi = chain.reduce((a, r) => a + r.pe.oi, 0);
  if (ceOi > 0 && peOi > 0) {
    const k = (pcrTarget * ceOi) / peOi;
    for (const row of chain) {
      row.pe.oi = Math.max(1, Math.round(row.pe.oi * k));
      row.pe.oiChange = Math.round(row.pe.oiChange * k);
      row.pe.volume = Math.max(0, Math.round(row.pe.volume * k));
    }
  }
  return { chain, spotPrice: spot, source: "sample" };
}
