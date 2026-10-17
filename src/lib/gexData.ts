/**
 * Gamma exposure (GEX) and dealer-positioning engine for NSE options.
 *
 * Every exposure is built on Black-76 Greeks re-expressed with spot held fixed (greeks76Spot from
 * "@/lib/options"), after the chain
 * is passed through enrichChain so NSE rows with zero IV / Greeks still work.
 *
 * UNITS (all exposures are in ₹ crore):
 *   GEX  = sign × Γ(spot) × units × S² × 1%      → ₹ Cr of delta to hedge per 1% move in the index
 *   DEX  = sign × Δ(spot) × units × S            → ₹ Cr of delta-notional held
 *   VEX  = sign × vanna × units × S              → ₹ Cr change in delta-notional per 1 vol point
 *   CEX  = sign × charm × units × S              → ₹ Cr change in delta-notional per calendar day
 * where units = OI in contracts × lot size (or the raw OI when the feed already reports quantity).
 *
 * SIGN CONVENTIONS:
 *   dealerLongCallShortPut (US / SpotGamma style): dealers are long calls and short puts, so call
 *     gamma is positive and put gamma negative. The total crosses zero, which gives the gamma flip.
 *   sellerShortBoth (India view: retail are net option buyers, so writers are short both sides):
 *     every strike adds short gamma, the total is never positive and there is no flip. The profile
 *     then shows where short-gamma hedging pressure is heaviest.
 * The library default is dealerLongCallShortPut so that a flip exists; the GEX page defaults to the
 * India seller view and labels the dealer-model flip separately.
 */
import type { OptionData, OptionLegData } from "@/lib/mockData";
import {
  atmIV,
  chainForward,
  enrichChain,
  getMarketParams,
  greeks76Spot,
  pctToDec,
  timeToExpiryYears,
  type OptionType,
} from "@/lib/options";

// ───────────────────────────── Public types ─────────────────────────────

export type GexConvention = "dealerLongCallShortPut" | "sellerShortBoth";

export interface GexOptions {
  convention?: GexConvention;
  oiUnit?: "contracts" | "qty";
}

export const DEFAULT_GEX_CONVENTION: GexConvention = "dealerLongCallShortPut";

export const GEX_CONVENTION_LABEL: Record<GexConvention, string> = {
  sellerShortBoth: "Net option-seller gamma",
  dealerLongCallShortPut: "Dealer long call / short put",
};

export interface StrikeExposure {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  dex: number;
  vex: number;
  cex: number;
}

export interface GammaLevels {
  callWall: number;
  putWall: number;
  absGamma: number;
  flip: number | null;
}

export interface GexProfilePoint {
  spot: number;
  totalGex: number;
}

// Legacy shapes (kept for older imports).
export interface GEXByStrike {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  callOI: number;
  putOI: number;
  callGamma: number;
  putGamma: number;
}

export interface GEXSummary {
  totalCallGEX: number;
  totalPutGEX: number;
  netGEX: number;
  /** Spot level where net GEX changes sign; spot itself when no crossing is found. */
  flipPoint: number;
  keyLevels: { strike: number; type: "support" | "resistance" | "magnet"; strength: number }[];
  dealerPosition: "long_gamma" | "short_gamma" | "neutral";
}

// ───────────────────────────── Internals ─────────────────────────────

const CRORE = 1e7;
const ONE_PCT = 0.01;
const DEFAULT_SIGMA = 0.15;

const pos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

function signsFor(convention: GexConvention = DEFAULT_GEX_CONVENTION): { call: number; put: number } {
  return convention === "sellerShortBoth" ? { call: -1, put: -1 } : { call: 1, put: -1 };
}

interface PreparedLeg {
  strike: number;
  type: OptionType;
  /** Open interest in underlying units (contracts × lot). */
  units: number;
  sigma: number;
}

interface PreparedChain {
  legs: PreparedLeg[];
  strikes: number[];
  spot: number;
  T: number;
  r: number;
  /** Forward / spot, held fixed when spot is shifted on the hypothetical grid. */
  fwdRatio: number;
}

/** Raw (unsigned) per-unit spot Greeks for one leg at a hypothetical spot. */
interface LegGreeks {
  gamma: number;
  delta: number;
  vanna: number;
  charm: number;
}

