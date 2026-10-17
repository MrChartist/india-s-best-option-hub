/**
 * Term structure, delta-bucket surface and per-expiry expected move (pure, node-safe).
 * IV values are in PERCENT unless noted.
 */
import type { OptionData } from "@/lib/mockData";
import {
  atmStraddle,
  calendarDaysBetween,
  constantMaturityIV,
  expectedMoveFromIV,
  expectedMoveFromStraddle,
  forwardVol,
  istDateString,
  tradingDaysBetween,
} from "@/lib/options";
import { buildSmile, type Smile } from "./smile";

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface ExpiryChain {
  expiry: string;
  chain: OptionData[];
}

/** One smile per expiry, sorted by maturity. Expiries without a solvable ATM IV are dropped. */
export function buildExpirySmiles(expiries: ExpiryChain[], o: { spot: number; now?: Date; r?: number }): Smile[] {
  return (expiries ?? [])
    .map((e) => buildSmile(e.chain, { spot: o.spot, expiry: e.expiry, now: o.now, r: o.r }))
    .filter((s) => finitePos(s.T) && finitePos(s.atmIv))
    .sort((a, b) => a.T - b.T);
}

// ── Term structure ──

export interface TermPoint {
  expiry: string;
  /** Calendar days to expiry (from today IST). */
  dte: number;
  /** Trading days to expiry. */
  tradingDte: number;
  T: number;
  F: number;
  atmIv: number;
  /** Forward vol (percent) between the previous expiry and this one; null for the first or on negative variance. */
  fwdVol: number | null;
  rr25: number;
  bf25: number;
}

export function termStructure(smiles: Smile[], now: Date = new Date()): TermPoint[] {
  const today = istDateString(now);
  const out: TermPoint[] = [];
  let prev: Smile | null = null;
  for (const s of [...smiles].sort((a, b) => a.T - b.T)) {
    let fwd: number | null = null;
    if (prev) {
      const v = forwardVol(prev.atmIv / 100, prev.T, s.atmIv / 100, s.T);
      fwd = Number.isFinite(v) ? r2(v * 100) : null;
    }
    out.push({
      expiry: s.expiry,
      dte: Math.max(0, calendarDaysBetween(today, s.expiry)),
      tradingDte: Math.max(0, tradingDaysBetween(today, s.expiry)),
      T: s.T,
      F: s.F,
      atmIv: r2(s.atmIv),
      fwdVol: fwd,
      rr25: s.rr25,
      bf25: s.bf25,
    });
    prev = s;
  }
  return out;
}

export type TermShape = "contango" | "backwardation" | "flat" | "unknown";

/**
 * Contango when the back of the curve (up to ~120 days) is above the front, backwardation when
 * below; flat within ±`flatBand` vol points. The front ignores expiries under 2 days, which are noisy.
 */
export function termShape(points: Array<{ T: number; atmIv: number }>, flatBand = 0.5): { shape: TermShape; slope: number } {
  const pts = (points ?? []).filter((p) => finitePos(p.T) && finitePos(p.atmIv)).sort((a, b) => a.T - b.T);
  const usable = pts.filter((p) => p.T * 365 >= 2);
  const front = usable[0] ?? pts[0];
  const backs = pts.filter((p) => p.T * 365 <= 120);
  const back = backs[backs.length - 1] ?? pts[pts.length - 1];
  if (!front || !back || front === back) return { shape: "unknown", slope: NaN };
  const slope = back.atmIv - front.atmIv;
  if (Math.abs(slope) < flatBand) return { shape: "flat", slope };
  return { shape: slope > 0 ? "contango" : "backwardation", slope };
}

/** 30-day constant-maturity ATM IV (percent) by total-variance interpolation. */
export function iv30FromTerm(points: Array<{ T: number; atmIv: number }>): number {
  const v = constantMaturityIV((points ?? []).map((p) => ({ T: p.T, iv: p.atmIv / 100 })), 30 / 365);
  return Number.isFinite(v) ? r2(v * 100) : NaN;
}

// ── Delta-bucket surface ──

