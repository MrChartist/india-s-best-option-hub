import { describe, expect, it } from "vitest";
import { niceStep, niceTicks } from "./niceTicks";

const gaps = (t: number[]) => t.slice(1).map((v, i) => +(v - t[i]).toFixed(9));

describe("niceTicks", () => {
  it("brackets the range with evenly spaced nice steps", () => {
    const t = niceTicks(158, 265);
    expect(t[0]).toBeLessThanOrEqual(158);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(265);
    expect(new Set(gaps(t)).size).toBe(1);
    expect(t).toEqual([150, 175, 200, 225, 250, 275]);
  });

  it("handles small decimals without float noise", () => {
    const t = niceTicks(0, 0.0125, 4);
    expect(t).toEqual([0, 0.005, 0.01, 0.015]);
    expect(niceTicks(0, 2.1, 4)).toEqual([0, 1, 2, 3]);
  });

  it("degenerate and bad input", () => {
    expect(niceTicks(NaN, 1)).toEqual([]);
    const t = niceTicks(100, 100);
    expect(t[0]).toBeLessThan(100);
    expect(t[t.length - 1]).toBeGreaterThan(100);
  });

  it("niceStep picks 1/2/2.5/5 multiples", () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(12, 5)).toBe(2.5);
    expect(niceStep(0)).toBe(1);
  });
});
