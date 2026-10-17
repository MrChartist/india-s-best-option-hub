/**
 * Volatility smile helpers (pure, node-safe).
 *
 * The smile is an OTM composite: puts below the forward, calls at or above it, because OTM
 * quotes are the liquid side and carry the cleanest IV. Strikes with no usable IV become null
 * so charts show a gap instead of a fake zero. IV values are in PERCENT.
 *
 * An optional raw-SVI fit (Gatheral) smooths the smile:
 *   w(k) = a + b·(ρ·(k − m) + √((k − m)² + σ²)),  w = total variance σ_imp²·T,  k = ln(K/F).
 */
import type { OptionData } from "@/lib/mockData";
import { chainForward, enrichChain, getMarketParams, atmIV, skewMetrics, timeToExpiryYears } from "@/lib/options";

export interface SmilePoint {
  strike: number;
  /** K / F */
  moneyness: number;
  /** ln(K / F) */
  logMoneyness: number;
  /** OTM-side IV in percent; null when the strike has no usable IV. */
  iv: number | null;
  /** Black-76 delta of the OTM leg (puts negative); null when unknown. */
  delta: number | null;
  side: "CE" | "PE";
}

export interface Smile {
  expiry: string;
  T: number;
  F: number;
  spot: number;
  /** Percent. */
  atmIv: number;
  points: SmilePoint[];
  rr25: number;
  bf25: number;
  iv25c: number;
  iv25p: number;
}

export interface BuildSmileOptions {
  spot: number;
  expiry: string;
  now?: Date;
  r?: number;
  /** Keep strikes with |K/F − 1| ≤ rangePct. Default ≈ 3.5 standard deviations, clamped to 3%–30%. */
  rangePct?: number;
}

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;

export function emptySmile(expiry: string, spot: number): Smile {
  return { expiry, T: NaN, F: NaN, spot, atmIv: NaN, points: [], rr25: NaN, bf25: NaN, iv25c: NaN, iv25p: NaN };
}

/** Default strike window: about 3.5σ of the expiry's move, clamped to 3%–30%. */
export function defaultSmileRange(atmIvPct: number, T: number): number {
  if (!finitePos(atmIvPct) || !finitePos(T)) return 0.1;
  const r = 3.5 * (atmIvPct / 100) * Math.sqrt(Math.max(T, 7 / 365));
  return Math.min(0.3, Math.max(0.03, r));
}

/** Build the OTM-composite smile for one expiry. Missing IVs are filled with Black-76 from mid/LTP. */
export function buildSmile(chain: OptionData[], o: BuildSmileOptions): Smile {
  const now = o.now ?? new Date();
  const r = Number.isFinite(o.r) ? (o.r as number) : getMarketParams().r;
  const T = timeToExpiryYears(o.expiry, now);
  if (!Array.isArray(chain) || chain.length === 0 || !finitePos(o.spot) || !finitePos(T)) return emptySmile(o.expiry, o.spot);
  const F = chainForward(chain, o.spot, T, r);
  if (!finitePos(F)) return emptySmile(o.expiry, o.spot);
  const enriched = enrichChain(chain, { spot: o.spot, expiry: o.expiry, now, r, forward: F });
  const atm = atmIV(enriched, F);
  const range = finitePos(o.rangePct) ? (o.rangePct as number) : defaultSmileRange(atm, T);

  const points: SmilePoint[] = [];
  for (const row of enriched) {
    if (!row || !finitePos(row.strikePrice)) continue;
    const K = row.strikePrice;
    if (Math.abs(K / F - 1) > range) continue;
    const side: "CE" | "PE" = K < F ? "PE" : "CE";
    const leg = side === "PE" ? row.pe : row.ce;
    const iv = leg && finitePos(leg.iv) ? leg.iv : null;
    const d = leg && Number.isFinite(leg.delta) && leg.delta !== 0 ? leg.delta : null;
    points.push({ strike: K, moneyness: K / F, logMoneyness: Math.log(K / F), iv, delta: iv === null ? null : d, side });
  }
  points.sort((a, b) => a.strike - b.strike);

  const sk = skewMetrics(
    points.filter((p) => p.iv !== null && p.delta !== null).map((p) => ({ delta: p.delta as number, iv: p.iv as number })),
    atm,
  );
  return { expiry: o.expiry, T, F, spot: o.spot, atmIv: atm, points, rr25: sk.rr25, bf25: sk.bf25, iv25c: sk.iv25c, iv25p: sk.iv25p };
}

