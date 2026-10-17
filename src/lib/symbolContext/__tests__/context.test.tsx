// @vitest-environment jsdom
import { act, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SYMBOL_STORAGE_KEY, SymbolProvider, useActiveSymbol, useHasSymbolProvider } from "..";

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.search}</output>;
}

const inRouter =
  (entry: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>
      <SymbolProvider>
        {children}
        <LocationProbe />
      </SymbolProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  window.sessionStorage.clear();
});

describe("SymbolProvider inside a router", () => {
  it("reads ?symbol= and ?expiry= from the URL", () => {
    const { result } = renderHook(() => useActiveSymbol(), { wrapper: inRouter("/option-chain?symbol=banknifty&expiry=2026-10-28") });
    expect(result.current.symbol).toBe("BANKNIFTY");
    expect(result.current.expiry).toBe("2026-10-28");
    expect(result.current.source).toBe("url");
  });

  it("defaults to NIFTY with no URL and no memory", () => {
    const { result } = renderHook(() => useActiveSymbol(), { wrapper: inRouter("/gex") });
    expect(result.current.symbol).toBe("NIFTY");
    expect(result.current.expiry).toBe("");
    expect(result.current.source).toBe("default");
  });

  it("writes the URL, clears the expiry on a new symbol and remembers the choice", () => {
    const { result } = renderHook(() => useActiveSymbol(), { wrapper: inRouter("/option-chain?tab=greeks&symbol=NIFTY&expiry=2026-10-20") });
    act(() => result.current.setSymbol("sensex"));
    expect(result.current.symbol).toBe("SENSEX");
    expect(result.current.expiry).toBe("");
    expect(screen.getByTestId("loc").textContent).toBe("?tab=greeks&symbol=SENSEX");
    act(() => result.current.setExpiry("2026-10-22"));
    expect(screen.getByTestId("loc").textContent).toBe("?tab=greeks&symbol=SENSEX&expiry=2026-10-22");
    expect(JSON.parse(window.sessionStorage.getItem(SYMBOL_STORAGE_KEY) ?? "{}")).toEqual({ symbol: "SENSEX", expiry: "2026-10-22" });
  });

  it("ignores invalid input", () => {
    const { result } = renderHook(() => useActiveSymbol(), { wrapper: inRouter("/?symbol=NIFTY") });
    act(() => result.current.setSymbol("<bad>"));
    act(() => result.current.setExpiry("whenever"));
    expect(result.current.symbol).toBe("NIFTY");
    expect(screen.getByTestId("loc").textContent).toBe("?symbol=NIFTY");
  });

  it("sets symbol and expiry together", () => {
    const { result } = renderHook(() => useActiveSymbol(), { wrapper: inRouter("/") });
    act(() => result.current.setSelection("RELIANCE", "2026-10-27"));
    expect(result.current.symbol).toBe("RELIANCE");
    expect(result.current.expiry).toBe("2026-10-27");
  });

  it("falls back to the last value in sessionStorage", () => {
    window.sessionStorage.setItem(SYMBOL_STORAGE_KEY, JSON.stringify({ symbol: "FINNIFTY", expiry: "2026-10-27" }));
    const { result } = renderHook(() => useActiveSymbol(), { wrapper: inRouter("/oi-analysis") });
    expect(result.current.symbol).toBe("FINNIFTY");
    expect(result.current.expiry).toBe("2026-10-27");
    expect(result.current.source).toBe("session");
  });

  it("remembers deep links", () => {
    renderHook(() => useActiveSymbol(), { wrapper: inRouter("/gex?symbol=MIDCPNIFTY") });
    expect(JSON.parse(window.sessionStorage.getItem(SYMBOL_STORAGE_KEY) ?? "{}").symbol).toBe("MIDCPNIFTY");
  });
});

describe("useActiveSymbol without a provider", () => {
  it("reads window.location, then NIFTY", () => {
    const { result, unmount } = renderHook(() => ({ v: useActiveSymbol(), has: useHasSymbolProvider() }));
    expect(result.current.has).toBe(false);
    expect(result.current.v.symbol).toBe("NIFTY");
    unmount();
    window.history.replaceState(null, "", "/gex?symbol=BANKNIFTY");
    const again = renderHook(() => useActiveSymbol());
    expect(again.result.current.symbol).toBe("BANKNIFTY");
  });

  it("updates the address bar and every caller", () => {
    window.history.replaceState(null, "", "/flow?view=tape");
    function A() {
      const { symbol, setSymbol } = useActiveSymbol();
      return (
        <button type="button" onClick={() => setSymbol("TCS")}>
          {symbol}
        </button>
      );
    }
    function B() {
      return <span data-testid="b">{useActiveSymbol().symbol}</span>;
    }
    render(
      <>
        <A />
        <B />
      </>,
    );
    expect(screen.getByTestId("b").textContent).toBe("NIFTY");
    act(() => screen.getByRole("button").click());
    expect(screen.getByTestId("b").textContent).toBe("TCS");
    expect(window.location.search).toBe("?view=tape&symbol=TCS");
  });
});
