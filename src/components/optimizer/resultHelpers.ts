import { formatDateIST, formatINR } from "@/lib/options";
import { payoffTag, type PayoffTag, type PayoffTone, type RankedCandidate } from "@/lib/optimizer";

export interface PayoffView {
  symbol: string;
  spot: number;
  target: number;
  lower: number;
  upper: number;
  nowMs: number;
  atDateMs: number;
  frontExpiryMs: number;
  atExpiry: boolean;
  r: number;
}

export interface ResultActions {
  onOpen: (c: RankedCandidate) => void;
  onAddToBasket: (c: RankedCandidate) => void;
  onPaperTrade: (c: RankedCandidate) => void;
}

/** Badge variant for a payoff tone. */
export const TONE_VARIANT: Record<PayoffTone, "bullish" | "bearish" | "neutral" | "info"> = {
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
  volatile: "info",
};

/** "Profits if NIFTY stays below 24,373" (plus "on 20 Oct 2026" when the target date is before expiry). */
export function tagFor(c: Pick<RankedCandidate, "profitZones">, view: PayoffView): PayoffTag {
  return payoffTag(c.profitZones, {
    symbol: view.symbol,
    spot: view.spot,
    target: view.target,
    on: view.atExpiry ? undefined : formatDateIST(view.atDateMs),
  });
}

export function money(v: number, unlimited: boolean): string {
  if (unlimited || v === Infinity || v === -Infinity) return "Unlimited";
  return formatINR(v, { decimals: 0 });
}

export function sizeLabel(c: Pick<RankedCandidate, "legs" | "lots">): string {
  return c.legs.every((l) => l.ratio === 1) ? `${c.lots} lot${c.lots === 1 ? "" : "s"}` : `${c.lots}× set`;
}

export const FUNDS_HINT =
  "Funds required: SPAN-style span + exposure margin + any expiry-day ELM + net premium paid. Premium received on short legs offsets premium paid on long legs, so a debit spread blocks only its net debit. Your broker's figure will differ.";

export const RETURN_HINT = "Net profit at your target price and date, after estimated round-trip charges, divided by funds required.";

export const ELM_HINT = "A short index option expires today, so SEBI's extra 2% expiry-day extreme loss margin is included in funds required.";

export const VIEW_HINT_NEUTRAL = "Delta neutral and already in profit at today's spot, so it fits a range-bound view. Ranked a little higher.";
export const VIEW_HINT_DIRECTIONAL = "Net delta points the same way as your view.";