function legGreeksAt(leg: PreparedLeg, S: number, pc: PreparedChain): LegGreeks {
  const F = S * pc.fwdRatio;
  // Spot Greeks: greeks76Spot re-expresses Black-76 with spot held fixed (dF/dS = F/S). This matters
  // for charm: greeks76's charm holds the forward fixed, but for a spot-settled index the forward
  // drifts towards spot as time passes, which flips the sign of near-ATM charm.
  const g = greeks76Spot({ F, K: leg.strike, T: pc.T, r: pc.r, sigma: leg.sigma, type: leg.type }, S);
  const clean = (v: number) => (Number.isFinite(v) ? v : 0);
  return {
    gamma: clean(g.gamma),
    delta: clean(g.delta),
    vanna: clean(g.vanna),
    charm: clean(g.charm),
  };
}

function legSigma(leg: OptionLegData | undefined, fallback: number): number {
  const iv = leg && pos(leg.iv) ? pctToDec(leg.iv) : NaN;
  const s = pos(iv) ? iv : fallback;
  return Math.min(3, Math.max(0.01, s));
}

function prepareChain(chain: OptionData[], spot: number, expiry: string, lotSize: number, opts?: GexOptions): PreparedChain | null {
  if (!Array.isArray(chain) || chain.length === 0 || !pos(spot)) return null;
  const qty = opts?.oiUnit === "qty";
  if (!qty && !pos(lotSize)) return null;
  const multiplier = qty ? 1 : lotSize;

  const r = getMarketParams().r;
  const Traw = timeToExpiryYears(expiry ?? "");
  const T = pos(Traw) ? Traw : 1 / (365 * 24 * 60);
  const rows = chain.filter((row) => row && pos(row.strikePrice) && row.ce && row.pe);
  if (rows.length === 0) return null;

  const fwd = chainForward(rows, spot, T, r);
  const F = pos(fwd) ? fwd : spot * Math.exp(r * T);
  const enriched = enrichChain(rows, { spot, expiry, r, forward: F });
  const atm = atmIV(enriched, F);
  const fallback = pos(atm) ? pctToDec(atm) : DEFAULT_SIGMA;

  const legs: PreparedLeg[] = [];
  const strikes = new Set<number>();
  for (const row of enriched) {
    strikes.add(row.strikePrice);
    const ceOi = pos(row.ce?.oi) ? row.ce.oi : 0;
    const peOi = pos(row.pe?.oi) ? row.pe.oi : 0;
    if (ceOi > 0) legs.push({ strike: row.strikePrice, type: "CE", units: ceOi * multiplier, sigma: legSigma(row.ce, fallback) });
    if (peOi > 0) legs.push({ strike: row.strikePrice, type: "PE", units: peOi * multiplier, sigma: legSigma(row.pe, fallback) });
  }
  return { legs, strikes: [...strikes].sort((a, b) => a - b), spot, T, r, fwdRatio: F / spot };
}

function emptyLevels(): GammaLevels {
  return { callWall: NaN, putWall: NaN, absGamma: NaN, flip: null };
}

/** Grid of hypothetical spots: spot × (1 ± rangePct%), `steps` equal intervals. */
function spotGridFor(spot: number, rangePct = 5, steps = 100): number[] {
  const range = Math.min(50, Math.max(0.1, Number.isFinite(rangePct) ? rangePct : 5)) / 100;
  const n = Math.min(1000, Math.max(2, Math.round(Number.isFinite(steps) ? steps : 100)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(spot * (1 - range + (2 * range * i) / n));
  return out;
}

/** Unsigned call and put gamma (₹ Cr per 1%) at each grid spot. */
function profileParts(pc: PreparedChain, grid: number[]): Array<{ spot: number; call: number; put: number }> {
  return grid.map((S) => {
    let call = 0;
    let put = 0;
    const scale = (S * S * ONE_PCT) / CRORE;
    for (const leg of pc.legs) {
      const g = legGreeksAt(leg, S, pc).gamma * leg.units * scale;
      if (leg.type === "CE") call += g;
      else put += g;
    }
    return { spot: S, call, put };
  });
}

function combineParts(parts: Array<{ spot: number; call: number; put: number }>, convention?: GexConvention): GexProfilePoint[] {
  const s = signsFor(convention);
  return parts.map((p) => ({ spot: p.spot, totalGex: s.call * p.call + s.put * p.put }));
}

/**
 * Zero crossing of a sampled curve, linearly interpolated. Exact zeros are skipped so a curve
 * that only touches zero is not treated as a crossing. When several crossings exist, the one
 * nearest `ref` is returned. Null when the curve never changes sign.
 */
export function zeroCrossing(points: GexProfilePoint[], ref: number): number | null {
  const pts = points.filter((p) => Number.isFinite(p.totalGex) && Number.isFinite(p.spot) && p.totalGex !== 0);
  let best: number | null = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (Math.sign(a.totalGex) === Math.sign(b.totalGex)) continue;
    const x = a.spot + ((0 - a.totalGex) * (b.spot - a.spot)) / (b.totalGex - a.totalGex);
    if (best === null || Math.abs(x - ref) < Math.abs(best - ref)) best = x;
  }
  return best;
}

function argmaxStrike<T extends { strike: number }>(rows: T[], score: (r: T) => number, spot: number): number {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const r of rows) {
    const s = score(r);
    if (!Number.isFinite(s)) continue;
    const better = s > bestScore + 1e-12 || (Math.abs(s - bestScore) <= 1e-12 && best !== null && Math.abs(r.strike - spot) < Math.abs(best.strike - spot));
    if (best === null || better) {
      best = r;
      bestScore = s;
    }
  }
  return best && bestScore > 0 ? best.strike : NaN;
}

