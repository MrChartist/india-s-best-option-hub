/**
 * The canonical adapter contract, proved on Dhan (the reference adapter) with recorded fixtures,
 * plus the order gate and validateAdapter rules every broker is held to. No network: the harness
 * stubs fetch and fails on any request a fixture does not answer.
 */
import { describe, expect, it } from "vitest";
import * as dhan from "./dhan.mjs";
import { createBrokerRegistry } from "./registry.mjs";
import {
  CAPABILITIES,
  FORBIDDEN_SECRET_KEY,
  OrderGateError,
  SessionRequiredError,
  consumeOrderGate,
  isForbiddenSecretKey,
  isOrderGated,
  normaliseError,
  validateAdapter,
  withOrderGate,
} from "./contract.mjs";
import { issueOrderGate } from "./orderGate.mjs";
import { checkOptionChain, toOptionData } from "./contractShapes.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";

describe("Dhan on the contract harness", () => {
  it("passes strict validation", () => {
    const v = validateAdapter(dhan);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
  });

  it("every declared capability returns the normalised shape from its fixture", async () => {
    const report = await runContractHarness(dhan, loadFixtures("dhan"));
    expect(harnessFailures(report)).toEqual([]);
    const covered = report.results.map((r) => r.capability);
    for (const cap of ["testConnection", "expiries", "optionChain", "ltp", "positions", "holdings", "funds", "orderBook", "tradeBook", "placeOrder", "modifyOrder", "cancelOrder", "normaliseError"]) {
      expect(covered).toContain(cap);
    }
  });

  it("normalises Dhan's own field names (availabelBalance, PART_TRADED, netQty sign)", async () => {
    const fx = loadFixtures("dhan");
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = createFetchStub(fx.byCapability.funds.responses).fetch;
      expect((await dhan.fetchFunds(fx.manifest.creds)).data).toEqual({ availableCash: 98440, usedMargin: 15202, totalBalance: 113642, collateral: 0, withdrawable: 98310 });
      globalThis.fetch = createFetchStub(fx.byCapability.positions.responses).fetch;
      const pos = (await dhan.fetchPositions(fx.manifest.creds)).data;
      expect(pos[1]).toMatchObject({ exchange: "NFO", netQty: -75, avgPrice: 190, pnl: 570, product: "INTRADAY" });
      globalThis.fetch = createFetchStub(fx.byCapability.orderBook.responses).fetch;
      const orders = (await dhan.fetchOrderBook(fx.manifest.creds)).data;
      expect(orders.map((o) => o.status)).toEqual(["OPEN", "REJECTED"]);
      expect(orders[1].statusMessage).toBe("Insufficient funds");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("maps the option chain onto the app's OptionData", () => {
    const fx = loadFixtures("dhan").byCapability.optionChain.responses[0].json;
    const { spotPrice, chain } = toOptionData(fx);
    expect(spotPrice).toBe(25041.35);
    expect(chain[0]).toMatchObject({ strikePrice: 25000, ce: { ltp: 182.4, oiChange: 233400, iv: 12.8, delta: 0.56, bidPrice: 181.9, askPrice: 182.9 } });
  });

  it("flags a chain whose IV is a fraction instead of a percentage", () => {
    const bad = { status: "success", data: { last_price: 100, oc: { "100": { ce: { last_price: 5, iv: 0.14 }, pe: { last_price: 4, iv: 0.15 } } } } };
    expect(checkOptionChain(bad).join(" ")).toMatch(/fraction/);
  });
});

describe("order gate", () => {
  const place = withOrderGate("placeOrder", async () => ({ orderId: "1", orderStatus: "OPEN" }), { brokerId: "x" });

  it("refuses without a gate, with a forged gate and with a reused gate", async () => {
    await expect(place({}, {}, 75)).rejects.toBeInstanceOf(OrderGateError);
    await expect(place({}, {}, 75, { action: "placeOrder", brokerId: "x" })).rejects.toBeInstanceOf(OrderGateError);
    const gate = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "x" });
    await expect(place({}, {}, 75, gate)).resolves.toEqual({ orderId: "1", orderStatus: "OPEN" });
    await expect(place({}, {}, 75, gate)).rejects.toBeInstanceOf(OrderGateError);
  });

  it("cannot be minted unless armed and the guard passed", () => {
    expect(() => issueOrderGate({ verdict: { ok: true }, liveArmed: "yes", action: "placeOrder" })).toThrow(OrderGateError);
    expect(() => issueOrderGate({ verdict: { ok: false }, liveArmed: true, action: "placeOrder" })).toThrow(OrderGateError);
  });

  it("is bound to an action, a broker and a short lifetime", () => {
    const g1 = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "x", now: 0 });
    expect(() => consumeOrderGate(g1, { action: "placeOrder", brokerId: "x", now: 1 })).toThrow(/different action/);
    const g2 = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "x", now: 0 });
    expect(() => consumeOrderGate(g2, { action: "cancelOrder", brokerId: "y", now: 1 })).toThrow(/different broker/);
    const g3 = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "cancelOrder", brokerId: "x", now: 0 });
    expect(() => consumeOrderGate(g3, { action: "cancelOrder", brokerId: "x", now: 60_000 })).toThrow(/stale/);
  });

  it("must name a broker on both sides and is not re-exported to adapters", async () => {
    expect(() => issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder" })).toThrow(OrderGateError);
    const g = issueOrderGate({ verdict: { ok: true }, liveArmed: true, action: "placeOrder", brokerId: "x" });
    expect(() => consumeOrderGate(g, { action: "placeOrder", now: Date.now() })).toThrow(/different broker/);
    expect(() => withOrderGate("placeOrder", async () => ({}))).toThrow(/brokerId/);
    const contract = await import("./contract.mjs");
    expect(contract.issueOrderGate).toBeUndefined();
  });
});

