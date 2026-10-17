/**
 * One-click screener presets. Each preset is a plain set of filter rules plus a default sort,
 * so selecting one fills the filter builder and stays editable.
 */
import type { FilterRule, SortDir, SortKey } from "./filters";
import { applyFilters } from "./filters";
import type { ScreenerRow } from "./metrics";
import { MWPL_NEAR_PCT } from "./metrics";

export type PresetId =
  | "long-buildup"
  | "short-buildup"
  | "short-covering"
  | "long-unwinding"
  | "iv-crush"
  | "cheap-vol"
  | "near-ban"
  | "volume-spike";

export type PresetTone = "bullish" | "bearish" | "info" | "warning" | "neutral";

export interface ScreenerPreset {
  id: PresetId;
  label: string;
  description: string;
  tone: PresetTone;
  rules: FilterRule[];
  sort: { key: SortKey; dir: SortDir };
}

export const IV_CRUSH_RATIO = 1.3;
export const VOLUME_SPIKE_RATIO = 3;

export const PRESETS: readonly ScreenerPreset[] = [
  {
    id: "long-buildup",
    label: "Long buildup",
    description: "Price up and futures OI up: fresh longs are being added.",
    tone: "bullish",
    rules: [{ id: "p-lb", kind: "buildup", values: ["LONG_BUILDUP"] }],
    sort: { key: "oiChangePct", dir: "desc" },
  },
  {
    id: "short-buildup",
    label: "Short buildup",
    description: "Price down and futures OI up: fresh shorts are being added.",
    tone: "bearish",
    rules: [{ id: "p-sb", kind: "buildup", values: ["SHORT_BUILDUP"] }],
    sort: { key: "oiChangePct", dir: "desc" },
  },
  {
    id: "short-covering",
    label: "Short covering",
    description: "Price up and futures OI down: shorts are closing positions.",
    tone: "info",
    rules: [{ id: "p-sc", kind: "buildup", values: ["SHORT_COVERING"] }],
    sort: { key: "oiChangePct", dir: "asc" },
  },
  {
    id: "long-unwinding",
    label: "Long unwinding",
    description: "Price down and futures OI down: longs are closing positions.",
    tone: "warning",
    rules: [{ id: "p-lu", kind: "buildup", values: ["LONG_UNWINDING"] }],
    sort: { key: "oiChangePct", dir: "asc" },
  },
  {
    id: "iv-crush",
    label: "IV crush candidates",
    description: `ATM IV at least ${IV_CRUSH_RATIO}× the 20-day HV. Rich premium that often deflates after results or events.`,
    tone: "warning",
    rules: [{ id: "p-ivc", kind: "number", field: "ivHvRatio", op: "gte", value: IV_CRUSH_RATIO }],
    sort: { key: "ivHvRatio", dir: "desc" },
  },
  {
    id: "cheap-vol",
    label: "Cheap vol (IV<HV)",
    description: "ATM IV below the 20-day HV: options price less movement than the stock has shown.",
    tone: "info",
    rules: [{ id: "p-cv", kind: "number", field: "ivHvRatio", op: "lt", value: 1 }],
    sort: { key: "ivHvRatio", dir: "asc" },
  },
  {
    id: "near-ban",
    label: "Near ban ≥80% MWPL",
    description: "Combined OI at or above 80% of the market-wide position limit. NSE bans new positions at 95%.",
    tone: "bearish",
    rules: [{ id: "p-nb", kind: "number", field: "mwplPct", op: "gte", value: MWPL_NEAR_PCT }],
    sort: { key: "mwplPct", dir: "desc" },
  },
  {
    id: "volume-spike",
    label: "Volume spike 3×",
    description: `Today's volume at least ${VOLUME_SPIKE_RATIO}× the 5-session average.`,
    tone: "neutral",
    rules: [{ id: "p-vs", kind: "number", field: "volRatio", op: "gte", value: VOLUME_SPIKE_RATIO }],
    sort: { key: "volRatio", dir: "desc" },
  },
];

export function getPreset(id: string | null | undefined): ScreenerPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Copy of a preset's rules with fresh ids, so edits never mutate the preset. */
export function presetRules(p: ScreenerPreset): FilterRule[] {
  return p.rules.map((r, i) => ({ ...r, id: `${p.id}-${i}` }) as FilterRule);
}

/** Matching row count per preset (search and sector filters are not applied). */
export function presetCounts(rows: readonly ScreenerRow[]): Record<PresetId, number> {
  const out = {} as Record<PresetId, number>;
  for (const p of PRESETS) out[p.id] = applyFilters(rows, { search: "", sectors: [], rules: p.rules }).length;
  return out;
}