export interface DeltaBucket {
  key: string;
  label: string;
  /** Target delta (puts negative). 0 marks ATM. */
  delta: number;
}

export const DELTA_BUCKETS: DeltaBucket[] = [
  { key: "10P", label: "10Δ P", delta: -0.1 },
  { key: "25P", label: "25Δ P", delta: -0.25 },
  { key: "40P", label: "40Δ P", delta: -0.4 },
  { key: "ATM", label: "ATM", delta: 0 },
  { key: "40C", label: "40Δ C", delta: 0.4 },
  { key: "25C", label: "25Δ C", delta: 0.25 },
  { key: "10C", label: "10Δ C", delta: 0.1 },
];

/** IV (percent) at a target delta by interpolating the OTM side; null outside the quoted range. */
export function ivAtDelta(smile: Smile, target: number): number | null {
  if (target === 0) return finitePos(smile.atmIv) ? r2(smile.atmIv) : null;
  const side = smile.points
    .filter((p) => p.iv !== null && p.delta !== null && (target < 0 ? (p.delta as number) < 0 : (p.delta as number) > 0))
    .map((p) => ({ x: p.delta as number, y: p.iv as number }))
    .sort((a, b) => a.x - b.x);
  if (side.length === 0) return null;
  if (target < side[0].x || target > side[side.length - 1].x) return null;
  for (let i = 1; i < side.length; i++) {
    const a = side[i - 1];
    const b = side[i];
    if (target <= b.x) return r2(b.x === a.x ? a.y : a.y + ((b.y - a.y) * (target - a.x)) / (b.x - a.x));
  }
  return side.length === 1 && side[0].x === target ? r2(side[0].y) : null;
}

export interface SurfaceRow {
  expiry: string;
  T: number;
  cells: Record<string, number | null>;
}

export function deltaSurface(smiles: Smile[], buckets: DeltaBucket[] = DELTA_BUCKETS): SurfaceRow[] {
  return smiles.map((s) => {
    const cells: Record<string, number | null> = {};
    for (const b of buckets) cells[b.key] = ivAtDelta(s, b.delta);
    return { expiry: s.expiry, T: s.T, cells };
  });
}

/** Min and max finite value across all cells (for colour scaling). */
export function surfaceRange(rows: SurfaceRow[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) for (const v of Object.values(r.cells)) if (v !== null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  return Number.isFinite(min) ? { min, max } : { min: NaN, max: NaN };
}

// ── Expected move per expiry ──

export interface MoveBand {
  move: number;
  upper: number;
  lower: number;
  pct: number;
}

export interface ExpectedMoveRow {
  expiry: string;
  dte: number;
  tradingDte: number;
  T: number;
  F: number;
  atmIv: number;
  iv1: MoveBand;
  iv2: MoveBand;
  straddle: number;
  straddleStrike: number;
  straddleMove: MoveBand;
  /** Straddle move ÷ IV move: above 1 means the straddle prices a bigger move than ATM IV alone. */
  ratio: number;
}

export function expectedMoveRows(expiries: ExpiryChain[], smiles: Smile[], spot: number, now: Date = new Date()): ExpectedMoveRow[] {
  const byExp = new Map(expiries.map((e) => [e.expiry, e.chain]));
  const term = termStructure(smiles, now);
  const out: ExpectedMoveRow[] = [];
  for (const t of term) {
    const chain = byExp.get(t.expiry) ?? [];
    const st = atmStraddle(chain, spot);
    const iv1 = expectedMoveFromIV(t.F, t.atmIv / 100, t.T, 1);
    const iv2 = expectedMoveFromIV(t.F, t.atmIv / 100, t.T, 2);
    const sm = expectedMoveFromStraddle(st.straddle, spot);
    out.push({
      expiry: t.expiry,
      dte: t.dte,
      tradingDte: t.tradingDte,
      T: t.T,
      F: t.F,
      atmIv: t.atmIv,
      iv1,
      iv2,
      straddle: st.straddle,
      straddleStrike: st.strike,
      straddleMove: sm,
      ratio: finitePos(iv1.move) && Number.isFinite(sm.move) ? sm.move / iv1.move : NaN,
    });
  }
  return out;
}
