/**
 * Minimal local persistence for "Save as Basket" (1CLIQ-TRADE-SPEC.md §9).
 *
 * Deliberately just a spec store, same convention as positionStore.ts's
 * localStorage CRUD — no deploy/tranche engine wiring here. A saved basket
 * holds specs (see strategyLegMapper.ts's BasketLegInput), never resolved
 * ids: resolveBasket() re-resolves against the live chain every time a
 * basket is deployed, never at save time (spec §9).
 */

import type { BasketLegInput } from "./strategyLegMapper";

const STORAGE_KEY = "optionsdesk_saved_baskets";

export interface SavedBasket {
  id: string;
  name: string;
  symbol: string;
  createdAt: number;
  legs: BasketLegInput[];
}

function isValidBasket(o: unknown): o is SavedBasket {
  const b = o as SavedBasket;
  return !!b && typeof b.id === "string" && typeof b.name === "string"
    && typeof b.symbol === "string" && Number.isFinite(b.createdAt) && Array.isArray(b.legs);
}

export function getSavedBaskets(): SavedBasket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Same discipline as positionStore.ts: drop corrupted entries individually
    // rather than letting one bad record poison the whole list.
    return Array.isArray(parsed) ? parsed.filter(isValidBasket) : [];
  } catch {
    return [];
  }
}

function persist(baskets: SavedBasket[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(baskets));
}

export function saveBasket(input: { name: string; symbol: string; legs: BasketLegInput[] }): SavedBasket {
  const basket: SavedBasket = {
    id: `basket-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || "Untitled basket",
    symbol: input.symbol,
    createdAt: Date.now(),
    legs: input.legs,
  };
  persist([...getSavedBaskets(), basket]);
  return basket;
}

export function removeBasket(id: string): void {
  persist(getSavedBaskets().filter((b) => b.id !== id));
}
