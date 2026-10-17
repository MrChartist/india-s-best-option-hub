/**
 * Evenly spaced "nice" linear ticks (1, 2, 2.5 or 5 × 10^k steps, d3-style) for charts that pass an
 * explicit `ticks` array to Recharts. Ticks always bracket [min, max], so the returned first/last
 * tick doubles as the axis domain.
 */

/** A nice step for roughly `count` intervals across `span`. */
export function niceStep(span: number, count = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * mag;
}

/** Round away float noise (0.30000000000000004 → 0.3) at the precision of `step`. */
function clean(v: number, step: number): number {
  const dp = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  return Number(v.toFixed(Math.min(12, dp)));
}

/**
 * Evenly spaced ticks covering [min, max] with about `count` intervals.
 * Degenerate input (equal or non-finite bounds) yields a small symmetric range around the value.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi === lo) {
    const d = lo === 0 ? 1 : Math.abs(lo) * 0.05;
    lo -= d;
    hi += d;
  }
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const n = Math.round((end - start) / step);
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(clean(start + i * step, step));
  return out;
}