function exposureFromPrepared(pc: PreparedChain, convention?: GexConvention): StrikeExposure[] {
  const s = signsFor(convention);
  const S = pc.spot;
  const gexScale = (S * S * ONE_PCT) / CRORE;
  const notional = S / CRORE;
  const byStrike = new Map<number, StrikeExposure>();
  for (const k of pc.strikes) byStrike.set(k, { strike: k, callGex: 0, putGex: 0, netGex: 0, dex: 0, vex: 0, cex: 0 });
  for (const leg of pc.legs) {
    const row = byStrike.get(leg.strike);
    if (!row) continue;
    const g = legGreeksAt(leg, S, pc);
    const sign = leg.type === "CE" ? s.call : s.put;
    const gex = sign * g.gamma * leg.units * gexScale;
    if (leg.type === "CE") row.callGex += gex;
    else row.putGex += gex;
    row.dex += sign * g.delta * leg.units * notional;
    row.vex += sign * g.vanna * leg.units * notional;
    row.cex += sign * g.charm * leg.units * notional;
  }
  return pc.strikes.map((k) => {
    const row = byStrike.get(k) as StrikeExposure;
    row.netGex = row.callGex + row.putGex;
    return row;
  });
}

function levelsFrom(byStrike: StrikeExposure[], spot: number, flip: number | null): GammaLevels {
  if (byStrike.length === 0) return emptyLevels();
  return {
    callWall: argmaxStrike(byStrike, (r) => Math.abs(r.callGex), spot),
    putWall: argmaxStrike(byStrike, (r) => Math.abs(r.putGex), spot),
    absGamma: argmaxStrike(byStrike, (r) => Math.abs(r.callGex) + Math.abs(r.putGex), spot),
    flip,
  };
}

// ───────────────────────────── Public API ─────────────────────────────

/**
 * Exposure per strike at the current spot, in ₹ crore (GEX per 1% move; DEX as delta-notional;
 * VEX per vol point; CEX per calendar day). Signed by the chosen convention.
 */
export function exposureByStrike(
  chain: OptionData[],
  spot: number,
  expiry: string,
  lotSize: number,
  opts?: GexOptions,
): Array<{ strike: number; callGex: number; putGex: number; netGex: number; dex: number; vex: number; cex: number }> {
  const pc = prepareChain(chain, spot, expiry, lotSize, opts);
  return pc ? exposureFromPrepared(pc, opts?.convention) : [];
}

/**
 * Total GEX (₹ Cr per 1%) recomputed over a hypothetical spot grid, holding each strike's IV fixed
 * (sticky strike). Defaults: ±5% in 100 steps (0.1% apart).
 */
export function gexProfile(
  chain: OptionData[],
  spot: number,
  expiry: string,
  lotSize: number,
  opts?: GexOptions & { rangePct?: number; steps?: number },
): Array<{ spot: number; totalGex: number }> {
  const pc = prepareChain(chain, spot, expiry, lotSize, opts);
  if (!pc) return [];
  return combineParts(profileParts(pc, spotGridFor(spot, opts?.rangePct, opts?.steps)), opts?.convention);
}

