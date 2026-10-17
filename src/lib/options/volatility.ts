/** Realised and implied volatility helpers. All vols are decimals unless the input is in percent. */

export interface OHLC {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

const ANN = 252;

function finitePos(x: number): boolean {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleVar(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
}

/** Linear-interpolated percentile (p in 0..1) of a sorted array. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(Math.max(p, 0), 1) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Close-to-close HV over the last `window` log returns (needs window+1 closes). */
export function hvCloseToClose(closes: number[], window: number, annualization = ANN): number {
  if (!Array.isArray(closes) || !(window >= 2)) return NaN;
  const c = closes.filter(finitePos);
  if (c.length < window + 1) return NaN;
  const tail = c.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < tail.length; i++) rets.push(Math.log(tail[i] / tail[i - 1]));
  return Math.sqrt(sampleVar(rets) * annualization);
}

function validBar(b: OHLC): boolean {
  return !!b && finitePos(b.o) && finitePos(b.h) && finitePos(b.l) && finitePos(b.c) && b.h >= b.l;
}

/** Parkinson high-low HV over the last `window` bars. */
export function hvParkinson(bars: OHLC[], window: number): number {
  if (!Array.isArray(bars) || !(window >= 1)) return NaN;
  const b = bars.filter(validBar);
  if (b.length < window) return NaN;
  const tail = b.slice(-window);
  const s = mean(tail.map((x) => Math.log(x.h / x.l) ** 2));
  return Math.sqrt((s / (4 * Math.LN2)) * ANN);
}

/** Yang-Zhang HV over the last `window` bars (needs window+1 bars for the overnight gap). */
export function hvYangZhang(bars: OHLC[], window: number): number {
  if (!Array.isArray(bars) || !(window >= 2)) return NaN;
  const b = bars.filter(validBar);
  if (b.length < window + 1) return NaN;
  const tail = b.slice(-(window + 1));
  const on: number[] = [];
  const oc: number[] = [];
  const rs: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const { o, h, l, c } = tail[i];
    on.push(Math.log(o / tail[i - 1].c));
    oc.push(Math.log(c / o));
    rs.push(Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o));
  }
  const n = window;
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));
  const v = sampleVar(on) + k * sampleVar(oc) + (1 - k) * mean(rs);
  return v >= 0 ? Math.sqrt(v * ANN) : NaN;
}

export function rollingHV(bars: OHLC[], window: number, method: "c2c" | "parkinson" | "yz" = "c2c"): Array<{ t: number; hv: number }> {
  const b = (Array.isArray(bars) ? bars : []).filter(validBar);
  const need = method === "parkinson" ? window : window + 1;
  const out: Array<{ t: number; hv: number }> = [];
  for (let i = need - 1; i < b.length; i++) {
    const slice = b.slice(i - need + 1, i + 1);
    const hv =
      method === "parkinson"
        ? hvParkinson(slice, window)
        : method === "yz"
          ? hvYangZhang(slice, window)
          : hvCloseToClose(slice.map((x) => x.c), window);
    if (Number.isFinite(hv)) out.push({ t: b[i].t, hv });
  }
  return out;
}

/** IV Rank 0-100: where current sits between the min and max of history. null if fewer than 20 points or a flat history. */
export function ivRank(current: number, history: number[]): number | null {
  const h = (Array.isArray(history) ? history : []).filter((x) => Number.isFinite(x));
  if (h.length < 20 || !Number.isFinite(current)) return null;
  const lo = Math.min(...h);
  const hi = Math.max(...h);
  if (hi === lo) return null;
  return Math.max(0, Math.min(100, ((current - lo) / (hi - lo)) * 100));
}

/** IV Percentile 0-100: share of history strictly below current. null if fewer than 20 points. */
export function ivPercentile(current: number, history: number[]): number | null {
  const h = (Array.isArray(history) ? history : []).filter((x) => Number.isFinite(x));
  if (h.length < 20 || !Number.isFinite(current)) return null;
  return (h.filter((x) => x < current).length / h.length) * 100;
}

