/**
 * The StrategyBuilder "seam" (1CLIQ-TRADE-SPEC.md §9's "StrategyBuilder seam"
 * paragraph): the leg-mapping logic that used to live inline inside
 * handleAddStrategyToPositions, extracted so both the existing "Add to
 * Positions" flow and the new "Save as Basket" flow map the SAME `legs`
 * state through a single, testable function instead of two hand-written
 * copies that can drift apart.
 */

import type { StrategyLeg } from "./mockData";
import type { PendingTrade } from "@/components/TradeConfirmDialog";

/**
 * Leg -> PendingTrade, exactly as handleAddStrategyToPositions did inline
 * before this extraction (StrategyBuilder.tsx originally lines 210-213).
 * Feeds the existing paper/live TradeConfirmDialog flow unchanged.
 */
export function mapLegsToPendingTrades(legs: StrategyLeg[], symbol: string, lotSize: number): PendingTrade[] {
  return legs.map((leg) => ({
    symbol, strike: leg.strike, optionType: leg.type, action: leg.action,
    lots: leg.lots, price: leg.premium, lotSize,
  }));
}

/** Mirrors server/lib/basketEngine.mjs's BasketLeg JSDoc shape exactly. */
export interface BasketLegInput {
  legId: string;
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  lots: number;
  strikeSpec: { kind: "absolute"; strike: number };
  expirySpec: { kind: "nearest"; weeksOut: 0 | 1 | 2 | "monthly" };
}

/**
 * Leg -> BasketLegInput for "Save as Basket" / basket-deploy.
 *
 * Strikes use an ABSOLUTE strikeSpec — the strikes chosen in the payoff
 * builder are exact numbers the trader picked, not "ATM+2"-style offsets, so
 * relative specs would silently redefine the strategy the moment spot moves
 * before deploy. Expiry defaults to the nearest weekly (`weeksOut: 0`)
 * because StrategyBuilder has no expiry picker of its own today (its legs
 * carry no expiry field at all) — resolveBasket() re-resolves this at
 * deploy time regardless (spec §9: "never at save time"), so a basket saved
 * today against a stale weekly still rolls forward correctly when deployed.
 */
export function mapLegsToBasketLegs(legs: StrategyLeg[]): BasketLegInput[] {
  return legs.map((leg, i) => ({
    legId: `leg-${i + 1}`,
    action: leg.action,
    optionType: leg.type,
    lots: leg.lots,
    strikeSpec: { kind: "absolute", strike: leg.strike },
    expirySpec: { kind: "nearest", weeksOut: 0 },
  }));
}
