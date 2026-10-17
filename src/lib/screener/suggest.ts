/**
 * Preset-aware "Suggested structure" for a screener row.
 *
 *   IV crush candidate  → short ≈16Δ strangle with protective wings (an iron condor)
 *   Cheap vol (IV < HV) → long ATM straddle
 *   Long buildup        → bull call spread (buy ATM CE, sell an OTM CE)
 *   Short buildup       → bear put spread  (buy ATM PE, sell an OTM PE)
 *
 * Legs are built with the shared basket builders (buildStrangle / buildStraddle / legFromRow) on a
 * chain view model, so the premiums and IVs are exactly what the option chain would hand to the
 * Strategy Builder. Pure: no fetches, no React.
 */
import { buildStraddle, buildStrangle, legFromRow, type BasketLeg } from "@/components/option-chain/basket";
import { nearestStrike, oneSigmaPoints, type ChainModel, type RowView } from "@/components/option-chain/chainModel";
import { getExpiries } from "@/lib/options";
import { IV_CRUSH_RATIO, type PresetId } from "./presets";
import type { ScreenerRow } from "./metrics";

export type SuggestionKind = "short-strangle" | "long-straddle" | "bull-call-spread" | "bear-put-spread";

export interface SuggestionMeta {
  kind: SuggestionKind;
  title: string;
  /** Why this structure fits the row, in one sentence. */
  rationale: string;
  /** Market view the structure expresses. */
  view: "neutral" | "volatile" | "bullish" | "bearish";
  risk: "defined" | "unlimited";
}

export const SUGGESTION_META: Readonly<Record<SuggestionKind, Omit<SuggestionMeta, "rationale">>> = {
  "short-strangle": {
    kind: "short-strangle",
    title: "Short ≈16Δ strangle with wings",
    view: "neutral",
    risk: "defined",
  },
  "long-straddle": { kind: "long-straddle", title: "Long ATM straddle", view: "volatile", risk: "defined" },
  "bull-call-spread": { kind: "bull-call-spread", title: "Bull call spread", view: "bullish", risk: "defined" },
  "bear-put-spread": { kind: "bear-put-spread", title: "Bear put spread", view: "bearish", risk: "defined" },
};

const PRESET_KIND: Partial<Record<PresetId, SuggestionKind>> = {
  "iv-crush": "short-strangle",
  "cheap-vol": "long-straddle",
  "long-buildup": "bull-call-spread",
  "short-buildup": "bear-put-spread",
};

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const fmt2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

/**
 * Which structure to suggest. The active preset wins (it is the reason the row is on screen);
 * without one the row's own signals decide, in the order IV/HV, then futures buildup.
 * Null when nothing in the row supports a view.
 */
export function suggestionFor(
  row: Pick<ScreenerRow, "ivHvRatio" | "buildup">,
  preset: PresetId | null,
): SuggestionMeta | null {
  const fromPreset = preset ? PRESET_KIND[preset] : undefined;
  let kind: SuggestionKind | undefined = fromPreset;
  if (!kind) {
    if (fin(row.ivHvRatio) && row.ivHvRatio >= IV_CRUSH_RATIO) kind = "short-strangle";
    else if (fin(row.ivHvRatio) && row.ivHvRatio < 1) kind = "long-straddle";
    else if (row.buildup === "LONG_BUILDUP") kind = "bull-call-spread";
    else if (row.buildup === "SHORT_BUILDUP") kind = "bear-put-spread";
  }
  if (!kind) return null;
  return { ...SUGGESTION_META[kind], rationale: rationaleFor(kind, row) };
}

function rationaleFor(kind: SuggestionKind, row: Pick<ScreenerRow, "ivHvRatio" | "buildup">): string {
  const ratio = fin(row.ivHvRatio) ? `IV is ${fmt2(row.ivHvRatio)}× the 20-day HV` : "";
  switch (kind) {
    case "short-strangle":
      return `${ratio || "Implied volatility is rich"}: sell premium about one standard deviation out and buy wings so the loss is capped if the stock breaks out.`;
    case "long-straddle":
      return `${ratio || "Implied volatility is cheap"}: options price less movement than the stock has been making, so owning both sides is relatively inexpensive.`;
    case "bull-call-spread":
      return "Price and futures OI are both rising (long buildup): a debit call spread takes the bullish view with a fixed maximum loss.";
    case "bear-put-spread":
      return "Price is falling while futures OI rises (short buildup): a debit put spread takes the bearish view with a fixed maximum loss.";
    default:
      return "";
  }
}

/**
 * Expiry to trade: the nearest one with at least `minDte` calendar days left (a structure that
 * expires tomorrow is mostly gamma risk), else the nearest.
 */
export function pickExpiry(symbol: string, now: Date = new Date(), minDte = 5): string | null {
  const list = getExpiries(symbol, now, 6);
  if (list.length === 0) return null;
  return (list.find((e) => e.dte >= minDte) ?? list[0]).date;
}

