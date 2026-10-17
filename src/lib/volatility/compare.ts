/**
 * Cross-symbol volatility comparison (pure, node-safe). IV values are in PERCENT.
 * One row per symbol from its multi-expiry chain and IV-rank stats, plus the IV spread between
 * two symbols' IV histories (e.g. BANKNIFTY − NIFTY).
 */
import { atmStraddle, EM_METHOD_LABEL, expectedMoves, maxPain, type ExpectedMoveMethod } from "@/lib/options";
import type { IvPoint } from "./history";
import { symbolKind } from "./screener";
import type { Smile } from "./smile";
import type { ExpiryChain } from "./surface";

export const COMPARE_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"] as const;
export const MAX_COMPARE_STOCKS = 4;

const finitePos = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const r2 = (x: number) => Math.round(x * 100) / 100;

export interface CompareInput {
  symbol: string;
  spot: number;
  chains: ExpiryChain[];
  /** Smiles sorted by maturity (from buildExpirySmiles). */
  smiles: Smile[];
  iv30: number;
  ivRank: number | null;
  ivPercentile: number | null;
  /** True when the chain is the labelled sample. */
  sample: boolean;
  /** True when IVR/IVP come from the labelled sample history. */
  historySample: boolean;
  /** Minimum calendar days for the front expiry (skips expiry-day noise). Default 2. */
  minDays?: number;
}

export interface CompareRow {
  symbol: string;
  kind: "INDEX" | "STOCK";
  expiry: string;
  dte: number;
  spot: number;
  /** Front-expiry ATM IV. */
  atmIv: number;
  iv30: number;
  ivRank: number | null;
  ivPercentile: number | null;
  rr25: number;
  /** Put OI ÷ call OI for the front expiry; NaN without OI. */
  pcr: number;
  maxPain: number;
  /** (max pain ÷ spot − 1) × 100. */
  maxPainDistPct: number;
  /** Expected move, always a 1σ band (IV 1σ, or the straddle scaled to 1σ when there is no IV band). */
  em: { move: number; pct: number; method: ExpectedMoveMethod; label: string };
  straddle: number;
  /** Straddle ÷ spot × 100. */
  straddlePct: number;
  sample: boolean;
  historySample: boolean;
}

/** σ√T·S per unit of ATM straddle: the straddle prices E|ΔS| = √(2/π)·σ√T·S. */
export const STRADDLE_TO_1SIGMA = Math.sqrt(Math.PI / 2);
export const STRADDLE_1SIGMA_LABEL = "Straddle 1σ (×1.25)";

/** One comparison row from the front expiry at least `minDays` out. Null without a usable smile. */
export function buildCompareRow(i: CompareInput): CompareRow | null {
  if (!finitePos(i.spot)) return null;
  const minDays = i.minDays ?? 2;
  const smile = i.smiles.find((s) => s.T * 365 >= minDays && finitePos(s.atmIv)) ?? i.smiles.find((s) => finitePos(s.atmIv));
  if (!smile) return null;
  const chain = i.chains.find((c) => c.expiry === smile.expiry)?.chain ?? [];
  let ce = 0;
  let pe = 0;
  for (const r of chain) {
    ce += Number.isFinite(r.ce?.oi) ? r.ce.oi : 0;
    pe += Number.isFinite(r.pe?.oi) ? r.pe.oi : 0;
  }
  const mp = chain.length ? maxPain(chain) : NaN;
  const st = chain.length ? atmStraddle(chain, i.spot) : { straddle: NaN, strike: NaN };
  const ems = expectedMoves({ spot: i.spot, forward: smile.F, atmIv: smile.atmIv / 100, tYears: smile.T, straddle: st.straddle });
  const useIv = Number.isFinite(ems.iv.move);
  // The column always means a 1σ move so rows sort on one definition. Without an IV band, the
  // straddle is scaled to its 1σ equivalent: an ATM straddle ≈ √(2/π)·σ√T·S, so σ√T·S ≈ 1.2533 ×
  // straddle (not the 0.85× "typical move", which is about 0.68σ and would look ~25% calmer).
  const straddle1s = finitePos(st.straddle) ? STRADDLE_TO_1SIGMA * st.straddle : NaN;
  const band = useIv ? ems.iv : { move: straddle1s, pct: (straddle1s / i.spot) * 100 };
  const method: ExpectedMoveMethod = useIv ? "iv" : "straddle";
  return {
    symbol: i.symbol.toUpperCase(),
    kind: symbolKind(i.symbol),
    expiry: smile.expiry,
    dte: Math.max(0, Math.round(smile.T * 365)),
    spot: i.spot,
    atmIv: r2(smile.atmIv),
    iv30: i.iv30,
    ivRank: i.ivRank,
    ivPercentile: i.ivPercentile,
    rr25: smile.rr25,
    pcr: ce > 0 ? r2(pe / ce) : NaN,
    maxPain: finitePos(mp) ? mp : NaN,
    maxPainDistPct: finitePos(mp) ? r2((mp / i.spot - 1) * 100) : NaN,
    em: { move: band.move, pct: band.pct, method, label: useIv ? EM_METHOD_LABEL.iv : STRADDLE_1SIGMA_LABEL },
    straddle: Number.isFinite(st.straddle) ? st.straddle : NaN,
    straddlePct: finitePos(st.straddle) ? r2((st.straddle / i.spot) * 100) : NaN,
    sample: i.sample,
    historySample: i.historySample,
  };
}

