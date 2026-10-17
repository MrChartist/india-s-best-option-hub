/**
 * Generic disk + in-memory cache for slow-changing datasets (broker instrument /
 * symbol masters). These files are large (MBs) and only change once a day, so
 * every broker module shares this instead of re-downloading per option-chain request.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, "../../.cache");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

const memCache = new Map();

// In-flight fetch de-dup: without this, N concurrent cache-miss callers for the
// same key (e.g. several symbols all needing the same instrument master right
// after it expires) would each kick off their own multi-MB download/parse —
// defeating the whole point of this shared cache and hammering the upstream host.
const inflight = new Map();

function keyToFilename(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

/** Get-or-fetch a JSON-serializable dataset, cached in-memory + on-disk with a TTL. */
export async function getCachedOrFetch(key, fetchFn, ttlMs) {
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.timestamp < ttlMs) return mem.data;

  // Another caller is already fetching this exact key — await that instead of
  // starting a redundant download.
  const pending = inflight.get(key);
  if (pending) return pending;

  const filepath = join(CACHE_DIR, keyToFilename(key));
  if (existsSync(filepath)) {
    try {
      const raw = JSON.parse(readFileSync(filepath, "utf-8"));
      if (raw?.data && Date.now() - raw.timestamp < ttlMs) {
        memCache.set(key, raw);
        return raw.data;
      }
    } catch { /* corrupt cache file — refetch */ }
  }

  const fetchPromise = (async () => {
    try {
      const data = await fetchFn();
      const entry = { data, timestamp: Date.now() };
      memCache.set(key, entry);
      try { writeFileSync(filepath, JSON.stringify(entry), "utf-8"); } catch { /* best-effort */ }
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, fetchPromise);
  return fetchPromise;
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
