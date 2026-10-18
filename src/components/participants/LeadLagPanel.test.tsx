import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DailyClose, HistoryPoint } from "@/lib/participantsApi";

// Give the chart a real size so Recharts draws the scatter dots in jsdom.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div className="recharts-responsive-container">{cloneElement(children, { width: 600, height: 240 } as Record<string, unknown>)}</div>
    ),
  };
});

describe("LeadLagPanel accessibility", () => {
  it("hides the unnamed role=img scatter dots inside the labelled chart", async () => {
    const { LeadLagPanel } = await import("./LeadLagPanel");
    const dates = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"];
    const series = dates.map((date, i) => ({ date, fiiLongPct: 20 + ((i * 7) % 5) }) as HistoryPoint);
    const closes: DailyClose[] = [...dates, "2026-10-14"].map((date, i) => ({ date, close: 25_000 + ((i * 37) % 11) * 20 }));
    const { container, getByRole } = render(
      <TooltipProvider>
        <LeadLagPanel series={series} closes={closes} closesLoading={false} windowLabel="60D" />
      </TooltipProvider>,
    );
    expect(getByRole("img", { name: /Scatter of \d+ sessions/ })).toBeInTheDocument();
    const dots = container.querySelectorAll('.recharts-scatter-symbol[role="img"]');
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) expect(d.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
