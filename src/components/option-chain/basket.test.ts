import { beforeEach, describe, expect, it } from "vitest";
import { generateSampleChain } from "@/lib/options";
import {
  BASKET_KEY,
  BASKET_SENT_KEY,
  addLegs,
  basketNetPremium,
  buildIronFly,
  buildStraddle,
  buildStrangle,
  decodeLegs,
  encodeLegs,
  fromBase64Url,
  groupBySymbol,
  legFromRow,
  paperTradingUrl,
  readBasket,
  readBasketSent,
  recordBasketSent,
  removeLegs,
  sendUrl,
  strategyBuilderUrl,
  toBase64Url,
  writeBasket,
  type BasketLeg,
} from "./basket";
import { buildChainModel } from "./chainModel";

const NOW = new Date("2026-10-15T05:00:00Z");
const model = buildChainModel(generateSampleChain({ symbol: "NIFTY", spot: 24512.3, expiry: "2026-10-20", now: NOW, seed: 3, strikes: 41 }).chain, {
  spot: 24512.3,
  expiry: "2026-10-20",
  lotSize: 65,
  now: NOW,
});
const ctx = { symbol: "NIFTY", expiry: "2026-10-20" };

const leg = (over: Partial<BasketLeg> = {}): BasketLeg => ({ symbol: "NIFTY", expiry: "2026-10-20", strike: 24500, type: "CE", side: "BUY", lots: 1, premium: 100, iv: 0.12, ...over });

describe("base64url", () => {
  it("round-trips unicode text without padding or unsafe characters", () => {
    const text = JSON.stringify({ s: "₹ NIFTY ±1σ ünïcode", n: [1, 2, 3] });
    const enc = toBase64Url(text);
    expect(enc).not.toMatch(/[+/=]/);
    expect(fromBase64Url(enc)).toBe(text);
  });
  it("encodes legs and builds the Strategy Builder link", () => {
    const legs = [leg(), leg({ type: "PE", side: "SELL" })];
    expect(decodeLegs(encodeLegs(legs))).toEqual(legs);
    expect(strategyBuilderUrl(legs)).toMatch(/^\/strategy-builder\?legs=[A-Za-z0-9_-]+$/);
  });
  it("returns [] for garbage", () => {
    expect(decodeLegs("%%%")).toEqual([]);
    expect(decodeLegs(toBase64Url('{"a":1}'))).toEqual([]);
  });
});

describe("basket merge and storage", () => {
  beforeEach(() => localStorage.clear());
  it("merges identical legs and keeps different sides apart", () => {
    const b = addLegs([leg()], [leg({ lots: 2, premium: 105 }), leg({ side: "SELL" })]);
    expect(b).toHaveLength(2);
    expect(b[0].lots).toBe(3);
    expect(b[0].premium).toBe(105);
  });
  it("persists to mc_basket_v1 and drops invalid entries", () => {
    writeBasket([leg()]);
    expect(JSON.parse(localStorage.getItem(BASKET_KEY) ?? "[]")).toHaveLength(1);
    localStorage.setItem(BASKET_KEY, JSON.stringify([leg(), { bogus: true }, leg({ iv: null })]));
    expect(readBasket()).toHaveLength(2);
    localStorage.setItem(BASKET_KEY, "not json");
    expect(readBasket()).toEqual([]);
  });
  it("computes net premium (credit positive)", () => {
    const net = basketNetPremium([leg({ side: "SELL", premium: 100 }), leg({ side: "BUY", premium: 40, strike: 24700 })], () => 65);
    expect(net).toBe((100 - 40) * 65);
  });
});

