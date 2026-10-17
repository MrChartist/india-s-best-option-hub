/**
 * Filter builder, sorting and CSV export for screener rows. Pure and unit tested.
 */
import { BUILDUP_LABEL, type Buildup } from "@/lib/options";
import type { MwplStatus, ScreenerRow } from "./metrics";

export type NumericField =
  | "ltp"
  | "changePct"
  | "oiChangePct"
  | "atmIv"
  | "ivp"
  | "hv20"
  | "ivHvRatio"
  | "pcrOi"
  | "volRatio"
  | "mwplPct"
  | "basisPct"
  | "carryPct"
  | "rolloverPct";

export type NumericOp = "gt" | "gte" | "lt" | "lte" | "between";

export type FilterRule =
  | { id: string; kind: "number"; field: NumericField; op: NumericOp; value: number; value2?: number }
  | { id: string; kind: "buildup"; values: Buildup[] }
  | { id: string; kind: "banned"; value: boolean }
  | { id: string; kind: "instrument"; value: "STOCK" | "INDEX" };

export interface NumericFieldMeta {
  field: NumericField;
  label: string;
  unit: string;
  hint: string;
  step: number;
}

export const NUMERIC_FIELDS: readonly NumericFieldMeta[] = [
  { field: "changePct", label: "Price change", unit: "%", hint: "Day change in the underlying", step: 0.5 },
  { field: "oiChangePct", label: "Futures OI change", unit: "%", hint: "Change in futures open interest", step: 1 },
  { field: "atmIv", label: "ATM IV", unit: "%", hint: "Near-expiry at-the-money implied volatility", step: 1 },
  { field: "ivp", label: "IV percentile", unit: "", hint: "Share of past days with lower ATM IV (needs 20 recorded days)", step: 5 },
  { field: "hv20", label: "HV 20", unit: "%", hint: "20-day historical volatility", step: 1 },
  { field: "ivHvRatio", label: "IV ÷ HV", unit: "×", hint: "ATM IV divided by 20-day HV", step: 0.1 },
  { field: "pcrOi", label: "PCR (OI)", unit: "", hint: "Put OI ÷ call OI", step: 0.1 },
  { field: "volRatio", label: "Volume vs 5-day", unit: "×", hint: "Today's volume ÷ 5-session average", step: 0.5 },
  { field: "mwplPct", label: "MWPL used", unit: "%", hint: "Combined OI as a share of the market-wide position limit", step: 5 },
  { field: "basisPct", label: "Basis", unit: "%", hint: "Near future minus underlying, as % of underlying", step: 0.1 },
  { field: "carryPct", label: "Carry (annualised)", unit: "%", hint: "Annualised cost of carry from the near future", step: 1 },
  { field: "rolloverPct", label: "Rollover", unit: "%", hint: "Futures OI in next and far months", step: 5 },
  { field: "ltp", label: "Price", unit: "₹", hint: "Last traded price of the underlying", step: 10 },
];

export const FIELD_META: Readonly<Record<NumericField, NumericFieldMeta>> = Object.fromEntries(NUMERIC_FIELDS.map((m) => [m.field, m])) as Record<NumericField, NumericFieldMeta>;

export const OP_LABEL: Readonly<Record<NumericOp, string>> = { gt: ">", gte: "≥", lt: "<", lte: "≤", between: "between" };

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function matchesRule(row: ScreenerRow, rule: FilterRule): boolean {
  switch (rule.kind) {
    case "number": {
      const v = row[rule.field];
      if (!finite(v)) return false;
      if (!finite(rule.value)) return true;
      switch (rule.op) {
        case "gt":
          return v > rule.value;
        case "gte":
          return v >= rule.value;
        case "lt":
          return v < rule.value;
        case "lte":
          return v <= rule.value;
        case "between": {
          const hi = finite(rule.value2) ? rule.value2 : rule.value;
          const lo = Math.min(rule.value, hi);
          return v >= lo && v <= Math.max(rule.value, hi);
        }
        default:
          return true;
      }
    }
    case "buildup":
      return rule.values.length === 0 || rule.values.includes(row.buildup);
    case "banned":
      return row.banned === rule.value;
    case "instrument":
      return row.kind === rule.value;
    default:
      return true;
  }
}

