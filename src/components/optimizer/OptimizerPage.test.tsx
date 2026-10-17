import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain, getExpiries } from "@/lib/options";
import type { OptionChainHookData } from "@/hooks/useMarketData";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

const exps = getExpiries("NIFTY", new Date(), 3);
const SPOT = 25000;
const asOf = Date.now();

function dataFor(expiry: string | undefined): OptionChainHookData {
  const exp = expiry || exps[0].date;
  return {
    chain: generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: exp, strikes: 41 }).chain,
    spotPrice: SPOT,
    expiries: exps.map((e) => ({ label: e.date, value: e.date, daysToExpiry: e.dte })),
    expiry: exp,
    lotSize: 65,
    stepSize: 50,
    maxPain: SPOT,
    totalCEOI: 0,
    totalPEOI: 0,
    isLive: false,
    afterHours: false,
    source: "sample",
    cachedAt: null,
    asOf,
    stale: true,
    reason: "Proxy offline",
  };
}

const cache = new Map<string, OptionChainHookData>();
vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: (_s: string, expiry?: string) => {
    const key = expiry ?? "";
    if (!cache.has(key)) cache.set(key, dataFor(expiry));
    return { data: cache.get(key), isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
}));

import Optimizer from "@/pages/Optimizer";

let lastLocation = "";
function LocationProbe() {
  const loc = useLocation();
  lastLocation = `${loc.pathname}${loc.search}`;
  return null;
}

function renderPage(entry = "/optimizer") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/optimizer" element={<Optimizer />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Optimizer page", () => {
  it("labels sample data, ranks strategies and opens one in the builder", async () => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    renderPage();
    expect(screen.getAllByText(/Sample data/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not investment advice/i)).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Ranked strategies" }, { timeout: 8000 });
    const cards = within(list).getAllByRole("article");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(10);
    // Only the top card's builder button is the filled primary; the rest are outline.
    const open0 = within(cards[0]).getByRole("button", { name: /Open in Builder/i });
    expect(open0.className).toMatch(/bg-primary/);
    if (cards.length > 1) expect(within(cards[1]).getByRole("button", { name: /Open in Builder/i }).className).not.toMatch(/bg-primary\b/);
    // Every card says what has to happen for it to pay.
    expect(within(cards[0]).getByText(/^Profits /)).toBeInTheDocument();
    expect(within(cards[0]).getByText(/Return on funds/i)).toBeInTheDocument();
    fireEvent.click(open0);
    expect(lastLocation).toMatch(/^\/strategy-builder\?legs=[A-Za-z0-9_-]+$/);
  }, 15000);

  it("reads ?symbol= and ?target=, tags 1σ and sends a result to paper trading", async () => {
    localStorage.clear();
    renderPage("/optimizer?symbol=nifty&target=25200");
    expect(screen.getByRole("heading", { level: 1, name: /Strategy Optimizer/i })).toBeInTheDocument();
    expect(screen.getAllByText("IV 1σ").length).toBeGreaterThan(0);
    expect(screen.getByText("Straddle ×0.85")).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: "Target price" }) as HTMLInputElement).value).toBe("25200");
    const slider = screen.getByRole("slider", { name: "Target price" });
    expect(slider).toHaveAttribute("aria-valuenow", "25200");
    expect(slider).toHaveAttribute("tabindex", "0");
    expect(slider.querySelector("[role]")).toBeNull();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "25250");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(Number(slider.getAttribute("aria-valuemin")));
    fireEvent.keyDown(slider, { key: "End" });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBe(Number(slider.getAttribute("aria-valuemax")));

    const list = await screen.findByRole("list", { name: "Ranked strategies" }, { timeout: 8000 });
    const cards = within(list).getAllByRole("article");
    fireEvent.click(within(cards[0]).getByRole("button", { name: /Paper trade/i }));
    expect(lastLocation).toMatch(/^\/paper-trading\?legs=[A-Za-z0-9_-]+$/);
  }, 15000);

  it("switches to the compact table and keeps tabs free of dangling aria-controls", async () => {
    localStorage.clear();
    renderPage();
    await screen.findByRole("list", { name: "Ranked strategies" }, { timeout: 8000 });
    fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
    const table = await screen.findByRole("table", { name: "Ranked strategies table" });
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
    expect(within(rows[1]).getByRole("button", { name: /in Builder/i }).className).toMatch(/bg-primary/);
    for (const tab of screen.getAllByRole("tab")) {
      const id = tab.getAttribute("aria-controls");
      if (id) expect(document.getElementById(id)).not.toBeNull();
    }
    expect(localStorage.getItem("mc_optimizer_layout_v1")).toBe("table");
  }, 15000);
});
