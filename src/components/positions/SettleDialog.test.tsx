import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { toISTDate } from "@/lib/options";
import { createPosition, positionSettlementKey, settlePositions } from "@/lib/positionStore";
import { SettleDialog } from "./SettleDialog";

const ce = (expiry: string) => createPosition({ symbol: "NIFTY", type: "CE", action: "BUY", strike: 25000, entryPrice: 100, expiry, lots: 1, lotSize: 75 });
const NOW = toISTDate("2026-11-04", "11:00");

describe("expiry settlement with several lapsed expiries of one underlying", () => {
  it("settlePositions uses a price per symbol and expiry", () => {
    const a = ce("2026-10-27");
    const b = ce("2026-11-03");
    const res = settlePositions([a, b], NOW, { [positionSettlementKey(a)]: 24900, [positionSettlementKey(b)]: 25300 });
    expect(res.settled.find((c) => c.id === a.id)?.exitPrice).toBe(0);
    expect(res.settled.find((c) => c.id === b.id)?.exitPrice).toBe(300);
  });

  it("a plain symbol price still applies to expiries without their own price", () => {
    const a = ce("2026-10-27");
    const b = ce("2026-11-03");
    const res = settlePositions([a, b], NOW, { NIFTY: 25300, [positionSettlementKey(a)]: 24900 });
    expect(res.settled.find((c) => c.id === a.id)?.exitPrice).toBe(0);
    expect(res.settled.find((c) => c.id === b.id)?.exitPrice).toBe(300);
  });

  it("the dialog asks for one price per expiry and confirms them separately", () => {
    const a = ce("2026-10-27");
    const b = ce("2026-11-03");
    const onConfirm = vi.fn();
    render(<SettleDialog open onOpenChange={vi.fn()} expired={[a, b]} suggestedSpots={{ NIFTY: 25300 }} now={NOW} onConfirm={onConfirm} />);
    const inputs = screen.getAllByLabelText(/NIFTY settlement price/) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    // Latest expiry first, seeded with the current spot; the older one needs its own close.
    expect(inputs[0].value).toBe("25300.00");
    expect(inputs[1].value).toBe("");
    fireEvent.change(inputs[1], { target: { value: "24900" } });
    fireEvent.click(screen.getByRole("button", { name: /Settle 2/ }));
    expect(onConfirm).toHaveBeenCalledWith({ [positionSettlementKey(b)]: 25300, [positionSettlementKey(a)]: 24900 });
  });
});
