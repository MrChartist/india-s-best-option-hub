import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const now = Date.now();
const indices = [
  { name: "NIFTY 50", symbol: "NIFTY", ltp: 25100.5, change: 120.25, changePercent: 0.48, open: 25000, high: 25150, low: 24950, prevClose: 24980.25 },
  { name: "NIFTY BANK", symbol: "BANKNIFTY", ltp: 56000, change: -200, changePercent: -0.36, open: 56200, high: 56300, low: 55900, prevClose: 56200 },
];
const stocks = [
  { symbol: "RELIANCE", ltp: 1400, change: 10, changePercent: 0.72, open: 1390, high: 1405, low: 1388, previousClose: 1390, volume: 23_000_000, openInterest: 120_000_000, oiChange: 1_500_000, sector: "Energy" },
  { symbol: "INFY", ltp: 1500, change: -15, changePercent: -0.99, open: 1515, high: 1520, low: 1495, previousClose: 1515, volume: 5_000_000, openInterest: 40_000_000, oiChange: -200_000, sector: "IT" },
];

vi.mock("@/hooks/useMarketData", () => ({
  useLiveIndices: () => ({ data: { data: indices, isLive: true, source: "nse", asOf: now, stale: false }, isLoading: false, source: "nse", asOf: now, stale: false }),
  useMarketStatus: () => ({ data: { giftNifty: { lastPrice: 25180, change: 40, changePercent: 0.16 }, indicativeNifty: { value: 25100 } } }),
  useAllIndices: () => ({ data: { vix: { value: 13.2, change: -0.2, changePercent: -1.5, high: 13.6, low: 12.9 }, sectors: [{ name: "IT", fullName: "NIFTY IT", change: -0.8, ltp: 1 }, { name: "Bank", fullName: "NIFTY BANK", change: 0.4, ltp: 1 }], advances: 30, declines: 20, unchanged: 0, isLive: true, source: "nse", asOf: now, stale: false }, isLoading: false, source: "nse", asOf: now, stale: false }),
  useFnOStocks: () => ({
    data: { gainers: [stocks[0]], losers: [stocks[1]], mostActive: stocks.map((s) => ({ ...s, oi: s.openInterest, oiInterpretation: s.changePercent > 0 ? "Long Buildup" : "Short Buildup" })), allStocks: stocks, isLive: true, source: "nse", asOf: now, stale: false },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useLiveOptionChain: () => ({ data: undefined, isLoading: false, isError: true }),
  useExpiryList: () => ({ data: { expiries: [], isLive: false } }),
  useStoredCandles: () => ({ data: null, isFetched: true, isLoading: false }),
  useProxyHealth: () => ({ data: { reachable: true, sources: { dhan: false } } }),
}));
vi.mock("@/hooks/useWebSocket", () => ({ useWebSocketStatus: () => false, useWebSocketVix: () => ({ vix: null, isConnected: false }) }));
vi.mock("@/hooks/useChartData", () => ({
  useChartData: () => ({ data: undefined, isLoading: false }),
  useSparklineData: () => ({ data: [1, 2, 3, 2, 4], isLoading: false }),
}));
vi.mock("@/hooks/useSnapshotRecorder", () => ({ useSnapshotRecorder: () => ({ recording: false, count: 0 }) }));
vi.mock("@/lib/screener/banList", () => ({ useBanList: () => ({ banned: ["INFY"], nearBan: [{ symbol: "RELIANCE", mwplPct: 86 }], isLoading: false, source: "nse" }) }));
vi.mock("@/lib/snapshotStore", () => ({ getDailyStats: async () => [] }));
vi.mock("@/components/gex/GammaLevelsCard", () => ({ default: () => <div>Gamma card</div> }));
vi.mock("@/components/flow/PremiumTideCard", () => ({ default: () => <div>Tide card</div> }));
vi.mock("@/components/participants/FiiLongCard", () => ({
  default: () => {
    throw new Error("boom");
  },
}));
vi.mock("@/components/IVRankWidget", () => ({ IVRankCard: ({ symbol }: { symbol: string }) => <div>IVR {symbol}</div>, IVRankDashboard: () => <div>IVR scanner</div> }));
vi.mock("@/components/ExpectedMoveWidget", () => ({ ExpectedMoveWidget: ({ symbol }: { symbol: string }) => <div>EM {symbol}</div> }));
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div style={{ width: 600, height: 200 }}>{children}</div> };
});

import Index from "@/pages/Index";
import Watchlist from "@/pages/Watchlist";
import { DASH_LAYOUT_KEY } from "./dashboardModel";
import { WATCHLIST_KEY } from "./watchlistModel";

function shell(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Dashboard page", () => {
  it("renders sections without leaked prompt text and isolates a crashing widget", () => {
    shell(<Index />);
    expect(screen.getByRole("heading", { name: "Market dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Indices" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /NIFTY 50: 25,100.50/ })).toHaveAttribute("href", "/option-chain?symbol=NIFTY");
    expect(screen.getByText("Gamma card")).toBeInTheDocument();
    expect(screen.getByText(/FII index futures long % could not be shown/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/'{3}|Do not make any visual\s+modifications/);
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
  });

  it("respects a saved layout with hidden sections and compact density", () => {
    localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify({ order: ["breadth"], hidden: ["indices"], density: "compact" }));
    shell(<Index />);
    expect(screen.queryByRole("heading", { name: "Indices" })).not.toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Market breadth");
    expect(screen.getByRole("radio", { name: "compact" })).toHaveAttribute("aria-checked", "true");
  });

  it("dismisses the context line and remembers it", () => {
    const { unmount } = shell(<Index />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss market context line" }));
    expect(screen.queryByRole("region", { name: "Market context" })).not.toBeInTheDocument();
    unmount();
    shell(<Index />);
    expect(screen.queryByRole("region", { name: "Market context" })).not.toBeInTheDocument();
  });
});

describe("Watchlist page", () => {
  it("validates symbols and offers suggestions", () => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ version: 1, activeId: "main", lists: [{ id: "main", name: "Mine", symbols: ["RELIANCE", "INFY"] }] }));
    shell(<Watchlist />);
    const input = screen.getByLabelText("Add symbol");
    fireEvent.change(input, { target: { value: "HDFCBNK" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByText(/not an NSE F&O underlying/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "HDFCBANK" }));
    expect(screen.getByText("Added HDFCBANK.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(WATCHLIST_KEY) as string).lists[0].symbols).toContain("HDFCBANK");
  });

  it("shows ban badges, sorts with aria-sort and formats volume in Indian units", () => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ version: 1, activeId: "main", lists: [{ id: "main", name: "Mine", symbols: ["INFY", "RELIANCE"] }] }));
    shell(<Watchlist />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Ban")).toBeInTheDocument();
    expect(within(table).getByText(/Near ban 86%/)).toBeInTheDocument();
    expect(within(table).getByText("2.3 Cr")).toBeInTheDocument();
    const th = within(table).getByRole("columnheader", { name: /Chg %/ });
    expect(th).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(th).getByRole("button"));
    expect(th).toHaveAttribute("aria-sort", "descending");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("rowheader").textContent).toMatch(/RELIANCE/);
  });

  it("creates a second named list", () => {
    shell(<Watchlist />);
    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Banks" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("tab", { name: /Banks/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(/This watchlist is empty/).length).toBeGreaterThan(0);
  });
});
