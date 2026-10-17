import { describe, it, expect } from "vitest";
import { buildOrderBody } from "./oms-noren.mjs";

// lotSize is deliberately NOT part of the order object — it is resolved from
// the exchange instrument master and passed separately. See buildOrderBody's
// header (and dhanOrders.test.mjs, which this mirrors) for why.
const baseOrder = {
  transactionType: "BUY",
  exchangeSegment: "NSE_FNO",
  orderType: "LIMIT",
  securityId: "BANKNIFTY25SEP58000CE", // Noren orders key off tradingSymbol, not a numeric id
  lots: 2,
  price: 100.5,
};
const LOT_SIZE = 30;

describe("buildOrderBody — quantity computation", () => {
  it("computes qty as lots × resolved lot size", () => {
    const body = buildOrderBody("UID1", baseOrder, LOT_SIZE);
    expect(body.qty).toBe(60);
  });

  it("rounds fractional results (defensive — inputs should already be integers)", () => {
    const body = buildOrderBody("UID1", { ...baseOrder, lots: 3 }, 33.333);
    expect(body.qty).toBe(Math.round(3 * 33.333));
  });
});

describe("buildOrderBody — lot size must come from the exchange master", () => {
  it("refuses to build an order without a resolved lot size", () => {
    expect(() => buildOrderBody("UID1", baseOrder)).toThrow(/resolved lot size/i);
  });

  it("rejects a zero or negative resolved lot size rather than defaulting", () => {
    expect(() => buildOrderBody("UID1", baseOrder, 0)).toThrow(/resolved lot size/i);
    expect(() => buildOrderBody("UID1", baseOrder, -30)).toThrow(/resolved lot size/i);
  });

  it("IGNORES a lotSize smuggled in on the order object — this is the stale-constant bug", () => {
    // A client sending the old (wrong) BANKNIFTY lot size of 15 must not be
    // able to influence quantity; only the resolved 30 counts.
    const body = buildOrderBody("UID1", { ...baseOrder, lotSize: 15 }, 30);
    expect(body.qty).toBe(60);
    expect(body.lotSize).toBeUndefined();
  });
});

describe("buildOrderBody — payload shape", () => {
  it("builds the exact fields the Noren OMS PlaceOrder endpoint expects", () => {
    const body = buildOrderBody("UID1", baseOrder, LOT_SIZE);
    expect(body).toEqual({
      uid: "UID1",
      actid: "UID1",
      exch: "NFO",
      tsym: "BANKNIFTY25SEP58000CE",
      qty: 60,
      prc: 100.5,
      prd: "I",
      trantype: "B",
      prctyp: "LMT",
      ret: "DAY",
      ordersource: "API",
    });
  });

  it("maps exchangeSegment NSE_FNO/BSE_FNO/MCX_COMM to Noren exch codes", () => {
    expect(buildOrderBody("UID1", { ...baseOrder, exchangeSegment: "BSE_FNO" }, LOT_SIZE).exch).toBe("BFO");
    expect(buildOrderBody("UID1", { ...baseOrder, exchangeSegment: "MCX_COMM" }, LOT_SIZE).exch).toBe("MCX");
  });

  it("defaults exchangeSegment to NSE_FNO -> NFO when omitted", () => {
    const { exchangeSegment, ...rest } = baseOrder;
    const body = buildOrderBody("UID1", rest, LOT_SIZE);
    expect(body.exch).toBe("NFO");
  });

  it("forces price to 0 for MARKET orders regardless of what's passed", () => {
    const body = buildOrderBody("UID1", { ...baseOrder, orderType: "MARKET", price: 999 }, LOT_SIZE);
    expect(body.prc).toBe(0);
    expect(body.prctyp).toBe("MKT");
  });

  it("includes trgprc for STOP_LOSS orders", () => {
    const body = buildOrderBody("UID1", { ...baseOrder, orderType: "STOP_LOSS", triggerPrice: 95 }, LOT_SIZE);
    expect(body.trgprc).toBe(95);
    expect(body.prctyp).toBe("SL-LMT");
  });

  it("includes trgprc for STOP_LOSS_MARKET orders", () => {
    const body = buildOrderBody("UID1", { ...baseOrder, orderType: "STOP_LOSS_MARKET", triggerPrice: 95 }, LOT_SIZE);
    expect(body.trgprc).toBe(95);
    expect(body.prctyp).toBe("SL-MKT");
  });

  it("rejects STOP_LOSS orders missing a triggerPrice — silently defaulting here could place an unintended order", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, orderType: "STOP_LOSS" }, LOT_SIZE)).toThrow(/triggerPrice/);
  });

  it("rejects STOP_LOSS_MARKET orders missing a triggerPrice", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, orderType: "STOP_LOSS_MARKET" }, LOT_SIZE)).toThrow(/triggerPrice/);
  });

  it("accepts an explicit tradingSymbol alias in place of securityId", () => {
    const { securityId, ...rest } = baseOrder;
    const body = buildOrderBody("UID1", { ...rest, tradingSymbol: "NIFTY25SEP24500PE" }, LOT_SIZE);
    expect(body.tsym).toBe("NIFTY25SEP24500PE");
  });

  it("stringifies a non-string tradingSymbol/securityId", () => {
    const body = buildOrderBody("UID1", { ...baseOrder, securityId: 12345 }, LOT_SIZE);
    expect(body.tsym).toBe("12345");
    expect(typeof body.tsym).toBe("string");
  });

  it("passes correlationId through as remarks when present", () => {
    const body = buildOrderBody("UID1", { ...baseOrder, correlationId: "intent-42" }, LOT_SIZE);
    expect(body.remarks).toBe("intent-42");
  });

  it("omits remarks when no correlationId is given", () => {
    const body = buildOrderBody("UID1", baseOrder, LOT_SIZE);
    expect(body.remarks).toBeUndefined();
  });
});

