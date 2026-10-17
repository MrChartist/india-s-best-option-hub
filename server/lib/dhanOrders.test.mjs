import { describe, it, expect } from "vitest";
import { buildOrderBody } from "./dhanOrders.mjs";

// lotSize is deliberately NOT part of the order object — it is resolved from the
// exchange instrument master and passed separately. See buildOrderBody's header.
const baseOrder = {
  transactionType: "BUY",
  exchangeSegment: "NSE_FNO",
  orderType: "LIMIT",
  securityId: "12345",
  lots: 2,
  price: 100.5,
};
const LOT_SIZE = 50;

describe("buildOrderBody — quantity computation", () => {
  it("computes quantity as lots × resolved lot size", () => {
    const body = buildOrderBody("client1", baseOrder, LOT_SIZE);
    expect(body.quantity).toBe(100);
  });

  it("rounds fractional results (defensive — inputs should already be integers)", () => {
    const body = buildOrderBody("client1", { ...baseOrder, lots: 3 }, 33.333);
    expect(body.quantity).toBe(Math.round(3 * 33.333));
  });
});

describe("buildOrderBody — lot size must come from the exchange master", () => {
  it("refuses to build an order without a resolved lot size", () => {
    expect(() => buildOrderBody("client1", baseOrder)).toThrow(/resolved lot size/i);
  });

  it("rejects a zero or negative resolved lot size rather than defaulting", () => {
    expect(() => buildOrderBody("client1", baseOrder, 0)).toThrow(/resolved lot size/i);
    expect(() => buildOrderBody("client1", baseOrder, -50)).toThrow(/resolved lot size/i);
  });

  it("IGNORES a lotSize smuggled in on the order object — this is the stale-constant bug", () => {
    // A client sending the old (wrong) BANKNIFTY lot size of 15 must not be able
    // to influence quantity; only the resolved 30 counts.
    const body = buildOrderBody("client1", { ...baseOrder, lotSize: 15 }, 30);
    expect(body.quantity).toBe(60);
    expect(body.lotSize).toBeUndefined();
  });
});

describe("buildOrderBody — payload shape", () => {
  it("builds the exact fields Dhan's v2 /orders endpoint documents", () => {
    const body = buildOrderBody("client1", baseOrder, LOT_SIZE);
    expect(body).toEqual({
      dhanClientId: "client1",
      transactionType: "BUY",
      exchangeSegment: "NSE_FNO",
      productType: "INTRADAY",
      orderType: "LIMIT",
      validity: "DAY",
      securityId: "12345",
      quantity: 100,
      price: 100.5,
    });
  });

  it("defaults exchangeSegment to NSE_FNO when omitted", () => {
    const { exchangeSegment, ...rest } = baseOrder;
    const body = buildOrderBody("client1", rest, LOT_SIZE);
    expect(body.exchangeSegment).toBe("NSE_FNO");
  });

  it("forces price to 0 for MARKET orders regardless of what's passed", () => {
    const body = buildOrderBody("client1", { ...baseOrder, orderType: "MARKET", price: 999 }, LOT_SIZE);
    expect(body.price).toBe(0);
  });

  it("includes triggerPrice for STOP_LOSS orders", () => {
    const body = buildOrderBody("client1", { ...baseOrder, orderType: "STOP_LOSS", triggerPrice: 95 }, LOT_SIZE);
    expect(body.triggerPrice).toBe(95);
  });

  it("rejects STOP_LOSS orders missing a triggerPrice — silently defaulting here could place an unintended order", () => {
    expect(() => buildOrderBody("client1", { ...baseOrder, orderType: "STOP_LOSS" }, LOT_SIZE)).toThrow(/triggerPrice/);
  });

  it("rejects an invalid transactionType rather than passing it through", () => {
    expect(() => buildOrderBody("client1", { ...baseOrder, transactionType: "HOLD" }, LOT_SIZE)).toThrow(/transactionType/);
  });

  it("rejects zero or negative lots", () => {
    expect(() => buildOrderBody("client1", { ...baseOrder, lots: 0 }, LOT_SIZE)).toThrow(/lots/);
    expect(() => buildOrderBody("client1", { ...baseOrder, lots: -1 }, LOT_SIZE)).toThrow(/lots/);
  });

  it("rejects a missing securityId", () => {
    const { securityId, ...rest } = baseOrder;
    expect(() => buildOrderBody("client1", rest, LOT_SIZE)).toThrow(/securityId/);
  });

  it("stringifies a numeric securityId (Dhan documents it as a string field)", () => {
    const body = buildOrderBody("client1", { ...baseOrder, securityId: 12345 }, LOT_SIZE);
    expect(body.securityId).toBe("12345");
    expect(typeof body.securityId).toBe("string");
  });
});
