import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { addTradingDays, generateSampleChain, istDateString } from "@/lib/options";
import type { OptionChainHookData } from "@/hooks/useMarketData";
import { buildHeatmapModel, heatAlpha } from "./heatmapModel";

const SPOT = 25012.4;
const EXP1 = addTradingDays(istDateString(), 3);
const EXP2 = addTradingDays(istDateString(), 8);
const c1 = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP1, seed: 5, strikes: 41 }).chain;
const c2 = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP2, seed: 9, strikes: 51 }).chain;

const hookData: OptionChainHookData = {
  chain: c1,
  spotPrice: SPOT,
  expiries: [{ label: EXP1, value: EXP1, daysToExpiry: 3 }],
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
  useChainMulti: () => ({
    data: { symbol: "NIFTY", spot: SPOT, expiries: [{ expiry: EXP1, chain: c1 }, { expiry: EXP2, chain: c2 }], isLive: false, source: "sample", asOf: Date.now(), stale: true },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useAllIndices: () => ({ data: { vix: { value: 13.4, change: 0.6, changePercent: 4.7, high: 13.6, low: 12.8 } } }),
}));

// Recharts needs a measured container; jsdom has none.
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 800, height: 300 }}>{children}</div> };
});

import GammaExposure from "@/pages/GammaExposure";
import GammaLevelsCard from "./GammaLevelsCard";

function renderWithShell(ui: React.ReactElement, path = "/gex") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );
}

describe("heatmap model", () => {
  it("merges expiries, windows strikes and marks walls", () => {
    const m = buildHeatmapModel(
      [{ expiry: EXP1, chain: c1, lotSize: 65 }, { expiry: EXP2, chain: c2, lotSize: 65 }],
      SPOT,
      "gex",
      { convention: "sellerShortBoth", oiUnit: "contracts", window: 10 },
    );
    expect(m.expiries).toEqual([EXP1, EXP2]);
    expect(m.strikes).toHaveLength(21);
    expect(m.values[0]).toHaveLength(2);
    expect(m.maxAbs).toBeGreaterThan(0);
    expect(m.markers[0].callWall).toBeGreaterThanOrEqual(SPOT - 50);
    expect(m.markers[0].putWall).toBeLessThanOrEqual(SPOT + 50);
    expect(heatAlpha(m.maxAbs, m.maxAbs)).toBeCloseTo(0.6);
    expect(heatAlpha(NaN, 1)).toBe(0);
  });
});

describe("GammaExposure page", () => {
  it("renders levels, sample badge, convention toggle and disclaimer", () => {
    renderWithShell(<GammaExposure />);
    expect(screen.getByRole("heading", { level: 1, name: /gamma exposure/i })).toBeInTheDocument();
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Call wall").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Max pain").length).toBeGreaterThan(0);
    // India default: seller view, so the flip shown is labelled as the dealer model.
    expect(screen.getAllByText(/Flip \(dealer model\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Not investment advice/).length).toBeGreaterThan(0);
    expect(screen.getByText(/India VIX/i)).toBeInTheDocument();
  });

  it("switches to the dealer model and to all expiries", () => {
    renderWithShell(<GammaExposure />);
    fireEvent.click(screen.getByRole("radio", { name: "Dealer model (US)" }));
    expect(screen.getAllByText("Gamma flip").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: /All expiries/ }));
    expect(screen.getByText(/2 expiries/)).toBeInTheDocument();
    const region = screen.getByRole("region", { name: /heatmap/i });
    expect(within(region).getAllByText("CW").length).toBeGreaterThan(0);
  });
});

describe("GammaLevelsCard", () => {
  it("renders the embeddable card with a link to the page", () => {
    renderWithShell(<GammaLevelsCard symbol="nifty" />, "/");
    expect(screen.getByText(/Gamma levels · NIFTY/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open GEX/ })).toHaveAttribute("href", "/gex?symbol=NIFTY");
    expect(screen.getByText("Put wall")).toBeInTheDocument();
  });
});
