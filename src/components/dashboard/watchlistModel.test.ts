import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYMBOLS,
  LEGACY_WATCHLIST_KEY,
  WATCHLIST_KEY,
  activeList,
  buildUniverse,
  createList,
  deleteList,
  editDistance,
  loadWatchlists,
  nextSort,
  renameList,
  sanitizeState,
  saveWatchlists,
  sortRows,
  suggestSymbols,
  updateActive,
  validateSymbol,
  type SortableRow,
} from "./watchlistModel";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

describe("storage", () => {
  it("falls back to defaults", () => {
    const s = loadWatchlists(new MemoryStorage());
    expect(activeList(s).symbols).toEqual([...DEFAULT_SYMBOLS]);
    expect(loadWatchlists(null).lists).toHaveLength(1);
  });

  it("migrates the legacy flat array once, applying renames", () => {
    const st = new MemoryStorage();
    st.setItem(LEGACY_WATCHLIST_KEY, JSON.stringify(["reliance", "TATAMOTORS", "RELIANCE", 4, "bad symbol!"]));
    const s = loadWatchlists(st);
    expect(activeList(s).symbols).toEqual(["RELIANCE", "TMPV"]);
    expect(st.getItem(LEGACY_WATCHLIST_KEY)).toBeNull();
    expect(st.getItem(WATCHLIST_KEY)).not.toBeNull();
  });

  it("recovers from corrupt JSON and tolerates throwing storage", () => {
    const st = new MemoryStorage();
    st.setItem(WATCHLIST_KEY, "{oops");
    expect(loadWatchlists(st).lists[0].symbols.length).toBeGreaterThan(0);
    const throwing = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => undefined } as unknown as Storage;
    expect(() => loadWatchlists(throwing)).not.toThrow();
    expect(saveWatchlists(loadWatchlists(throwing), throwing)).toBe(false);
  });

  it("sanitises lists and keeps a valid active id", () => {
    expect(sanitizeState({ lists: [] })).toBeNull();
    const s = sanitizeState({ activeId: "zzz", lists: [{ id: "a", name: "", symbols: ["infy"] }, { id: "a", name: "dup" }] });
    expect(s?.lists).toHaveLength(1);
    expect(s?.activeId).toBe("a");
    expect(s?.lists[0]).toEqual({ id: "a", name: "Watchlist 1", symbols: ["INFY"] });
  });

  it("creates, renames, edits and deletes named lists", () => {
    let s = loadWatchlists(new MemoryStorage());
    s = createList(s, "  Banks ");
    expect(activeList(s).name).toBe("Banks");
    s = updateActive(s, (l) => [...l, "SBIN"]);
    expect(activeList(s).symbols).toEqual(["SBIN"]);
    s = renameList(s, s.activeId, "PSU banks");
    expect(activeList(s).name).toBe("PSU banks");
    expect(renameList(s, s.activeId, "   ")).toBe(s);
    const id = s.activeId;
    s = deleteList(s, id);
    expect(s.lists.find((l) => l.id === id)).toBeUndefined();
    expect(deleteList(s, s.activeId)).toBe(s); // never deletes the last list
  });
});

describe("validation", () => {
  const universe = buildUniverse(["NEWLISTING"]);

  it("accepts known symbols and live extras", () => {
    expect(validateSymbol(" infy ", universe, [])).toEqual({ ok: true, symbol: "INFY" });
    expect(validateSymbol("newlisting", universe, [])).toEqual({ ok: true, symbol: "NEWLISTING" });
    expect(validateSymbol("SENSEX", universe, [])).toMatchObject({ ok: true });
  });

  it("maps renamed symbols", () => {
    expect(validateSymbol("ZOMATO", universe, [])).toEqual({ ok: true, symbol: "ETERNAL", renamedFrom: "ZOMATO" });
  });

  it("rejects empty, malformed and duplicate input", () => {
    expect(validateSymbol("", universe, [])).toMatchObject({ ok: false, reason: "empty" });
    expect(validateSymbol("$$", universe, [])).toMatchObject({ ok: false, reason: "format" });
    expect(validateSymbol("INFY", universe, ["INFY"])).toMatchObject({ ok: false, reason: "duplicate" });
  });

  it("suggests close matches for typos", () => {
    const r = validateSymbol("RELIANC", universe, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.suggestions[0]).toBe("RELIANCE");
    const r2 = validateSymbol("HDFCBNK", universe, []);
    if (!r2.ok) expect(r2.suggestions).toContain("HDFCBANK");
    expect(suggestSymbols("", universe)).toEqual([]);
  });

  it("computes edit distance with an early exit", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("abc", "abc")).toBe(0);
    expect(editDistance("a", "abcdef", 2)).toBe(3);
  });
});

describe("sorting", () => {
  const row = (symbol: string, changePercent: number, hasData = true): SortableRow => ({ symbol, ltp: 1, change: 0, changePercent, volume: 0, oi: 0, oiChange: 0, hasData });
  const rows = [row("B", 2), row("A", -1), row("Z", 0, false), row("C", 5)];

  it("sorts numerically and keeps empty rows last", () => {
    expect(sortRows(rows, "changePercent", "desc").map((r) => r.symbol)).toEqual(["C", "B", "A", "Z"]);
    expect(sortRows(rows, "changePercent", "asc").map((r) => r.symbol)).toEqual(["A", "B", "C", "Z"]);
    expect(sortRows(rows, "symbol", "asc").map((r) => r.symbol)).toEqual(["A", "B", "C", "Z"]);
    expect(sortRows(rows, null, "asc")).toEqual(rows);
  });

  it("cycles header sort states", () => {
    let s = nextSort({ key: null, dir: "desc" }, "ltp");
    expect(s).toEqual({ key: "ltp", dir: "desc" });
    s = nextSort(s, "ltp");
    expect(s).toEqual({ key: "ltp", dir: "asc" });
    s = nextSort(s, "ltp");
    expect(s.key).toBeNull();
    expect(nextSort({ key: null, dir: "desc" }, "symbol")).toEqual({ key: "symbol", dir: "asc" });
  });
});
