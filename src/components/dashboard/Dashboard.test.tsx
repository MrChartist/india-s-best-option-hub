import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const mode = vi.hoisted(() => ({ offline: false, pcr: 0.95 }));
const now = Date.now();
const chainRows = [
  { strikePrice: 25000, ce: { ltp: 180, oi: 50_000, oiChange: 1_000, volume: 1, iv: 13, delta: 0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 }, pe: { ltp: 80, oi: 90_000, oiChange: 2_000, volume: 1, iv: 13, delta: -0.5, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 } },
  { strikePrice: 25200, ce: { ltp: 70, oi: 120_000, oiChange: 3_000, volume: 1, iv: 13, delta: 0.3, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 }, pe: { ltp: 170, oi: 30_000, oiChange: 500, volume: 1, iv: 13, delta: -0.7, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 } },
];
const indices = [
  { name: "NIFTY 50", symbol: "NIFTY", ltp: 25100.5, change: 120.25, changePercent: 0.48, open: 25000, high: 25150, low: 24950, prevClose: 24980.25 },
  { name: "NIFTY BANK", symbol: "BANKNIFTY", ltp: 56000, change: -200, changePercent: -0.36, open: 56200, high: 56300, low: 55900, prevClose: 56200 },
];
const stocks = [
  { symbol: "RELIANCE", ltp: 1400, change: 10, changePercent: 0.72, open: 1390, high: 1405, low: 1388, previousClose: 1390, volume: 23_000_000, openInterest: 120_000_000, oiChange: 1_500_000, sector: "Energy" },
  { symbol: "INFY", ltp: 1500, change: -15, changePercent: -0.99, open: 1515, high: 1520, low: 1495, previousClose: 1515, volume: 5_000_000, openInterest: 40_000_000, oiChange: -200_000, sector: "IT" },
];

