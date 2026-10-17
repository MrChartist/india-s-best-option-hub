import { beforeEach, describe, expect, it } from "vitest";
import { black76Price, chargesForLegs, exerciseSTT, forwardFromSpot, getLotSize as contractLotSize, timeToExpiryYears, toISTDate } from "@/lib/options";
import {
  LOT_SIZE_MAP,
  addPosition,
  buildClosedPosition,
  closePosition,
  createPosition,
  exportPositions,
  getClosedPositions,
  getLotSize,
  getPositions,
  importPositions,
  mergeImport,
  positionToLeg,
  savePositions,
  settleExpired,
  settlePositions,
  validatePosition,
} from "@/lib/positionStore";
import { betaFromBars, livePosition, managementHints, scenarioGrid, summarisePortfolio } from "@/components/positions/analytics";

const EXPIRY = "2026-10-27";
const NOW = toISTDate("2026-10-20", "11:00");

function nifty(overrides: Partial<Parameters<typeof createPosition>[0]> = {}) {
  return createPosition({ symbol: "NIFTY", type: "CE", action: "BUY", strike: 25000, entryPrice: 100, expiry: EXPIRY, lots: 1, lotSize: 75, ...overrides });
}

beforeEach(() => localStorage.clear());

describe("lot sizes", () => {
  it("delegates to the contract table and returns undefined for unknown symbols", () => {
    expect(getLotSize("NIFTY")).toBe(contractLotSize("NIFTY"));
    expect(LOT_SIZE_MAP.NIFTY).toBe(contractLotSize("NIFTY"));
    expect("NIFTY" in LOT_SIZE_MAP).toBe(true);
    expect(getLotSize("NOT_A_SYMBOL")).toBeUndefined();
    expect(LOT_SIZE_MAP.NOT_A_SYMBOL).toBeUndefined();
  });
});