export type CompareSortKey = "symbol" | "atmIv" | "ivPercentile" | "pcr" | "maxPainDistPct" | "emPct" | "straddlePct";

/** Sort rows by a key; missing values go last. */
export function sortCompareRows(rows: CompareRow[], key: CompareSortKey, dir: "asc" | "desc" = "desc"): CompareRow[] {
  const val = (r: CompareRow): number | string | null => {
    switch (key) {
      case "symbol":
        return r.symbol;
      case "emPct":
        return Number.isFinite(r.em.pct) ? r.em.pct : null;
      case "ivPercentile":
        return r.ivPercentile;
      default: {
        const v = r[key];
        return Number.isFinite(v) ? v : null;
      }
    }
  };
  const s = dir === "asc" ? 1 : -1;
  return [...(rows ?? [])].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * s;
    return (va - vb) * s;
  });
}

// ── IV spread between two symbols ──

export interface SpreadRow {
  date: string;
  a: number;
  b: number;
  /** b − a, vol points. */
  spread: number;
}

export interface SpreadSeries {
  rows: SpreadRow[];
  mean: number;
  sd: number;
  last: number;
  /** (last − mean) ÷ sd; NaN with fewer than 10 rows. */
  z: number;
}

/** Date-joined IVs of two series and their spread (b − a). */
export function ivSpreadSeries(a: IvPoint[], b: IvPoint[]): SpreadSeries {
  const am = new Map((a ?? []).filter((p) => p && finitePos(p.iv)).map((p) => [p.date, p.iv]));
  const rows: SpreadRow[] = [];
  for (const p of b ?? []) {
    if (!p || !finitePos(p.iv)) continue;
    const av = am.get(p.date);
    if (av === undefined) continue;
    rows.push({ date: p.date, a: av, b: p.iv, spread: r2(p.iv - av) });
  }
  rows.sort((x, y) => (x.date < y.date ? -1 : 1));
  const xs = rows.map((r) => r.spread);
  const m = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
  const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)) : NaN;
  const last = xs.length ? xs[xs.length - 1] : NaN;
  return { rows, mean: r2(m), sd: r2(sd), last, z: xs.length >= 10 && sd > 0 ? r2((last - m) / sd) : NaN };
}

/** Parse a comma-separated stock list from the URL: valid, unique, not an index, at most MAX_COMPARE_STOCKS. */
export function parseCompareStocks(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? "").split(",")) {
    const s = part.trim().toUpperCase();
    if (!/^[A-Z0-9&-]{1,20}$/.test(s)) continue;
    if ((COMPARE_INDICES as readonly string[]).includes(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_COMPARE_STOCKS) break;
  }
  return out;
}
