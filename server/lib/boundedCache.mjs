/**
 * A small in-memory cache for broker sessions keyed by a credential hash: entries expire at their own `expiresAt`
 * and the map never holds more than `maxEntries` (the least recently used entry is evicted first). Keeps a caller
 * who sends many different credential headers from growing proxy memory without bound.
 *
 * Map-compatible for the calls the adapters make: get, set, has, delete, clear, size, values, entries, iteration.
 */
export function createSessionCache({ maxEntries = 64, expiryOf = (v) => v?.expiresAt, now = () => Date.now() } = {}) {
  const map = new Map();

  const expired = (value) => {
    const at = Number(expiryOf(value));
    return Number.isFinite(at) && at > 0 && at <= now();
  };

  function prune() {
    for (const [k, v] of map) if (expired(v)) map.delete(k);
  }

  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      if (expired(value)) { map.delete(key); return undefined; }
      map.delete(key); // refresh recency
      map.set(key, value);
      return value;
    },
    has(key) { return this.get(key) !== undefined; },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      if (map.size > maxEntries) prune();
      while (map.size > maxEntries) map.delete(map.keys().next().value);
      return this;
    },
    delete(key) { return map.delete(key); },
    clear() { map.clear(); },
    get size() { return map.size; },
    keys() { return map.keys(); },
    values() { return map.values(); },
    entries() { return map.entries(); },
    [Symbol.iterator]() { return map[Symbol.iterator](); },
  };
}

/** A Set capped at `maxEntries` (oldest dropped first), for "this credential set is spent" markers. */
export function createBoundedSet({ maxEntries = 256 } = {}) {
  const set = new Set();
  return {
    add(value) {
      set.delete(value);
      set.add(value);
      while (set.size > maxEntries) set.delete(set.values().next().value);
      return this;
    },
    has(value) { return set.has(value); },
    delete(value) { return set.delete(value); },
    clear() { set.clear(); },
    get size() { return set.size; },
    values() { return set.values(); },
    [Symbol.iterator]() { return set[Symbol.iterator](); },
  };
}
