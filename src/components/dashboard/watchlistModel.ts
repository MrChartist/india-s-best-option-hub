/**
 * Pure watchlist logic: storage (with migration from the old key), named lists, symbol validation
 * with "Did you mean" suggestions, and sorting. Used by src/pages/Watchlist.tsx.
 */
import { CONTRACT_SPECS } from "@/lib/options";
import { FNO_INDICES, RENAMED_SYMBOLS, STATIC_FNO_STOCKS, canonicalFnoSymbol } from "@/lib/screener/universe";

export const WATCHLIST_KEY = "mc_watchlist_v1";
export const LEGACY_WATCHLIST_KEY = "optionsdesk_watchlist";
export const MAX_LISTS = 12;
export const MAX_SYMBOLS = 100;

export const DEFAULT_SYMBOLS: readonly string[] = [
  "NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "TMPV", "BAJFINANCE", "ADANIENT", "LT", "KOTAKBANK", "ITC", "HINDUNILVR",
];

export interface NamedWatchlist {
  id: string;
  name: string;
  symbols: string[];
}

export interface WatchlistState {
  version: 1;
  activeId: string;
  lists: NamedWatchlist[];
}

const cleanSymbols = (list: unknown): string[] => {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const s = canonicalFnoSymbol(raw);
    if (!s || seen.has(s) || !SYMBOL_SHAPE.test(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
};

export const SYMBOL_SHAPE = /^[A-Z0-9][A-Z0-9&\-_]{0,19}$/;

export function defaultState(symbols: readonly string[] = DEFAULT_SYMBOLS): WatchlistState {
  return { version: 1, activeId: "main", lists: [{ id: "main", name: "My watchlist", symbols: [...symbols] }] };
}

export function sanitizeState(raw: unknown): WatchlistState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { activeId?: unknown; lists?: unknown };
  if (!Array.isArray(r.lists)) return null;
  const ids = new Set<string>();
  const lists: NamedWatchlist[] = [];
  for (const l of r.lists) {
    if (!l || typeof l !== "object") continue;
    const item = l as { id?: unknown; name?: unknown; symbols?: unknown };
    const id = typeof item.id === "string" && item.id ? item.id : `list-${lists.length + 1}`;
    if (ids.has(id)) continue;
    ids.add(id);
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 40) : `Watchlist ${lists.length + 1}`;
    lists.push({ id, name, symbols: cleanSymbols(item.symbols) });
    if (lists.length >= MAX_LISTS) break;
  }
  if (lists.length === 0) return null;
  const activeId = typeof r.activeId === "string" && ids.has(r.activeId) ? r.activeId : lists[0].id;
  return { version: 1, activeId, lists };
}

