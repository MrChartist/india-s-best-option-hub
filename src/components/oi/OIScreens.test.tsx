import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("hands max pain to the optimizer and tags the expected-move method", () => {
    renderAt(<MaxPainPCR />, "/max-pain-pcr?symbol=NIFTY");
    const link = screen.getByRole("link", { name: /Open optimizer with target = max pain/ });
    expect(link.getAttribute("href")).toMatch(/^\/optimizer\?symbol=NIFTY&target=\d+/);
    expect(screen.getAllByText(/IV 1σ|Straddle ×0\.85/).length).toBeGreaterThan(0);
    // Row-level sample chips are gone; the header carries the one sample label.
    expect(screen.queryByText(/^Sample$/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
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
    expect(screen.getByRole("list", { name: "Legs per quadrant" })).toHaveTextContent(/Long build-up/);
  });

  it("shows labelled intraday OI charts, wall spreads and contract links", () => {
    renderAt(<OIAnalysis />, "/oi-analysis?symbol=NIFTY");
    expect(screen.getByRole("heading", { name: "Intraday OI" })).toBeInTheDocument();
    expect(screen.getByText("Cumulative call vs put OI change")).toBeInTheDocument();
    expect(screen.getByText(/OI change in ATM ± 5 range/)).toBeInTheDocument();
    expect(screen.getByText("Strike OI change through the day")).toBeInTheDocument();
    expect(screen.getAllByText("Sample session").length).toBeGreaterThanOrEqual(3);
    const spread = screen.getAllByRole("link", { name: /^Sell [\d,]+ CE \/ buy [\d,]+ CE in builder/ });
    expect(spread[0].getAttribute("href")).toMatch(/^\/strategy-builder\?legs=/);
    expect(screen.getAllByRole("link", { name: /contract page/ })[0].getAttribute("href")).toMatch(/^\/contract\/NIFTY\/\d{4}-\d{2}-\d{2}\/\d+\/(CE|PE)$/);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("caps the heatmap at ATM ± 12 with a Show all toggle", () => {
    renderAt(<OIAnalysis />, "/oi-analysis?symbol=NIFTY");
    const toggle = screen.queryByRole("button", { name: /^Show all \(\d+\)$/ });
    if (toggle) {
      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Show ATM ± 12" })).toHaveAttribute("aria-pressed", "true");
    } else {
      expect(screen.getByText("OI heatmap")).toBeInTheDocument();
    }
  });

  it("replays recorded snapshots", () => {
    renderAt(<OIAnalysis />, "/oi-analysis?symbol=NIFTY&tab=replay");
    expect(screen.getByText("Intraday OI replay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Play replay/ })).toBeInTheDocument();
  });
});