/** Strike `steps` listed strikes away from `strike` (positive = higher). Clamped to the chain. */
export function strikeOffset(rows: readonly RowView[], strike: number, steps: number): number {
  const idx = rows.findIndex((r) => r.strike === strike);
  if (idx < 0) return NaN;
  const j = Math.max(0, Math.min(rows.length - 1, idx + steps));
  return rows[j].strike;
}

/** Strike beyond `strike` by at least `minPoints` and at least one listed strike, in `dir`. */
function strikeBeyond(rows: readonly RowView[], strike: number, minPoints: number, dir: 1 | -1): number {
  const target = nearestStrike(rows as RowView[], strike + dir * Math.max(0, minPoints));
  if (!fin(target)) return NaN;
  if ((dir === 1 && target > strike) || (dir === -1 && target < strike)) return target;
  const next = strikeOffset(rows, strike, dir);
  return next !== strike ? next : NaN;
}

export interface SuggestedStructure {
  meta: SuggestionMeta;
  legs: BasketLeg[];
  /** Why legs could not be built (empty legs), for the UI. */
  error?: string;
}

/**
 * Build the legs on a chain model. `symbol` and `expiry` go on every leg; one lot each.
 * Returns empty legs with an `error` when the chain cannot support the structure.
 */
export function buildSuggestedLegs(
  meta: SuggestionMeta,
  model: Pick<ChainModel, "rows" | "spot" | "forward" | "atmIv" | "T" | "atmStrike">,
  symbol: string,
  expiry: string,
): SuggestedStructure {
  const rows = model.rows;
  const ctx = { symbol, expiry, lots: 1 };
  if (rows.length < 5 || !fin(model.atmStrike))
    return { meta, legs: [], error: "The option chain has too few strikes." };
  const sigma = oneSigmaPoints(model);
  const centre = fin(model.forward) && model.forward > 0 ? model.forward : model.spot;
  const fail = (error: string): SuggestedStructure => ({ meta, legs: [], error });

  switch (meta.kind) {
    case "short-strangle": {
      if (!fin(sigma) || sigma <= 0) return fail("ATM IV is unavailable, so the 1σ (≈16Δ) strikes cannot be placed.");
      const shorts = buildStrangle(rows as RowView[], centre, sigma, "SELL", ctx);
      if (shorts.length !== 2) return fail("No listed strikes about one standard deviation away.");
      const ceShort = shorts.find((l) => l.type === "CE") as BasketLeg;
      const peShort = shorts.find((l) => l.type === "PE") as BasketLeg;
      const wing = sigma * 0.5;
      const ceWingK = strikeBeyond(rows, ceShort.strike, wing, 1);
      const peWingK = strikeBeyond(rows, peShort.strike, wing, -1);
      const ceWingRow = rows.find((r) => r.strike === ceWingK);
      const peWingRow = rows.find((r) => r.strike === peWingK);
      if (!ceWingRow || !peWingRow) return fail("The chain does not list strikes far enough out for the wings.");
      return {
        meta,
        legs: [ceShort, peShort, legFromRow(ceWingRow, "CE", "BUY", ctx), legFromRow(peWingRow, "PE", "BUY", ctx)],
      };
    }
    case "long-straddle": {
      const legs = buildStraddle(rows as RowView[], model.atmStrike, "BUY", ctx);
      return legs.length === 2 ? { meta, legs } : fail("The ATM strike is missing from the chain.");
    }
    case "bull-call-spread":
    case "bear-put-spread": {
      const bull = meta.kind === "bull-call-spread";
      const atmRow = rows.find((r) => r.strike === model.atmStrike);
      if (!atmRow) return fail("The ATM strike is missing from the chain.");
      const width = fin(sigma) && sigma > 0 ? sigma * 0.5 : 0;
      const farK = strikeBeyond(rows, model.atmStrike, width, bull ? 1 : -1);
      const farRow = rows.find((r) => r.strike === farK);
      if (!farRow) return fail("No listed strike beyond the ATM strike for the short leg.");
      const type = bull ? "CE" : "PE";
      return { meta, legs: [legFromRow(atmRow, type, "BUY", ctx), legFromRow(farRow, type, "SELL", ctx)] };
    }
    default:
      return fail("Unknown structure.");
  }
}

/** Net premium per unit (positive = credit) and the number of legs priced at zero. */
export function netPremiumPerUnit(legs: readonly BasketLeg[]): { net: number; unpriced: number } {
  let net = 0;
  let unpriced = 0;
  for (const l of legs) {
    if (!(l.premium > 0)) unpriced += 1;
    net += (l.side === "SELL" ? 1 : -1) * l.premium * l.lots;
  }
  return { net: Math.round(net * 100) / 100, unpriced };
}
