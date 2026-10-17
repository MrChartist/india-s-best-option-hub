/**
 * Round price-axis ticks for strike / spot charts: 250 points for NIFTY, 500 for BANKNIFTY,
 * doubled until the axis has no more than `maxTicks` labels so phones stay readable.
 */

const BASE_STEP: Record<string, number> = {
  NIFTY: 250,
  BANKNIFTY: 500,
  FINNIFTY: 250,
  MIDCPNIFTY: 100,
  SENSEX: 500,
  BANKEX: 500,
};

/** Base tick step for an underlying. Unknown symbols get a 1-2-5 step sized to the range. */
export function baseTickStep(symbol: string | undefined, lo: number, hi: number): number {
  const s = (symbol || "").toUpperCase();
  if (BASE_STEP[s]) return BASE_STEP[s];
  const span = Math.abs(hi - lo);
  if (!(span > 0)) return 1;
  const raw = span / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/** The step actually used: the base step, doubled while it would print more than maxTicks labels. */
export function priceTickStep(symbol: string | undefined, lo: number, hi: number, maxTicks = 9): number {
  let step = baseTickStep(symbol, lo, hi);
  const span = Math.abs(hi - lo);
  if (!(span > 0) || !(step > 0)) return step;
  const cap = Math.max(2, Math.floor(maxTicks));
  while (span / step > cap) step *= 2;
  return step;
}

/** Multiples of `step` inside [lo, hi] (inclusive). */
export function roundTicks(lo: number, hi: number, step: number): number[] {
  if (![lo, hi, step].every(Number.isFinite) || !(step > 0)) return [];
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const out: number[] = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Round ticks for a numeric price axis. */
export function priceTicks(symbol: string | undefined, lo: number, hi: number, maxTicks = 9): number[] {
  return roundTicks(lo, hi, priceTickStep(symbol, lo, hi, maxTicks));
}

/**
 * Ticks for a categorical strike axis: only strikes that land on a round multiple of the step.
 * Falls back to every n-th strike when no strike is a round multiple (odd strike grids).
 */
export function strikeAxisTicks(symbol: string | undefined, strikes: number[], maxTicks = 9): number[] {
  const list = strikes.filter(Number.isFinite);
  if (list.length === 0) return [];
  const lo = Math.min(...list);
  const hi = Math.max(...list);
  const step = priceTickStep(symbol, lo, hi, maxTicks);
  const round = list.filter((k) => Math.abs(k / step - Math.round(k / step)) < 1e-9);
  if (round.length >= 2) return round;
  const every = Math.max(1, Math.ceil(list.length / Math.max(2, maxTicks)));
  return list.filter((_, i) => i % every === 0);
}
