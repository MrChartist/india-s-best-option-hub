/**
 * App-wide active symbol and expiry.
 *
 *   const { symbol, setSymbol, expiry, setExpiry } = useActiveSymbol();
 *
 * - The URL is the source of truth: ?symbol=BANKNIFTY&expiry=2026-10-28. Links and reloads keep the
 *   choice, and changing it replaces the history entry (no back-button clutter).
 * - The last value is remembered per tab in sessionStorage, so moving from the chain to GEX keeps
 *   BANKNIFTY even when the link has no ?symbol=.
 * - Works without <SymbolProvider>: it then reads the URL directly and falls back to the remembered
 *   value and finally NIFTY. Setters still update the URL (and tell React Router about it).
 * - expiry is "" until someone picks one; pages then use their own default (usually the nearest
 *   expiry of the live chain). setSymbol clears the expiry when the underlying changes.
 *
 * The integrator mounts <SymbolProvider> inside <BrowserRouter> in App.tsx. Pure rules live in
 * ./state (unit tested); the switcher's symbol and expiry lists live in ./symbols.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import {
  nextForExpiry,
  nextForSymbol,
  readStoredSelection,
  resolveSelection,
  safeSessionStorage,
  SYMBOL_STORAGE_KEY,
  writeSearch,
  writeStoredSelection,
  type ActiveSelection,
  type SelectionSource,
} from "./state";

export * from "./state";
export * from "./symbols";

export interface ActiveSymbolValue {
  /** Upper-case underlying, never empty ("NIFTY" by default). */
  symbol: string;
  /** Switch underlying. Invalid input is ignored. Clears the expiry when the symbol changes. */
  setSymbol: (symbol: string) => void;
  /** ISO yyyy-mm-dd, or "" when none is chosen. */
  expiry: string;
  /** Pick an expiry ("" or null clears it). Accepts ISO or "28 Oct"; invalid input is ignored. */
  setExpiry: (expiry: string | null) => void;
  /** Set both at once (one URL update), e.g. from a contract link. */
  setSelection: (symbol: string, expiry?: string | null) => void;
  /** Where the symbol came from: the URL, this tab's last choice, or the NIFTY default. */
  source: SelectionSource;
}

const SymbolContext = createContext<ActiveSymbolValue | null>(null);
SymbolContext.displayName = "SymbolContext";

/** Event fired after a URL change made outside React Router (the provider-less fallback). */
const CHANGE_EVENT = "mrc:active-symbol";

function sameSelection(a: ActiveSelection | null, b: ActiveSelection): boolean {
  return Boolean(a && a.symbol === b.symbol && a.expiry === b.expiry);
}

function compose(current: ActiveSelection, symbol: string, expiry: string | null | undefined): ActiveSelection | null {
  const withSymbol = nextForSymbol(current, symbol);
  if (!withSymbol) return null;
  if (expiry === undefined) return withSymbol;
  return nextForExpiry(withSymbol, expiry);
}

/** Shared setter wiring: `commit` writes the URL; storage and local state follow. */
function useSetters(current: ActiveSelection, commit: (next: ActiveSelection) => void) {
  const ref = useRef(current);
  ref.current = current;
  const apply = useCallback(
    (next: ActiveSelection | null) => {
      if (!next || sameSelection(ref.current, next)) return;
      writeStoredSelection(safeSessionStorage(), next);
      commit(next);
    },
    [commit],
  );
  const setSymbol = useCallback((s: string) => apply(nextForSymbol(ref.current, s)), [apply]);
  const setExpiry = useCallback((e: string | null) => apply(nextForExpiry(ref.current, e)), [apply]);
  const setSelection = useCallback((s: string, e?: string | null) => apply(compose(ref.current, s, e)), [apply]);
  return { setSymbol, setExpiry, setSelection };
}

/** Keep sessionStorage in step with what the URL says (deep links count as "last used"). */
function useRemember(resolved: ActiveSelection & { source: SelectionSource }, onStored: (s: ActiveSelection) => void) {
  useEffect(() => {
    if (resolved.source !== "url") return;
    const storage = safeSessionStorage();
    const prev = readStoredSelection(storage);
    const next = { symbol: resolved.symbol, expiry: resolved.expiry };
    if (sameSelection(prev, next)) return;
    writeStoredSelection(storage, next);
    onStored(next);
  }, [resolved.source, resolved.symbol, resolved.expiry, onStored]);
}

function RouterSymbolProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [stored, setStored] = useState<ActiveSelection | null>(() => readStoredSelection(safeSessionStorage()));
  const resolved = useMemo(() => resolveSelection(location.search, stored), [location.search, stored]);
  useRemember(resolved, setStored);

  const locRef = useRef(location);
  locRef.current = location;
  const commit = useCallback(
    (next: ActiveSelection) => {
      setStored(next);
      const loc = locRef.current;
      navigate({ pathname: loc.pathname, search: writeSearch(loc.search, next), hash: loc.hash }, { replace: true, state: loc.state });
    },
    [navigate],
  );
  const setters = useSetters(resolved, commit);
  const value = useMemo<ActiveSymbolValue>(
    () => ({ symbol: resolved.symbol, expiry: resolved.expiry, source: resolved.source, ...setters }),
    [resolved.symbol, resolved.expiry, resolved.source, setters],
  );
  return <SymbolContext.Provider value={value}>{children}</SymbolContext.Provider>;
}

// ── Provider-less fallback: read window.location, write with history.replaceState ──

function readLocationSearch(): string {
  try {
    return typeof window === "undefined" ? "" : window.location.search;
  } catch {
    return "";
  }
}

function readStoredRaw(): string {
  try {
    return safeSessionStorage()?.getItem(SYMBOL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

const noop = () => {};

function useStandaloneSelection(enabled: boolean): ActiveSymbolValue {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!enabled || typeof window === "undefined") return noop;
      window.addEventListener("popstate", cb);
      window.addEventListener(CHANGE_EVENT, cb);
      return () => {
        window.removeEventListener("popstate", cb);
        window.removeEventListener(CHANGE_EVENT, cb);
      };
    },
    [enabled],
  );
  // Snapshot is a plain string so React can compare it cheaply.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (enabled ? `${readLocationSearch()}\u0000${readStoredRaw()}` : ""),
    () => "",
  );
  const resolved = useMemo(() => {
    const [search = ""] = snapshot.split("\u0000");
    return resolveSelection(search, readStoredSelection(safeSessionStorage()));
  }, [snapshot]);
  const bump = useCallback(() => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  useRemember(resolved, bump);

  const commit = useCallback((next: ActiveSelection) => {
    if (typeof window === "undefined") return;
    try {
      const { pathname, search, hash } = window.location;
      // Keep history.state (React Router's index) so a router, if any, sees a zero-delta POP.
      window.history.replaceState(window.history.state, "", `${pathname}${writeSearch(search, next)}${hash}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    } catch {
      /* history blocked (sandboxed frame): storage still holds the choice */
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  const setters = useSetters(resolved, commit);
  return useMemo(
    () => ({ symbol: resolved.symbol, expiry: resolved.expiry, source: resolved.source, ...setters }),
    [resolved.symbol, resolved.expiry, resolved.source, setters],
  );
}

/** Provides the active symbol and expiry. Mount once, inside the router. */
export function SymbolProvider({ children }: { children: ReactNode }) {
  const inRouter = useInRouterContext();
  if (inRouter) return <RouterSymbolProvider>{children}</RouterSymbolProvider>;
  return <StandaloneSymbolProvider>{children}</StandaloneSymbolProvider>;
}

function StandaloneSymbolProvider({ children }: { children: ReactNode }) {
  const value = useStandaloneSelection(true);
  return <SymbolContext.Provider value={value}>{children}</SymbolContext.Provider>;
}

/** The active symbol and expiry, with setters. Safe to call with or without <SymbolProvider>. */
export function useActiveSymbol(): ActiveSymbolValue {
  const ctx = useContext(SymbolContext);
  const fallback = useStandaloneSelection(ctx === null);
  return ctx ?? fallback;
}

/** True when a <SymbolProvider> is mounted above (for diagnostics and tests). */
export function useHasSymbolProvider(): boolean {
  return useContext(SymbolContext) !== null;
}