/** Points with a usable IV, for charting as {strike, iv}. */
export function smileSeries(smile: Smile): Array<{ strike: number; iv: number }> {
  return smile.points.filter((p) => p.iv !== null).map((p) => ({ strike: p.strike, iv: p.iv as number }));
}

/** Linear interpolation of the smile's IV at a strike (no extrapolation). NaN outside the range. */
export function smileIvAt(smile: Smile, strike: number): number {
  const pts = smileSeries(smile);
  if (pts.length === 0 || !Number.isFinite(strike)) return NaN;
  if (strike < pts[0].strike || strike > pts[pts.length - 1].strike) return NaN;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (strike <= b.strike) return b.strike === a.strike ? a.iv : a.iv + ((b.iv - a.iv) * (strike - a.strike)) / (b.strike - a.strike);
  }
  return pts[pts.length - 1].iv;
}

// ── SVI ──

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SviFit {
  params: SviParams;
  /** Root-mean-square error in IV percentage points. */
  rmseIv: number;
  n: number;
}

export function sviTotalVariance(p: SviParams, k: number): number {
  const x = k - p.m;
  return p.a + p.b * (p.rho * x + Math.sqrt(x * x + p.sigma * p.sigma));
}

/** SVI implied vol in percent at log-moneyness k for maturity T. NaN where total variance ≤ 0. */
export function sviIv(p: SviParams, k: number, T: number): number {
  const w = sviTotalVariance(p, k);
  return w > 0 && T > 0 ? Math.sqrt(w / T) * 100 : NaN;
}

/** Minimal Nelder–Mead simplex minimiser. */
export function nelderMead(f: (x: number[]) => number, x0: number[], o?: { step?: number; maxIter?: number; tol?: number }): { x: number[]; fx: number } {
  const n = x0.length;
  const step = o?.step ?? 0.2;
  const maxIter = o?.maxIter ?? 2000;
  const tol = o?.tol ?? 1e-12;
  let simplex: Array<{ x: number[]; fx: number }> = [{ x: x0.slice(), fx: f(x0) }];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += x[i] !== 0 ? step * Math.abs(x[i]) + step * 0.1 : step;
    simplex.push({ x, fx: f(x) });
  }
  for (let it = 0; it < maxIter; it++) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0];
    const worst = simplex[n];
    if (Math.abs(worst.fx - best.fx) <= tol * (Math.abs(best.fx) + tol)) break;
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    const along = (t: number) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const xr = along(-1);
    const fr = f(xr);
    if (fr < best.fx) {
      const xe = along(-2);
      const fe = f(xe);
      simplex[n] = fe < fr ? { x: xe, fx: fe } : { x: xr, fx: fr };
    } else if (fr < simplex[n - 1].fx) {
      simplex[n] = { x: xr, fx: fr };
    } else {
      const xc = fr < worst.fx ? along(-0.5) : along(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, worst.fx)) {
        simplex[n] = { x: xc, fx: fc };
      } else {
        simplex = simplex.map((v, i) => (i === 0 ? v : { x: v.x.map((xj, j) => best.x[j] + 0.5 * (xj - best.x[j])), fx: NaN }));
        for (let i = 1; i <= n; i++) simplex[i].fx = f(simplex[i].x);
      }
    }
  }
  simplex.sort((a, b) => a.fx - b.fx);
  return simplex[0];
}

function decode(x: number[]): SviParams {
  return { a: x[0], b: Math.exp(x[1]), rho: Math.tanh(x[2]), m: x[3], sigma: Math.exp(x[4]) };
}

/**
 * Least-squares raw-SVI fit to (k, IV%) points for maturity T. Returns null with fewer than 5
 * points or a failed fit. Enforces b ≥ 0, |ρ| < 1, σ > 0 and a + bσ√(1 − ρ²) ≥ 0 (non-negative variance).
 */
