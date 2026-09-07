import "@testing-library/jest-dom";

// jsdom's window.localStorage is undefined under this Node/Vitest combo — Node's
// own experimental global Web Storage (gated behind --localstorage-file) shadows
// it without ever throwing, it just evaluates to undefined. Polyfill an in-memory
// Storage so any localStorage-backed lib (trendingOiStore, positionStore, alertStore)
// behaves the same under test as it does in a real browser.
if (!window.localStorage) {
  const backing = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem: (key) => (backing.has(key) ? backing.get(key)! : null),
    setItem: (key, value) => { backing.set(key, String(value)); },
    removeItem: (key) => { backing.delete(key); },
    clear: () => { backing.clear(); },
    key: (index) => Array.from(backing.keys())[index] ?? null,
    get length() { return backing.size; },
  };
  Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true, writable: true });
  Object.defineProperty(globalThis, "localStorage", { value: memoryStorage, configurable: true, writable: true });
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