/** Forward vol between T1 and T2: sqrt((σ2²T2 − σ1²T1)/(T2 − T1)); NaN on negative variance. */
export function forwardVol(s1: number, T1: number, s2: number, T2: number): number {
  if (![s1, T1, s2, T2].every(Number.isFinite) || !(T2 > T1) || T1 < 0) return NaN;
  const v = (s2 * s2 * T2 - s1 * s1 * T1) / (T2 - T1);
  return v >= 0 ? Math.sqrt(v) : NaN;
}

/** Constant-maturity IV by linear interpolation in total variance; flat vol outside the range. */
export function constantMaturityIV(points: Array<{ T: number; iv: number }>, targetT: number): number {
  const pts = (Array.isArray(points) ? points : []).filter((p) => p && p.T > 0 && Number.isFinite(p.iv) && p.iv > 0).sort((a, b) => a.T - b.T);
  if (pts.length === 0 || !(targetT > 0)) return NaN;
  if (targetT <= pts[0].T) return pts[0].iv;
  if (targetT >= pts[pts.length - 1].T) return pts[pts.length - 1].iv;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (targetT <= b.T) {
      const wa = a.iv * a.iv * a.T;
      const wb = b.iv * b.iv * b.T;
      const w = wa + ((wb - wa) * (targetT - a.T)) / (b.T - a.T);
      return w > 0 ? Math.sqrt(w / targetT) : NaN;
    }
  }
  return NaN;
}

function interpAt(pts: Array<{ x: number; y: number }>, x: number): number {
  if (pts.length === 0) return NaN;
  const s = pts.slice().sort((a, b) => a.x - b.x);
  if (x <= s[0].x) return s[0].y;
  if (x >= s[s.length - 1].x) return s[s.length - 1].y;
  for (let i = 1; i < s.length; i++) {
    if (x <= s[i].x) {
      const a = s[i - 1];
      const b = s[i];
      return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return NaN;
}

/**
 * 25-delta risk reversal and butterfly. Calls have delta in (0,1), puts in (−1,0).
 * rr25 = IV(25Δ call) − IV(25Δ put); bf25 = average of the two − ATM IV. Same units as the input IV.
 */
export function skewMetrics(smile: Array<{ delta: number; iv: number }>, atmIv: number): { rr25: number; bf25: number; iv25c: number; iv25p: number } {
  const pts = (Array.isArray(smile) ? smile : []).filter((p) => p && Number.isFinite(p.delta) && Number.isFinite(p.iv) && p.iv > 0);
  const calls = pts.filter((p) => p.delta > 0 && p.delta < 1).map((p) => ({ x: p.delta, y: p.iv }));
  const puts = pts.filter((p) => p.delta < 0 && p.delta > -1).map((p) => ({ x: p.delta, y: p.iv }));
  const iv25c = interpAt(calls, 0.25);
  const iv25p = interpAt(puts, -0.25);
  return {
    rr25: iv25c - iv25p,
    bf25: (iv25c + iv25p) / 2 - atmIv,
    iv25c,
    iv25p,
  };
}

/** Volatility cone from close-to-close HV for each window over the whole history. */
export function volCone(
  closes: number[],
  windows: number[],
): Array<{ window: number; min: number; p25: number; median: number; p75: number; max: number; current: number }> {
  const c = (Array.isArray(closes) ? closes : []).filter(finitePos);
  const out: Array<{ window: number; min: number; p25: number; median: number; p75: number; max: number; current: number }> = [];
  for (const w of Array.isArray(windows) ? windows : []) {
    if (!(w >= 2) || c.length < w + 1) continue;
    const rets: number[] = [];
    for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
    const series: number[] = [];
    for (let end = w; end <= rets.length; end++) series.push(Math.sqrt(sampleVar(rets.slice(end - w, end)) * ANN));
    const sorted = series.slice().sort((a, b) => a - b);
    out.push({
      window: w,
      min: sorted[0],
      p25: percentileSorted(sorted, 0.25),
      median: percentileSorted(sorted, 0.5),
      p75: percentileSorted(sorted, 0.75),
      max: sorted[sorted.length - 1],
      current: series[series.length - 1],
    });
  }
  return out;
}