export interface FilterState {
  search: string;
  sectors: string[];
  rules: FilterRule[];
}

export const EMPTY_FILTERS: FilterState = { search: "", sectors: [], rules: [] };

export function applyFilters(rows: readonly ScreenerRow[], f: FilterState): ScreenerRow[] {
  const q = f.search.trim().toUpperCase();
  const sectors = new Set(f.sectors);
  return rows.filter((r) => {
    if (q && !r.symbol.includes(q) && !r.sector.toUpperCase().includes(q)) return false;
    if (sectors.size > 0 && !sectors.has(r.sector)) return false;
    for (const rule of f.rules) if (!matchesRule(r, rule)) return false;
    return true;
  });
}

// ── Sorting ──

export type SortKey = NumericField | "symbol" | "buildup" | "volume" | "mwplStatus";
export type SortDir = "asc" | "desc";

const BUILDUP_ORDER: Record<Buildup, number> = { LONG_BUILDUP: 0, SHORT_COVERING: 1, NEUTRAL: 2, LONG_UNWINDING: 3, SHORT_BUILDUP: 4 };
const MWPL_ORDER: Record<MwplStatus, number> = { BAN: 3, DANGER: 2, NEAR: 1, OK: 0 };

function sortValue(r: ScreenerRow, key: SortKey): number | string | null {
  if (key === "symbol") return r.symbol;
  if (key === "buildup") return BUILDUP_ORDER[r.buildup];
  if (key === "mwplStatus") return r.mwplStatus ? MWPL_ORDER[r.mwplStatus] * 1000 + (r.mwplPct ?? 0) : null;
  const v = r[key];
  return finite(v) ? v : null;
}

/** Stable sort; missing values always go last whatever the direction. */
export function sortRows(rows: readonly ScreenerRow[], key: SortKey, dir: SortDir): ScreenerRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, key) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      if (typeof a.v === "string" || typeof b.v === "string") {
        const c = String(a.v).localeCompare(String(b.v));
        return c !== 0 ? c * sign : a.i - b.i;
      }
      return a.v !== b.v ? (a.v - b.v) * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

// ── CSV ──

function cell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && !Number.isFinite(v)) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS: ReadonlyArray<{ header: string; get: (r: ScreenerRow) => string | number | boolean | null }> = [
  { header: "symbol", get: (r) => r.symbol },
  { header: "type", get: (r) => r.kind },
  { header: "sector", get: (r) => r.sector },
  { header: "ltp", get: (r) => r.ltp },
  { header: "change_pct", get: (r) => r.changePct },
  { header: "oi_change_pct", get: (r) => r.oiChangePct },
  { header: "oi_source", get: (r) => r.oiSource },
  { header: "buildup", get: (r) => BUILDUP_LABEL[r.buildup] },
  { header: "atm_iv_pct", get: (r) => r.atmIv },
  { header: "ivp", get: (r) => r.ivp },
  { header: "hv20_pct", get: (r) => r.hv20 },
  { header: "iv_hv_ratio", get: (r) => r.ivHvRatio },
  { header: "pcr_oi", get: (r) => r.pcrOi },
  { header: "pcr_source", get: (r) => r.pcrSource },
  { header: "volume", get: (r) => r.volume },
  { header: "volume_vs_5d", get: (r) => r.volRatio },
  { header: "mwpl_pct", get: (r) => r.mwplPct },
  { header: "in_ban", get: (r) => (r.banned ? "yes" : "no") },
  { header: "basis", get: (r) => r.basis },
  { header: "basis_pct", get: (r) => r.basisPct },
  { header: "carry_annualised_pct", get: (r) => r.carryPct },
  { header: "rollover_pct", get: (r) => r.rolloverPct },
  { header: "data", get: (r) => (r.isSample ? "sample" : "market") },
];

export function rowsToCSV(rows: readonly ScreenerRow[]): string {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => cell(c.get(r))).join(","));
  return lines.join("\n");
}

let ruleSeq = 0;
/** Unique-enough id for a new filter rule. */
export function newRuleId(): string {
  ruleSeq += 1;
  return `r${Date.now().toString(36)}${ruleSeq}`;
}
