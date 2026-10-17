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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/optimizer"]}>
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
    fireEvent.click(within(cards[0]).getByRole("button", { name: /Open in Builder/i }));
    expect(lastLocation).toMatch(/^\/strategy-builder\?legs=[A-Za-z0-9_-]+$/);
  }, 15000);
});
