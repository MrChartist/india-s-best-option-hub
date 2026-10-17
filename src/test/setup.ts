import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; the "lib" project runs in plain Node
// where `window` does not exist at all.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  });
}

/**
 * Minimal Web Storage shim for the Node ("lib") project, so pure modules that
 * persist settings (localStorage/sessionStorage) can be unit-tested without a
 * DOM. Tests that need `document`, IndexedDB or layout should use jsdom.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof window === "undefined") {
  const g = globalThis as { localStorage?: Storage; sessionStorage?: Storage };
  // Node 22+ may expose an experimental, non-functional localStorage getter.
  const hasWorkingStorage = (s: Storage | undefined): boolean => {
    try {
      return typeof s?.getItem === "function";
    } catch {
      return false;
    }
  };
  if (!hasWorkingStorage(g.localStorage)) {
    Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true, writable: true });
  }
  if (!hasWorkingStorage(g.sessionStorage)) {
    Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true, writable: true });
  }
}
