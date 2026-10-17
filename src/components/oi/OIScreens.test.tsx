import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addTradingDays, generateSampleChain, istDateString } from "@/lib/options";
import { buildSnapshot } from "@/lib/snapshotStore";
import type { OptionChainHookData } from "@/hooks/useMarketData";

const SPOT = 25012.4;
const EXP1 = addTradingDays(istDateString(), 3);
const EXP2 = addTradingDays(istDateString(), 8);
const c1 = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP1, seed: 5, strikes: 41 }).chain;
const c2 = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP2, seed: 9, strikes: 41 }).chain;
const t0 = Date.now() - 10 * 60_000;
const snaps = [buildSnapshot("NIFTY", EXP1, SPOT - 20, c1, t0), buildSnapshot("NIFTY", EXP1, SPOT, c1.map((r) => ({ ...r, ce: { ...r.ce, oi: r.ce.oi + 1000 } })), t0 + 60_000)];

const hookData: OptionChainHookData = {
  chain: c1,
  spotPrice: SPOT,
  expiries: [
    { label: EXP1, value: EXP1, daysToExpiry: 3 },
    { label: EXP2, value: EXP2, daysToExpiry: 8 },
  ],
  expiry: EXP1,
  lotSize: 65,
  stepSize: 50,
  maxPain: 25000,
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

vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: () => ({ data: hookData, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }),
  useExpiryList: () => ({ data: { expiries: hookData.expiries, isLive: false } }),
  useChainMulti: () => ({
    data: { symbol: "NIFTY", spot: SPOT, expiries: [{ expiry: EXP1, chain: c1 }, { expiry: EXP2, chain: c2 }], isLive: false, source: "sample", asOf: Date.now(), stale: true },
    isLoading: false,
    refetch: vi.fn(),
  }),
  buildSampleChainData: vi.fn(),
  isLiveSession: () => false,
}));

vi.mock("@/hooks/useSnapshotRecorder", () => ({
  useSnapshotRecorder: () => ({ recording: false, count: 0 }),
  useSnapshots: () => ({ data: snaps, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/components/IVPercentileGauge", () => ({ IVPercentileGauge: () => <div>IV panel</div> }));

vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: ReactNode }) => <div style={{ width: 800, height: 300 }}>{children}</div> };
});

// Radix Slider measures its thumbs; jsdom has no ResizeObserver.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import MaxPainPCR from "@/pages/MaxPainPCR";
import OIAnalysis from "@/pages/OIAnalysis";

function renderAt(ui: ReactElement, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Max Pain & PCR page", () => {
  it("renders the curve, table, PCR suite and the education note with sample labels", () => {
    renderAt(<MaxPainPCR />, "/max-pain-pcr?symbol=NIFTY");
    expect(screen.getByRole("heading", { name: /Max Pain & PCR/ })).toBeInTheDocument();
    expect(screen.getByText("Max pain payout curve")).toBeInTheDocument();
    expect(screen.getByText("Max pain across expiries")).toBeInTheDocument();
    expect(screen.getByText("Put-call ratio suite")).toBeInTheDocument();
    expect(screen.getAllByText(/Sample data/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
    expect(screen.getAllByRole("radio").length).toBeGreaterThanOrEqual(2);
  });
});

describe("OI Analysis page", () => {
  it("highlights a deep-linked strike and offers real shortcuts", () => {
    const strike = c1[20].strikePrice;
    renderAt(<OIAnalysis />, `/oi-analysis?symbol=NIFTY&strike=${strike}`);
    expect(screen.getByText(new RegExp(`Strike ${strike.toLocaleString("en-IN")} highlighted`))).toBeInTheDocument();
    expect(screen.getByText(/ATM zone/)).toBeInTheDocument();
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
  });

  it("shows the buildup quadrant from a tab deep link", () => {
    renderAt(<OIAnalysis />, "/oi-analysis?symbol=NIFTY&tab=quadrant");
    expect(screen.getByText("Buildup quadrant")).toBeInTheDocument();
    expect(screen.getByText(/Long build-up ·/)).toBeInTheDocument();
  });

  it("replays recorded snapshots", () => {
    renderAt(<OIAnalysis />, "/oi-analysis?symbol=NIFTY&tab=replay");
    expect(screen.getByText("Intraday OI replay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play replay/ })).toBeInTheDocument();
  });
});
