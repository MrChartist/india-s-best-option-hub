import { describe, it, expect } from "vitest";
import { buildModifyOrderBody } from "./dhanPortfolio.mjs";

// getPositions/getHoldings/getFunds/getTrades are thin dhanFetch() wrappers
// with no branching worth extracting as a pure function — same as
// placeOrder/getOrders/getOrderStatus/cancelOrder in dhanOrders.mjs, none of
// which dhanOrders.test.mjs covers either. They are intentionally NOT tested
// here: exercising them would mean either mocking dhanFetch (forbidden by
// this repo's test convention) or making a real network call against Dhan
// (also forbidden). buildModifyOrderBody() is the one piece of real logic in
// this file — payload validation and construction — so it's the only thing
// tested below, mirroring dhanOrders.test.mjs's treatment of buildOrderBody.

const baseChanges = { orderType: "LIMIT", validity: "DAY", price: 101.5, quantity: 100 };

describe("buildModifyOrderBody — required fields", () => {
  it("builds the exact fields Dhan's v2 PUT /orders/{orderId} endpoint documents", () => {
    const body = buildModifyOrderBody("client1", "ORDER123", baseChanges);
    expect(body).toEqual({
      dhanClientId: "client1",
      orderId: "ORDER123",
      orderType: "LIMIT",
      validity: "DAY",
      quantity: 100,
      price: 101.5,
    });
  });

  it("rejects a missing orderId", () => {
    expect(() => buildModifyOrderBody("client1", undefined, baseChanges)).toThrow(/orderId/i);
    expect(() => buildModifyOrderBody("client1", "", baseChanges)).toThrow(/orderId/i);
  });

  it("rejects an invalid orderType", () => {
    expect(() => buildModifyOrderBody("client1", "ORDER123", { ...baseChanges, orderType: "HOLD" })).toThrow(/orderType/);
  });

  it("rejects a missing/invalid validity", () => {
    expect(() => buildModifyOrderBody("client1", "ORDER123", { ...baseChanges, validity: "GTC" })).toThrow(/validity/);
  });

  it("stringifies a numeric orderId (Dhan documents it as a string field)", () => {
    const body = buildModifyOrderBody("client1", 123, baseChanges);
    expect(body.orderId).toBe("123");
    expect(typeof body.orderId).toBe("string");
  });
});

describe("buildModifyOrderBody — trigger price for stop orders", () => {
  it("includes triggerPrice for STOP_LOSS orders", () => {
    const body = buildModifyOrderBody("client1", "ORDER123", { orderType: "STOP_LOSS", validity: "DAY", triggerPrice: 95 });
    expect(body.triggerPrice).toBe(95);
  });

  it("rejects STOP_LOSS_MARKET orders missing a triggerPrice — silently defaulting here could modify into an unintended trigger", () => {
    expect(() => buildModifyOrderBody("client1", "ORDER123", { orderType: "STOP_LOSS_MARKET", validity: "DAY" })).toThrow(/triggerPrice/);
  });

  it("does not require triggerPrice for LIMIT/MARKET orders", () => {
    expect(() => buildModifyOrderBody("client1", "ORDER123", { orderType: "MARKET", validity: "DAY" })).not.toThrow();
  });
});

describe("buildModifyOrderBody — cannot smuggle a different account/order id through changes", () => {
  it("IGNORES a dhanClientId/orderId smuggled in on the changes object — the real clientId/orderId parameters always win", () => {
    const body = buildModifyOrderBody("real-client", "REAL-ORDER", {
      ...baseChanges,
      dhanClientId: "attacker-client",
      orderId: "OTHER-ORDER",
    });
    expect(body.dhanClientId).toBe("real-client");
    expect(body.orderId).toBe("REAL-ORDER");
  });
});

describe("buildModifyOrderBody — optional fields only appear when provided", () => {
  it("omits quantity/price/legName/disclosedQuantity when not supplied", () => {
    const body = buildModifyOrderBody("client1", "ORDER123", { orderType: "MARKET", validity: "IOC" });
    expect(body).toEqual({
      dhanClientId: "client1",
      orderId: "ORDER123",
      orderType: "MARKET",
      validity: "IOC",
    });
  });

  it("includes legName and disclosedQuantity when supplied", () => {
    const body = buildModifyOrderBody("client1", "ORDER123", { ...baseChanges, legName: "STOP_LOSS_LEG", disclosedQuantity: 10 });
    expect(body.legName).toBe("STOP_LOSS_LEG");
    expect(body.disclosedQuantity).toBe(10);
  });
});
