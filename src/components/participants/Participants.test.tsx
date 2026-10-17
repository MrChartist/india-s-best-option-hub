import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    // One sample label lives in the page header; panels do not repeat it.
    const header = document.querySelector("[data-page-header]") as HTMLElement;
    expect(header.textContent).toMatch(/Sample data/);
    expect(screen.getAllByText(/^Sample data$/)).toHaveLength(1);
  });

  it("uses the app date picker (dd MMM yyyy), offers a 1Y window and explains hatched shorts", async () => {
    state.live = false;
    renderWithProviders(<Participants />);
    const trigger = await screen.findByRole("button", { name: /Report date/ });
    await waitFor(() => expect(trigger.textContent).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/));
    expect(screen.getByRole("radio", { name: "1Y" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/hatched bars are shorts/).length).toBeGreaterThan(0));
    expect(screen.getByRole("heading", { name: /does it lead NIFTY/ })).toBeInTheDocument();
    expect(screen.queryByText(/\dth pct/)).not.toBeInTheDocument();
    // A Sunday snaps back to Friday's report.
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const sunday = within(dialog)
      .getAllByRole("gridcell")
      .map((c) => c.querySelector("button") ?? c)
      .find((b) => b.textContent === "11" && !b.hasAttribute("disabled"));
    expect(sunday).toBeTruthy();
    fireEvent.click(sunday as HTMLElement);
    expect(await screen.findByText(/11 Oct 2026 has no report/)).toBeInTheDocument();
  });

  it("renders live NSE data and saves history in the browser", async () => {
    state.live = true;
    renderWithProviders(<Participants />);
    await waitFor(() => expect(screen.getAllByText("16 Oct 2026").length).toBeGreaterThan(0));
    expect(screen.queryByText(/is simulated for illustration/i)).not.toBeInTheDocument();
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
