import { describe, it, expect, beforeEach, vi } from "vitest";

// The guard resolves lot size from Dhan's instrument master. Stub the network so
// these stay pure unit tests, exactly as dhanOrders.test.mjs avoids a real call.
vi.mock("./instrumentLookup.mjs", () => {
  const INSTRUMENTS = {
    "NSE_FNO:44321": { securityId: "44321", exchangeSegment: "NSE_FNO", lotSize: 30, tickSize: 0.05, tradingSymbol: "BANKNIFTY 58000 CE", expiry: "2026-09-29" },
    "NSE_FNO:44322": { securityId: "44322", exchangeSegment: "NSE_FNO", lotSize: 75, tickSize: 0.05, tradingSymbol: "NIFTY 26000 CE", expiry: "2026-09-29" },
    "NSE_FNO:99999": { securityId: "99999", exchangeSegment: "NSE_FNO", lotSize: 0, tickSize: 0.05, tradingSymbol: "BROKEN" },
  };
  return {
    lookupInstrument: async (seg, id) => INSTRUMENTS[`${seg}:${id}`] || null,
    resolveLotSize: async (seg, id) => {
      const i = INSTRUMENTS[`${seg}:${id}`];
      if (!i) throw new Error(`Unknown instrument ${seg}:${id} — refusing to guess lot size.`);
      if (!i.lotSize) throw new Error(`Instrument ${seg}:${id} reports lot size ${i.lotSize}`);
      return i.lotSize;
    },
  };
});

const { validateOrder, recordOrder, resetGuardState, effectiveLimits, DEFAULT_LIMITS } = await import("./orderGuard.mjs");

/** A UTC instant for an IST wall-clock time (IST = UTC+5:30). */
function ist(y, m, d, h, min) {
  return new Date(Date.UTC(y, m - 1, d, h, min) - (5 * 60 + 30) * 60000).getTime();
}
// 2026-09-07 is a Monday.
const OPEN = ist(2026, 9, 7, 11, 0);

const order = {
  transactionType: "BUY",
  exchangeSegment: "NSE_FNO",
  securityId: "44321",
  orderType: "MARKET",
  lots: 2,
};
const ctx = { clientId: "c1", liveArmed: true, ltp: 590.25, now: OPEN };

beforeEach(() => resetGuardState());

describe("the live-trading gate is enforced server-side, not only in the UI", () => {
  it("blocks when the session is not armed", async () => {
    const v = await validateOrder(order, { ...ctx, liveArmed: false });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("NOT_ARMED");
  });

  it("blocks when liveArmed is merely truthy-ish rather than exactly true", async () => {
    const v = await validateOrder(order, { ...ctx, liveArmed: "yes" });
    expect(v.code).toBe("NOT_ARMED");
  });
});

describe("lot size comes from the exchange master, never the client", () => {
  it("returns the authoritative lot size and quantity", async () => {
    const v = await validateOrder(order, ctx);
    expect(v.ok).toBe(true);
    expect(v.lotSize).toBe(30);
    expect(v.quantity).toBe(60);
  });

  it("IGNORES a stale lotSize sent by the client — the actual bug this guards", async () => {
    // The app's hardcoded map still says BANKNIFTY is 15. If that reached the
    // exchange the user would trade half the size they intended.
    const v = await validateOrder({ ...order, lotSize: 15 }, ctx);
    expect(v.lotSize).toBe(30);
    expect(v.quantity).toBe(60);
  });

  it("blocks an unknown instrument rather than defaulting to some lot size", async () => {
    const v = await validateOrder({ ...order, securityId: "00000" }, ctx);
    expect(v.ok).toBe(false);
    expect(v.code).toBe("LOT_SIZE_UNRESOLVED");
  });

  it("blocks an instrument whose master lot size is zero", async () => {
    const v = await validateOrder({ ...order, securityId: "99999" }, ctx);
    expect(v.code).toBe("LOT_SIZE_UNRESOLVED");
  });

  it("blocks an order with no securityId — paper-only instruments cannot go live", async () => {
    const { securityId, ...rest } = order;
    const v = await validateOrder(rest, ctx);
    expect(v.code).toBe("NO_SECURITY_ID");
  });
});

describe("market session", () => {
  it("blocks in pre-open", async () => {
    const v = await validateOrder(order, { ...ctx, now: ist(2026, 9, 7, 9, 5) });
    expect(v.code).toBe("PRE_OPEN");
  });

  it("blocks when closed", async () => {
    const v = await validateOrder(order, { ...ctx, now: ist(2026, 9, 7, 16, 30) });
    expect(v.code).toBe("MARKET_CLOSED");
  });

  it("blocks on a weekend", async () => {
    const v = await validateOrder(order, { ...ctx, now: ist(2026, 9, 5, 11, 0) });
    expect(v.code).toBe("MARKET_CLOSED");
  });
});

