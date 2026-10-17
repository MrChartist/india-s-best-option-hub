import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FnOStockData } from "@/lib/marketApi";
import Screener from "@/pages/Screener";

const state: { stocks: FnOStockData[]; envelopes: Record<string, unknown> } = { stocks: [], envelopes: {} };

vi.mock("@/hooks/useMarketData", () => ({
  isLiveSession: () => false,
  useFnOStocks: () => ({
    data: state.stocks.length
      ? { allStocks: state.stocks, source: "nse", isLive: true, asOf: Date.now(), stale: false, reason: undefined }
      : { allStocks: [], source: "none", isLive: false, asOf: Date.now(), stale: true, reason: "offline" },
    isLoading: false,
  }),
  useLiveIndices: () => ({ data: { data: [] }, isLoading: false }),
}));

vi.mock("@/lib/api/proxyClient", () => ({
  proxyGet: vi.fn(async (path: string) => {
    const data = state.envelopes[path];
    return data === undefined
      ? { data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "offline" } }
      : { data, meta: { source: "nse", asOf: Date.now(), stale: false } };
  }),
  // Daily candles for the per-stock scan (useScreener runHistory).
  proxyFetchJSON: vi.fn(async () => {
    throw new Error("Proxy unreachable");
  }),
}));

vi.mock("@/lib/marketApi", () => ({
  fetchChainMulti: vi.fn(async () => ({ data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "offline" } })),
}));

vi.mock("@/lib/snapshotStore", () => ({
  getDailyStats: vi.fn(async () => []),
  putDailyStat: vi.fn(async () => undefined),
  computeDailyStat: vi.fn(),
}));

function renderPage(url = "/screener") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Screener />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const stock = (symbol: string, changePercent: number, volume: number): FnOStockData => ({
  symbol, ltp: 1000, change: 10, changePercent, open: 990, high: 1010, low: 980, previousClose: 990, volume, totalTradedVolume: volume, sector: "",
});

describe("Screener page", () => {
  beforeEach(() => {
    state.stocks = [];
    state.envelopes = {};
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it("labels sample data when the live list is unavailable", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: /F&O Screener/ })).toBeInTheDocument();
    expect(screen.getByText(/Every number below is sample data/)).toBeInTheDocument();
    expect(screen.getAllByText(/Sample data/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("sorts columns with aria-sort", () => {
    renderPage();
    const header = screen.getByRole("columnheader", { name: /Symbol/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("applies a preset from the URL", () => {
    renderPage("/screener?preset=near-ban");
    const btn = screen.getByRole("button", { name: /Near ban ≥80% MWPL/ });
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("uses live rows, OI spurts and the ban list when available", async () => {
    state.stocks = [stock("RELIANCE", 1.5, 1e6), stock("ZOMATO", -2, 5e5), stock("SAIL", 0.5, 2e5)];
    state.envelopes = {
      "/api/x/oi-spurts": [
        { symbol: "RELIANCE", chgOiPct: 12, latestOi: 1, prevOi: 1, chgOi: 0, volume: 0 },
        { symbol: "ETERNAL", chgOiPct: 4, latestOi: 1, prevOi: 1, chgOi: 0, volume: 0 },
      ],
      "/api/x/ban-list": { date: "2026-10-17", symbols: ["SAIL"] },
      "/api/x/mwpl": [{ symbol: "SAIL", mwplPct: 97 }, { symbol: "RELIANCE", mwplPct: 88 }],
    };
    renderPage();
    expect(screen.queryByText(/Every number below is sample data/)).not.toBeInTheDocument();
    expect(await screen.findByText("ETERNAL")).toBeInTheDocument();
    expect(await screen.findByText(/Near-ban alert/)).toBeInTheDocument();
    expect(await screen.findAllByText("Long BU")).not.toHaveLength(0);
    expect(screen.getAllByText("Short BU").length).toBeGreaterThan(0);
  });
});
