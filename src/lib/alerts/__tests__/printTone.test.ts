import { describe, expect, it } from "vitest";
import { printTone } from "../evaluate";

describe("printTone", () => {
  it("reads type x aggressor", () => {
    expect(printTone({ type: "CE", aggressor: "ASK" })).toBe("bullish");
    expect(printTone({ type: "PE", aggressor: "BID" })).toBe("bullish"); // put writing
    expect(printTone({ type: "PE", aggressor: "ASK" })).toBe("bearish");
    expect(printTone({ type: "CE", aggressor: "BID" })).toBe("bearish"); // call writing
    expect(printTone({ type: "CE", aggressor: "MID" })).toBe("info");
  });
});
