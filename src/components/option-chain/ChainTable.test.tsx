import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain } from "@/lib/options";
import { ChainTable } from "./ChainTable";
import { ChainSummaryBar } from "./ChainSummaryBar";
import { buildChainModel, deltaTargets, sliceAroundATM } from "./chainModel";
import { visibleColumns } from "./columns";
import { presetColumns } from "./preferences";

const NOW = new Date("2026-10-15T05:00:00Z");
const SPOT = 24512.3;
const model = buildChainModel(generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: "2026-10-20", now: NOW, seed: 11, strikes: 41 }).chain, {
  spot: SPOT,
  expiry: "2026-10-20",
  lotSize: 65,
  symbol: "NIFTY",
  now: NOW,
});

function renderTable(preset: "sensibull" | "greeks" = "sensibull", onTrade = vi.fn()) {
  const columns = visibleColumns(presetColumns(preset));
  const rows = sliceAroundATM(model.rows, model.atmStrike, 10);
  const utils = render(
    <ChainTable
      symbol="NIFTY"
      expiry="2026-10-20"
      model={model}
      rows={rows}
      columns={columns}
      deltaView
      deltas={deltaTargets(model.rows)}
      gammaMap={new Map([[model.atmStrike, ["AG" as const]]])}
      focusedStrike={null}
      focusedSide="CE"
      onFocusRow={vi.fn()}
      sigmaPoints={300}
      onTrade={onTrade}
      onStraddle={vi.fn()}
      onStrangle={vi.fn()}
      onIronFly={vi.fn()}
      onAlert={vi.fn()}
      onOIAnalysis={vi.fn()}
    />,
  );
  return { ...utils, columns, rows, onTrade };
}

describe("ChainTable", () => {
  it("keeps header, body and footer column counts aligned from one column array", () => {
    const { container, columns, rows } = renderTable("greeks");
    const expected = columns.length * 2 + 1;
    const headCells = container.querySelectorAll("thead tr:nth-child(2) th");
    expect(headCells.length).toBe(expected);
    const firstRow = container.querySelector("tbody tr[data-strike]");
    expect(firstRow?.querySelectorAll("td").length).toBe(expected);
    expect(container.querySelectorAll("tfoot td").length).toBe(expected);
    expect(container.querySelectorAll("tbody tr[data-strike]").length).toBe(rows.length);
  });

  it("marks ATM, renders the spot divider and gamma badges", () => {
    const { container } = renderTable();
    const atm = container.querySelector(`tr[data-strike="${model.atmStrike}"]`) as HTMLElement;
    expect(within(atm).getByText("ATM")).toBeInTheDocument();
    expect(within(atm).getByText("AG")).toBeInTheDocument();
    expect(screen.getByText("NIFTY spot")).toBeInTheDocument();
  });

  it("adds a leg through the B / S buttons on the LTP cell", () => {
    const onTrade = vi.fn();
    renderTable("sensibull", onTrade);
    fireEvent.click(screen.getByRole("button", { name: `Buy ${model.atmStrike} CE: add to basket` }));
    expect(onTrade).toHaveBeenCalledWith(model.atmStrike, "CE", "BUY");
    fireEvent.click(screen.getByRole("button", { name: `Sell ${model.atmStrike} PE: add to basket` }));
    expect(onTrade).toHaveBeenCalledWith(model.atmStrike, "PE", "SELL");
  });
});

describe("ChainSummaryBar", () => {
  it("labels sample data and shows the key stats", () => {
    render(
      <TooltipProvider>
        <ChainSummaryBar symbol="NIFTY" model={model} lotSize={65} lotEffectiveFrom="2025-12-31" dte="5 days" source={{ source: "sample", asOf: NOW.getTime(), stale: true }} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText("PCR (OI)")).toBeInTheDocument();
    expect(screen.getByText("Max pain")).toBeInTheDocument();
    expect(screen.getByText("Expected move")).toBeInTheDocument();
  });
});
