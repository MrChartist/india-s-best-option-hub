import { describe, it, expect } from "vitest";
import { buildOrderBody, capabilities } from "./fyersOrders.mjs";

// lotSize is deliberately NOT part of the order object — it is resolved from the
// exchange instrument master and passed separately. See buildOrderBody's header.
const baseOrder = {
  symbol: "NSE:NIFTY25SEP25000CE",
  side: "BUY",
  orderType: "LIMIT",
  productType: "INTRADAY",
  validity: "DAY",
  lots: 2,
  limitPrice: 100.5,
};
const LOT_SIZE = 75;

describe("buildOrderBody — quantity computation", () => {
  it("computes qty as lots × resolved lot size", () => {
    const body = buildOrderBody(baseOrder, LOT_SIZE);
    expect(body.qty).toBe(150);
  });

  it("rounds fractional results (defensive — inputs should already be integers)", () => {
    const body = buildOrderBody({ ...baseOrder, lots: 3 }, 33.333);
    expect(body.qty).toBe(Math.round(3 * 33.333));
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
    expect(body.qty).toBe(150);
    expect(body.lotSize).toBeUndefined();
  });
});

describe("buildOrderBody — payload shape", () => {
  it("builds the exact fields the cross-referenced Fyers v3 order shape documents", () => {
    const body = buildOrderBody(baseOrder, LOT_SIZE);
    expect(body).toEqual({
      symbol: "NSE:NIFTY25SEP25000CE",
      qty: 150,
      type: 1, // LIMIT
      side: 1, // BUY
      productType: "INTRADAY",
      limitPrice: 100.5,
      stopPrice: 0,
      disclosedQty: 0,
      validity: "DAY",
      offlineOrder: false,
    });
  });

  it("maps MARKET/STOP/STOPLIMIT orderType and BUY/SELL side to Fyers' numeric codes", () => {
    expect(buildOrderBody({ ...baseOrder, orderType: "MARKET" }, LOT_SIZE).type).toBe(2);
    expect(buildOrderBody({ ...baseOrder, orderType: "STOP", stopPrice: 95 }, LOT_SIZE).type).toBe(3);
    expect(buildOrderBody({ ...baseOrder, orderType: "STOPLIMIT", stopPrice: 95 }, LOT_SIZE).type).toBe(4);
    expect(buildOrderBody({ ...baseOrder, side: "SELL" }, LOT_SIZE).side).toBe(-1);
  });

  it("rejects an invalid symbol missing the EXCH: prefix", () => {
    expect(() => buildOrderBody({ ...baseOrder, symbol: "NIFTY25SEP25000CE" }, LOT_SIZE)).toThrow(/Invalid Fyers symbol/);
  });

  it("rejects an invalid side", () => {
    expect(() => buildOrderBody({ ...baseOrder, side: "HOLD" }, LOT_SIZE)).toThrow(/Invalid side/);
  });

  it("rejects BO/CO productType — confirmed rejected by Fyers API v3", () => {
    expect(() => buildOrderBody({ ...baseOrder, productType: "BO" }, LOT_SIZE)).toThrow(/Unsupported Fyers productType/);
    expect(() => buildOrderBody({ ...baseOrder, productType: "CO" }, LOT_SIZE)).toThrow(/Unsupported Fyers productType/);
  });

  it("rejects MTF productType until independently verified", () => {
    expect(() => buildOrderBody({ ...baseOrder, productType: "MTF" }, LOT_SIZE)).toThrow(/Unsupported Fyers productType/);
  });

  it("rejects IOC validity until independently verified", () => {
    expect(() => buildOrderBody({ ...baseOrder, validity: "IOC" }, LOT_SIZE)).toThrow(/Unsupported Fyers validity/);
  });

  it("rejects zero or negative lots", () => {
    expect(() => buildOrderBody({ ...baseOrder, lots: 0 }, LOT_SIZE)).toThrow(/lots/i);
    expect(() => buildOrderBody({ ...baseOrder, lots: -1 }, LOT_SIZE)).toThrow(/lots/i);
  });

  it("requires limitPrice for LIMIT/STOPLIMIT orders", () => {
    const { limitPrice, ...rest } = baseOrder;
    expect(() => buildOrderBody(rest, LOT_SIZE)).toThrow(/limitPrice required/);
  });

  it("requires stopPrice for STOP/STOPLIMIT orders", () => {
    expect(() => buildOrderBody({ ...baseOrder, orderType: "STOP" }, LOT_SIZE)).toThrow(/stopPrice required/);
  });

  it("zeroes limitPrice/stopPrice for a plain MARKET order regardless of stray input", () => {
    const body = buildOrderBody({ ...baseOrder, orderType: "MARKET", limitPrice: 999, stopPrice: 888 }, LOT_SIZE);
    expect(body.limitPrice).toBe(0);
    expect(body.stopPrice).toBe(0);
  });
});

describe("capabilities — must not overstate what's confirmed", () => {
  it("declares bracket/cover/ioc/mtf/nativeMarketProtection as false pending verification", () => {
    expect(capabilities.bracket).toBe(false);
    expect(capabilities.cover).toBe(false);
    expect(capabilities.ioc).toBe(false);
    expect(capabilities.mtf).toBe(false);
    expect(capabilities.nativeMarketProtection).toBe(false);
  });

  it("only lists productTypes buildOrderBody actually accepts", () => {
    for (const p of capabilities.products) {
      expect(() => buildOrderBody({ ...baseOrder, productType: p }, LOT_SIZE)).not.toThrow();
    }
  });
});
