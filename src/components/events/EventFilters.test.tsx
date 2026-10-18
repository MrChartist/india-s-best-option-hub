import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EVENT_KINDS } from "@/lib/events";
import { EventFilters } from "./EventFilters";

describe("EventFilters", () => {
  it("keeps the count in a selected chip at full ink (no opacity that drops contrast below AA)", () => {
    render(
      <EventFilters
        value={{ kinds: [...EVENT_KINDS], symbol: "", fnoOnly: false, highOnly: false }}
        onChange={vi.fn()}
        onReset={vi.fn()}
        counts={{ [EVENT_KINDS[0]]: 12 }}
        dirty={false}
      />,
    );
    const chip = screen.getAllByRole("button", { pressed: true })[0];
    const count = chip.querySelector(".tabular-nums");
    expect(count).toHaveTextContent("12");
    expect(count?.className).not.toMatch(/opacity-/);
  });
});
