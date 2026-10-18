import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { generateSampleChain } from "@/lib/options";
import { buildChainModel } from "./chainModel";
import { StrikeInspector } from "./StrikeInspector";

const NOW = new Date("2026-10-15T05:00:00Z");
const SPOT = 24512.3;
const model = buildChainModel(generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: "2026-10-20", now: NOW, seed: 11, strikes: 21 }).chain, {
  spot: SPOT,
  expiry: "2026-10-20",
  lotSize: 65,
  symbol: "NIFTY",
  now: NOW,
});
const row = model.rows.find((r) => r.strike === model.atmStrike);

function renderInspector(overrides: Partial<Parameters<typeof StrikeInspector>[0]> = {}) {
  const props = {
    symbol: "NIFTY",
    expiry: "2026-10-20",
    row,
    focused: false,
    isATM: true,
    isMaxPain: false,
    onTrade: vi.fn(),
    onOpenContract: vi.fn(),
    onAlert: vi.fn(),
    onOIAnalysis: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<StrikeInspector {...props} />);
  return props;
}

describe("StrikeInspector", () => {
  it("shows calls and puts side by side for the strike", () => {
    renderInspector();
    const aside = screen.getByRole("complementary", { name: "Strike inspector" });
    expect(within(aside).getByText("ATM")).toBeInTheDocument();
    expect(within(aside).getByText(/nearest the money/)).toBeInTheDocument();
    const table = within(aside).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "CE" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "PE" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Delta" })).toBeInTheDocument();
  });

  it("routes each action with the strike and side", () => {
    const p = renderInspector({ focused: true });
    const k = model.atmStrike;
    const put = screen.getByRole("group", { name: new RegExp(`PE$`) });
    fireEvent.click(within(put).getByRole("button", { name: "Sell" }));
    expect(p.onTrade).toHaveBeenCalledWith(k, "PE", "SELL");
    const call = screen.getByRole("group", { name: new RegExp(`CE$`) });
    fireEvent.click(within(call).getByRole("button", { name: /Contract/ }));
    expect(p.onOpenContract).toHaveBeenCalledWith(k, "CE");
    fireEvent.click(within(call).getByRole("button", { name: /Alert/ }));
    expect(p.onAlert).toHaveBeenCalledWith(k, "CE");
    fireEvent.click(screen.getByRole("button", { name: /OI Analysis/ }));
    expect(p.onOIAnalysis).toHaveBeenCalledWith(k);
    fireEvent.click(screen.getByRole("button", { name: "Close the strike inspector" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("explains how to pick a strike when there is no row", () => {
    renderInspector({ row: undefined, isATM: false });
    expect(screen.getByText(/press J \/ K, to inspect a strike/)).toBeInTheDocument();
  });
});
