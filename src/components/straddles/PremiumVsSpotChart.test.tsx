import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { StraddlePoint } from "@/components/expiry/expiryMath";

// Give the chart a real size so Recharts draws the scatter dots in jsdom.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: ReactElement }) => (
      <div className="recharts-responsive-container">{cloneElement(children, { width: 800, height: 280 } as Record<string, unknown>)}</div>
    ),
  };
});

describe("PremiumVsSpotChart accessibility", () => {
  it("hides the unnamed role=img scatter dots from assistive technology", async () => {
    const { PremiumVsSpotChart } = await import("./PremiumVsSpotChart");
    const t0 = Date.parse("2026-10-16T04:00:00Z");
    const points: StraddlePoint[] = Array.from({ length: 6 }, (_, i) => ({
      ts: t0 + i * 60_000, spot: 25_000 + i * 10, strike: 25_000, peStrike: 25_000, ce: 100 + i, pe: 90 - i, straddle: 190, vol: Number.NaN,
    }));
    const { container } = render(
      <TooltipProvider>
        <PremiumVsSpotChart points={points} mult={1} unit="₹ per unit" mode="sample" />
      </TooltipProvider>,
    );
    const dots = container.querySelectorAll('.recharts-scatter-symbol[role="img"]');
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) expect(d.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector("figure[aria-label]")).not.toBeNull();
  });
});
