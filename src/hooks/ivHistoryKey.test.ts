import { describe, expect, it } from "vitest";
import { ivHistoryKey } from "./useAlertEngine";

describe("ivHistoryKey", () => {
  it("changes when a capped 260-day history rolls forward without changing length", () => {
    const day1 = Array.from({ length: 260 }, (_, i) => 10 + i / 100);
    const day2 = [...day1.slice(1), 25]; // oldest dropped, today's IV appended: still 260 rows
    const before = ivHistoryKey([{ data: day1, dataUpdatedAt: 1_000 }]);
    const after = ivHistoryKey([{ data: day2, dataUpdatedAt: 2_000 }]);
    expect(day2).toHaveLength(day1.length);
    expect(after).not.toBe(before);
  });

  it("is stable while the data is unchanged and marks missing data", () => {
    const q = { data: [12, 13], dataUpdatedAt: 5 };
    expect(ivHistoryKey([q, { data: undefined, dataUpdatedAt: 0 }])).toBe(ivHistoryKey([q, { data: undefined, dataUpdatedAt: 0 }]));
    expect(ivHistoryKey([{ data: undefined, dataUpdatedAt: 0 }])).toBe("-1");
  });
});
