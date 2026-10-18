import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addCalendarDays, generateSampleChain, getExpiries, istDateString } from "@/lib/options";

const ctl = vi.hoisted(() => ({ source: "sample" as "sample" | "nse" }));

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not provide.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver ??= ResizeObserverStub;

const SPOT = 25000;
const expiries = getExpiries("NIFTY", new Date(), 4).map((e) => e.date).filter((d) => d > istDateString());
const multi = {
  symbol: "NIFTY",
  spot: SPOT,
  expiries: expiries.map((expiry, i) => ({ expiry, chain: generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry, atmIv: 0.12 + i * 0.01, seed: i + 1 }).chain })),
  isLive: false,
  source: "sample" as const,
  asOf: Date.now(),
  stale: true,
  reason: "Proxy offline",
};
// Stable objects per symbol and source, like React Query's structural sharing.
const multiCache = new Map<string, typeof multi>();
function multiFor(symbol: string) {
  const key = `${symbol}|${ctl.source}`;
  let m = multiCache.get(key);
  if (!m) {
    m = { ...multi, symbol, source: ctl.source as "sample", isLive: ctl.source !== "sample" };
    multiCache.set(key, m);
  }
  return m;
}
const nearExpiry = expiries[0] ?? addCalendarDays(istDateString(), 5);
const nearChain = {
  chain: multi.expiries[0]?.chain ?? [],
  spotPrice: SPOT,
  expiries: [],
  expiry: nearExpiry,
  lotSize: 65,
  stepSize: 50,
  maxPain: SPOT,
  totalCEOI: 0,
  totalPEOI: 0,
  isLive: false,
  afterHours: false,
  source: "sample" as const,
  cachedAt: null,
  asOf: Date.now(),
  stale: true,
  reason: "Proxy offline",
};

vi.mock("@/hooks/useMarketData", () => ({
  useChainMulti: (symbol: string) =>
    symbol
      ? { data: multiFor(symbol), isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }
      : { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() },
  useAllIndices: () => ({ data: { vix: null }, isLoading: false }),
  useLiveOptionChain: () => ({ data: nearChain, isLoading: false }),
}));