vi.mock("@/hooks/useMarketData", () => ({
  useLiveIndices: () =>
    mode.offline
      ? { data: { data: [], isLive: false, source: "none", asOf: now, stale: true, reason: "Proxy offline" }, isLoading: false, source: "none", asOf: now, stale: true }
      : { data: { data: indices, isLive: true, source: "nse", asOf: now, stale: false }, isLoading: false, source: "nse", asOf: now, stale: false },
  useMarketStatus: () => ({ data: mode.offline ? undefined : { giftNifty: { lastPrice: 25180, change: 40, changePercent: 0.16 }, indicativeNifty: { value: 25100 } } }),
  useAllIndices: () =>
    mode.offline
      ? { data: { vix: null, sectors: [], advances: 0, declines: 0, unchanged: 0, isLive: false, source: "none", asOf: now, stale: true, reason: "Proxy offline" }, isLoading: false, source: "none", asOf: now, stale: true }
      : { data: { vix: { value: 13.2, change: -0.2, changePercent: -1.5, high: 13.6, low: 12.9 }, sectors: [{ name: "IT", fullName: "NIFTY IT", change: -0.8, ltp: 1 }, { name: "Bank", fullName: "NIFTY BANK", change: 0.4, ltp: 1 }], advances: 30, declines: 20, unchanged: 0, isLive: true, source: "nse", asOf: now, stale: false }, isLoading: false, source: "nse", asOf: now, stale: false },
  useFnOStocks: () => ({
    data: mode.offline
      ? { gainers: [], losers: [], mostActive: [], allStocks: [], isLive: false, source: "none", asOf: now, stale: true, reason: "Proxy offline" }
      : { gainers: [stocks[0]], losers: [stocks[1]], mostActive: stocks.map((s) => ({ ...s, oi: s.openInterest, oiInterpretation: s.changePercent > 0 ? "Long Buildup" : "Short Buildup" })), allStocks: stocks, isLive: true, source: "nse", asOf: now, stale: false },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useLiveOptionChain: (symbol: string) =>
    symbol === "NIFTY"
      ? {
          data: { chain: chainRows, spotPrice: 25100, expiries: [], expiry: "2026-10-27", lotSize: 65, stepSize: 200, maxPain: 25000, totalCEOI: 100_000, totalPEOI: 100_000 * mode.pcr, isLive: !mode.offline, afterHours: false, source: mode.offline ? "sample" : "nse", cachedAt: null, asOf: now, stale: mode.offline },
          isLoading: false,
          isError: false,
        }
      : { data: undefined, isLoading: false, isError: true },
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
vi.mock("@/components/participants/useParticipants", () => ({ useParticipantsDashboard: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@/components/volatility/useVolatility", () => ({
  useIvRank: (symbol: string) => ({
    basis: "vix",
    basisLabel: "India VIX",
    current: 13.2,
    currentLabel: "India VIX",
    stats: { ivRank: symbol === "NIFTY" ? 34 : null, ivPercentile: 40, low: 10, high: 22, n: symbol === "NIFTY" ? 250 : 4, insufficient: symbol !== "NIFTY" },
    history: [],
    currentIsSample: false,
    currentIsDerived: false,
    historyIsSample: false,
    sampleBars: null,
    isLoading: false,
    historySummary: "",
  }),
}));
vi.mock("@/components/gex/GammaLevelsCard", () => ({ default: () => <div>Gamma card</div> }));
vi.mock("@/components/flow/PremiumTideCard", () => ({ default: () => <div>Tide card</div> }));
vi.mock("@/components/participants/FiiLongCard", () => ({
  default: () => {
    throw new Error("boom");
  },
}));
vi.mock("@/components/IVRankWidget", () => ({ IVRankDashboard: () => <div>IVR scanner</div> }));
vi.mock("@/components/ExpectedMoveWidget", () => ({ ExpectedMoveWidget: ({ symbol }: { symbol: string }) => <div>EM {symbol}</div> }));
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div style={{ width: 600, height: 200 }}>{children}</div> };
});

import Index from "@/pages/Index";
import Watchlist from "@/pages/Watchlist";
import { DASH_LAYOUT_KEY, SECTION_IDS } from "./dashboardModel";
import { WATCHLIST_KEY } from "./watchlistModel";
import { TOUR_KEY } from "./onboarding";
import { WORKSPACES_KEY } from "./workspaces";

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
  localStorage.setItem(TOUR_KEY, JSON.stringify({ step: 0, done: true }));
  mode.offline = false;
  mode.pcr = 0.95;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Dashboard page", () => {
  it("renders sections without leaked prompt text and isolates a crashing widget", () => {
    shell(<Index />);
    expect(screen.getByRole("heading", { name: "Market dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Indices" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^NIFTY 50\s*:\s*open option chain$/ })).toHaveAttribute("href", "/option-chain?symbol=NIFTY");
    expect(screen.getAllByText("25,100.50").length).toBeGreaterThan(0);
    expect(screen.getByText("Gamma card")).toBeInTheDocument();
    expect(screen.getByText(/FII index futures long % could not be shown/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/'{3}|Do not make any visual\s+modifications/);
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
  });

  it("adopts a layout saved by the previous release, placing the new brief after indices", () => {
    const old = ["breadth", ...SECTION_IDS.filter((id) => id !== "breadth" && id !== "brief")];
    localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify({ order: old, hidden: ["indices"], density: "compact" }));
    shell(<Index />);
    expect(screen.queryByRole("heading", { name: "Indices" })).not.toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(["Market breadth", "Daily market brief"]);
    expect(document.querySelector("[data-density]")).toHaveAttribute("data-density", "compact");
    fireEvent.click(screen.getByRole("button", { name: /Customise dashboard/ }));
    expect(screen.getByRole("radio", { name: "compact" })).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem(WORKSPACES_KEY) as string).workspaces).toHaveLength(1);
  });

  it("applies a preset and saves a second named workspace", () => {
    shell(<Index />);
    fireEvent.click(screen.getByRole("button", { name: /Customise dashboard/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Expiry/ }));
    expect(screen.getByRole("button", { name: /^Expiry/ })).toHaveAttribute("aria-pressed", "true");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe("Expiries");
    expect(headings).not.toContain("Top movers");
    fireEvent.click(screen.getByRole("button", { name: "Save as a new workspace" }));
    fireEvent.change(screen.getByLabelText("New workspace name"), { target: { value: "Tuesday" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = JSON.parse(localStorage.getItem(WORKSPACES_KEY) as string);
    expect(saved.workspaces.map((w: { name: string }) => w.name)).toEqual(["My dashboard", "Tuesday"]);
    expect(screen.getByRole("combobox", { name: "Workspace" })).toHaveValue(saved.activeId);
  });

  it("bands PCR neutrally between 0.7 and 1.2 with a Balanced chip and shows the daily brief", () => {
    shell(<Index />);
    const brief = screen.getByRole("list", { name: "Daily market brief" });
    expect(within(brief).getByRole("link", { name: /NIFTY PCR \(OI\)/ })).toHaveAttribute("href", "/max-pain-pcr?symbol=NIFTY");
    expect(within(brief).getByRole("link", { name: /OI walls/ })).toHaveTextContent("25,000 – 25,200");
    const pcrLink = screen.getByRole("link", { name: /NIFTY PCR \(OI\): 0\.95/ });
    const tile = pcrLink.closest(".relative") as HTMLElement;
    expect(within(tile).getByText("Balanced")).toBeInTheDocument();
    expect(within(tile).getByText("0.95")).toHaveClass("text-foreground");
    expect(within(tile).queryByText("▲")).not.toBeInTheDocument();
    expect(within(tile).getByRole("button", { name: /What is/ })).toBeInTheDocument();
  });

  it("merges the IV rank mini cards into one card with a row per index", () => {
    shell(<Index />);
    const card = screen.getByRole("heading", { name: /IV rank/, level: 3 }).closest("div.flex-col") as HTMLElement;
    expect(within(card).getByRole("link", { name: "NIFTY" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "BANKNIFTY" })).toBeInTheDocument();
    expect(within(card).getByText(/No history yet: 4 of 20 days/)).toBeInTheDocument();
  });

  it("never renders empty without the proxy: sample indices, movers and breadth plus one needs-live strip", () => {
    mode.offline = true;
    shell(<Index />);
    expect(screen.getByRole("link", { name: /^NIFTY 50\s*:\s*open option chain$/ })).toBeInTheDocument();
    expect(screen.getAllByText("24,250.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(2);
    expect(screen.getByRole("heading", { name: "Top gainers" })).toBeInTheDocument();
    expect(screen.queryByText("No gainers right now")).not.toBeInTheDocument();
    const strip = screen.getByRole("complementary", { name: "Needs live data" });
    expect(within(strip).getByText("GIFT Nifty")).toBeInTheDocument();
    expect(within(strip).getByText("PCR vs previous close")).toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: /Start proxy/ })).toBeInTheDocument();
    // The strip comes after every populated section.
    const sections = Array.from(document.querySelectorAll("section[aria-labelledby^='dash-']"));
    expect(sections.length).toBeGreaterThan(5);
    expect(sections[sections.length - 1].compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows a five-step tour until it is finished or skipped", () => {
    localStorage.removeItem(TOUR_KEY);
    const { unmount } = shell(<Index />);
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show me around" }));
    expect(screen.getByRole("heading", { name: "Start with the option chain" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Open option chain" })).toHaveAttribute("href", "/option-chain?symbol=NIFTY");
    fireEvent.click(screen.getByRole("button", { name: "Skip the tour" }));
    expect(screen.queryByText(/Step 2 of 5/)).not.toBeInTheDocument();
    unmount();
    shell(<Index />);
    expect(screen.queryByText(/Getting started/)).not.toBeInTheDocument();
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

  it("shows labelled sample quotes when the proxy is offline", () => {
    mode.offline = true;
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ version: 1, activeId: "main", lists: [{ id: "main", name: "Mine", symbols: ["NIFTY", "RELIANCE"] }] }));
    shell(<Watchlist />);
    expect(screen.getByRole("heading", { level: 1, name: /Watchlist/ })).toBeInTheDocument();
    expect(screen.getByText(/these are sample prices, changes, ranges and OI/)).toBeInTheDocument();
    const region = screen.getByRole("region", { name: /Watchlist “Mine” table/ });
    const table = within(region).getByRole("table");
    expect(within(table).getByText("24,250.00")).toBeInTheDocument();
    expect(within(table).queryByText("No quote")).not.toBeInTheDocument();
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
  });

  it("creates a second named list", () => {
    shell(<Watchlist />);
    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    fireEvent.change(screen.getByLabelText("List name"), { target: { value: "Banks" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("tab", { name: /Banks/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText(/This watchlist is empty/).length).toBeGreaterThan(0);
  });

  it("reloads when another tab saves, so its next edit does not overwrite that tab's work", () => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify({ version: 1, activeId: "main", lists: [{ id: "main", name: "Mine", symbols: ["INFY"] }] }));
    shell(<Watchlist />);
    // Tab A adds RELIANCE and saves.
    const fromA = JSON.stringify({ version: 1, activeId: "main", lists: [{ id: "main", name: "Mine", symbols: ["INFY", "RELIANCE"] }] });
    localStorage.setItem(WATCHLIST_KEY, fromA);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: WATCHLIST_KEY, newValue: fromA }));
    });
    // This tab (B) then adds TCS.
    fireEvent.change(screen.getByLabelText("Add symbol"), { target: { value: "TCS" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY) as string).lists[0].symbols;
    expect(saved).toEqual(expect.arrayContaining(["INFY", "RELIANCE", "TCS"]));
  });

  it("does not write the list back just by opening the page", () => {
    const raw = JSON.stringify({ version: 1, activeId: "main", lists: [{ id: "main", name: "Mine", symbols: ["INFY"] }] });
    localStorage.setItem(WATCHLIST_KEY, raw);
    const spy = vi.spyOn(Storage.prototype, "setItem");
    shell(<Watchlist />);
    expect(spy.mock.calls.filter((c) => c[0] === WATCHLIST_KEY)).toHaveLength(0);
    spy.mockRestore();
  });
});
