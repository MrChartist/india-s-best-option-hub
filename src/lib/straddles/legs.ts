/**
 * Hand-off from the straddle tools to the shared basket and the Strategy Builder.
 * Premiums are rupees per unit; IV is a decimal (BasketLeg contract).
 */
import { strategyBuilderUrl, type BasketLeg } from "@/components/option-chain/basket";
import type { Side } from "@/lib/options";

export interface PairQuote {
  strike: number;
  /** ₹ per unit (mid or LTP). */
  premium: number;
  /** Percent as the chain reports it (0 or NaN = unknown). */
  ivPct?: number;
}

const ivDecimal = (pct: number | undefined) => (typeof pct === "number" && Number.isFinite(pct) && pct > 0 ? Math.round(pct * 100) / 10_000 : null);

/** CE and PE legs for a straddle or custom pair, or [] when a strike or premium is missing. */
export function pairLegs(o: { symbol: string; expiry: string; ce: PairQuote; pe: PairQuote; side: Side; lots?: number }): BasketLeg[] {
  const symbol = String(o?.symbol || "").toUpperCase();
  const lots = Math.max(1, Math.round(o?.lots ?? 1));
  if (!symbol || !o.expiry) return [];
  const ok = (q: PairQuote) => q && Number.isFinite(q.strike) && q.strike > 0 && Number.isFinite(q.premium) && q.premium > 0;
  if (!ok(o.ce) || !ok(o.pe)) return [];
  return [
    { symbol, expiry: o.expiry, strike: o.ce.strike, type: "CE", side: o.side, lots, premium: Math.round(o.ce.premium * 100) / 100, iv: ivDecimal(o.ce.ivPct) },
    { symbol, expiry: o.expiry, strike: o.pe.strike, type: "PE", side: o.side, lots, premium: Math.round(o.pe.premium * 100) / 100, iv: ivDecimal(o.pe.ivPct) },
  ];
}

/** Strategy Builder link for the pair (replaces the builder's legs). Empty string when the legs are incomplete. */
export function pairBuilderUrl(o: Parameters<typeof pairLegs>[0]): string {
  const legs = pairLegs(o);
  return legs.length === 2 ? strategyBuilderUrl(legs) : "";
}
