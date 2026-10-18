import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OptimizerForm } from "./OptimizerForm";
import { DEFAULT_FORM_SETTINGS, type FormSettings } from "./formSettings";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

function Harness({ spy, onTarget }: { spy: (s: FormSettings) => void; onTarget: (p: number) => void }) {
  const [settings, setSettings] = useState<FormSettings>(DEFAULT_FORM_SETTINGS);
  return (
    <OptimizerForm
      symbol="NIFTY"
      onSymbolChange={vi.fn()}
      expiries={[]}
      expiry=""
      onExpiryChange={vi.fn()}
      spot={25000}
      step={50}
      chart={null}
      targetPrice={25000}
      onTargetPrice={onTarget}
      activeSentiment={null}
      onSentiment={vi.fn()}
      targetDate="2026-10-27"
      onTargetDate={vi.fn()}
      minDate="2026-10-19"
      maxDate="2026-10-27"
      settings={settings}
      onSettings={(patch) => setSettings((s) => {
        const next = { ...s, ...patch };
        spy(next);
        return next;
      })}
      onReset={vi.fn()}
    />
  );
}

function setup() {
  const spy = vi.fn();
  const onTarget = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <Harness spy={spy} onTarget={onTarget} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { spy, onTarget };
}

describe("OptimizerForm numeric inputs", () => {
  it("lets 'Strikes ± ATM' be typed digit by digit and clamps on blur", () => {
    const { spy } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Liquidity and scan settings/ }));
    const input = screen.getByLabelText("Strikes ± ATM") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } });
    expect(input.value).toBe("1");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ strikesAroundAtm: 12 }));
    expect(input.value).toBe("12");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.blur(input);
    expect(input.value).toBe("2");
  });

  it("rejects a negative budget instead of dropping the minus sign", () => {
    const { spy } = setup();
    const budget = screen.getByLabelText(/Budget \(margin\)/) as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "-50000" } });
    fireEvent.blur(budget);
    expect(spy).not.toHaveBeenCalled();
    expect(budget.value).toBe((100000).toLocaleString("en-IN"));
  });

  it("does not turn '1e5' into ₹15", () => {
    const { spy } = setup();
    const budget = screen.getByLabelText(/Budget \(margin\)/) as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "1e5" } });
    fireEvent.blur(budget);
    const budgets = spy.mock.calls.map((c) => (c[0] as FormSettings).budget);
    expect(budgets).not.toContain(15);
    fireEvent.change(budget, { target: { value: "₹2,50,000" } });
    fireEvent.blur(budget);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ budget: 250000 }));
  });
});