describe("validateAdapter", () => {
  const base = { id: "demo", credentialFields: ["apiKey"], testConnection() {}, fetchExpiryList() {}, fetchOptionChain() {}, fetchLTP() {} };

  it("every registered broker passes at least the lenient contract", () => {
    const registry = createBrokerRegistry();
    const failures = registry.list().flatMap((id) => validateAdapter(registry.get(id)).errors.map((e) => `${id}: ${e}`));
    expect(failures).toEqual([]);
  });

  it("strict mode rejects an ungated order method and a declared-but-missing capability", () => {
    const v = validateAdapter({ ...base, placeOrder() {}, capabilities: { auth: { kind: "apiKeyToken" }, testConnection: true, expiries: true, optionChain: true, ltp: true, placeOrder: true, funds: true } });
    expect(v.errors.join("\n")).toMatch(/placeOrder\(\) .*withOrderGate/);
    expect(v.errors.join("\n")).toMatch(/funds declared but fetchFunds\(\) is missing/);
  });

  it("treats camelCase PINs and other second factors as secrets, but not ordinary keys", () => {
    for (const k of ["password", "passwd", "pin", "mpin", "loginPin", "tradingPin", "pinCode", "userPin", "trading_pin", "totp", "totpCode", "otp", "twoFA", "factor2", "dob", "userDob", "pan", "panNumber", "securityAnswer"]) {
      expect(isForbiddenSecretKey(k), k).toBe(true);
      expect(FORBIDDEN_SECRET_KEY.test(k), k).toBe(true);
    }
    for (const k of ["apiKey", "apiSecret", "clientId", "clientCode", "userId", "vendorCode", "accessToken", "sessionToken", "feedToken", "encryptionKey", "mobileNumber", "requestCode", "appCode", "spinner", "company", "optionChain", "sessionServerId"]) {
      expect(isForbiddenSecretKey(k), k).toBe(false);
    }
  });

  it("strict mode requires sessionLogin metadata and forbids secret credential fields", () => {
    const v = validateAdapter({ ...base, credentialFields: ["apiKey", "password"], capabilities: { auth: { kind: "sessionLogin" }, testConnection: true, expiries: true, optionChain: true, ltp: true } });
    const all = v.errors.join("\n");
    expect(all).toMatch(/must export login/);
    expect(all).toMatch(/loginFields/);
    expect(all).toMatch(/sessionFields/);
    expect(all).toMatch(/must not list secret password/);
  });

  it("keeps the legacy order-feature keys legal alongside contract keys", () => {
    const v = validateAdapter({ ...base, capabilities: { auth: { kind: "apiKeyToken" }, testConnection: true, expiries: true, optionChain: true, ltp: true, bracket: false, products: ["CNC"] } });
    expect(v.errors).toEqual([]);
    expect(v.warnings.filter((w) => /unknown capability/.test(w))).toEqual([]);
  });

  it("Dhan's order methods are gated", () => {
    for (const [name, spec] of Object.entries(CAPABILITIES)) if (spec.order) expect(isOrderGated(dhan[name])).toBe(true);
  });
});

describe("normaliseError", () => {
  it("maps refusals to 422 and upstream failures to 502, redacting secrets", () => {
    expect(normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(normaliseError(new Error("Dhan API error [401]: secretTokenValue"), { secrets: ["secretTokenValue"] })).toEqual({ statusCode: 502, code: "UPSTREAM_ERROR", message: "Dhan API error [401]: ***" });
    expect(dhan.normaliseError(new Error('Dhan API error [401]: {"errorCode":"DH-901"}')).code).toBe("UPSTREAM_AUTH");
  });
});