describe("leg builders", () => {
  it("prices a leg at mid with a decimal IV", () => {
    const row = model.rows.find((r) => r.strike === 24500)!;
    const l = legFromRow(row, "CE", "BUY", ctx);
    expect(l.premium).toBeCloseTo(row.ce.mid, 1);
    expect(l.iv).toBeGreaterThan(0.01);
    expect(l.iv).toBeLessThan(1);
    expect(l).toMatchObject({ symbol: "NIFTY", expiry: "2026-10-20", strike: 24500, type: "CE", side: "BUY", lots: 1 });
  });
  it("builds a straddle at one strike", () => {
    const s = buildStraddle(model.rows, 24500, "SELL", ctx);
    expect(s.map((l) => l.type)).toEqual(["CE", "PE"]);
    expect(new Set(s.map((l) => l.strike)).size).toBe(1);
    expect(buildStraddle(model.rows, 1, "SELL", ctx)).toEqual([]);
  });
  it("builds a ±1σ strangle around the centre", () => {
    const s = buildStrangle(model.rows, 24500, 400, "SELL", ctx);
    expect(s).toHaveLength(2);
    expect(s[0].strike).toBe(24900);
    expect(s[1].strike).toBe(24100);
    expect(buildStrangle(model.rows, 24500, NaN, "SELL", ctx)).toEqual([]);
  });
  it("builds a short iron fly with wings outside the body", () => {
    const f = buildIronFly(model.rows, 24500, ctx);
    expect(f).toHaveLength(4);
    const [sc, sp, bc, bp] = f;
    expect(sc.side).toBe("SELL");
    expect(sp.side).toBe("SELL");
    expect(bc.strike).toBeGreaterThan(24500);
    expect(bp.strike).toBeLessThan(24500);
  });
});

describe("hand-off links, groups and the sent marker", () => {
  beforeEach(() => localStorage.clear());
  const legs = [leg(), leg({ type: "PE", side: "SELL", premium: 80 })];

  it("builds replace / append Strategy Builder links and a Paper Trading link", () => {
    const enc = encodeLegs(legs);
    expect(strategyBuilderUrl(legs)).toBe(`/strategy-builder?legs=${enc}`);
    expect(strategyBuilderUrl(legs, "replace")).toBe(`/strategy-builder?legs=${enc}`);
    expect(strategyBuilderUrl(legs, "append")).toBe(`/strategy-builder?legs=${enc}&mode=append`);
    expect(paperTradingUrl(legs)).toBe(`/paper-trading?legs=${enc}`);
    expect(decodeLegs(new URLSearchParams(paperTradingUrl(legs).split("?")[1]).get("legs") ?? "")).toEqual(legs);
    expect(sendUrl("builder", legs)).toBe(strategyBuilderUrl(legs));
    expect(sendUrl("append", legs)).toBe(strategyBuilderUrl(legs, "append"));
    expect(sendUrl("paper", legs)).toBe(paperTradingUrl(legs));
  });

  it("groups by underlying in first-seen order with a subtotal each", () => {
    const mixed = [leg(), leg({ symbol: "BANKNIFTY", strike: 52000, premium: 300, side: "SELL" }), leg({ type: "PE", side: "SELL", premium: 80 })];
    const groups = groupBySymbol(mixed, (s) => (s === "BANKNIFTY" ? 30 : 75));
    expect(groups.map((g) => g.symbol)).toEqual(["NIFTY", "BANKNIFTY"]);
    expect(groups[0].items.map((x) => x.index)).toEqual([0, 2]);
    expect(groups[0].net).toBe((80 - 100) * 75);
    expect(groups[1].net).toBe(300 * 30);
    expect(groupBySymbol([], () => 75)).toEqual([]);
  });

  it("removes sent legs and records the hand-off", () => {
    const basket = [...legs, leg({ symbol: "BANKNIFTY", strike: 52000 })];
    expect(removeLegs(basket, legs)).toEqual([basket[2]]);
    expect(readBasketSent()).toBeNull();
    const rec = recordBasketSent("paper", legs, 1_760_000_000_000);
    expect(rec).toEqual({ at: 1_760_000_000_000, target: "paper", count: 2, symbols: ["NIFTY"] });
    expect(readBasketSent()).toEqual(rec);
    localStorage.setItem(BASKET_SENT_KEY, JSON.stringify({ at: 1, target: "nowhere", count: 1, symbols: [] }));
    expect(readBasketSent()).toBeNull();
    localStorage.setItem(BASKET_SENT_KEY, "{");
    expect(readBasketSent()).toBeNull();
  });
});
