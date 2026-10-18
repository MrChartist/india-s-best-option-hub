import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain, getExpiries } from "@/lib/options";
import { flowStore } from "@/lib/flow";
import { alertStore, resetDeliveryRegistry } from "@/lib/alerts";

const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), toastSpy) }));
vi.mock("@/hooks/useMarketData", () => ({ useLiveOptionChain: () => ({ data: undefined, isLoading: true }) }));
vi.mock("@/lib/api/proxyClient", () => ({
  proxyGet: vi.fn(async () => ({
    data: null,
    meta: { source: "cache", asOf: Date.now(), stale: true, reason: "offline" },
  })),
}));
vi.mock("@/lib/snapshotStore", async (orig) => {
  const actual = await orig<typeof import("@/lib/snapshotStore")>();
  return {
    ...actual,
    getLatestSnapshots: vi.fn(async () => []),
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

beforeEach(() => {
  localStorage.clear();
  alertStore.resetForTests();
  resetDeliveryRegistry();
  Object.values(toastSpy).forEach((f) => f.mockClear());
});

function wrap(ui: React.ReactNode, path = "/alerts") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const expiry = getExpiries("NIFTY", new Date(), 1)[0].date;
function ingest(spot: number, asOf: number, isLive = true) {
  const { chain } = generateSampleChain({ symbol: "NIFTY", spot, expiry });
  flowStore.ingest({
    symbol: "NIFTY",
    expiry,
    lotSize: 65,
    spot,
    chain,
    source: isLive ? "dhan" : "sample",
    asOf,
    stale: !isLive,
    isLive,
    reason: undefined,
  });
}

describe("alert runner", () => {
  it("fires on a live crossing, delivers a toast and logs a snapshot; sample data never fires", async () => {
    alertStore.addRule({ symbol: "NIFTY", type: "price_level", direction: "above", level: 25_000, cooldownMin: 0 });
    const { default: AlertSystem } = await import("@/components/AlertSystem");
    wrap(<AlertSystem />);
    const t0 = Date.now();
    act(() => ingest(24_900, t0 - 60_000, false));
    act(() => ingest(25_200, t0 - 50_000, false));
    expect(alertStore.getState().log).toHaveLength(0);
    act(() => ingest(24_900, t0 - 30_000));
    act(() => ingest(25_100, t0 - 15_000));
    await waitFor(() => expect(alertStore.getState().log).toHaveLength(1));
    const e = alertStore.getState().log[0];
    expect(e.title).toContain("crossed above 25,000");
    expect(e.snapshot).toMatchObject({ symbol: "NIFTY", spot: 25_100 });
    expect(e.delivery.toast).toBe("sent");
    expect(toastSpy.success).toHaveBeenCalledWith(expect.stringContaining("NIFTY crossed above"), expect.anything());
    expect(alertStore.getState().runtime).toMatchObject({ running: true });
  });
});

describe("Alerts page", () => {
  it("lists, edits, pauses, deletes with undo and test-fires", async () => {
    alertStore.addRule({ symbol: "NIFTY", type: "pcr_cross", direction: "either", level: 1 });
    const { default: Alerts } = await import("@/pages/Alerts");
    wrap(<Alerts />);
    expect(screen.getByRole("heading", { level: 1, name: /Alerts/ })).toBeInTheDocument();
    expect(screen.getByText("NIFTY PCR (OI) crosses 1.00")).toBeInTheDocument();

    // Pause
    fireEvent.click(screen.getByRole("switch", { name: /Pause rule: NIFTY PCR/ }));
    expect(alertStore.getState().rules[0].enabled).toBe(false);
    expect(screen.getByText("Paused")).toBeInTheDocument();

    // Edit
    fireEvent.keyDown(screen.getByRole("button", { name: /Actions for rule/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("PCR level"), { target: { value: "1.2" } });
    fireEvent.change(within(dialog).getByLabelText("Name (optional)"), { target: { value: "PCR flip" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(alertStore.getState().rules[0]).toMatchObject({ level: 1.2, label: "PCR flip", enabled: false }),
    );

    // Test-fire from the log tab
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Log/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Test-fire/ }));
    await waitFor(() => expect(alertStore.getState().log[0]?.test).toBe(true));

    // Delete with undo
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Rules/ }));
    fireEvent.keyDown(await screen.findByRole("button", { name: /Actions for rule: PCR flip/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    expect(alertStore.getState().rules).toHaveLength(0);
    const call = toastSpy.success.mock.calls.find((c) => c[0] === "Rule deleted");
    act(() => (call?.[1] as { action: { onClick: () => void } }).action.onClick());
    expect(alertStore.getState().rules[0]).toMatchObject({ label: "PCR flip" });
  });

  it("shows an empty state, adds from ideas and imports a legacy chain file", async () => {
    const { default: Alerts } = await import("@/pages/Alerts");
    wrap(<Alerts />);
    expect(
      await screen.findByRole("button", { name: /Add rule: Any stock enters the F&O ban list/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add rule: Any stock enters the F&O ban list/ }));
    expect(alertStore.getState().rules).toHaveLength(1);

    const legacy = [
      {
        id: "sa_mgdmd0w0_abcd12",
        symbol: "NIFTY",
        expiry,
        strike: 25_000,
        type: "CE",
        field: "premium",
        op: "gte",
        value: 120,
      },
    ];
    const file = new File([JSON.stringify(legacy)], "old.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(alertStore.getState().rules.map((r) => r.type)).toEqual(["ban_entry", "strike_level"]));
    expect(toastSpy.success).toHaveBeenCalledWith(
      "Imported 1 rule",
      expect.objectContaining({ description: expect.stringContaining("migrated") }),
    );
  });
});

describe("AlertSystem sheet", () => {
  it("loads lazily and links to the Alerts page", async () => {
    const { default: AlertSystem } = await import("@/components/AlertSystem");
    wrap(<AlertSystem />, "/");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Alerts, 0 active/ }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog)
        .getByRole("link", { name: /Manage all alerts/ })
        .getAttribute("href"),
    ).toBe("/alerts");
  });
});
