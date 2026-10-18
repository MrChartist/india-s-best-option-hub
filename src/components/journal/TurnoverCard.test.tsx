import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { matchRoundTrips, parseZerodha, sampleTradebook } from "@/lib/journal";
import { TurnoverCard } from "./TurnoverCard";

describe("TurnoverCard", () => {
  it("renders a valid description list (div groups hold only dt/dd)", () => {
    const { trips } = matchRoundTrips(parseZerodha(sampleTradebook()).fills, { now: new Date("2026-10-18T12:00:00+05:30") });
    expect(trips.length).toBeGreaterThan(0);
    const { container } = render(<TurnoverCard trips={trips} sample />);
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    for (const group of Array.from(dl!.children)) {
      expect(group.tagName).toBe("DIV");
      const kids = Array.from(group.children).map((c) => c.tagName);
      expect(kids.length).toBeGreaterThan(0);
      for (const k of kids) expect(["DT", "DD"]).toContain(k);
    }
    // Every dt/dd sits directly inside a div that is a direct child of the dl.
    for (const item of Array.from(dl!.querySelectorAll("dt, dd"))) expect(item.parentElement?.parentElement).toBe(dl);
  });
});
