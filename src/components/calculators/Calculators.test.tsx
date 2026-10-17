import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import Calculators from "@/pages/Calculators";

vi.mock("@/hooks/useMarketData", () => ({
  useLiveIndices: () => ({ data: { data: [], isLive: false, source: "none", asOf: Date.now(), stale: true }, isLoading: false, source: "none", asOf: Date.now(), stale: true }),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.search}</div>;
}

function renderAt(url: string) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/calculators"
            element={
              <>
                <Calculators />
                <LocationProbe />
              </>
            }
          />
          <Route path="/strategy-builder" element={<div>builder</div>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("Calculators page", () => {
  it("renders the charges tab by default with the compliance note", () => {
    renderAt("/calculators");
    expect(screen.getByRole("heading", { level: 1, name: /calculators/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Charges", selected: true })).toBeInTheDocument();
    expect(screen.getByText(/Data for education and research\. Not investment advice\./)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Summary" })).toBeInTheDocument();
  });

  it("opens the tab named in ?tab=", () => {
    renderAt("/calculators?tab=margin");
    expect(screen.getByRole("tab", { name: "Margin", selected: true })).toBeInTheDocument();
    expect(screen.getAllByText(/Estimate; actual SPAN may differ/).length).toBeGreaterThan(0);
    // sample spot is labelled, never shown as live
    expect(screen.getAllByText(/Sample spot/).length).toBeGreaterThan(0);
    // default iron condor produces a Strategy Builder link carrying ?legs=
    const link = screen.getByRole("link", { name: /Open in Strategy Builder/i });
    expect(link.getAttribute("href")).toMatch(/^\/strategy-builder\?legs=/);
  });

  it("falls back to the default tab for an unknown ?tab=", () => {
    renderAt("/calculators?tab=nope");
    expect(screen.getByRole("tab", { name: "Charges", selected: true })).toBeInTheDocument();
  });

  it("every calculator renders without crashing", () => {
    for (const tab of ["size", "price", "iv", "exercise", "basis", "lots"]) {
      const { unmount } = renderAt(`/calculators?tab=${tab}`);
      const panel = screen.getByRole("tabpanel");
      expect(panel).toBeInTheDocument();
      unmount();
    }
  }, 20_000); // six full renders; slow on loaded CI runners

  it("lot lookup shows NIFTY specs and six expiries", () => {
    renderAt("/calculators?tab=lots");
    const region = screen.getByRole("region", { name: "Next 6 expiries" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("region", { name: "NIFTY" })).toBeInTheDocument();
  });
});
