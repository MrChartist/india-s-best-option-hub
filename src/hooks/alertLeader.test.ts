// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { releaseLease, tryLease } from "./useAlertEngine";

describe("alert runner lease (fallback leader election)", () => {
  beforeEach(() => localStorage.clear());
  it("lets one tab hold the lease until it expires or is released", () => {
    expect(tryLease("a", 1_000)).toBe(true);
    expect(tryLease("b", 2_000)).toBe(false);
    expect(tryLease("a", 3_000)).toBe(true); // renew
    expect(tryLease("b", 3_000 + 9_000)).toBe(true); // a stopped renewing
    releaseLease("b");
    expect(tryLease("a", 13_000)).toBe(true);
  });
});