/**
 * Call wall (largest call gamma), put wall (largest put gamma), absolute gamma strike (largest
 * combined gamma) and the gamma flip (zero crossing of total GEX over spot ±5% in 0.1% steps,
 * interpolated). Walls are convention-independent; the flip is null under sellerShortBoth.
 */
export function computeGammaLevels(
  chain: OptionData[],
  spot: number,
  expiry: string,
  lotSize: number,
  opts?: GexOptions,
): { callWall: number; putWall: number; absGamma: number; flip: number | null } {
  const pc = prepareChain(chain, spot, expiry, lotSize, opts);
  if (!pc) return emptyLevels();
  const byStrike = exposureFromPrepared(pc, opts?.convention);
  const profile = combineParts(profileParts(pc, spotGridFor(spot, 5, 100)), opts?.convention);
  return levelsFrom(byStrike, spot, zeroCrossing(profile, spot));
}

/**
 * Strike × expiry matrix for heatmaps. One row per strike (union across expiries); one numeric
 * column per expiry. Strikes not listed in an expiry are NaN.
 *   gex      net GEX, ₹ Cr per 1%            dex   net DEX, ₹ Cr
 *   oi       CE + PE open interest, contracts  oiChange  CE + PE change in OI, contracts
 */
export function multiExpiryExposure(
  chains: Array<{ expiry: string; chain: OptionData[] }>,
  spot: number,
  lotSize: number,
  metric: "gex" | "dex" | "oi" | "oiChange",
  opts?: GexOptions,
): Array<{ strike: number; [expiry: string]: number }> {
  if (!Array.isArray(chains) || chains.length === 0) return [];
  const perExpiry = new Map<string, Map<number, number>>();
  const strikes = new Set<number>();
  const qty = opts?.oiUnit === "qty";
  const toContracts = (v: number) => (qty ? (pos(lotSize) ? v / lotSize : NaN) : v);

  for (const { expiry, chain } of chains) {
    if (!expiry || !Array.isArray(chain)) continue;
    const values = new Map<number, number>();
    if (metric === "gex" || metric === "dex") {
      for (const row of exposureByStrike(chain, spot, expiry, lotSize, opts)) {
        values.set(row.strike, metric === "gex" ? row.netGex : row.dex);
      }
    } else {
      for (const row of chain) {
        if (!row || !pos(row.strikePrice)) continue;
        const ce = metric === "oi" ? row.ce?.oi : row.ce?.oiChange;
        const pe = metric === "oi" ? row.pe?.oi : row.pe?.oiChange;
        const total = (Number.isFinite(ce) ? (ce as number) : 0) + (Number.isFinite(pe) ? (pe as number) : 0);
        values.set(row.strikePrice, toContracts(total));
      }
    }
    for (const k of values.keys()) strikes.add(k);
    perExpiry.set(expiry, values);
  }

  return [...strikes]
    .sort((a, b) => a - b)
    .map((strike) => {
      const row: { strike: number; [expiry: string]: number } = { strike };
      for (const [expiry, values] of perExpiry) row[expiry] = values.has(strike) ? (values.get(strike) as number) : NaN;
      return row;
    });
}

/**
 * Guess whether a feed reports OI in contracts (NSE) or in quantity (some broker feeds).
 * Quantity OI is always a whole multiple of the lot size; contract counts are a multiple only
 * by chance (about 1 in lotSize). Needs at least 12 non-zero legs, otherwise assumes contracts.
 */
export function inferOiUnit(chain: OptionData[], lotSize: number): "contracts" | "qty" {
  if (!Array.isArray(chain) || !pos(lotSize) || lotSize < 2) return "contracts";
  let n = 0;
  let multiples = 0;
  for (const row of chain) {
    for (const leg of [row?.ce, row?.pe]) {
      const oi = leg?.oi;
      if (!pos(oi)) continue;
      n++;
      if (Math.abs(oi / lotSize - Math.round(oi / lotSize)) < 1e-9) multiples++;
    }
  }
  if (n < 12) return "contracts";
  return multiples / n >= 0.95 ? "qty" : "contracts";
}

// ───────────────────────────── Aggregated view ─────────────────────────────

export interface GexChainInput {
  expiry: string;
  chain: OptionData[];
  /** Lot size for this expiry (lot sizes can change between series). */
  lotSize: number;
}