describe("buildOrderBody — rejects invalid enums rather than passing them through", () => {
  it("rejects an invalid transactionType", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, transactionType: "HOLD" }, LOT_SIZE)).toThrow(/transactionType/);
  });

  it("rejects an invalid productType", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, productType: "NOT_A_PRODUCT" }, LOT_SIZE)).toThrow(/productType/);
  });

  it("rejects an invalid orderType", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, orderType: "TRAILING_STOP" }, LOT_SIZE)).toThrow(/orderType/);
  });

  it("rejects an invalid validity", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, validity: "GTC" }, LOT_SIZE)).toThrow(/validity/i);
  });

  it("rejects zero or negative lots", () => {
    expect(() => buildOrderBody("UID1", { ...baseOrder, lots: 0 }, LOT_SIZE)).toThrow(/lots/);
    expect(() => buildOrderBody("UID1", { ...baseOrder, lots: -1 }, LOT_SIZE)).toThrow(/lots/);
  });

  it("rejects a missing securityId/tradingSymbol", () => {
    const { securityId, ...rest } = baseOrder;
    expect(() => buildOrderBody("UID1", rest, LOT_SIZE)).toThrow(/securityId/);
  });
});

describe("buildOrderBody — side and product code mapping", () => {
  it("maps BUY/SELL to B/S", () => {
    expect(buildOrderBody("UID1", baseOrder, LOT_SIZE).trantype).toBe("B");
    expect(buildOrderBody("UID1", { ...baseOrder, transactionType: "SELL" }, LOT_SIZE).trantype).toBe("S");
  });

  it("maps CNC/INTRADAY/MARGIN/CO/BO product types to Noren codes", () => {
    expect(buildOrderBody("UID1", { ...baseOrder, productType: "CNC" }, LOT_SIZE).prd).toBe("C");
    expect(buildOrderBody("UID1", { ...baseOrder, productType: "INTRADAY" }, LOT_SIZE).prd).toBe("I");
    expect(buildOrderBody("UID1", { ...baseOrder, productType: "MARGIN" }, LOT_SIZE).prd).toBe("M");
    expect(buildOrderBody("UID1", { ...baseOrder, productType: "CO" }, LOT_SIZE).prd).toBe("H");
    expect(buildOrderBody("UID1", { ...baseOrder, productType: "BO" }, LOT_SIZE).prd).toBe("B");
  });

  it("defaults productType to INTRADAY when omitted", () => {
    const { productType, ...rest } = baseOrder;
    expect(buildOrderBody("UID1", rest, LOT_SIZE).prd).toBe("I");
  });
});
