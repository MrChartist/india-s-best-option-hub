/**
 * Shared in-memory + disk cache used by all broker adapters and other proxies.
 * Extracted from proxy-server.mjs without behavior change.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const cache = new Map();
const lastGoodCache = new Map();
const LAST_GOOD_TTL = 18 * 60 * 60 * 1000; // 18 hours

let CACHE_DIR = "";

export function initCacheDir(dirname) {
  CACHE_DIR = resolve(dirname, ".cache");
  try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

  // Rehydrate lastGoodCache from disk on startup
  try {
    const files = readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(CACHE_DIR, file), "utf-8"));
        if (raw?.data && raw?.timestamp && Date.now() - raw.timestamp < LAST_GOOD_TTL) {
          lastGoodCache.set(file.replace(/\.json$/, ""), raw);
        }
      } catch { /* skip corrupt entries */ }
    }
    if (lastGoodCache.size > 0) {
      console.log(`  📦 Rehydrated ${lastGoodCache.size} last-good cache entries from disk`);
    }
  } catch { /* .cache dir doesn't exist yet */ }
}

function diskCacheKeyToFilename(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

function setLastGoodToDisk(key, data) {
  if (!CACHE_DIR) return;
  try {
    const filepath = join(CACHE_DIR, diskCacheKeyToFilename(key));
    writeFileSync(filepath, JSON.stringify({ data, timestamp: Date.now() }), "utf-8");
  } catch (e) {
    console.warn(`  ⚠️ Failed to write cache to disk for ${key}:`, e.message);
  }
}

function getLastGoodFromDisk(key) {
  if (!CACHE_DIR) return null;
  try {
    const filepath = join(CACHE_DIR, diskCacheKeyToFilename(key));
    if (!existsSync(filepath)) return null;
    const raw = JSON.parse(readFileSync(filepath, "utf-8"));
    if (raw && raw.data && raw.timestamp && Date.now() - raw.timestamp < LAST_GOOD_TTL) {
      return raw;
    }
  } catch { /* ignore corrupt files */ }
  return null;
}

export function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

export function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function setLastGood(key, data) {
  const diskKey = diskCacheKeyToFilename(key);
  lastGoodCache.set(diskKey, { data, timestamp: Date.now() });
  setLastGoodToDisk(key, data);
}

export function getLastGood(key) {
  const diskKey = diskCacheKeyToFilename(key);
  const entry = lastGoodCache.get(diskKey);
  if (entry && Date.now() - entry.timestamp < LAST_GOOD_TTL) return entry;
  if (entry) lastGoodCache.delete(diskKey);

  const diskEntry = getLastGoodFromDisk(key);
  if (diskEntry) {
    lastGoodCache.set(diskKey, diskEntry);
    return diskEntry;
  }
  return null;
}

export const cacheCtx = { getCached, setCache, getLastGood, setLastGood };