describe("data model", () => {
  it("normalises expiry to ISO and keeps strategyId / tag", () => {
    const p = createPosition({ symbol: "nifty", type: "PE", action: "SELL", strike: 24500, entryPrice: 50, expiry: "27-Oct-2026", strategyId: "s1", tag: "Strangle" });
    expect(p.symbol).toBe("NIFTY");
    expect(p.expiry).toBe(EXPIRY);
    expect(p.lotSize).toBe(contractLotSize("NIFTY", EXPIRY));
    expect(p.strategyId).toBe("s1");
    expect(p.tag).toBe("Strangle");
    expect(p.entryDateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("validates positions by hand", () => {
    expect(validatePosition(null)).toBeNull();
    expect(validatePosition({ symbol: "NIFTY", type: "XX", action: "BUY", strike: 1, lots: 1, entryPrice: 1 })).toBeNull();
    expect(validatePosition({ symbol: "UNKNOWNCO", type: "CE", action: "BUY", strike: 100, lots: 1, entryPrice: 1 })).toBeNull(); // no lot size
    const ok = validatePosition({ symbol: "UNKNOWNCO", type: "CE", action: "BUY", strike: 100, lots: 1, entryPrice: 1, lotSize: 500, expiry: "27 Oct 2026" });
    expect(ok?.lotSize).toBe(500);
    expect(ok?.expiry).toBe(EXPIRY);
  });

  it("savePositions never throws when storage fails", () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceeded");
    };
    try {
      expect(savePositions([nifty()])).toBe(false);
    } finally {
      Storage.prototype.setItem = orig;
    }
    expect(savePositions([nifty()])).toBe(true);
  });
});

describe("closing deducts charges", () => {
  it("keeps grossPnl and books netPnl = gross − entry and exit charges", () => {
    const p = nifty();
    addPosition(p);
    const { active, closed } = closePosition(p.id, 130, { now: NOW });
    expect(active).toHaveLength(0);
    const c = closed[0];
    const entry = chargesForLegs([positionToLeg(p)], { onDate: p.entryDateIso }).total;
    const exit = chargesForLegs([positionToLeg(p, { side: "SELL", premium: 130 })], { onDate: "2026-10-20" }).total;
    expect(c.grossPnl).toBeCloseTo(30 * 75, 2);
    expect(c.charges).toBeCloseTo(entry + exit, 1);
    expect(c.netPnl).toBeCloseTo(30 * 75 - entry - exit, 1);
    expect(c.realizedPnl).toBe(c.netPnl);
    expect(c.exitDateIso).toBe("2026-10-20");
    expect(getClosedPositions()).toHaveLength(1);
  });

  it("a short position pays STT on its opening sell, not on the closing buy", () => {
    const short = nifty({ action: "SELL" });
    const c = buildClosedPosition(short, 80, { now: NOW });
    expect(c.grossPnl).toBeCloseTo(20 * 75, 2);
    expect(c.chargesBreakdown?.stt).toBeGreaterThan(0);
  });
});

describe("expiry settlement", () => {
  const after = toISTDate(EXPIRY, "16:00");

  it("settles at intrinsic with exercise STT on ITM longs only", () => {
    const longCE = nifty();
    const shortCE = nifty({ action: "SELL", strike: 25100 });
    const otmPE = nifty({ type: "PE", strike: 24800 });
    const res = settlePositions([longCE, shortCE, otmPE], after, { NIFTY: 25300 });
    expect(res.active).toHaveLength(0);
    expect(res.settled).toHaveLength(3);
    const l = res.settled.find((x) => x.id === longCE.id);
    const s = res.settled.find((x) => x.id === shortCE.id);
    const o = res.settled.find((x) => x.id === otmPE.id);
    const stt = exerciseSTT(300, 75, EXPIRY);
    expect(l?.exitPrice).toBe(300);
    expect(l?.exerciseStt).toBeCloseTo(stt, 2);
    expect(l?.closeReason).toBe("expiry");
    expect(l?.exitDateIso).toBe(EXPIRY);
    const entryCharges = chargesForLegs([positionToLeg(longCE)], { onDate: longCE.entryDateIso }).total;
    expect(l?.netPnl).toBeCloseTo(200 * 75 - entryCharges - stt, 1);
    expect(s?.exerciseStt).toBeUndefined();
    expect(s?.grossPnl).toBeCloseTo((100 - 200) * 75, 2);
    expect(o?.exitPrice).toBe(0);
    expect(o?.exerciseStt).toBeUndefined();
  });

  it("leaves unexpired and spot-less positions open and persists the rest", () => {
    const expired = nifty();
    const later = nifty({ expiry: "2026-11-24" });
    const bank = createPosition({ symbol: "BANKNIFTY", type: "CE", action: "BUY", strike: 56000, entryPrice: 10, expiry: EXPIRY, lots: 1, lotSize: 35 });
    savePositions([expired, later, bank]);
    const res = settleExpired(after, { NIFTY: 24000 });
    expect(res.settled.map((s) => s.id)).toEqual([expired.id]);
    expect(res.pending.map((p) => p.id)).toEqual([bank.id]);
    expect(getPositions().map((p) => p.id).sort()).toEqual([later.id, bank.id].sort());
    expect(getClosedPositions()).toHaveLength(1);
  });
});

describe("import / export", () => {
  it("merges valid entries, skips invalid ones and duplicates", () => {
    const a = nifty();
    savePositions([a]);
    const b = nifty({ strike: 25100 });
    const json = JSON.stringify({ active: [a, b, { junk: true }], closed: [{ ...buildClosedPosition(nifty({ strike: 24000 }), 5, { now: NOW }) }] });
    const res = importPositions(json);
    expect(res.error).toBeUndefined();
    expect(res.addedActive).toBe(1);
    expect(res.addedClosed).toBe(1);
    expect(res.duplicates).toBe(1);
    expect(res.rejected).toBe(1);
    expect(getPositions()).toHaveLength(2);
    const exported = JSON.parse(exportPositions());
    expect(exported.version).toBe(2);
    expect(exported.active).toHaveLength(2);
  });

  it("reports bad JSON without touching storage", () => {
    const res = mergeImport("{oops", { active: [], closed: [] });
    expect(res.error).toMatch(/JSON/);
  });
});

describe("analytics", () => {
  it("solves IV from the CMP and returns spot Greeks in rupees", () => {
    const spot = 25000;
    const T = timeToExpiryYears(EXPIRY, NOW);
    const F = forwardFromSpot(spot, T, 0.065, 0.013);
    const fair = black76Price({ F, K: 25000, T, r: 0.065, sigma: 0.14, type: "CE" });
    const p = nifty({ action: "SELL", entryPrice: fair + 20, currentPrice: fair });
    const live = livePosition(p, { spot, now: NOW, r: 0.065 });
    expect(live.ivSource).toBe("solved");
    expect(live.iv).toBeCloseTo(0.14, 3);
    expect(live.qty).toBe(-75);
    expect(live.deltaUnit).toBeGreaterThan(0.45);
    expect(live.delta).toBeLessThan(0); // short call
    expect(live.theta).toBeGreaterThan(0); // short premium earns decay
    expect(live.vega).toBeLessThan(0);
    expect(live.grossPnl).toBeCloseTo(20 * 75, 1);
    expect(live.netPnl).toBeLessThan(live.grossPnl);
  });

  it("beta-weights delta into NIFTY lots and builds a scenario grid", () => {
    const p = nifty({ currentPrice: 100 });
    const live = { [p.id]: livePosition(p, { spot: 25000, now: NOW, r: 0.065 }) };
    const sum = summarisePortfolio([p], live, { spots: { NIFTY: 25000 }, betas: {}, niftySpot: 25000, niftyLot: 75, now: NOW });
    expect(sum.underlyings[0].niftyLots).toBeCloseTo(live[p.id].delta / 75, 6);
    expect(sum.underlyings[0].hedgeFutLots).toBeCloseTo(-live[p.id].delta / 75, 6);
    expect(sum.capitalAtRisk).toBeCloseTo(100 * 75, 6);
    const grid = scenarioGrid([p], live, { NIFTY: 25000 }, { now: NOW, r: 0.065 });
    expect(grid).toHaveLength(3);
    expect(grid[1]).toHaveLength(7);
    expect(grid[1][6]).toBeGreaterThan(grid[1][0]); // long call gains as spot rises
    expect(grid[0][3]).toBeGreaterThan(grid[2][3]); // and with higher IV
  });

  it("computes beta from aligned daily returns", () => {
    const day = 86_400_000;
    const idx = Array.from({ length: 120 }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * day, o: 0, h: 0, l: 0, c: 100 * Math.exp(0.01 * Math.sin(i)) }));
    const stock = idx.map((b) => ({ ...b, c: 50 * Math.pow(b.c / 100, 1.5) }));
    expect(betaFromBars(stock, idx)).toBeCloseTo(1.5, 6);
    expect(Number.isNaN(betaFromBars(stock.slice(0, 10), idx))).toBe(true);
  });

  it("flags 50% profit and expiry-day short gamma", () => {
    const today = "2026-10-20";
    const now = toISTDate(today, "11:00");
    const p = createPosition({ symbol: "NIFTY", type: "CE", action: "SELL", strike: 25500, entryPrice: 40, currentPrice: 10, expiry: today, lots: 1, lotSize: 75 });
    const live = { [p.id]: livePosition(p, { spot: 25000, now, r: 0.065 }) };
    const summary = summarisePortfolio([p], live, { spots: { NIFTY: 25000 }, betas: {}, niftySpot: 25000, niftyLot: 75, now });
    const hints = managementHints({ positions: [p], live, summary, chains: {}, now, r: 0.065, formatINR: (v) => String(Math.round(v)) });
    expect(hints.some((h) => h.id === "expiry-gamma" && h.severity === "danger")).toBe(true);
    expect(hints.some((h) => h.id.startsWith("profit-"))).toBe(true);
  });
});