export interface GexTotals {
  callGex: number;
  putGex: number;
  netGex: number;
  dex: number;
  vex: number;
  cex: number;
}

export type GammaRegime = "damped" | "amplified" | "neutral";

export interface GexView {
  byStrike: StrikeExposure[];
  profile: GexProfilePoint[];
  levels: GammaLevels;
  /** Flip under the dealer model, shown alongside the seller view (which has no flip). */
  dealerFlip: number | null;
  /** Grid spot where |total GEX| is largest: the strongest hedging pressure. */
  gammaPeak: number | null;
  totals: GexTotals;
  regime: GammaRegime;
  expiries: string[];
}

/** Classify net GEX at spot. Values within 2% of gross gamma count as neutral. */
export function gammaRegime(netGex: number, grossGex: number): GammaRegime {
  if (!Number.isFinite(netGex)) return "neutral";
  const band = Math.abs(grossGex) * 0.02;
  if (netGex > band) return "damped";
  if (netGex < -band) return "amplified";
  return "neutral";
}

/**
 * Combine one or more expiries into a single positioning view: summed strike exposures, summed
 * profile on a common spot grid, walls, flip, totals and regime.
 */
export function buildGexView(
  chains: GexChainInput[],
  spot: number,
  opts?: GexOptions & { rangePct?: number; steps?: number },
): GexView {
  const convention = opts?.convention ?? DEFAULT_GEX_CONVENTION;
  const grid = pos(spot) ? spotGridFor(spot, opts?.rangePct, opts?.steps) : [];
  const strikeMap = new Map<number, StrikeExposure>();
  const partSums = grid.map((S) => ({ spot: S, call: 0, put: 0 }));
  const expiries: string[] = [];

  for (const c of Array.isArray(chains) ? chains : []) {
    const pc = prepareChain(c.chain, spot, c.expiry, c.lotSize, opts);
    if (!pc) continue;
    expiries.push(c.expiry);
    for (const row of exposureFromPrepared(pc, convention)) {
      const acc = strikeMap.get(row.strike) ?? { strike: row.strike, callGex: 0, putGex: 0, netGex: 0, dex: 0, vex: 0, cex: 0 };
      acc.callGex += row.callGex;
      acc.putGex += row.putGex;
      acc.netGex += row.netGex;
      acc.dex += row.dex;
      acc.vex += row.vex;
      acc.cex += row.cex;
      strikeMap.set(row.strike, acc);
    }
    profileParts(pc, grid).forEach((p, i) => {
      partSums[i].call += p.call;
      partSums[i].put += p.put;
    });
  }

  const byStrike = [...strikeMap.values()].sort((a, b) => a.strike - b.strike);
  const profile = combineParts(partSums, convention);
  const dealerProfile = combineParts(partSums, "dealerLongCallShortPut");
  const totals = byStrike.reduce<GexTotals>(
    (t, r) => ({ callGex: t.callGex + r.callGex, putGex: t.putGex + r.putGex, netGex: t.netGex + r.netGex, dex: t.dex + r.dex, vex: t.vex + r.vex, cex: t.cex + r.cex }),
    { callGex: 0, putGex: 0, netGex: 0, dex: 0, vex: 0, cex: 0 },
  );
  let gammaPeak: number | null = null;
  let peakAbs = 0;
  for (const p of profile) {
    if (Math.abs(p.totalGex) > peakAbs) {
      peakAbs = Math.abs(p.totalGex);
      gammaPeak = p.spot;
    }
  }
  const gross = Math.abs(totals.callGex) + Math.abs(totals.putGex);
  return {
    byStrike,
    profile,
    levels: levelsFrom(byStrike, spot, zeroCrossing(profile, spot)),
    dealerFlip: zeroCrossing(dealerProfile, spot),
    gammaPeak,
    totals,
    regime: byStrike.length > 0 ? gammaRegime(totals.netGex, gross) : "neutral",
    expiries,
  };
}

// ───────────────────────────── Legacy API ─────────────────────────────

type LegacyRow = { strikePrice: number; ce: { oi: number; gamma: number }; pe: { oi: number; gamma: number } };

