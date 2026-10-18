import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import Contract from "@/pages/Contract";

describe("Contract page with an unknown symbol", () => {
  it("says the symbol has no F&O contracts instead of rendering a sample contract", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/contract/XYZ/2026-10-27/2500/CE"]}>
            <Routes>
              <Route path="/contract/:symbol/:expiry/:strike/:type" element={<Contract />} />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Contract not found" })).toBeInTheDocument();
    expect(screen.getByText("XYZ is not an F&O underlying.")).toBeInTheDocument();
  });
});