vi.mock("@/lib/volatility/api", () => ({
  fetchVixHistory: vi.fn(async () => ({ data: [], source: "cache", asOf: 0, stale: true, reason: "offline" })),
  loadDailyStats: vi.fn(async () => []),
  cachedBhavPoints: vi.fn(() => []),
  cachedBhavEntries: vi.fn(() => []),
  dailySnapshotAtm: vi.fn(async () => ({})),
  fetchDailyBars: vi.fn(async () => {
    throw new Error("offline");
  }),
  fetchBhavcopyChains: vi.fn(async () => null),
  cacheBhavIv: vi.fn(),
  backfillBhavcopyIv: vi.fn(async () => ({ done: 0, total: 0, added: 0, failed: 0 })),
  snapshotNear: vi.fn(async () => null),
  lastSnapshotBetween: vi.fn(async () => null),
  snapshotToChain: vi.fn(() => []),
  scanScreenerSymbol: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

import Volatility from "@/pages/Volatility";
import { ExpectedMoveWidget } from "@/components/ExpectedMoveWidget";
import { IVRankCard } from "@/components/IVRankWidget";

let lastSearch = "";
function Probe() {
  lastSearch = useLocation().search;
  return null;
}

function wrap(ui: React.ReactNode, url = "/volatility?symbol=NIFTY") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  {ui}
                  <Probe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Volatility page", () => {
  beforeEach(() => {
    ctl.source = "sample";
  });

  it("renders with a labelled sample fallback, defaults to the Smile tab and keeps the disclaimer", async () => {
    wrap(<Volatility />);
    expect(screen.getByRole("heading", { name: /volatility/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/sample chain/i);
    expect(screen.getByText(/Data for education and research\. Not investment advice\./)).toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Smile", selected: true })).toBeInTheDocument();
    expect(screen.getByText(/volatility smile/i)).toBeInTheDocument();
  });

  it("computes IV rank from the labelled one-year sample history on the Overview tab", async () => {
    wrap(<Volatility />, "/volatility?symbol=BANKNIFTY&tab=overview");
    expect(await screen.findByText(/1 year of labelled sample IV/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/one-year sample history/i);
    expect(screen.queryByText(/No history/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
  });

  it("switches symbol through the URL", () => {
    wrap(<Volatility />);
    fireEvent.click(screen.getByRole("button", { name: "BANKNIFTY" }));
    expect(lastSearch).toContain("symbol=BANKNIFTY");
  });

  it("opens the surface tab with a sample label and the skew overlay", () => {
    wrap(<Volatility />, "/volatility?symbol=NIFTY&tab=surface");
    expect(screen.getByRole("table", { name: /implied volatility by expiry and delta/i })).toHaveTextContent(/sample data/i);
    expect(screen.getByText("Sample surface")).toBeInTheDocument();
    expect(screen.getByText(/skew by expiry/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Moneyness" }));
    expect(screen.getByRole("table", { name: /implied volatility by expiry and moneyness/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "vs yesterday" }));
    expect(screen.getByText(/sample previous session/i)).toBeInTheDocument();
  });

  it("renders the expected move table with method tags and a sample hit rate", async () => {
    wrap(<Volatility />, "/volatility?symbol=NIFTY&tab=move");
    expect(screen.getByText(/expected move by expiry/i)).toBeInTheDocument();
    expect(screen.getByText("IV 1σ move")).toBeInTheDocument();
    expect(await screen.findByText(/labelled sample for illustration/)).toBeInTheDocument();
  });

  it("shows India VIX analytics on a labelled sample when VIX history is missing", async () => {
    wrap(<Volatility />, "/volatility?symbol=NIFTY&tab=vix");
    expect(await screen.findByText(/India VIX with percentile bands/)).toBeInTheDocument();
    expect(screen.getByText(/seeded one-year sample/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /NIFTY statistics by India VIX bucket/ })).toBeInTheDocument();
    expect(screen.getByText(/Weekly vs monthly ATM IV/)).toBeInTheDocument();
  });

  it("compares the four indices side by side and adds stocks through the URL", async () => {
    wrap(<Volatility />, "/volatility?symbol=NIFTY&tab=compare&cmp=RELIANCE");
    const table = screen.getByRole("table", { name: /volatility comparison/i });
    for (const s of ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "RELIANCE"]) expect(table).toHaveTextContent(s);
    expect(await screen.findAllByText("IV 1σ")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove RELIANCE" }));
    expect(lastSearch).not.toContain("cmp=");
    expect(screen.getByText(/BANKNIFTY − NIFTY IV spread/)).toBeInTheDocument();
  });

  it("does not invent history when the chain is live", async () => {
    ctl.source = "nse";
    wrap(<Volatility />, "/volatility?symbol=BANKNIFTY&tab=overview");
    expect((await screen.findAllByText(/No history \(0 days\)/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/1 year of labelled sample IV/)).not.toBeInTheDocument();
  });
});

describe("dashboard widgets", () => {
  beforeEach(() => {
    ctl.source = "sample";
  });

  it("ExpectedMoveWidget computes from the chain and labels sample data", () => {
    wrap(<ExpectedMoveWidget symbol="NIFTY" iv={99} spotPrice={1} daysToExpiry={1} />);
    expect(screen.getByText(/NIFTY expected move/i)).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getAllByText("IV 1σ").length).toBeGreaterThan(0);
  });

  it("IVRankCard leads with IVR, labels the IV and marks sample history", async () => {
    wrap(<IVRankCard symbol="BANKNIFTY" currentIV={42} />);
    expect(await screen.findByText(/^IV \d/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^IV rank \d+$/)).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
  });

  it("IVRankCard says No history for a live chain without history", async () => {
    ctl.source = "nse";
    wrap(<IVRankCard symbol="BANKNIFTY" currentIV={42} />);
    expect(await screen.findByText("No history")).toBeInTheDocument();
  });

  it("IVRankCard falls back to the chain IV for NIFTY when India VIX is missing, marked derived", async () => {
    ctl.source = "nse";
    wrap(<IVRankCard symbol="NIFTY" />);
    expect(await screen.findByText(/India VIX unavailable/)).toBeInTheDocument();
    expect(screen.getByText("Derived")).toBeInTheDocument();
  });
});

describe("Volatility page with an unknown symbol", () => {
  it("shows NIFTY with a notice instead of a sample chain for the made-up symbol", async () => {
    wrap(<Volatility />, "/volatility?symbol=XYZ");
    expect(await screen.findByText(/“XYZ” is not an F&O underlying, so this page is showing NIFTY/)).toBeInTheDocument();
    expect(screen.queryByText(/^XYZ /)).toBeNull();
  });
});
