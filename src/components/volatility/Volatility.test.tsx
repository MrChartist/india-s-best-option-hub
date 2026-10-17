import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addCalendarDays, generateSampleChain, getExpiries, istDateString } from "@/lib/options";

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
  useChainMulti: (symbol: string) => (symbol ? { data: multi, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() } : { data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useAllIndices: () => ({ data: { vix: null }, isLoading: false }),
  useLiveOptionChain: () => ({ data: nearChain, isLoading: false }),
}));

vi.mock("@/lib/volatility/api", () => ({
  fetchVixHistory: vi.fn(async () => ({ data: [], source: "cache", asOf: 0, stale: true, reason: "offline" })),
  loadDailyStats: vi.fn(async () => []),
  cachedBhavPoints: vi.fn(() => []),
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
  it("renders with a labelled sample fallback and the disclaimer", async () => {
    wrap(<Volatility />);
    expect(screen.getByRole("heading", { name: /volatility/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/sample chain/i);
    expect(screen.getByText(/Data for education and research\. Not investment advice\./)).toBeInTheDocument();
    expect((await screen.findAllByText(/Insufficient history \(0 days\)/)).length).toBeGreaterThan(0);
  });

  it("switches symbol through the URL", () => {
    wrap(<Volatility />);
    fireEvent.click(screen.getByRole("button", { name: "BANKNIFTY" }));
    expect(lastSearch).toContain("symbol=BANKNIFTY");
  });

  it("opens the surface and expected-move tabs from ?tab=", () => {
    wrap(<Volatility />, "/volatility?symbol=NIFTY&tab=surface");
    expect(screen.getByRole("table", { name: /implied volatility by expiry and delta/i })).toBeInTheDocument();
  });

  it("renders the expected move table", () => {
    wrap(<Volatility />, "/volatility?symbol=NIFTY&tab=move");
    expect(screen.getByText(/expected move by expiry/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Insufficient \(0\)/).length).toBeGreaterThan(0);
  });
});

describe("dashboard widgets", () => {
  it("ExpectedMoveWidget computes from the chain and labels sample data", () => {
    wrap(<ExpectedMoveWidget symbol="NIFTY" iv={99} spotPrice={1} daysToExpiry={1} />);
    expect(screen.getByText(/NIFTY expected move/i)).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.getByText("IV move")).toBeInTheDocument();
  });

  it("IVRankCard shows insufficient history instead of a fake rank", async () => {
    wrap(<IVRankCard symbol="BANKNIFTY" currentIV={42} />);
    expect(await screen.findByText(/Insufficient history \(0d\)/)).toBeInTheDocument();
  });
});
