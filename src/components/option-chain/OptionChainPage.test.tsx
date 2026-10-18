import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain } from "@/lib/options";
import type { OptionChainHookData } from "@/hooks/useMarketData";

const EXPIRY = "2026-10-20";
const sample = generateSampleChain({ symbol: "NIFTY", spot: 24512.3, expiry: EXPIRY, seed: 5, strikes: 41 });
const hookData: OptionChainHookData = {
  chain: sample.chain,
  spotPrice: 24512.3,
  expiries: [
    { label: "20 Oct 2026", value: EXPIRY, daysToExpiry: 5 },
    { label: "27 Oct 2026", value: "2026-10-27", daysToExpiry: 12 },
  ],
  expiry: EXPIRY,
  lotSize: 65,
  stepSize: 50,
  maxPain: 24500,
  totalCEOI: 0,
  totalPEOI: 0,
  isLive: false,
  afterHours: false,
  source: "sample",
  cachedAt: null,
  asOf: Date.now(),
  stale: true,
  reason: "Proxy offline",
};

const refetch = vi.fn();
vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: () => ({ data: hookData, isLoading: false, isError: false, error: null, refetch, isFetching: false, dataUpdatedAt: 1 }),
  useChainMulti: () => ({ data: undefined, isLoading: true, isSuccess: false }),
  buildSampleChainData: vi.fn(),
}));
vi.mock("@/components/StockChart", () => ({ StockChart: () => null }));

import OptionChain from "@/pages/OptionChain";

let lastLocation = "";
function LocationProbe() {
  const loc = useLocation();
  lastLocation = `${loc.pathname}${loc.search}`;
  return null;
}

function renderPage(url = "/option-chain?symbol=NIFTY") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/option-chain" element={<><OptionChain /><LocationProbe /></>} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("OptionChain page", () => {
  beforeEach(() => {
    localStorage.clear();
    refetch.mockClear();
  });

  it("renders the chain with a visible sample-data label and disclaimer", () => {
    renderPage();
    expect(screen.getAllByText(/Sample data/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Data for education and research\. Not investment advice\./)).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr[data-strike]").length).toBe(31); // ±15 default range
  });

  it("supports keyboard: J focuses ATM, A adds the CE to the basket, R refetches", () => {
    renderPage();
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    const focused = document.querySelector('tr[aria-selected="true"]');
    expect(focused?.getAttribute("data-strike")).toBe("24500");
    act(() => {
      fireEvent.keyDown(window, { key: "a" });
    });
    const basket = JSON.parse(localStorage.getItem("mc_basket_v1") ?? "[]");
    expect(basket).toHaveLength(1);
    expect(basket[0]).toMatchObject({ symbol: "NIFTY", expiry: EXPIRY, strike: 24500, type: "CE", side: "BUY", lots: 1 });
    act(() => {
      fireEvent.keyDown(window, { key: "r" });
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps ?expiry= in the URL when an expiry is picked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: /27 Oct/ }));
    expect(lastLocation).toContain("expiry=2026-10-27");
    expect(lastLocation).toContain("symbol=NIFTY");
  });

  it("changes the strike range", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "±10" }));
    expect(document.querySelectorAll("tbody tr[data-strike]").length).toBe(21);
    expect(localStorage.getItem("mc_chain_range_v1")).toBe("10");
  });

  it("sends a basket group to Paper Trading, then marks it sent and clears it", () => {
    renderPage();
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "a" });
    });
    fireEvent.click(screen.getByRole("button", { name: /^Basket\s*1\s*legs, open basket$/ }));
    expect(screen.getByRole("heading", { name: /NIFTY/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Paper trade/ }));
    expect(lastLocation).toMatch(/^\/paper-trading\?legs=[A-Za-z0-9_-]+$/);
    expect(JSON.parse(localStorage.getItem("mc_basket_v1") ?? "[]")).toEqual([]);
    expect(JSON.parse(localStorage.getItem("mc_basket_sent_v1") ?? "{}")).toMatchObject({ target: "paper", count: 1, symbols: ["NIFTY"] });
  });

  it("toggles the strike inspector and remembers the choice", () => {
    renderPage();
    expect(screen.queryByRole("complementary", { name: "Strike inspector" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Strike inspector" }));
    expect(screen.getByRole("complementary", { name: "Strike inspector" })).toBeInTheDocument();
    expect(localStorage.getItem("mc_chain_inspector_v1")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Close the strike inspector" }));
    expect(screen.queryByRole("complementary", { name: "Strike inspector" })).not.toBeInTheDocument();
  });

  it("uses the page header, without a duplicate sample banner", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Option Chain" })).toBeInTheDocument();
    expect(screen.queryByText("Sample data: not market prices")).not.toBeInTheDocument();
  });
});
