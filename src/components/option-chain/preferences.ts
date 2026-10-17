/**
 * Column ids, presets and persisted chain preferences (columns, strike range, delta view).
 * Every storage access is wrapped in try/catch: private windows and blocked storage fall back
 * to the defaults.
 */
import { STRIKE_RANGES, type StrikeRange } from "./chainModel";

/** Ordered from the outer edge of the CALL side inwards to the strike column. PUT side mirrors it. */
export const COLUMN_ORDER = [
  "buildup",
  "premium",
  "liquidity",
  "probTouch",
  "probITM",
  "rho",
  "vega",
  "theta",
  "gamma",
  "delta",
  "spread",
  "bid",
  "ask",
  "volume",
  "oiChg",
  "oi",
  "oiBar",
  "iv",
  "ltpChg",
  "ltp",
] as const;

export type ColumnId = (typeof COLUMN_ORDER)[number];

export type PresetId = "basic" | "greeks" | "liquidity" | "sensibull" | "custom";

export const PRESETS: Record<Exclude<PresetId, "custom">, { label: string; description: string; columns: ColumnId[] }> = {
  // The id stays "sensibull" so preferences already stored in localStorage keep resolving;
  // only the visible label is neutral (no third-party brand names in the UI).
  sensibull: {
    label: "Classic",
    description: "Buildup, OI change, OI with bars, IV and LTP",
    columns: ["buildup", "oiChg", "oi", "oiBar", "iv", "ltpChg", "ltp"],
  },
  basic: {
    label: "Basic",
    description: "OI, OI change, volume, IV and LTP",
    columns: ["oiChg", "oi", "oiBar", "volume", "iv", "ltp"],
  },
  greeks: {
    label: "Greeks",
    description: "IV, Δ, Γ, Θ, ν, ρ and LTP",
    columns: ["iv", "delta", "gamma", "theta", "vega", "rho", "ltp"],
  },
  liquidity: {
    label: "Liquidity",
    description: "Bid, ask, spread, volume, score, premium traded, probabilities",
    columns: ["probITM", "probTouch", "premium", "liquidity", "volume", "spread", "bid", "ask", "ltp"],
  },
};

export const DEFAULT_PRESET: Exclude<PresetId, "custom"> = "sensibull";

export const COLUMNS_KEY = "mc_chain_columns_v1";
export const RANGE_KEY = "mc_chain_range_v1";
export const DELTA_VIEW_KEY = "mc_chain_delta_view_v1";

export interface ColumnPrefs {
  preset: PresetId;
  visible: ColumnId[];
}

const isColumnId = (x: unknown): x is ColumnId => typeof x === "string" && (COLUMN_ORDER as readonly string[]).includes(x);

/** Sort ids into canonical order and drop unknown or duplicate ids. */
export function normaliseColumns(ids: readonly unknown[]): ColumnId[] {
  const set = new Set(ids.filter(isColumnId));
  return COLUMN_ORDER.filter((id) => set.has(id));
}

export function presetColumns(preset: Exclude<PresetId, "custom">): ColumnId[] {
  return normaliseColumns(PRESETS[preset].columns);
}

/** Which preset (if any) exactly matches a column set. */
export function matchPreset(visible: readonly ColumnId[]): PresetId {
  const key = normaliseColumns(visible).join(",");
  for (const id of Object.keys(PRESETS) as Array<Exclude<PresetId, "custom">>) {
    if (presetColumns(id).join(",") === key) return id;
  }
  return "custom";
}

export function readColumnPrefs(): ColumnPrefs {
  const fallback: ColumnPrefs = { preset: DEFAULT_PRESET, visible: presetColumns(DEFAULT_PRESET) };
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const p = parsed as { visible?: unknown };
    const visible = Array.isArray(p.visible) ? normaliseColumns(p.visible) : [];
    if (visible.length === 0) return fallback;
    return { preset: matchPreset(visible), visible };
  } catch {
    return fallback;
  }
}

export function writeColumnPrefs(p: ColumnPrefs): void {
  try {
    localStorage.setItem(COLUMNS_KEY, JSON.stringify({ preset: p.preset, visible: p.visible }));
  } catch {
    /* ignore */
  }
}

export function readRange(): StrikeRange {
  try {
    const raw = localStorage.getItem(RANGE_KEY);
    if (raw === "all") return "all";
    const n = Number(raw);
    return (STRIKE_RANGES as Array<number | string>).includes(n) ? (n as StrikeRange) : 15;
  } catch {
    return 15;
  }
}

export function writeRange(r: StrikeRange): void {
  try {
    localStorage.setItem(RANGE_KEY, String(r));
  } catch {
    /* ignore */
  }
}

export function readBool(key: string, fallback = false): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writeBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