describe("fat-finger ceilings", () => {
  it("blocks more lots than the per-order cap", async () => {
    const v = await validateOrder({ ...order, lots: 11 }, ctx);
    expect(v.code).toBe("MAX_LOTS");
  });

  it("blocks a notional above the cap", async () => {
    // 10 lots x 30 x 900 = Rs2,70,000 > Rs2,00,000
    const v = await validateOrder({ ...order, lots: 10 }, { ...ctx, ltp: 900 });
    expect(v.code).toBe("MAX_NOTIONAL");
    expect(v.message).toMatch(/2,00,000/);
  });

  it("allows a notional just under the cap", async () => {
    const v = await validateOrder({ ...order, lots: 10 }, { ...ctx, ltp: 600 });
    expect(v.ok).toBe(true);
  });

  it("rejects fractional or zero lots", async () => {
    expect((await validateOrder({ ...order, lots: 1.5 }, ctx)).code).toBe("BAD_LOTS");
    expect((await validateOrder({ ...order, lots: 0 }, ctx)).code).toBe("BAD_LOTS");
    expect((await validateOrder({ ...order, lots: -2 }, ctx)).code).toBe("BAD_LOTS");
  });

  it("rejects an invalid side", async () => {
    expect((await validateOrder({ ...order, transactionType: "HOLD" }, ctx)).code).toBe("BAD_SIDE");
  });
});

describe("price sanity band", () => {
  const limitOrder = { ...order, orderType: "LIMIT", price: 590 };

  it("accepts a limit price near LTP", async () => {
    expect((await validateOrder(limitOrder, ctx)).ok).toBe(true);
  });

  it("blocks a limit price far from LTP — the classic decimal slip", async () => {
    const v = await validateOrder({ ...limitOrder, price: 5900 }, ctx);
    expect(v.code).toBe("PRICE_BAND");
  });

  it("uses the rupee floor so cheap options are not over-constrained", async () => {
    // 3% of Rs1.50 is 4.5 paise; the Rs2 floor must apply instead.
    const v = await validateOrder({ ...limitOrder, price: 3.0 }, { ...ctx, ltp: 1.5 });
    expect(v.ok).toBe(true);
  });

  it("does not apply the band to MARKET orders", async () => {
    const v = await validateOrder({ ...order, orderType: "MARKET", price: 99999 }, ctx);
    expect(v.ok).toBe(true);
  });
});

describe("rate limit and duplicate detection", () => {
  it("blocks past the per-minute cap", async () => {
    for (let i = 0; i < DEFAULT_LIMITS.maxOrdersPerMinute; i++) {
      recordOrder("c1", { ...order, lots: i + 1 }, OPEN);
    }
    const v = await validateOrder({ ...order, lots: 1 }, ctx);
    expect(v.code).toBe("RATE_LIMIT");
  });

  it("counts per client, so one user cannot rate-limit another", async () => {
    for (let i = 0; i < DEFAULT_LIMITS.maxOrdersPerMinute; i++) {
      recordOrder("c1", { ...order, lots: i + 1 }, OPEN);
    }
    expect((await validateOrder(order, { ...ctx, clientId: "c2" })).ok).toBe(true);
  });

  it("forgets orders older than a minute", async () => {
    for (let i = 0; i < DEFAULT_LIMITS.maxOrdersPerMinute; i++) {
      recordOrder("c1", { ...order, lots: i + 1 }, OPEN - 61000);
    }
    expect((await validateOrder(order, ctx)).ok).toBe(true);
  });

  it("blocks an identical repeat within the double-tap window", async () => {
    recordOrder("c1", order, OPEN - 500);
    const v = await validateOrder(order, ctx);
    expect(v.code).toBe("DUPLICATE");
  });

  it("allows the same order again once the window passes", async () => {
    recordOrder("c1", order, OPEN - 3000);
    expect((await validateOrder(order, ctx)).ok).toBe(true);
  });

  it("does not treat a different side as a duplicate — closing a position is not a double-tap", async () => {
    recordOrder("c1", order, OPEN - 500);
    const v = await validateOrder({ ...order, transactionType: "SELL" }, ctx);
    expect(v.ok).toBe(true);
  });
});

describe("effectiveLimits — user limits ratchet down only", () => {
  it("accepts a stricter user limit", () => {
    expect(effectiveLimits({ maxLotsPerOrder: 3 }).maxLotsPerOrder).toBe(3);
  });

  it("refuses to raise a limit above the built-in ceiling", () => {
    expect(effectiveLimits({ maxLotsPerOrder: 500 }).maxLotsPerOrder).toBe(DEFAULT_LIMITS.maxLotsPerOrder);
    expect(effectiveLimits({ maxNotionalPerOrder: 1e9 }).maxNotionalPerOrder).toBe(DEFAULT_LIMITS.maxNotionalPerOrder);
  });

  it("ignores junk values", () => {
    expect(effectiveLimits({ maxLotsPerOrder: "lots" }).maxLotsPerOrder).toBe(DEFAULT_LIMITS.maxLotsPerOrder);
    expect(effectiveLimits(null)).toEqual(DEFAULT_LIMITS);
  });
});
