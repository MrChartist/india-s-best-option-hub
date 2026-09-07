import { describe, it, expect } from "vitest";
import { validateArmRequest } from "./riskArmValidation.mjs";
import { TRAIL_MODES } from "./riskMath.mjs";

/** A valid BUY-CE leg: profits when spot rises. SL 50pts, Target 80pts. */
function validLeg(overrides = {}) {
  return {
    exchangeSegment: "IDX_I",
    securityId: "25",
    s0: 58090,
    side: "BUY",
    optionType: "CE",
    slPts: 50,
    tgtPts: 80,
    ...overrides,
  };
}

describe("validateArmRequest — accepts a well-formed leg", () => {
  it("accepts a valid config", () => {
    expect(validateArmRequest(validLeg())).toEqual({ ok: true });
  });

  it("accepts a valid trailing config", () => {
    const result = validateArmRequest(validLeg({
      trailing: { mode: TRAIL_MODES.PERCENTAGE_GIVEBACK, params: { p: 0.3 } },
    }));
    expect(result.ok).toBe(true);
  });
});

describe("validateArmRequest — shape/enum ladder", () => {
  it("rejects a missing exchangeSegment/securityId", () => {
    const { exchangeSegment, ...rest } = validLeg();
    expect(validateArmRequest(rest).ok).toBe(false);
    const { securityId, ...rest2 } = validLeg();
    expect(validateArmRequest(rest2).ok).toBe(false);
  });

  it("rejects an empty-string securityId", () => {
    expect(validateArmRequest(validLeg({ securityId: "" })).ok).toBe(false);
  });

  it("rejects an invalid side rather than silently coercing case", () => {
    const result = validateArmRequest(validLeg({ side: "buy" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/side/i);
  });

  it("rejects an invalid optionType", () => {
    const result = validateArmRequest(validLeg({ optionType: "XX" }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/optionType/i);
  });

  it("rejects a non-finite s0", () => {
    expect(validateArmRequest(validLeg({ s0: NaN })).ok).toBe(false);
    expect(validateArmRequest(validLeg({ s0: "58090" })).ok).toBe(false);
  });

  it("rejects zero or negative slPts/tgtPts", () => {
    expect(validateArmRequest(validLeg({ slPts: 0 })).ok).toBe(false);
    expect(validateArmRequest(validLeg({ slPts: -10 })).ok).toBe(false);
    expect(validateArmRequest(validLeg({ tgtPts: 0 })).ok).toBe(false);
    expect(validateArmRequest(validLeg({ tgtPts: -10 })).ok).toBe(false);
  });

  it("rejects an unknown trailing mode", () => {
    const result = validateArmRequest(validLeg({ trailing: { mode: "not-a-mode", params: {} } }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/trailing/i);
  });

  it("rejects a trailing config missing params", () => {
    const result = validateArmRequest(validLeg({ trailing: { mode: TRAIL_MODES.FIXED_POINT } }));
    expect(result.ok).toBe(false);
  });

  it("rejects a trailing config whose params is not an object", () => {
    const result = validateArmRequest(validLeg({ trailing: { mode: TRAIL_MODES.FIXED_POINT, params: "nope" } }));
    expect(result.ok).toBe(false);
  });
});