export function fitSvi(points: Array<{ k: number; iv: number }>, T: number): SviFit | null {
  const pts = (points ?? []).filter((p) => p && Number.isFinite(p.k) && finitePos(p.iv));
  if (pts.length < 5 || !finitePos(T)) return null;
  const data = pts.map((p) => ({ k: p.k, w: (p.iv / 100) ** 2 * T }));
  const wMin = Math.min(...data.map((d) => d.w));
  const span = Math.max(...data.map((d) => Math.abs(d.k))) || 0.05;
  const loss = (x: number[]) => {
    const p = decode(x);
    let s = 0;
    for (const d of data) {
      const e = sviTotalVariance(p, d.k) - d.w;
      s += e * e;
    }
    const floor = p.a + p.b * p.sigma * Math.sqrt(1 - p.rho * p.rho);
    if (floor < 0) s += 1e3 * floor * floor + 1e-6;
    return Number.isFinite(s) ? s : 1e9;
  };
  let best: { x: number[]; fx: number } | null = null;
  const starts: number[][] = [
    [wMin * 0.8, Math.log(Math.max(wMin, 1e-6) / span), Math.atanh(-0.3), 0, Math.log(span / 2)],
    [wMin * 0.5, Math.log(Math.max(wMin, 1e-6) / (span / 3)), Math.atanh(-0.6), -span / 5, Math.log(span / 5)],
    [wMin * 0.9, Math.log(Math.max(wMin, 1e-6) / (span * 2)), 0, 0, Math.log(span)],
  ];
  for (const x0 of starts) {
    let r = nelderMead(loss, x0, { maxIter: 3000, step: 0.3 });
    r = nelderMead(loss, r.x, { maxIter: 2000, step: 0.05 });
    if (!best || r.fx < best.fx) best = r;
  }
  if (!best || !Number.isFinite(best.fx)) return null;
  const params = decode(best.x);
  let se = 0;
  let n = 0;
  for (const p of pts) {
    const v = sviIv(params, p.k, T);
    if (!Number.isFinite(v)) return null;
    se += (v - p.iv) ** 2;
    n++;
  }
  return { params, rmseIv: Math.sqrt(se / n), n };
}

/** SVI fit of a smile, sampled on `samples` strikes across the observed range. Null when the fit fails. */
export function fitSmileSvi(smile: Smile, samples = 60): { fit: SviFit; curve: Array<{ strike: number; iv: number }> } | null {
  const pts = smile.points.filter((p) => p.iv !== null).map((p) => ({ k: p.logMoneyness, iv: p.iv as number }));
  const fit = fitSvi(pts, smile.T);
  if (!fit || !finitePos(smile.F)) return null;
  const strikes = smile.points.filter((p) => p.iv !== null).map((p) => p.strike);
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  const curve: Array<{ strike: number; iv: number }> = [];
  const n = Math.max(2, Math.floor(samples));
  for (let i = 0; i < n; i++) {
    const K = lo + ((hi - lo) * i) / (n - 1);
    const iv = sviIv(fit.params, Math.log(K / smile.F), smile.T);
    if (Number.isFinite(iv)) curve.push({ strike: Math.round(K * 100) / 100, iv: Math.round(iv * 100) / 100 });
  }
  return { fit, curve };
}

/**
 * "Skew position": where ATM IV sits among the smile's strike IVs (0 = cheapest strike, 100 = richest),
 * as the share of strikes with lower IV. It describes the shape of today's smile, not history.
 */
export function skewPosition(smile: Smile): { position: number; min: number; max: number; mean: number; n: number } {
  const ivs = smileSeries(smile).map((p) => p.iv);
  if (ivs.length === 0 || !finitePos(smile.atmIv)) return { position: NaN, min: NaN, max: NaN, mean: NaN, n: ivs.length };
  const below = ivs.filter((v) => v < smile.atmIv).length;
  return {
    position: (below / ivs.length) * 100,
    min: Math.min(...ivs),
    max: Math.max(...ivs),
    mean: ivs.reduce((a, b) => a + b, 0) / ivs.length,
    n: ivs.length,
  };
}
