import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain } from "@/lib/options";
import { ChainTable } from "./ChainTable";
import { ChainSummaryBar } from "./ChainSummaryBar";
import { buildChainModel, deltaTargets, sliceAroundATM } from "./chainModel";
import { visibleColumns } from "./columns";
import { presetColumns } from "./preferences";

// jsdom has no DOMRect, which Radix ContextMenu uses (DOMRect.fromRect) to anchor at the pointer.
if (typeof globalThis.DOMRect === "undefined") {
  class DOMRectShim {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    get top() { return this.y; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
    static fromRect(r: { x?: number; y?: number; width?: number; height?: number } = {}) {
      return new DOMRectShim(r.x, r.y, r.width, r.height);
    }
  }
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = DOMRectShim;
}

const NOW = new Date("2026-10-15T05:00:00Z");
const SPOT = 24512.3;
const model = buildChainModel(generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: "2026-10-20", now: NOW, seed: 11, strikes: 41 }).chain, {
  spot: SPOT,
  expiry: "2026-10-20",
  lotSize: 65,
  symbol: "NIFTY",
  now: NOW,
});

function renderTable(preset: "sensibull" | "greeks" = "sensibull", onTrade = vi.fn(), onOpenContract = vi.fn()) {
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
      onOpenContract={onOpenContract}
    />,
  );
  return { ...utils, columns, rows, onTrade, onOpenContract };
}

describe("ChainTable", () => {
  it("keeps header, body and footer column counts aligned from one column array", () => {
    const { container, columns, rows } = renderTable("greeks");
    // Each side: data columns + one trade (B / S) column; plus the strike column.
    const expected = columns.length * 2 + 3;
    const headCells = container.querySelectorAll("thead tr:nth-child(2) th");
    expect(headCells.length).toBe(expected);
    const firstRow = container.querySelector("tbody tr[data-strike]");
    expect(firstRow?.querySelectorAll("td, th").length).toBe(expected);
    expect(firstRow?.querySelectorAll('th[scope="row"]').length).toBe(1);
    expect(container.querySelectorAll("tfoot td").length).toBe(expected);
    const groupSpan = Array.from(container.querySelectorAll("thead tr:first-child th")).reduce((n, th) => n + Number(th.getAttribute("colspan") ?? 1), 0);
    expect(groupSpan).toBe(expected);
    expect(container.querySelectorAll("tbody tr[data-strike]").length).toBe(rows.length);
  });

  it("marks ATM, renders the spot divider and gamma badges", () => {
    const { container } = renderTable();
    const atm = container.querySelector(`tr[data-strike="${model.atmStrike}"]`) as HTMLElement;
    expect(within(atm).getByText("ATM")).toBeInTheDocument();
    expect(within(atm).getByText("AG")).toBeInTheDocument();
    expect(screen.getByText("NIFTY spot")).toBeInTheDocument();
  });

  it("washes ITM cells with the ITM token and keeps rows a fixed height", () => {
    const { container } = renderTable();
    const itmStrike = model.rows.find((r) => r.ce.itm && r.strike !== model.atmStrike && Math.abs(r.strike - model.atmStrike) <= 500)!.strike;
    const tr = container.querySelector(`tr[data-strike="${itmStrike}"]`) as HTMLElement;
    expect(tr.className).toContain("h-8");
    const ceCell = tr.querySelector('td[data-side="CE"]') as HTMLElement;
    expect(ceCell.className).toContain("bg-[hsl(var(--wash-itm))]");
    expect(ceCell.className).not.toContain("wash-warning");
    const atm = container.querySelector(`tr[data-strike="${model.atmStrike}"]`) as HTMLElement;
    expect(atm.className).toContain("shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.55)]");
  });

  it("puts B / S in their own column beside the strike, faint on ATM±3 only", () => {
    const { container } = renderTable();
    const atm = container.querySelector(`tr[data-strike="${model.atmStrike}"]`) as HTMLElement;
    const strikeCell = atm.querySelector('th[scope="row"]') as HTMLElement;
    const ceTrade = strikeCell.previousElementSibling as HTMLElement;
    const peTrade = strikeCell.nextElementSibling as HTMLElement;
    expect(within(ceTrade).getByRole("button", { name: `Buy ${model.atmStrike} CE: add to basket` })).toBeInTheDocument();
    expect(within(peTrade).getByRole("button", { name: `Sell ${model.atmStrike} PE: add to basket` })).toBeInTheDocument();
    expect((ceTrade.firstElementChild as HTMLElement).className).toContain("opacity-40");
    const far = container.querySelector("tbody tr[data-strike]") as HTMLElement;
    const farTrade = (far.querySelector('th[scope="row"]') as HTMLElement).previousElementSibling as HTMLElement;
    expect((farTrade.firstElementChild as HTMLElement).className).toContain("opacity-0");
    expect((farTrade.firstElementChild as HTMLElement).className).toContain("[@media(hover:none)]:opacity-100");
  });

  it("offers Open contract in the strike context menu", async () => {
    const onOpenContract = vi.fn();
    const { container } = renderTable("sensibull", vi.fn(), onOpenContract);
    const atm = container.querySelector(`tr[data-strike="${model.atmStrike}"] td`) as HTMLElement;
    fireEvent.contextMenu(atm);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Open contract/ }));
    expect(onOpenContract).toHaveBeenCalledWith(model.atmStrike, "CE");
    fireEvent.contextMenu(atm);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open the PE contract" }));
    expect(onOpenContract).toHaveBeenCalledWith(model.atmStrike, "PE");
  });

  it("adds a leg through the B / S buttons beside the strike", () => {
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
    expect(screen.getByText("Exp. move")).toBeInTheDocument();
    expect(screen.getByText("IV 1σ")).toBeInTheDocument();
    expect(screen.getByText("Straddle ×0.85")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /What is .*put-call ratio|What is PCR/i })).toBeInTheDocument();
    // Secondary stats sit behind the disclosure.
    expect(screen.queryByText("Lot size")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More stats" }));
    expect(screen.getByText("Lot size")).toBeInTheDocument();
    expect(screen.getByText("OI build-up")).toBeInTheDocument();
  });
});
