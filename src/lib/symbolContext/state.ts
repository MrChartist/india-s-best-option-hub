/**
 * Pure state for the app-wide active symbol and expiry (no React, no DOM access unless a
 * Storage is passed in), so the rules are unit tested directly.
 *
 * Resolution order for the symbol:   ?symbol=  →  last value this tab (sessionStorage)  →  NIFTY
 * Resolution order for the expiry:   ?expiry=  →  last value, only if it belongs to the same symbol  →  ""
 *
 * An expiry of "" means "none chosen": each page then picks its own default (usually the nearest
 * expiry from the live chain). Expiries are ISO yyyy-mm-dd, the same shape as /contract/... links.
 */
import { isValidIsoDate, normalizeExpiry, normalizeSymbol } from "@/lib/options";

export const SYMBOL_PARAM = "symbol";
export const EXPIRY_PARAM = "expiry";
export const DEFAULT_SYMBOL = "NIFTY";
/** sessionStorage key: per tab, so two tabs can watch different underlyings. */
export const SYMBOL_STORAGE_KEY = "mrc.activeSymbol";

export interface ActiveSelection {
  /** Upper-case NSE/BSE underlying, e.g. "NIFTY", "RELIANCE", "M&M". Never empty. */
  symbol: string;
  /** ISO yyyy-mm-dd, or "" when no expiry has been chosen. */
  expiry: string;
}

export type SelectionSource = "url" | "session" | "default";

export interface ResolvedSelection extends ActiveSelection {
  /** Where the symbol came from (handy for "remembered from your last page" hints and tests). */
  source: SelectionSource;
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&-]{0,19}$/;

/** Canonical symbol, or "" when the input is not a plausible NSE/BSE ticker. */
export function sanitizeSymbol(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const sym = normalizeSymbol(raw);
  return SYMBOL_RE.test(sym) ? sym : "";
}

/** ISO expiry, or "" when the input is not a date ("28 Oct", "28OCT26" and ISO are accepted). */
export function sanitizeExpiry(raw: unknown, now: Date = new Date()): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (isValidIsoDate(s)) return s;
  return normalizeExpiry(s, now);
}

/** Read ?symbol= and ?expiry= from a search string ("?a=b" or "a=b"). Invalid values come back "". */
export function readSearch(search: string, now: Date = new Date()): ActiveSelection {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return { symbol: sanitizeSymbol(params.get(SYMBOL_PARAM)), expiry: sanitizeExpiry(params.get(EXPIRY_PARAM), now) };
}

/** Parse a stored value defensively; anything malformed is ignored. */
export function parseStored(raw: string | null | undefined): ActiveSelection | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ActiveSelection> | null;
    const symbol = sanitizeSymbol(v?.symbol);
    if (!symbol) return null;
    const expiry = typeof v?.expiry === "string" && isValidIsoDate(v.expiry) ? v.expiry : "";
    return { symbol, expiry };
  } catch {
    return null;
  }
}

export function serializeStored(sel: ActiveSelection): string {
  return JSON.stringify({ symbol: sel.symbol, expiry: sel.expiry });
}

/** Combine the URL and the remembered value into the active selection. */
export function resolveSelection(search: string, stored: ActiveSelection | null, now: Date = new Date()): ResolvedSelection {
  const fromUrl = readSearch(search, now);
  if (fromUrl.symbol) {
    const expiry = fromUrl.expiry || (stored && stored.symbol === fromUrl.symbol ? stored.expiry : "");
    return { symbol: fromUrl.symbol, expiry, source: "url" };
  }
  if (stored) {
    // An explicit ?expiry= without ?symbol= still wins for the remembered symbol.
    return { symbol: stored.symbol, expiry: fromUrl.expiry || stored.expiry, source: "session" };
  }
  return { symbol: DEFAULT_SYMBOL, expiry: fromUrl.expiry, source: "default" };
}

/**
 * New search string with ?symbol= and ?expiry= set (other params are kept, in order).
 * An empty expiry removes the param. Returns "" or "?…".
 */
export function writeSearch(search: string, sel: ActiveSelection): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(SYMBOL_PARAM, sel.symbol);
  if (sel.expiry) params.set(EXPIRY_PARAM, sel.expiry);
  else params.delete(EXPIRY_PARAM);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * Next selection after a symbol change. Expiry calendars differ by underlying (NIFTY weekly Tuesday,
 * SENSEX weekly Thursday, stocks monthly), so a new symbol drops the expiry unless the same symbol
 * was picked again.
 */
export function nextForSymbol(current: ActiveSelection, rawSymbol: string): ActiveSelection | null {
  const symbol = sanitizeSymbol(rawSymbol);
  if (!symbol) return null;
  return { symbol, expiry: symbol === current.symbol ? current.expiry : "" };
}

/** Next selection after an expiry change ("" clears it). Null when the input is not a date. */
export function nextForExpiry(current: ActiveSelection, rawExpiry: string | null | undefined, now: Date = new Date()): ActiveSelection | null {
  if (rawExpiry === null || rawExpiry === undefined || rawExpiry === "") return { symbol: current.symbol, expiry: "" };
  const expiry = sanitizeExpiry(rawExpiry, now);
  return expiry ? { symbol: current.symbol, expiry } : null;
}

/** Storage read that never throws (private windows, blocked site data). */
export function readStoredSelection(storage: Pick<Storage, "getItem"> | null | undefined): ActiveSelection | null {
  if (!storage) return null;
  try {
    return parseStored(storage.getItem(SYMBOL_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Storage write that never throws. */
export function writeStoredSelection(storage: Pick<Storage, "setItem"> | null | undefined, sel: ActiveSelection): void {
  if (!storage) return;
  try {
    storage.setItem(SYMBOL_STORAGE_KEY, serializeStored(sel));
  } catch {
    /* storage blocked: the URL still carries the choice */
  }
}

/** window.sessionStorage, or null where it is unavailable or throws on access. */
export function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
