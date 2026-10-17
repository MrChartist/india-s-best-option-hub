import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { generateSampleChain, getExpiries, getLotSize } from "@/lib/options";
import { createPosition, getPositions, savePositions } from "@/lib/positionStore";
import { installResizeObserver, renderPage } from "./testUtils";

const SPOT = 25_000;
const chains = new Map<string, ReturnType<typeof chainData>>();
let source: "nse" | "sample" = "nse";

function chainData(symbol: string, expiry: string) {
  const { chain } = generateSampleChain({ symbol, spot: SPOT, expiry, seed: 7 });
  return { chain, spotPrice: SPOT, expiries: [], expiry, lotSize: getLotSize(symbol, expiry) ?? 1, stepSize: 50, maxPain: SPOT, totalCEOI: 0, totalPEOI: 0, isLive: source !== "sample", afterHours: false, source, cachedAt: null, asOf: Date.now(), stale: false };
}

vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: (symbol: string, expiry?: string) => {
    const k = `${symbol}|${expiry}|${source}`;
    if (!chains.has(k)) chains.set(k, chainData(symbol, expiry ?? ""));
    return { data: chains.get(k), isLoading: false, isError: false };
  },
}));
vi.mock("@/lib/volatility/api", () => ({
  fetchDailyBars: () => Promise.reject(new Error("offline")),
}));

beforeAll(installResizeObserver);
beforeEach(() => {
  localStorage.clear();
  source = "nse";
});

const expiry = () => getExpiries("NIFTY", new Date(), 2)[1].date;

describe("Position Tracker page", () => {
  it("shows the empty state and the education note", async () => {
    const { default: Page } = await import("@/pages/PositionTracker");
    renderPage(<Page />);
    expect(screen.getByRole("heading", { level: 1, name: /Positions/ })).toBeInTheDocument();
    expect(screen.getByText("No open positions")).toBeInTheDocument();
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
  });

  it("updates CMP from the live chain, shows risk tiles and every tab renders", async () => {
    const exp = expiry();
    savePositions([createPosition({ symbol: "NIFTY", type: "CE", action: "SELL", strike: 25500, entryPrice: 1, expiry: exp, lots: 1 }), createPosition({ symbol: "NIFTY", type: "PE", action: "SELL", strike: 24500, entryPrice: 1, expiry: exp, lots: 1 })]);
    const { default: Page } = await import("@/pages/PositionTracker");
    renderPage(<Page />);
    const live = chains.get(`NIFTY|${exp}|nse`);
    const ce = live?.chain.find((r) => r.strikePrice === 25500)?.ce.ltp ?? 0;
    await waitFor(() => expect(getPositions().find((p) => p.strike === 25500)?.currentPrice).toBeCloseTo(ce, 6));
    expect(screen.getByText("Net MTM")).toBeInTheDocument();
    expect(screen.getByText("NIFTY Δ (β-wtd)")).toBeInTheDocument();
    expect(screen.getAllByText("Live").length).toBeGreaterThan(0);

    for (const name of [/Greeks by underlying/, /Scenarios/, /Payoff/, /Closed/]) {
      fireEvent.mouseDown(screen.getByRole("tab", { name }));
      fireEvent.click(screen.getByRole("tab", { name }));
    }
    await waitFor(() => expect(screen.getByText(/No closed positions yet/)).toBeInTheDocument());
  });

  it("never overwrites CMP with sample quotes and labels them", async () => {
    source = "sample";
    const exp = expiry();
    savePositions([createPosition({ symbol: "NIFTY", type: "CE", action: "BUY", strike: 25000, entryPrice: 123, expiry: exp, lots: 1 })]);
    const { default: Page } = await import("@/pages/PositionTracker");
    renderPage(<Page />);
    await waitFor(() => expect(screen.getByText(/Spots come from sample data/)).toBeInTheDocument());
    expect(getPositions()[0].currentPrice).toBe(123);
  });

  it("closes a position net of charges", async () => {
    const exp = expiry();
    savePositions([createPosition({ symbol: "NIFTY", type: "CE", action: "BUY", strike: 25000, entryPrice: 100, currentPrice: 100, expiry: exp, lots: 1, cmpManual: true })]);
    const { default: Page } = await import("@/pages/PositionTracker");
    renderPage(<Page />);
    fireEvent.click(screen.getByRole("button", { name: /Close NIFTY 25000 CE/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Exit price/), { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close position" }));
    await waitFor(() => expect(getPositions()).toHaveLength(0));
    const closed = JSON.parse(localStorage.getItem("optionsdesk_closed_positions") ?? "[]");
    expect(closed[0].grossPnl).toBeCloseTo(50 * closed[0].lotSize, 2);
    expect(closed[0].netPnl).toBeLessThan(closed[0].grossPnl);
  });
});