function storageOrNull(s?: Storage | null): Storage | null {
  if (s !== undefined) return s;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Read the v1 store; migrate the old flat array once; fall back to defaults. Never throws. */
export function loadWatchlists(storage?: Storage | null): WatchlistState {
  const s = storageOrNull(storage);
  try {
    const raw = s?.getItem(WATCHLIST_KEY);
    if (raw) {
      const parsed = sanitizeState(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    /* corrupt JSON: try the legacy key */
  }
  try {
    const legacy = s?.getItem(LEGACY_WATCHLIST_KEY);
    if (legacy) {
      const symbols = cleanSymbols(JSON.parse(legacy));
      const migrated = defaultState(symbols.length ? symbols : DEFAULT_SYMBOLS);
      saveWatchlists(migrated, s);
      try {
        s?.removeItem(LEGACY_WATCHLIST_KEY);
      } catch {
        /* ignore */
      }
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return defaultState();
}

export function saveWatchlists(state: WatchlistState, storage?: Storage | null): boolean {
  const s = storageOrNull(storage);
  try {
    s?.setItem(WATCHLIST_KEY, JSON.stringify(state));
    return !!s;
  } catch {
    return false;
  }
}

export function activeList(state: WatchlistState): NamedWatchlist {
  return state.lists.find((l) => l.id === state.activeId) ?? state.lists[0];
}

export function updateActive(state: WatchlistState, fn: (symbols: string[]) => string[]): WatchlistState {
  return { ...state, lists: state.lists.map((l) => (l.id === state.activeId ? { ...l, symbols: fn(l.symbols).slice(0, MAX_SYMBOLS) } : l)) };
}

export function createList(state: WatchlistState, name: string): WatchlistState {
  if (state.lists.length >= MAX_LISTS) return state;
  let n = state.lists.length + 1;
  let id = `list-${n}`;
  const ids = new Set(state.lists.map((l) => l.id));
  while (ids.has(id)) id = `list-${++n}`;
  const clean = name.trim().slice(0, 40) || `Watchlist ${state.lists.length + 1}`;
  return { ...state, activeId: id, lists: [...state.lists, { id, name: clean, symbols: [] }] };
}

export function renameList(state: WatchlistState, id: string, name: string): WatchlistState {
  const clean = name.trim().slice(0, 40);
  if (!clean) return state;
  return { ...state, lists: state.lists.map((l) => (l.id === id ? { ...l, name: clean } : l)) };
}

export function deleteList(state: WatchlistState, id: string): WatchlistState {
  if (state.lists.length <= 1) return state;
  const lists = state.lists.filter((l) => l.id !== id);
  return { ...state, lists, activeId: state.activeId === id ? lists[0].id : state.activeId };
}

// ── Validation ──

/** Every symbol the app knows: static F&O list, contract specs, indices, plus anything live. */
export function buildUniverse(extra: Iterable<string> = []): Set<string> {
  const u = new Set<string>([...FNO_INDICES, "SENSEX", "BANKEX", ...STATIC_FNO_STOCKS, ...Object.keys(CONTRACT_SPECS)]);
  for (const s of extra) if (s) u.add(canonicalFnoSymbol(s));
  return u;
}

/** Levenshtein distance with an early exit once the distance exceeds `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Closest known symbols: prefix matches first, then small edit distances. */
export function suggestSymbols(input: string, universe: Iterable<string>, limit = 3): string[] {
  const q = input.trim().toUpperCase();
  if (!q) return [];
  const max = q.length <= 4 ? 1 : 2;
  const scored: Array<{ s: string; score: number }> = [];
  for (const s of universe) {
    if (s === q) continue;
    let score: number;
    if (s.startsWith(q)) score = 0.5 + (s.length - q.length) / 100;
    else if (q.startsWith(s) && s.length >= 3) score = 1 + (q.length - s.length) / 100;
    else {
      const d = editDistance(q, s, max);
      if (d > max) continue;
      score = d + 0.1;
    }
    scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.localeCompare(b.s));
  return scored.slice(0, limit).map((x) => x.s);
}

export type ValidationResult =
  | { ok: true; symbol: string; renamedFrom?: string }
  | { ok: false; reason: "empty" | "format" | "duplicate" | "unknown" | "full"; message: string; suggestions: string[] };

export function validateSymbol(input: string, universe: Set<string>, current: readonly string[]): ValidationResult {
  const raw = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return { ok: false, reason: "empty", message: "Type a symbol to add.", suggestions: [] };
  const symbol = canonicalFnoSymbol(raw);
  const renamedFrom = RENAMED_SYMBOLS[raw] ? raw : undefined;
  if (!SYMBOL_SHAPE.test(symbol)) return { ok: false, reason: "format", message: "Use the NSE symbol, letters and digits only (for example RELIANCE).", suggestions: [] };
  if (current.includes(symbol)) return { ok: false, reason: "duplicate", message: `${symbol} is already in this watchlist.`, suggestions: [] };
  if (current.length >= MAX_SYMBOLS) return { ok: false, reason: "full", message: `A watchlist holds up to ${MAX_SYMBOLS} symbols.`, suggestions: [] };
  if (!universe.has(symbol)) {
    const suggestions = suggestSymbols(symbol, universe).filter((s) => !current.includes(s));
    return { ok: false, reason: "unknown", message: `${symbol} is not an NSE F&O underlying we know.`, suggestions };
  }
  return renamedFrom ? { ok: true, symbol, renamedFrom } : { ok: true, symbol };
}

// ── Sorting ──

export type SortKey = "symbol" | "ltp" | "change" | "changePercent" | "volume" | "oi" | "oiChange";
export type SortDir = "asc" | "desc";

export interface SortableRow {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  volume: number;
  oi: number;
  oiChange: number;
  hasData: boolean;
}

/** Stable sort; rows without data always sink to the bottom. A null key keeps the user's order. */
export function sortRows<T extends SortableRow>(rows: readonly T[], key: SortKey | null, dir: SortDir): T[] {
  const indexed = rows.map((r, i) => ({ r, i }));
  if (!key) return rows.slice();
  const mul = dir === "asc" ? 1 : -1;
  indexed.sort((a, b) => {
    if (a.r.hasData !== b.r.hasData) return a.r.hasData ? -1 : 1;
    const c = key === "symbol" ? a.r.symbol.localeCompare(b.r.symbol) : (a.r[key] as number) - (b.r[key] as number);
    return c !== 0 ? c * mul : a.i - b.i;
  });
  return indexed.map((x) => x.r);
}

/** Cycle used by the column headers: desc → asc → off (numeric), asc → desc → off (symbol). */
export function nextSort(current: { key: SortKey | null; dir: SortDir }, key: SortKey): { key: SortKey | null; dir: SortDir } {
  const first: SortDir = key === "symbol" ? "asc" : "desc";
  if (current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return { key: null, dir: first };
}
