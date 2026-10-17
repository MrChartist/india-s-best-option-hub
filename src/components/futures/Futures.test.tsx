import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import Futures from "@/pages/Futures";

const state = { live: false };

function rowsFor(symbol: string, date: string) {
  const spot = symbol === "NIFTY" ? 25000 : 1000;
  const bump = date === "2026-10-16" ? 1.004 : 1;
  return [
    {
      symbol,
      expiry: "2026-10-27",
      strike: 0,
      type: "FUT",
      close: spot * 1.003 * bump,
      settle: 0,
      oi: 90000,
      chgOi: 3000,
      volume: 10,
      underlyingClose: spot * bump,
    },
    {
      symbol,
      expiry: "2026-11-23",
      strike: 0,
      type: "FUT",
      close: spot * 1.009 * bump,
      settle: 0,
      oi: 20000,
      chgOi: 2000,
      volume: 5,
      underlyingClose: spot * bump,
    },
    {
      symbol,
      expiry: "2026-12-29",
      strike: 0,
      type: "FUT",
      close: spot * 1.015 * bump,
      settle: 0,
      oi: 4000,
      chgOi: 100,
      volume: 1,
      underlyingClose: spot * bump,
    },
    {
      symbol,
      expiry: "2026-10-27",
      strike: spot,
      type: "CE",
      close: 100,
      settle: 0,
      oi: 1,
      chgOi: 0,
      volume: 0,
      underlyingClose: spot * bump,
    },
  ];
}

vi.mock("@/lib/api/proxyClient", () => ({
  proxyGet: vi.fn(async (_path: string, params?: Record<string, string | undefined>) => {
    if (!state.live)
      return { data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "proxy-offline" } };
    const date = params?.date ?? "2026-10-16";
    return {
      data: rowsFor(String(params?.symbol), date),
      meta: { source: "nse", asOf: Date.parse(`${date}T18:30:00+05:30`), stale: false },
    };
  }),
}));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
});

beforeEach(() => localStorage.clear());

function renderPage(url = "/futures") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Futures />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Futures page", () => {
  it("falls back to one clearly labelled sample set when NSE is unreachable", async () => {
    state.live = false;
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Futures and Rollover" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/generated for illustration/)).toBeInTheDocument());
    const header = document.querySelector("[data-page-header]") as HTMLElement;
    expect(within(header).getByText(/Sample data/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Sample data$/)).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Index futures" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /NIFTY futures/ })).toBeInTheDocument();
    expect(screen.getByText("Term structure")).toBeInTheDocument();
    expect(screen.getByText("Rollover vs last 3 expiries")).toBeInTheDocument();
    expect(screen.getByText("Expiry-week roll tracker")).toBeInTheDocument();
    // Sample data is never written to the browser store.
    expect(localStorage.getItem("mc_futures_days_v1")).toBeNull();
    // No history download in sample mode.
    expect(screen.queryByRole("button", { name: /Load NSE history/ })).not.toBeInTheDocument();
  });

  it("uses the NSE bhavcopy when available, saves it and offers a history download", async () => {
    state.live = true;
    renderPage("/futures?symbol=NIFTY");
    await waitFor(() => expect(screen.getAllByText(/NSE · end of day/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/generated for illustration/)).not.toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Index futures" });
    // NIFTY near: 25,000 × 1.004 × 1.003 = 25,175.30
    expect(within(table).getAllByText("25,175.30").length).toBeGreaterThan(0);
    expect(localStorage.getItem("mc_futures_days_v1")).toContain("2026-10-16");
    expect(await screen.findByRole("button", { name: /Load NSE history/ })).toBeInTheDocument();
  });

  it("explains that BSE contracts are not in the NSE bhavcopy", async () => {
    state.live = false;
    renderPage("/futures?symbol=SENSEX");
    expect(await screen.findByText(/SENSEX trades on BSE/)).toBeInTheDocument();
  });
});
