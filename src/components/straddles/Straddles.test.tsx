import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain, getExpiries, getLotSize } from "@/lib/options";

const SPOTS: Record<string, number> = { NIFTY: 25_000, SENSEX: 82_000, BANKNIFTY: 56_000, FINNIFTY: 26_000, MIDCPNIFTY: 13_000, BANKEX: 62_000 };

function sampleData(symbol: string, expiryIn?: string) {
  const spot = SPOTS[symbol] ?? 2_500;
  const expiry = expiryIn || getExpiries(symbol, new Date(), 1)[0]?.date || "2026-11-03";
  const { chain } = generateSampleChain({ symbol, spot, expiry });
  return {
    chain,
    spotPrice: spot,
    expiries: [],
    expiry,
    lotSize: getLotSize(symbol, expiry) ?? 1,
    stepSize: symbol === "SENSEX" || symbol === "BANKNIFTY" || symbol === "BANKEX" ? 100 : 50,
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
  useLiveOptionChain: (symbol: string, expiry?: string) => {
    const k = `${symbol}|${expiry ?? ""}`;
    if (!cache.has(k)) cache.set(k, sampleData(symbol, expiry));
    return { data: cache.get(k), isLoading: false, isError: false };
  },
}));

vi.mock("@/hooks/useSnapshotRecorder", () => ({
  useSnapshotRecorder: () => ({ recording: false, count: 0 }),
  useSnapshots: () => ({ data: [], isLoading: false }),
}));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
});

function wrap(ui: ReactNode, initial = "/straddles") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Straddles page", () => {
  it("labels sample data and renders every intraday chart and the daily view", async () => {
    localStorage.clear();
    const { default: Straddles } = await import("@/pages/Straddles");
    wrap(<Straddles />);

    expect(screen.getByRole("heading", { level: 1, name: /Straddles/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/simulated NIFTY session/));
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.getByText("Premium now")).toBeInTheDocument();
    expect(screen.getByText("Straddle ×0.85")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /ATM straddle \(rolling\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /CE and PE legs/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Straddle vs spot/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Multi-strike comparison/ })).toBeInTheDocument();
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();

    // Custom pair: the KPI row switches to the CE share and the builder stays available.
    fireEvent.click(screen.getByRole("radio", { name: "Custom CE/PE" }));
    await waitFor(() => expect(screen.getByText("CE share")).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 2, name: /CE \+ .* PE/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open in builder: the .* in the Strategy Builder or basket/ })).toBeEnabled();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Daily/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: /Daily straddle/ })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/so these closes are simulated/)).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Combined" })).toBeInTheDocument();
  });

  it("reads a fixed strike from the link", async () => {
    const { default: Straddles } = await import("@/pages/Straddles");
    wrap(<Straddles />, "/straddles?symbol=BANKNIFTY&mode=fixed&strike=56000");
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: /56,000 straddle/ })).toBeInTheDocument());
  });
});
