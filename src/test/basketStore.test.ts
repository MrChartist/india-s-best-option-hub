import { describe, it, expect, beforeEach } from "vitest";
import { getSavedBaskets, saveBasket, removeBasket } from "@/lib/basketStore";
import type { BasketLegInput } from "@/lib/strategyLegMapper";

const leg: BasketLegInput = {
  legId: "leg-1", action: "BUY", optionType: "CE", lots: 1,
  strikeSpec: { kind: "absolute", strike: 24000 },
  expirySpec: { kind: "nearest", weeksOut: 0 },
};

beforeEach(() => localStorage.clear());

describe("basketStore", () => {
  it("starts empty", () => {
    expect(getSavedBaskets()).toEqual([]);
  });

  it("saves a basket and assigns a unique id + createdAt", () => {
    const saved = saveBasket({ name: "Iron Condor", symbol: "NIFTY", legs: [leg] });
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBeGreaterThan(0);
    expect(getSavedBaskets()).toHaveLength(1);
    expect(getSavedBaskets()[0].legs).toEqual([leg]);
  });

  it("falls back to a placeholder name rather than saving a blank one", () => {
    const saved = saveBasket({ name: "   ", symbol: "NIFTY", legs: [leg] });
    expect(saved.name).toBe("Untitled basket");
  });

  it("removes a basket by id without touching the others", () => {
    const a = saveBasket({ name: "A", symbol: "NIFTY", legs: [leg] });
    const b = saveBasket({ name: "B", symbol: "BANKNIFTY", legs: [leg] });
    removeBasket(a.id);
    const remaining = getSavedBaskets();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });

  it("drops corrupted entries instead of poisoning the whole list", () => {
    localStorage.setItem("optionsdesk_saved_baskets", JSON.stringify([{ garbage: true }, { id: "x", name: "ok", symbol: "NIFTY", createdAt: 1, legs: [] }]));
    expect(getSavedBaskets()).toHaveLength(1);
  });
});
