/**
 * The Strategy Builder "seam" (1CLIQ-TRADE-SPEC.md §9): maps the builder's legs onto the basket
 * engine's leg specs for "Save as basket" / basket-deploy, through one testable function.
 */

/** The fields of a Strategy Builder leg this mapper reads (src/lib/options Leg). */
export interface BuilderLegLike {
  type: "CE" | "PE" | "FUT";
  side: "BUY" | "SELL";
  strike: number;
  lots: number;
  /** ISO yyyy-mm-dd; empty when the leg has no expiry yet. */
  expiry?: string;
  enabled?: boolean;
}

/** Mirrors server/lib/basketEngine.mjs's BasketLeg JSDoc shape exactly. */
export interface BasketLegInput {
  legId: string;
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  lots: number;
  strikeSpec: { kind: "absolute"; strike: number };
  expirySpec: { kind: "absolute"; date: string } | { kind: "nearest"; weeksOut: 0 | 1 | 2 | "monthly" };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builder legs → BasketLegInput[]. Disabled legs and futures are skipped (baskets hold option legs).
 *
 * Strikes use an ABSOLUTE strikeSpec: the strikes picked in the builder are exact numbers, not
 * "ATM+2" offsets, so relative specs would silently redefine the strategy once spot moves. A leg
 * with an ISO expiry keeps it (absolute expirySpec); one without falls back to the nearest weekly.
 * resolveBasket() re-resolves every spec at deploy time, never at save time (spec §9).
 */
export function mapLegsToBasketLegs(legs: BuilderLegLike[]): BasketLegInput[] {
  const out: BasketLegInput[] = [];
  for (const leg of legs) {
    if (leg.enabled === false || leg.type === "FUT") continue;
    out.push({
      legId: `leg-${out.length + 1}`,
      action: leg.side,
      optionType: leg.type,
      lots: leg.lots,
      strikeSpec: { kind: "absolute", strike: leg.strike },
      expirySpec: leg.expiry && ISO_DATE.test(leg.expiry) ? { kind: "absolute", date: leg.expiry } : { kind: "nearest", weeksOut: 0 },
    });
  }
  return out;
}
