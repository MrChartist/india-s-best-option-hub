import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain, getExpiries, getLotSize } from "@/lib/options";

const SPOTS: Record<string, number> = { NIFTY: 25_000, BANKNIFTY: 56_000, SENSEX: 82_000 };

function sampleData(symbol: string) {
  const spot = SPOTS[symbol] ?? 2_500;
  const expiry = getExpiries(symbol, new Date(), 1)[0]?.date ?? "2026-10-20";
  const { chain } = generateSampleChain({ symbol, spot, expiry });
  return {
    chain,
    spotPrice: spot,
    expiries: [],
    expiry,
    lotSize: getLotSize(symbol, expiry) ?? 1,
    stepSize: 50,
    maxPain: spot,
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
}

const cache = new Map<string, ReturnType<typeof sampleData>>();
vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: (symbol: string) => {
    if (!cache.has(symbol)) cache.set(symbol, sampleData(symbol));
    return { data: cache.get(symbol), isLoading: false };
  },
}));

vi.mock("@/lib/api/proxyClient", () => ({
  proxyGet: vi.fn(async () => ({ data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "offline" } })),
}));

vi.mock("@/lib/snapshotStore", async (orig) => {
  const actual = await orig<typeof import("@/lib/snapshotStore")>();
  return {
    ...actual,
    getLatestSnapshots: vi.fn(async () => []),
    getSnapshots: vi.fn(async () => []),
    getDailyStats: vi.fn(async () => []),
    recordSnapshot: vi.fn(async () => undefined),
  };
});

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Flow page", () => {
  it("labels derived and sample data and fills the tape from a simulated session", async () => {
    const { default: Flow } = await import("@/pages/Flow");
    wrap(<Flow />);
    expect(screen.getByText(/NSE does not publish trade-level data/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/simulated sample session/));
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByText(/prints? of|print[s]? · newest first/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
  });
});

describe("AlertSystem", () => {
  it("works with zero props, adds an idea as a rule and persists it", async () => {
    localStorage.clear();
    const { default: AlertSystem } = await import("@/components/AlertSystem");
    wrap(<AlertSystem />);
    fireEvent.click(screen.getByRole("button", { name: /Alerts, 0 active/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("Educational, not advice").length).toBeGreaterThan(3);
    fireEvent.click(within(dialog).getByRole("button", { name: /Add rule: NIFTY PCR \(OI\) crosses 1.00/ }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("mc_alert_rules_v1") ?? "[]")).toHaveLength(1));
    expect(within(dialog).getByText("1 active")).toBeInTheDocument();
    // No VIX-derived PCR anywhere.
    expect(dialog.textContent).not.toMatch(/VIX/);
  });
});
