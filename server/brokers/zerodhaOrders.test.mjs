import { describe, it, expect } from "vitest";
import { buildOrderBody, capabilities } from "./zerodhaOrders.mjs";

// lotSize is deliberately NOT part of the order object — it is resolved from the
// exchange instrument master and passed separately. See buildOrderBody's header.
const baseOrder = {
  tradingsymbol: "NIFTY25SEP25000CE",
  exchange: "NFO",
  transactionType: "BUY",
  orderType: "LIMIT",
  product: "MIS",
  validity: "DAY",
  lots: 2,
  price: 100.5,
};
const LOT_SIZE = 75;

describe("buildOrderBody — quantity computation", () => {
  it("computes quantity as lots × resolved lot size", () => {
    const body = buildOrderBody(baseOrder, LOT_SIZE);
    expect(body.quantity).toBe(150);
  });

  it("rounds fractional results (defensive — inputs should already be integers)", () => {
    const body = buildOrderBody({ ...baseOrder, lots: 3 }, 33.333);
    expect(body.quantity).toBe(Math.round(3 * 33.333));
  });
});

describe("buildOrderBody — lot size must come from the exchange master", () => {
  it("refuses to build an order without a resolved lot size", () => {
    expect(() => buildOrderBody(baseOrder)).toThrow(/resolved lot size/i);
  });

  it("rejects a zero or negative resolved lot size rather than defaulting", () => {
    expect(() => buildOrderBody(baseOrder, 0)).toThrow(/resolved lot size/i);
    expect(() => buildOrderBody(baseOrder, -75)).toThrow(/resolved lot size/i);
  });

  it("IGNORES a lotSize smuggled in on the order object", () => {
    const body = buildOrderBody({ ...baseOrder, lotSize: 25 }, 75);
    expect(body.quantity).toBe(150);
    expect(body.lotSize).toBeUndefined();
  });
});

describe("buildOrderBody — payload shape", () => {
  it("builds the exact fields Kite Connect's v3 /orders/regular endpoint documents", () => {
    const body = buildOrderBody(baseOrder, LOT_SIZE);
    expect(body).toEqual({
      tradingsymbol: "NIFTY25SEP25000CE",
      exchange: "NFO",
      transaction_type: "BUY",
      order_type: "LIMIT",
      quantity: 150,
      product: "MIS",
      validity: "DAY",
      price: 100.5,
    });
  });

  it("defaults exchange to NFO when omitted", () => {
    const { exchange, ...rest } = baseOrder;
    expect(buildOrderBody(rest, LOT_SIZE).exchange).toBe("NFO");
  });

  it("forces price to 0 for MARKET orders regardless of what's passed", () => {
    const body = buildOrderBody({ ...baseOrder, orderType: "MARKET", price: 999 }, LOT_SIZE);
    expect(body.price).toBe(0);
  });

  it("includes trigger_price for SL and SL-M orders", () => {
    expect(buildOrderBody({ ...baseOrder, orderType: "SL", triggerPrice: 95 }, LOT_SIZE).trigger_price).toBe(95);
    expect(buildOrderBody({ ...baseOrder, orderType: "SL-M", triggerPrice: 95 }, LOT_SIZE).trigger_price).toBe(95);
  });

  it("rejects SL/SL-M orders missing a triggerPrice", () => {
    expect(() => buildOrderBody({ ...baseOrder, orderType: "SL" }, LOT_SIZE)).toThrow(/trigger_price required/);
    expect(() => buildOrderBody({ ...baseOrder, orderType: "SL-M" }, LOT_SIZE)).toThrow(/trigger_price required/);
  });

  it("rejects SL orders missing a price (SL needs both price and trigger_price)", () => {
    expect(() => buildOrderBody({ ...baseOrder, orderType: "SL", triggerPrice: 95, price: undefined }, LOT_SIZE)).toThrow(/price required/);
  });

  it("accepts and truncates an over-long tag to Kite's documented 20-char max", () => {
    const body = buildOrderBody({ ...baseOrder, tag: "a".repeat(30) }, LOT_SIZE);
    expect(body.tag).toHaveLength(20);
  });

  it("rejects an invalid transactionType rather than passing it through", () => {
    expect(() => buildOrderBody({ ...baseOrder, transactionType: "HOLD" }, LOT_SIZE)).toThrow(/transactionType/);
  });

  it("rejects an invalid product", () => {
    expect(() => buildOrderBody({ ...baseOrder, product: "BO" }, LOT_SIZE)).toThrow(/Invalid product/);
  });

  it("rejects TTL validity — validity_ttl plumbing is intentionally not implemented", () => {
    expect(() => buildOrderBody({ ...baseOrder, validity: "TTL" }, LOT_SIZE)).toThrow(/Invalid validity/);
  });

  it("rejects zero or negative lots", () => {
    expect(() => buildOrderBody({ ...baseOrder, lots: 0 }, LOT_SIZE)).toThrow(/lots/i);
    expect(() => buildOrderBody({ ...baseOrder, lots: -1 }, LOT_SIZE)).toThrow(/lots/i);
  });

  it("rejects a missing tradingsymbol", () => {
    const { tradingsymbol, ...rest } = baseOrder;
    expect(() => buildOrderBody(rest, LOT_SIZE)).toThrow(/tradingsymbol/i);
  });
});

describe("capabilities — every true value is backed by Kite's documented enums", () => {
  it("declares bracket as false — bo is not a documented Kite variety", () => {
    expect(capabilities.bracket).toBe(false);
  });

  it("declares cover/ioc/mtf/nativeMarketProtection true, matching Kite's documented co variety, IOC validity, MTF product, and market_protection field", () => {
    expect(capabilities.cover).toBe(true);
    expect(capabilities.ioc).toBe(true);
    expect(capabilities.mtf).toBe(true);
    expect(capabilities.nativeMarketProtection).toBe(true);
  });

  it("only lists products buildOrderBody actually accepts", () => {
    for (const p of capabilities.products) {
      expect(() => buildOrderBody({ ...baseOrder, product: p }, LOT_SIZE)).not.toThrow();
    }
  });
});
