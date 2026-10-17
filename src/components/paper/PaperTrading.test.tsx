import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { generateSampleChain, getLotSize } from "@/lib/options";
import { PAPER_KEY } from "@/lib/paperTrading";
import { BASKET_KEY } from "@/components/option-chain/basket";
import { installResizeObserver, renderPage } from "@/components/positions/testUtils";

const SPOT = 25_000;
const chains = new Map<string, ReturnType<typeof chainData>>();

function chainData(symbol: string, expiry: string) {
  const { chain } = generateSampleChain({ symbol, spot: SPOT, expiry, seed: 3 });
  return { chain, spotPrice: SPOT, expiries: [], expiry, lotSize: getLotSize(symbol, expiry) ?? 1, stepSize: 50, maxPain: SPOT, totalCEOI: 0, totalPEOI: 0, isLive: true, afterHours: false, source: "nse" as const, cachedAt: null, asOf: Date.now(), stale: false };
}

vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: (symbol: string, expiry?: string) => {
    const k = `${symbol}|${expiry}`;
    if (!chains.has(k)) chains.set(k, chainData(symbol, expiry ?? ""));
    return { data: chains.get(k), isLoading: false, isError: false };
  },
  useAllIndices: () => ({ data: { vix: { value: 13.5, change: 0, changePercent: 0, high: 14, low: 13 } }, isLoading: false }),
}));
vi.mock("@/lib/volatility/api", () => ({
  fetchVixHistory: () => Promise.resolve({ data: Array.from({ length: 260 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`, close: 10 + (i % 10) })), source: "nse", asOf: Date.now(), stale: false }),
  cachedBhavPoints: () => [],
}));

beforeAll(installResizeObserver);
beforeEach(() => localStorage.clear());

describe("Paper Trading page", () => {
  it("buys at market from the ticket, books charges and tags the entry context", async () => {
    const { default: Page } = await import("@/pages/PaperTrading");
    renderPage(<Page />, "/paper-trading");
    expect(screen.getByRole("heading", { level: 1, name: /Paper Trading/ })).toBeInTheDocument();
    expect(screen.getByText(/Not investment advice/)).toBeInTheDocument();
    const buy = await screen.findByRole("button", { name: /Buy at market/ });
    // The max loss is mandatory: buying stays disabled until it is set.
    await waitFor(() => expect(screen.getByText(/most you are willing to lose/)).toBeInTheDocument());
    expect(buy).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: /^Use ₹/ }));
    await waitFor(() => expect(buy).toBeEnabled());
    // Beginner mode hides a naked sell.
    expect(screen.getByText("Naked sell hidden")).toBeInTheDocument();
    fireEvent.click(buy);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(PAPER_KEY) ?? "{}").positions).toHaveLength(1), { timeout: 4000 });
    const saved = JSON.parse(localStorage.getItem(PAPER_KEY) ?? "{}");
    expect(saved.ledger.map((l: { kind: string }) => l.kind)).toEqual(["DEPOSIT", "PREMIUM", "CHARGES"]);
    expect(saved.trades[0].context.vix).toBe(13.5);
    expect(saved.trades[0].context.ivpBasis).toBe("vix");
    for (const name of [/Orders/, /Closed trades/, /P&L calendar/, /Ledger/]) {
      fireEvent.mouseDown(screen.getByRole("tab", { name }));
      fireEvent.click(screen.getByRole("tab", { name }));
    }
    await waitFor(() => expect(screen.getByRole("button", { name: /CSV/ })).toBeInTheDocument());
  });

  it("loads the option-chain basket and places it at market", async () => {
    const { getExpiries } = await import("@/lib/options");
    const expiry = getExpiries("NIFTY", new Date(), 1)[0].date;
    localStorage.setItem(BASKET_KEY, JSON.stringify([{ symbol: "NIFTY", expiry, strike: 25000, type: "PE", side: "BUY", lots: 1, premium: 100, iv: null }]));
    const { default: Page } = await import("@/pages/PaperTrading");
    renderPage(<Page />, "/paper-trading");
    fireEvent.click(screen.getByRole("button", { name: "Load basket" }));
    fireEvent.click(await screen.findByRole("button", { name: "Place all at market" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Net premium")).toBeInTheDocument();
    expect(within(dialog).getByText("Available after")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: /Place 1 leg/ });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Use ₹/ }));
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(PAPER_KEY) ?? "{}").positions?.[0]?.type).toBe("PE"), { timeout: 4000 });
    expect(await screen.findByRole("link", { name: /Analyse NIFTY paper positions/ })).toHaveAttribute("href", expect.stringMatching(/^\/strategy-builder\?legs=/));
  });

  it("stages legs from a ?legs= link and blocks a naked short basket in beginner mode", async () => {
    const { getExpiries } = await import("@/lib/options");
    const { encodeLegs } = await import("@/components/option-chain/basket");
    const expiry = getExpiries("NIFTY", new Date(), 1)[0].date;
    const enc = encodeLegs([{ symbol: "NIFTY", expiry, strike: 25500, type: "CE", side: "SELL", lots: 1, premium: 40, iv: null }]);
    const { default: Page } = await import("@/pages/PaperTrading");
    renderPage(<Page />, `/paper-trading?legs=${enc}`);
    expect(await screen.findByText("Naked short")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Place all at market" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Max loss for this basket/), { target: { value: "5000" } });
    expect(await within(dialog).findByText(/Beginner mode blocks naked short options/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /Place 1 leg/ })).toBeDisabled();
  });
});