function isFullRow(row: LegacyRow): row is LegacyRow & OptionData {
  const r = row as Partial<OptionData>;
  return !!r.ce && !!r.pe && typeof r.ce.iv === "number" && typeof r.pe.iv === "number" && typeof r.ce.ltp === "number";
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * GEX per strike in ₹ Cr per 1% move. When `opts.expiry` is given and rows are full option-chain
 * rows, Greeks are recomputed with Black-76 (works with zero NSE Greeks). Otherwise the gamma on
 * each row is used as supplied.
 */
export function calculateGEX(
  spotPrice: number,
  chain: LegacyRow[],
  lotSize: number,
  opts?: GexOptions & { expiry?: string },
): GEXByStrike[] {
  if (!Array.isArray(chain) || !pos(spotPrice)) return [];
  if (opts?.expiry && chain.length > 0 && chain.every(isFullRow)) {
    const full = chain as OptionData[];
    const rows = exposureByStrike(full, spotPrice, opts.expiry, lotSize, opts);
    const byStrike = new Map(full.map((r) => [r.strikePrice, r]));
    return rows.map((r) => {
      const src = byStrike.get(r.strike);
      return {
        strike: r.strike,
        callGEX: round2(r.callGex),
        putGEX: round2(r.putGex),
        netGEX: round2(r.netGex),
        callOI: src?.ce.oi ?? 0,
        putOI: src?.pe.oi ?? 0,
        callGamma: src?.ce.gamma ?? 0,
        putGamma: src?.pe.gamma ?? 0,
      };
    });
  }
  const s = signsFor(opts?.convention);
  const mult = opts?.oiUnit === "qty" ? 1 : lotSize;
  const scale = (spotPrice * spotPrice * ONE_PCT) / CRORE;
  return chain.map((row) => {
    const cg = Number.isFinite(row.ce?.gamma) ? row.ce.gamma : 0;
    const pg = Number.isFinite(row.pe?.gamma) ? row.pe.gamma : 0;
    const co = Number.isFinite(row.ce?.oi) ? row.ce.oi : 0;
    const po = Number.isFinite(row.pe?.oi) ? row.pe.oi : 0;
    const callGEX = s.call * cg * co * mult * scale;
    const putGEX = s.put * pg * po * mult * scale;
    return {
      strike: row.strikePrice,
      callGEX: round2(callGEX),
      putGEX: round2(putGEX),
      netGEX: round2(callGEX + putGEX),
      callOI: co,
      putOI: po,
      callGamma: cg,
      putGamma: pg,
    };
  });
}

/**
 * Summary of a GEX-by-strike table. Pass `profile` (from gexProfile) to get the true flip; without
 * it, the flip falls back to the interpolated sign change of net GEX across strikes nearest spot.
 */
export function getGEXSummary(gexByStrike: GEXByStrike[], spotPrice: number, profile?: GexProfilePoint[]): GEXSummary {
  const rows = Array.isArray(gexByStrike) ? gexByStrike : [];
  const totalCallGEX = rows.reduce((s, r) => s + r.callGEX, 0);
  const totalPutGEX = rows.reduce((s, r) => s + r.putGEX, 0);
  const netGEX = totalCallGEX + totalPutGEX;

  const flipFromProfile = profile && profile.length > 1 ? zeroCrossing(profile, spotPrice) : null;
  const flipFromStrikes = zeroCrossing(rows.map((r) => ({ spot: r.strike, totalGex: r.netGEX })), spotPrice);
  const flipPoint = flipFromProfile ?? flipFromStrikes ?? spotPrice;

  const absGammaStrike = argmaxStrike(rows, (r) => Math.abs(r.callGEX) + Math.abs(r.putGEX), spotPrice);
  const sorted = [...rows].sort((a, b) => Math.abs(b.callGEX) + Math.abs(b.putGEX) - (Math.abs(a.callGEX) + Math.abs(a.putGEX)));
  const keyLevels = sorted.slice(0, 5).map((r) => ({
    strike: r.strike,
    type: (r.strike === absGammaStrike ? "magnet" : r.strike > spotPrice ? "resistance" : "support") as "support" | "resistance" | "magnet",
    strength: round2(Math.abs(r.callGEX) + Math.abs(r.putGEX)),
  }));

  const regime = gammaRegime(netGEX, Math.abs(totalCallGEX) + Math.abs(totalPutGEX));
  return {
    totalCallGEX: round2(totalCallGEX),
    totalPutGEX: round2(totalPutGEX),
    netGEX: round2(netGEX),
    flipPoint,
    keyLevels,
    dealerPosition: regime === "damped" ? "long_gamma" : regime === "amplified" ? "short_gamma" : "neutral",
  };
}
