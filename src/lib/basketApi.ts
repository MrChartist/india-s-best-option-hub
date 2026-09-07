/**
 * Client for the basket-deploy resolve/preview endpoint
 * (1CLIQ-TRADE-SPEC.md §9, proxy-server.mjs's basket-deploy case).
 *
 * This endpoint NEVER places an order — it only resolves specs (strikeSpec/
 * expirySpec) against the live chain so the trader can see exactly which
 * legs would deploy live vs. paper-only before anything is saved. Saving is
 * a separate, purely local step (see basketStore.ts).
 */

import { postDhanEndpoint } from "./dhanProxyClient";
import type { BasketLegInput } from "./strategyLegMapper";

export interface ResolvedBasketLegPreview {
  legId: string;
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  lots: number;
  expiry: string | null;
  strike: number | null;
  securityId: string | null;
  exchangeSegment: string | null;
  blocked: boolean;
  blockedReason: string | null;
}

export interface BasketPreview {
  legs: ResolvedBasketLegPreview[];
  blockedForLive: boolean;
  blockedLegIds: string[];
  spot: number | null;
  stepSize: number;
  symbol: string;
}

/** Resolve a draft basket's legs against the live chain — preview only, no order. */
export async function previewBasket(symbol: string, legs: BasketLegInput[]): Promise<BasketPreview> {
  return postDhanEndpoint<BasketPreview>("basket-deploy", { basket: { legs } }, { symbol });
}
