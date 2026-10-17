import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { sampleParticipantHistory } from "@/lib/participantsApi";
import Participants from "@/pages/Participants";
import FiiLongCard from "./FiiLongCard";

const state = { live: false };
const HISTORY = sampleParticipantHistory(30, "2026-10-16", 4242);
const LAST = HISTORY.filter((r) => r.date === "2026-10-16");

vi.mock("@/lib/api/proxyClient", () => ({
  proxyGet: vi.fn(async (path: string) => {
    const offline = { data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "offline" } };
    if (!state.live) return offline;
    const meta = { source: "nse", asOf: Date.now(), stale: false };
    if (path === "/api/x/participant-oi/history") return { data: HISTORY, meta };
    if (path === "/api/x/participant-oi") return { data: LAST, meta };
    return offline;
  }),
}));

vi.mock("@/lib/marketApi", () => ({
  fetchFIIDII: vi.fn(async () => {
    if (!state.live) throw new Error("offline");
    return [
      { category: "FII/FPI *", date: "16-Oct-2026", buyValue: 12000, sellValue: 13500, netValue: -1500 },
      { category: "DII **", date: "16-Oct-2026", buyValue: 14000, sellValue: 12000, netValue: 2000 },
    ];
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

beforeEach(() => {
  localStorage.clear();
});

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/participants"]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Participants page", () => {
  it("falls back to clearly labelled sample data when the proxy is offline", async () => {
    state.live = false;
    renderWithProviders(<Participants />);
    expect(screen.getByRole("heading", { level: 1, name: /FII \/ DII Positioning/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Sample data/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/Participant-wise positions/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Client vs FII mirror" })).toBeInTheDocument();
    expect(screen.getByText(/Data for education and research. Not investment advice./)).toBeInTheDocument();
  });

  it("renders live NSE data and saves history in the browser", async () => {
    state.live = true;
    renderWithProviders(<Participants />);
    await waitFor(() => expect(screen.getAllByText("16 Oct 2026").length).toBeGreaterThan(0));
    expect(screen.queryByText(/every F&O number below is simulated/i)).not.toBeInTheDocument();
    expect(localStorage.getItem("mc_participant_oi_v1")).toContain("2026-10-16");
    await waitFor(() => expect(localStorage.getItem("mc_fii_dii_cash_v1")).toContain("2026-10-16"));
  });
});

describe("FiiLongCard", () => {
  it("renders without props and links to the page", async () => {
    state.live = true;
    renderWithProviders(<FiiLongCard />);
    await waitFor(() => expect(screen.getByText(/FII index futures long/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /FII \/ DII positioning/i })).toHaveAttribute("href", "/participants");
  });
});
