import { beforeEach, describe, expect, it } from "vitest";
import { generateSampleChain } from "@/lib/options";
import {
  BASKET_KEY,
  addLegs,
  basketNetPremium,
  buildIronFly,
  buildStraddle,
  buildStrangle,
  decodeLegs,
  encodeLegs,
  fromBase64Url,
  legFromRow,
  readBasket,
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
    expect(l.premium).toBeCloseTo(row.ce.mid, 2);
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
