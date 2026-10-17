import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { JOURNAL_KEY } from "@/lib/journal";
import { installResizeObserver, renderPage } from "@/components/positions/testUtils";

beforeAll(installResizeObserver);
beforeEach(() => localStorage.clear());

const CSV = `symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time,expiry_date
NIFTY26O0625000CE,,2026-10-01,NFO,FO,,sell,false,65,120.50,1001,9001,2026-10-01T09:45:10,2026-10-06
NIFTY26O0625000CE,,2026-10-03,NFO,FO,,buy,false,65,60.00,1003,9002,2026-10-03T14:10:00,2026-10-06`;

describe("Trade Journal page", () => {
  it("opens on the labelled sample tradebook with edge analytics and the turnover card", async () => {
    const { default: Page } = await import("@/pages/Journal");
    renderPage(<Page />, "/journal");
    expect(screen.getByRole("heading", { level: 1, name: /Trade Journal/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Sample tradebook/).length).toBeGreaterThan(0);
    expect(screen.getByText(/None of these trades are real/)).toBeInTheDocument();
    expect(screen.getByText("Where your edge is")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Turnover CSV/ })).toBeInTheDocument();
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
    for (const name of [/Gross vs net/, /P&L calendar/, /Trade log/]) {
      fireEvent.mouseDown(screen.getByRole("tab", { name }));
      fireEvent.click(screen.getByRole("tab", { name }));
    }
    expect(await screen.findByRole("textbox", { name: "Search trades" })).toBeInTheDocument();
  });

  it("imports a Zerodha tradebook and saves tags on a round trip", async () => {
    const { default: Page } = await import("@/pages/Journal");
    renderPage(<Page />, "/journal");
    const input = screen.getByLabelText("Choose a tradebook CSV") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([CSV], "tradebook.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "{}").fills).toHaveLength(2));
    expect(await screen.findByText(/Imported · 2 fills/)).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Trade log/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Trade log/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Tags and notes for NIFTY 25000 CE/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Tags/), { target: { value: "plan followed, expiry week" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? "{}");
      expect(Object.values(saved.annotations ?? {})).toEqual([{ tags: ["plan followed", "expiry week"], note: "" }]);
    });
  });
});
