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

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/expiry-day?symbol=NIFTY"]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Expiry Day page", () => {
  it("labels sample data, shows straddle numbers and every tab renders", async () => {
    localStorage.clear();
    const { default: ExpiryDay } = await import("@/pages/ExpiryDay");
    wrap(<ExpiryDay />);

    expect(screen.getByRole("heading", { level: 1, name: /Expiry Day/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/simulated NIFTY session/));
    expect(screen.getAllByText("Sample data").length).toBeGreaterThan(0);
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Expiry countdown/i })).toBeInTheDocument();
    // Straddle stats come from the simulated session.
    expect(screen.getAllByText("Theta / min").length).toBeGreaterThan(0);
    expect(screen.getByText("Straddle now")).toBeInTheDocument();
    // One KPI row: the unit toggle rescales it, and the expected move carries its method tag.
    expect(screen.getAllByText("Decayed today")).toHaveLength(1);
    expect(screen.getByText("Straddle ×0.85")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "₹/lot" }));
    await waitFor(() => expect(screen.getAllByText(/per lot \(\d+\)/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("radio", { name: "₹/unit" }));

    // Decay vs theory (default tab)
    expect(screen.getByRole("heading", { level: 2, name: /Decay vs theory/ })).toBeInTheDocument();
    expect(screen.getByText("Time decay")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Hero-zero" }));
    await waitFor(() => expect(screen.getByText("Lottery, high risk")).toBeInTheDocument());
    const add = screen.getAllByRole("button", { name: /^Add .* to basket$/ })[0];
    fireEvent.click(add);
    const basket = JSON.parse(localStorage.getItem("mc_basket_v1") ?? "[]");
    expect(basket).toHaveLength(1);
    expect(basket[0]).toMatchObject({ symbol: "NIFTY", side: "BUY", lots: 1 });
    expect(screen.getAllByRole("link", { name: /contract details$/ })[0].getAttribute("href")).toMatch(/^\/contract\/NIFTY\/\d{4}-\d{2}-\d{2}\/\d+\/(CE|PE)$/);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Multi-straddle" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Add/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Remove ATM straddle \(\d+\)$/ }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("mc_expiry_combos_v1:NIFTY") ?? "[]")).toHaveLength(2));

    fireEvent.mouseDown(screen.getByRole("tab", { name: "OI walls & flow" }));
    await waitFor(() => expect(screen.getByText("Call wall")).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole("tab", { name: "NIFTY vs SENSEX" }));
    await waitFor(() => expect(screen.getByText("Implied daily move")).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Rules" }));
    await waitFor(() => expect(screen.getByText("Extra 2% ELM on short index options")).toBeInTheDocument());
    expect(screen.getByText(/STT on exercise/)).toBeInTheDocument();
    // Heavy multi-tab render: ~2s alone, can exceed the 5s default under full-suite load.
  }, 20000);
});
