/**
 * Local proxy server for the Mr. Chartist Options Terminal.
 *
 *   1. HTTP proxy to Dhan API v2, NSE India (www + archives) and Yahoo Finance,
 *      with CORS handled, caching, request coalescing, rate queues and last-good fallbacks.
 *   2. Envelope routes under /api/x/* that always answer { data, meta: { source, asOf, stale, reason? } }.
 *      Row shapes are documented in docs/DATA_ENDPOINTS.md.
 *   3. WebSocket relay: connects to the Dhan live market feed, parses the binary packets and
 *      broadcasts JSON ticks to browser clients on ws://127.0.0.1:4002/ws. Every tick is published
 *      to the in-process tickBus (server-side risk engine) before the browser fan-out.
 *   4. 1Cliq trading endpoints on /api/dhan-proxy?endpoint=… (orders, portfolio, risk engine, panic
 *      layer, basket resolve; see SECTION 2b) and the generic multi-broker data proxy
 *      (/api/broker-proxy for every read capability an adapter declares, /api/broker-capabilities,
 *      /api/broker-test-connection; server/brokers/registry.mjs + brokerProxyRoutes.mjs), plus
 *      POST /api/broker-session-login for brokers that need a password/PIN + current TOTP code per
 *      session (server/brokers/sessionLogin.mjs; only the returned session token leaves the proxy).
 *
 * Security defaults: binds 127.0.0.1 (PROXY_HOST to change), CORS and WebSocket Origin allowlist
 * (localhost:8080/5173/4001 plus PROXY_ALLOWED_ORIGINS), Host-header allowlist against DNS
 * rebinding (loopback names, origin hosts, PROXY_ALLOWED_HOSTS), .env Dhan keys only for browser
 * or loopback callers, per-IP token bucket, strict input whitelists, upstream timeouts and
 * truncated error bodies. Trading endpoints additionally require POST + JSON for anything that
 * changes state, accept Origin-less (non-browser) callers only from loopback, and are never cached.
 * Session login has the same POST/JSON/loopback rules, a 4 KB body cap and its own 5-per-minute limiter.
 *
 * Usage:  npm run proxy   |   npm run dev:live
 * Env:    PROXY_PORT (4002), PROXY_HOST (127.0.0.1), PROXY_ALLOWED_ORIGINS (comma list),
 *         PROXY_ALLOWED_HOSTS (comma list of extra Host names),
 *         DHAN_CLIENT_ID, DHAN_ACCESS_TOKEN (optional; browser keys are sent per request instead),
 *         RECORD_SYMBOLS (comma list; turns on the snapshot recorder), RECORD_INTERVAL_SEC (60–180),
 *         RECORD_EXPIRIES (1–3), RECORD_RETENTION_DAYS (default 30), RECORD_DIR (default ./data/snapshots)
 */

import http from "node:http";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, mkdirSync, readdirSync, existsSync, unlinkSync, createReadStream, promises as fsp } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { WebSocketServer, WebSocket } from "ws";
import { createBrokerRegistry } from "./server/brokers/registry.mjs";
import { BrokerError, FORBIDDEN_SECRET_KEY } from "./server/brokers/contract.mjs";
import {
  BROKER_PROXY_ENDPOINTS, MARKET_TTL_MS, argsKey, capabilityMethod, describeAdapter, filterInstruments, hasBrokerData,
  parseBrokerArgs, parseInstrumentFilter, resolveBrokerEndpoint,
} from "./server/brokers/brokerProxyRoutes.mjs";
import { SESSION_LOGIN_BODY_LIMIT, createLoginRateLimiter, handleSessionLogin } from "./server/brokers/sessionLogin.mjs";
import { placeOrder as dhanPlaceOrder, getOrders as dhanGetOrders, getOrderStatus as dhanGetOrderStatus, cancelOrder as dhanCancelOrder } from "./server/lib/dhanOrders.mjs";
import { getPositions as dhanGetPositions, getHoldings as dhanGetHoldings, getFunds as dhanGetFunds, getTrades as dhanGetTrades, modifyOrder as dhanModifyOrder } from "./server/lib/dhanPortfolio.mjs";
import { validateOrder, recordOrder } from "./server/lib/orderGuard.mjs";
import * as tickBus from "./server/lib/tickBus.mjs";
import * as riskEngine from "./server/lib/riskEngine.mjs";
import * as panicLayer from "./server/lib/panicLayer.mjs";
import * as panicGate from "./server/lib/panicGate.mjs";
import * as tradingLockState from "./server/lib/tradingLockState.mjs";
import * as auditLog from "./server/lib/auditLog.mjs";
import * as basketEngine from "./server/lib/basketEngine.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (no external deps) ──
try {
  const envFile = readFileSync(resolve(__dirname, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env is optional */ }

const VERSION = "2.0.0";
const PORT = parseInt(process.env.PROXY_PORT || "4002", 10);
const HOST = process.env.PROXY_HOST || "127.0.0.1";
const DHAN_BASE = "https://api.dhan.co/v2";
const NSE_BASE = "https://www.nseindia.com";
const NSE_ARCHIVES = "https://nsearchives.nseindia.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULT_ORIGINS = [8080, 5173, 4001].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_ORIGINS,
  ...(process.env.PROXY_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
]);

// ══════════════════════════════════════════════
// ── SECTION 1: Utilities ──
// ══════════════════════════════════════════════

export function truncate(s, n = 200) {
  const str = String(s ?? "");
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UpstreamError extends Error {
  constructor(source, status, message, retryAfterMs = 0) {
    super(message);
    this.name = "UpstreamError";
    this.source = source;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parse a Retry-After header (seconds or HTTP date) into ms, capped at 10 minutes. */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return 0;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 600000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(Math.max(at - now, 0), 600000) : 0;
}

// ── True LRU cache ──
export class LRUCache {
  constructor(max = 500) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (Date.now() >= e.expiry) {
      this.map.delete(key);
      return null;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }
  set(key, value, ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiry: Date.now() + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  delete(key) {
    this.map.delete(key);
  }
  get size() {
    return this.map.size;
  }
}

const cache = new LRUCache(600);

// ── In-flight request coalescing ──
const inflight = new Map();
export function coalesce(key, fn) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ── Per-upstream rate queue (serialises calls with a minimum gap) ──
/**
 * Bounded: when `maxDepth` jobs are already waiting the call is rejected with a 429, and a job
 * that waited longer than `maxWaitMs` before its turn is dropped (its caller has most likely
 * timed out) instead of spending upstream quota.
 */
export class RateQueue {
  constructor(minIntervalMs, { maxDepth = Infinity, maxWaitMs = Infinity, source = "queue" } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxDepth = maxDepth;
    this.maxWaitMs = maxWaitMs;
    this.source = source;
    this.last = 0;
    this.pending = 0;
    this.chain = Promise.resolve();
  }
  get depth() {
    return this.pending;
  }
  schedule(fn) {
    if (this.pending >= this.maxDepth) {
      return Promise.reject(new UpstreamError(this.source, 429, `${this.source} queue full (${this.pending} waiting); retry shortly`, this.minIntervalMs));
    }
    this.pending++;
    const enqueuedAt = Date.now();
    const run = this.chain.then(async () => {
      try {
        if (Date.now() - enqueuedAt > this.maxWaitMs) {
          throw new UpstreamError(this.source, 429, `${this.source} queue wait exceeded ${Math.round(this.maxWaitMs / 1000)}s; request dropped`, this.minIntervalMs);
        }
        const wait = this.last + this.minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        this.last = Date.now();
      } finally {
        this.pending--;
      }
      return fn();
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

const queues = {
  dhanOC: new RateQueue(3000, { maxDepth: 8, maxWaitMs: 20000, source: "dhan" }), // Dhan option chain: 1 request per 3 s
  dhan: new RateQueue(250, { maxDepth: 80, maxWaitMs: 20000, source: "dhan" }),
  nse: new RateQueue(350),
  nseArchive: new RateQueue(300),
  yahoo: new RateQueue(150),
};

// ── Upstream health ──
const upstreamHealth = {
  dhan: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  nse: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  bse: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  yahoo: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
};

function markSuccess(source) {
  const h = upstreamHealth[source];
  if (h) h.lastSuccess = Date.now();
}

// 429 back-off windows, keyed by source plus endpoint family and credential tag (for example
// "dhan:oc:<tag>" or "nse:archive"), so one rate-limited endpoint or token does not block the rest.
const upstreamBlocks = new Map(); // blockKey → blockedUntil (ms)

function markFailure(source, err, blockKey = source) {
  const h = upstreamHealth[source];
  if (!h) return;
  h.lastFailure = Date.now();
  h.lastError = truncate(err?.message || String(err), 160);
  if (err?.retryAfterMs) {
    const until = Date.now() + err.retryAfterMs;
    upstreamBlocks.set(blockKey, until);
    h.blockedUntil = until; // informational (/health); the gate reads upstreamBlocks
  }
}

function blockedUntil(blockKey) {
  const until = upstreamBlocks.get(blockKey);
  if (!until) return 0;
  if (Date.now() >= until) {
    upstreamBlocks.delete(blockKey);
    return 0;
  }
  return until;
}

/** Back-off for an upstream error response: only 429s block, and an explicit Retry-After (even 0) is respected. */
export function retryAfterMsFor(status, retryAfterHeader) {
  if (status !== 429) return 0;
  if (retryAfterHeader === null || retryAfterHeader === undefined || String(retryAfterHeader).trim() === "") return 60000;
  const secs = Number(retryAfterHeader);
  if (Number.isFinite(secs) || Number.isFinite(Date.parse(retryAfterHeader))) return parseRetryAfter(retryAfterHeader);
  return 60000;
}

/**
 * fetch() with a timeout, health tracking, Retry-After handling and truncated error bodies.
 * Returns the Response on 2xx; throws UpstreamError otherwise. `blockKey` scopes the 429 back-off.
 */
export async function upstreamFetch(source, url, init = {}, timeoutMs = 15000, blockKey = source) {
  const until = blockedUntil(blockKey);
  if (until) {
    throw new UpstreamError(source, 429, `${source} rate-limited; retry after ${Math.ceil((until - Date.now()) / 1000)}s`, until - Date.now());
  }
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = new UpstreamError(source, 0, e?.name === "TimeoutError" ? `${source} timed out after ${timeoutMs} ms` : `${source} unreachable: ${truncate(e?.message, 120)}`);
    markFailure(source, err, blockKey);
    throw err;
  }
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    const retryAfterMs = retryAfterMsFor(res.status, res.headers.get("retry-after"));
    const clean = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const err = new UpstreamError(source, res.status, `${source} HTTP ${res.status}: ${truncate(clean, 160)}`, retryAfterMs);
    markFailure(source, err, blockKey);
    throw err;
  }
  return res;
}

// ── Last-good store (memory + disk, atomic writes) ──
const LAST_GOOD_TTL = 18 * 60 * 60 * 1000;
const LONG_LAST_GOOD_TTL = 14 * 24 * 60 * 60 * 1000; // immutable archive files
const CACHE_DIR = resolve(__dirname, ".cache");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

// Bounded: keys include user-controlled values (chain-multi expiry lists, dates), so memory and
// the .cache directory are capped. Least recently used entries are evicted, file included.
const LAST_GOOD_MAX = 600;
// Disk writes are async and throttled per key: a 3 s option-chain poll persists at most once a minute.
const LAST_GOOD_PERSIST_MS = 60 * 1000;
const lastGood = new Map();
const lgPersistedAt = new Map(); // key → last disk write time
const lgDirty = new Map(); // key → entry waiting for its throttle window
const lgWriteQueue = new Map(); // key → entry ready to write
let lgWriting = false;

function lgFile(key) {
  return join(CACHE_DIR, `${key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180)}.json`);
}

function lgTtl(key) {
  return key.startsWith("archive:") ? LONG_LAST_GOOD_TTL : LAST_GOOD_TTL;
}

function lgRemoveFile(key) {
  fsp.unlink(lgFile(key)).catch(() => undefined);
}

/** Insert into the in-memory LRU, evicting (and deleting the file of) the oldest entries. */
function rememberLastGood(key, entry) {
  if (lastGood.has(key)) lastGood.delete(key);
  lastGood.set(key, entry);
  while (lastGood.size > LAST_GOOD_MAX) {
    const oldest = lastGood.keys().next().value;
    lastGood.delete(oldest);
    lgPersistedAt.delete(oldest);
    lgDirty.delete(oldest);
    lgWriteQueue.delete(oldest);
    lgRemoveFile(oldest);
  }
}

async function drainLastGoodWrites() {
  if (lgWriting) return;
  lgWriting = true;
  try {
    while (lgWriteQueue.size > 0) {
      const [key, entry] = lgWriteQueue.entries().next().value;
      lgWriteQueue.delete(key);
      const file = lgFile(key);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await fsp.writeFile(tmp, JSON.stringify(entry), "utf-8");
        await fsp.rename(tmp, file);
        // Evicted while the write was in flight: do not leave an orphan file behind.
        if (!lastGood.has(key)) lgRemoveFile(key);
      } catch (e) {
        fsp.unlink(tmp).catch(() => undefined);
        console.warn(`  ⚠️ Could not persist last-good ${truncate(key, 60)}: ${truncate(e.message, 80)}`);
      }
    }
  } finally {
    lgWriting = false;
  }
}

function persistLastGood(key, entry) {
  lgDirty.delete(key);
  lgPersistedAt.set(key, Date.now());
  lgWriteQueue.set(key, entry);
  void drainLastGoodWrites();
}

function setLastGood(key, data, source) {
  const entry = { key, data, source, timestamp: Date.now() };
  rememberLastGood(key, entry);
  const last = lgPersistedAt.get(key) || 0;
  if (Date.now() - last >= LAST_GOOD_PERSIST_MS) persistLastGood(key, entry);
  else lgDirty.set(key, entry); // flushed by the interval below
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of lgDirty) {
    if (now - (lgPersistedAt.get(key) || 0) >= LAST_GOOD_PERSIST_MS) persistLastGood(key, entry);
  }
}, 15000).unref();

function getLastGood(key) {
  const mem = lastGood.get(key);
  if (mem && Date.now() - mem.timestamp < lgTtl(key)) return mem;
  if (mem) lastGood.delete(key);
  try {
    const file = lgFile(key);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    if (raw?.key === key && raw.data !== undefined && Date.now() - raw.timestamp < lgTtl(key)) {
      rememberLastGood(key, raw);
      return raw;
    }
  } catch { /* corrupt file */ }
  return null;
}

// Rehydrate from disk using the key stored inside each file (not the sanitised filename).
// Expired, corrupt and over-cap files are deleted so the directory cannot grow without limit.
try {
  const found = [];
  for (const f of readdirSync(CACHE_DIR)) {
    const full = join(CACHE_DIR, f);
    if (f.endsWith(".tmp")) { try { unlinkSync(full); } catch { /* ignore */ } continue; }
    if (!f.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(full, "utf-8"));
      if (typeof raw?.key === "string" && raw.data !== undefined && Date.now() - raw.timestamp < lgTtl(raw.key)) found.push(raw);
      else unlinkSync(full);
    } catch {
      try { unlinkSync(full); } catch { /* ignore */ }
    }
  }
  found.sort((a, b) => a.timestamp - b.timestamp); // oldest first, so the LRU evicts them first
  for (const raw of found) {
    rememberLastGood(raw.key, raw);
    lgPersistedAt.set(raw.key, raw.timestamp);
  }
  if (lastGood.size > 0) console.log(`  📦 Rehydrated ${lastGood.size} last-good entries from disk`);
} catch { /* first run */ }

// ── Per-IP token bucket ──
const buckets = new Map();
const BUCKET_CAPACITY = 80;
const BUCKET_REFILL_PER_SEC = 25;

export function takeToken(ip, now = Date.now(), store = buckets) {
  let b = store.get(ip);
  if (!b) {
    b = { tokens: BUCKET_CAPACITY, ts: now };
    store.set(ip, b);
  }
  b.tokens = Math.min(BUCKET_CAPACITY, b.tokens + ((now - b.ts) / 1000) * BUCKET_REFILL_PER_SEC);
  b.ts = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [ip, b] of buckets) if (b.ts < cutoff) buckets.delete(ip);
}, 60000).unref();

// ── Input whitelists ──
export class InputError extends Error {}

const SYMBOL_RE = /^[A-Z0-9&-]{1,20}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const NSE_DATE_RE = /^\d{1,2}-[A-Za-z]{3}-\d{4}$/;
const INTERVALS = new Set(["1", "5", "15", "25", "60", "D"]);
const SEGMENTS = new Set(["IDX_I", "NSE_EQ", "NSE_FNO", "BSE_EQ", "BSE_FNO", "NSE_CURRENCY", "BSE_CURRENCY", "MCX_COMM"]);
const INSTRUMENTS = new Set(["INDEX", "EQUITY", "FUTIDX", "FUTSTK", "OPTIDX", "OPTSTK", "FUTCUR", "OPTCUR"]);

export function vSymbol(v, fallback) {
  const s = String(v ?? fallback ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(s)) throw new InputError(`Invalid symbol: ${truncate(v, 30)}`);
  return s;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "21-Oct-2025" | "2025-10-21" → "2025-10-21"; "" when unparseable. */
export function toIso(input) {
  const s = String(input ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}

/** "2025-10-21" → "21-Oct-2025" (NSE API format). */
export function isoToNse(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MON_NAMES[mo - 1]}-${y}`;
}

export function vExpiry(v, { optional = true } = {}) {
  if (v === null || v === undefined || v === "") {
    if (optional) return "";
    throw new InputError("Missing expiry");
  }
  const s = String(v).trim();
  if (!ISO_RE.test(s) && !NSE_DATE_RE.test(s)) throw new InputError(`Invalid expiry: ${truncate(v, 30)}`);
  const iso = toIso(s);
  if (!iso) throw new InputError(`Invalid expiry: ${truncate(v, 30)}`);
  return iso;
}

export function vDate(v, { optional = true } = {}) {
  if (v === null || v === undefined || v === "") {
    if (optional) return "";
    throw new InputError("Missing date");
  }
  const s = String(v).trim();
  if (!ISO_RE.test(s)) throw new InputError(`Invalid date (use yyyy-mm-dd): ${truncate(v, 30)}`);
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new InputError(`Invalid date: ${s}`);
  return s;
}

export function vInt(v, { min, max, fallback }) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`Expected an integer between ${min} and ${max}`);
  return n;
}

function vEnum(v, set, fallback, label) {
  const s = v === null || v === undefined || v === "" ? fallback : String(v);
  if (!set.has(s)) throw new InputError(`Invalid ${label}: ${truncate(v, 20)}`);
  return s;
}

function vDateTime(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw new InputError("Invalid date/time (use yyyy-mm-dd or yyyy-mm-dd HH:MM)");
  return s;
}

// ── IST calendar helpers ──
export function istNow(now = new Date()) {
  const d = new Date(now.getTime() + 330 * 60000);
  return { iso: d.toISOString().slice(0, 10), hh: d.getUTCHours(), mm: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

export function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Weekdays on or before `fromIso`, newest first. */
export function recentWeekdays(fromIso, count) {
  const out = [];
  let d = fromIso;
  for (let i = 0; out.length < count && i < count * 2 + 10; i++) {
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6) out.push(d);
    d = addDaysIso(d, -1);
  }
  return out;
}

const ddmmyyyy = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
const ddDashMmDashYyyy = (iso) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

// ── CSV and ZIP helpers ──

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Extract the first file from a ZIP buffer (stored or deflated) using the central directory. */
export function unzipFirst(buf, pattern = /\.csv$/i) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let chosen = null;
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (!chosen || (pattern.test(name) && !pattern.test(chosen.name))) chosen = { method, compSize, localOffset, name };
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!chosen) throw new Error("Empty ZIP");
  const lo = chosen.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error("Bad ZIP local header");
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const data = buf.subarray(start, start + chosen.compSize);
  if (chosen.method === 0) return data.toString("utf8");
  if (chosen.method === 8) return inflateRawSync(data).toString("utf8");
  throw new Error(`Unsupported ZIP compression method ${chosen.method}`);
}

// ══════════════════════════════════════════════
// ── SECTION 2: Dhan REST API ──
// ══════════════════════════════════════════════

// Dhan IDX_I security ids (verify against the Dhan scrip master).
const INDEX_SECURITY_IDS = {
  NIFTY: 13,
  BANKNIFTY: 25,
  FINNIFTY: 27,
  MIDCPNIFTY: 442,
  INDIAVIX: 21,
  SENSEX: 51,
  BANKEX: 69,
};

const UNDERLYING_MAP = {
  NIFTY: { underlyingScrip: 13, seg: "IDX_I" },
  BANKNIFTY: { underlyingScrip: 25, seg: "IDX_I" },
  FINNIFTY: { underlyingScrip: 27, seg: "IDX_I" },
  MIDCPNIFTY: { underlyingScrip: 442, seg: "IDX_I" },
  SENSEX: { underlyingScrip: 51, seg: "IDX_I" },
  BANKEX: { underlyingScrip: 69, seg: "IDX_I" },
};

const CLIENT_ID_RE = /^[A-Za-z0-9]{3,32}$/;
const TOKEN_RE = /^[A-Za-z0-9._-]{20,4096}$/;

function resolveDhanCreds(clientId, accessToken) {
  const c = clientId || process.env.DHAN_CLIENT_ID || "";
  const t = accessToken || process.env.DHAN_ACCESS_TOKEN || "";
  if (!c || !t) return null;
  if (!CLIENT_ID_RE.test(c) || !TOKEN_RE.test(t)) throw new InputError("Dhan credentials have an invalid format");
  return { clientId: c, accessToken: t };
}

/**
 * Short, non-reversible tag for a credential pair. Dhan cache, in-flight and last-good keys carry
 * it so a caller never receives data fetched with someone else's token.
 */
export function credTag(creds) {
  if (!creds) return "";
  return createHash("sha256").update(`${creds.clientId}:${creds.accessToken}`).digest("hex").slice(0, 12);
}

async function dhanFetch(path, body, creds, { queue = queues.dhan, timeoutMs = 15000 } = {}) {
  if (!creds) throw new UpstreamError("dhan", 401, "Dhan credentials not configured (Broker settings or .env)");
  // Back off per endpoint family and credential pair: an option-chain 429 (1 request per 3 s) for
  // one token must not block LTP, history or other users' tokens.
  const blockKey = `dhan:${queue === queues.dhanOC ? "oc" : "api"}:${credTag(creds)}`;
  return queue.schedule(async () => {
    const res = await upstreamFetch("dhan", `${DHAN_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": creds.accessToken, "client-id": creds.clientId },
      body: JSON.stringify(body),
    }, timeoutMs, blockKey);
    const json = await res.json();
    if (json?.status === "failure" || json?.errorCode) {
      const err = new UpstreamError("dhan", 400, `Dhan: ${truncate(json.errorMessage || json.remarks || json.errorCode || "request failed", 160)}`);
      markFailure("dhan", err);
      throw err;
    }
    markSuccess("dhan");
    return json;
  });
}

async function dhanExpiryList(symbol, creds) {
  const u = UNDERLYING_MAP[symbol];
  if (!u) throw new InputError(`Unsupported symbol for Dhan: ${symbol}. Supported: ${Object.keys(UNDERLYING_MAP).join(", ")}`);
  if (!creds) throw new UpstreamError("dhan", 401, "Dhan credentials not configured (Broker settings or .env)");
  const tag = credTag(creds);
  const key = `dhan:expiry:${tag}:${symbol}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const json = await dhanFetch("/optionchain/expirylist", { UnderlyingScrip: u.underlyingScrip, UnderlyingSeg: u.seg }, creds);
    const list = Array.isArray(json?.data) ? json.data.map(toIso).filter(Boolean).sort() : [];
    const out = { status: "success", data: list };
    if (list.length > 0) {
      cache.set(key, out, 300000);
      setLastGood(`lastgood:dhan:expiry:${tag}:${symbol}`, out, "dhan");
    }
    return out;
  });
}

async function dhanOptionChain(symbol, expiry, creds) {
  const u = UNDERLYING_MAP[symbol];
  if (!u) throw new InputError(`Unsupported symbol for Dhan: ${symbol}`);
  if (!creds) throw new UpstreamError("dhan", 401, "Dhan credentials not configured (Broker settings or .env)");
  let exp = expiry;
  if (!exp) {
    const list = await dhanExpiryList(symbol, creds);
    exp = list.data[0];
    if (!exp) throw new UpstreamError("dhan", 404, "Dhan returned no expiries");
  }
  const tag = credTag(creds);
  const key = `dhan:oc:${tag}:${symbol}:${exp}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const json = await dhanFetch("/optionchain", { UnderlyingScrip: u.underlyingScrip, UnderlyingSeg: u.seg, Expiry: exp }, creds, { queue: queues.dhanOC });
    const oc = json?.data?.oc;
    if (!oc || Object.keys(oc).length === 0) throw new UpstreamError("dhan", 204, "Dhan returned an empty option chain");
    const out = { status: "success", data: json.data, expiry: exp };
    cache.set(key, out, 3000);
    setLastGood(`lastgood:dhan:oc:${tag}:${symbol}:${exp}`, out, "dhan");
    return out;
  });
}

function dhanErrorPayload(e) {
  return { status: "error", reason: truncate(e?.message || "Dhan request failed", 240) };
}

const DHAN_CRED_ENDPOINTS = new Set(["option-chain", "expiry-list", "ltp", "historical"]);

async function handleDhanProxy(params, creds) {
  const endpoint = params.get("endpoint");
  // Answer before touching any cache: cached Dhan data belongs to whoever fetched it.
  if (!creds && DHAN_CRED_ENDPOINTS.has(endpoint)) {
    return { status: 401, body: { status: "error", reason: "Dhan credentials not configured (Broker settings or .env)" } };
  }
  const tag = credTag(creds);
  switch (endpoint) {
    case "option-chain": {
      const symbol = vSymbol(params.get("symbol"), "NIFTY");
      const expiry = vExpiry(params.get("expiry"));
      try {
        return { status: 200, body: await dhanOptionChain(symbol, expiry, creds) };
      } catch (e) {
        if (e instanceof InputError) throw e;
        const lgKey = expiry ? `lastgood:dhan:oc:${tag}:${symbol}:${expiry}` : null;
        let lg = lgKey ? getLastGood(lgKey) : null;
        if (!lg && !expiry) {
          const exp = getLastGood(`lastgood:dhan:expiry:${tag}:${symbol}`)?.data?.data?.[0];
          if (exp) lg = getLastGood(`lastgood:dhan:oc:${tag}:${symbol}:${exp}`);
        }
        if (lg) return { status: 200, body: { ...lg.data, stale: true, afterHours: true, cachedAt: lg.timestamp, reason: truncate(e.message, 160) } };
        return { status: 502, body: dhanErrorPayload(e) };
      }
    }
    case "expiry-list": {
      const symbol = vSymbol(params.get("symbol"), "NIFTY");
      try {
        return { status: 200, body: await dhanExpiryList(symbol, creds) };
      } catch (e) {
        if (e instanceof InputError) throw e;
        const lg = getLastGood(`lastgood:dhan:expiry:${tag}:${symbol}`);
        if (lg) return { status: 200, body: { ...lg.data, stale: true, cachedAt: lg.timestamp } };
        return { status: 502, body: dhanErrorPayload(e) };
      }
    }
    case "ltp": {
      const symbol = vSymbol(params.get("symbol"), "NIFTY");
      const secId = INDEX_SECURITY_IDS[symbol];
      if (!secId) throw new InputError(`Unknown index: ${symbol}`);
      const key = `dhan:ltp:${tag}:${symbol}`;
      const hit = cache.get(key);
      if (hit) return { status: 200, body: hit };
      try {
        const json = await coalesce(key, () => dhanFetch("/marketfeed/ltp", { IDX_I: [secId] }, creds));
        cache.set(key, json, 2000);
        return { status: 200, body: json };
      } catch (e) {
        return { status: 502, body: dhanErrorPayload(e) };
      }
    }
    case "instruments":
      return { status: 200, body: await instrumentMaster() };
    case "historical": {
      const secId = String(params.get("securityId") || "");
      if (!/^\d{1,10}$/.test(secId)) throw new InputError("Invalid securityId");
      const exchSeg = vEnum(params.get("exchangeSegment"), SEGMENTS, "IDX_I", "exchangeSegment");
      const instrument = vEnum(params.get("instrument"), INSTRUMENTS, "INDEX", "instrument");
      const interval = vEnum(params.get("interval"), INTERVALS, "5", "interval");
      const fromDate = vDateTime(params.get("fromDate"));
      const toDate = vDateTime(params.get("toDate"));
      try {
        return { status: 200, body: await dhanHistorical({ secId, exchSeg, instrument, interval, fromDate, toDate }, creds) };
      } catch (e) {
        return { status: 502, body: dhanErrorPayload(e) };
      }
    }
    default:
      throw new InputError("Unknown endpoint. Use: option-chain, expiry-list, ltp, instruments, historical");
  }
}

// ══════════════════════════════════════════════
// ── SECTION 2b: Trading — orders, portfolio, risk engine, panic layer, baskets (1Cliq) ──
// ══════════════════════════════════════════════
//
// Real money. These endpoints never use the response cache, the in-flight coalescer or the
// last-good store: a failed request must surface the broker's real error verbatim, and a stale
// Funds/Positions figure in an execution terminal is the worst available failure mode
// (1CLIQ-TRADE-SPEC.md §10). They answer on /api/dhan-proxy?endpoint=<name> and go through the
// same Host allowlist, Origin allowlist and per-IP token bucket as every other route, plus:
//   - mutating endpoints are POST-only with a JSON body (order details never ride in a URL);
//   - a request without an Origin header (non-browser client) is accepted only from loopback;
//   - Dhan credentials come from resolveDhanCreds() under the same .env policy as data routes,
//     and are passed explicitly to server/** (server/brokers/dhan.mjs has no .env fallback).

/** Endpoints that change state. POST only, JSON body. */
export const TRADE_POST_ENDPOINTS = new Set([
  "place-order", "cancel-order", "modify-order", "basket-deploy",
  "risk-arm", "risk-disarm", "panic-close-all", "panic-cancel-all", "panic-set-lock",
]);
/** Read-only trading endpoints. GET. Never cached. */
export const TRADE_GET_ENDPOINTS = new Set([
  "orders", "order-status", "positions", "holdings", "funds", "trades", "risk-status", "panic-lock-state",
]);
/** Trading endpoints that never touch the broker (in-process risk engine / lock state). */
const TRADE_NO_CREDS = new Set(["risk-status", "risk-arm", "risk-disarm", "panic-lock-state", "panic-set-lock"]);

const ORDER_ID_RE = /^[A-Za-z0-9-]{1,40}$/;
const tickKeyOf = (segment, securityId) => `${segment}:${securityId}`;
const TRADE_BODY_LIMIT = 64 * 1024;

class TradeError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Read and parse a JSON request body (64 KB cap). Rejects non-JSON content types. */
export function readJsonBody(req, limit = TRADE_BODY_LIMIT) {
  return new Promise((resolvePromise, rejectPromise) => {
    const type = String(req.headers["content-type"] || "").toLowerCase();
    if (!type.startsWith("application/json")) {
      rejectPromise(new TradeError(415, "UNSUPPORTED_MEDIA_TYPE", "Send a JSON body (Content-Type: application/json)"));
      req.resume();
      return;
    }
    let raw = "";
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        rejectPromise(new TradeError(413, "BODY_TOO_LARGE", "Request body too large"));
        req.resume();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      if (!raw) return resolvePromise({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        resolvePromise(parsed);
      } catch {
        rejectPromise(new TradeError(400, "BAD_JSON", "Invalid JSON body"));
      }
    });
    req.on("error", (e) => {
      if (done) return;
      done = true;
      rejectPromise(e);
    });
  });
}

function vOrderId(v) {
  const s = String(v ?? "");
  if (!ORDER_ID_RE.test(s)) throw new InputError("Invalid orderId");
  return s;
}

// ── Panic-layer wiring (1CLIQ-TRADE-SPEC.md §5) ──
// server/lib/panicLayer.mjs is broker-agnostic (injected executor/fetcher functions). These are the
// translation layer onto this account's real Dhan book, and the only place Dhan-specific
// position/order shapes are read for the panic path.

const DHAN_OPEN_ORDER_STATUSES = new Set(["TRANSIT", "PENDING", "PART_TRADED"]);

/** Dhan's own open-orders view: "open" means still resting, not yet terminal. */
async function fetchDhanOpenOrders(creds) {
  const orders = await dhanGetOrders(creds);
  return (Array.isArray(orders) ? orders : []).filter((o) => DHAN_OPEN_ORDER_STATUSES.has(o?.orderStatus));
}

/**
 * Map one Dhan GET /positions record onto panicLayer's OpenPosition shape. `netQty` is signed
 * exchange quantity, `multiplier` the contract's lot size, `drvOptionType` ("CALL"/"PUT") is
 * present only for option legs (Dhan v2 portfolio docs).
 */
function mapDhanPositionToOpenPosition(p) {
  const netQty = Number(p.netQty) || 0;
  const lotSize = Number(p.multiplier) > 0 ? Number(p.multiplier) : 1;
  const assetClass = p.drvOptionType === "CALL" || p.drvOptionType === "PUT"
    ? "OPTION"
    : String(p.exchangeSegment || "").includes("FNO") ? "FUTURE" : "EQUITY";
  return {
    id: `${p.exchangeSegment}:${p.securityId}`,
    securityId: p.securityId,
    exchangeSegment: p.exchangeSegment,
    productType: p.productType,
    assetClass,
    netQty,
    lotSize,
    lots: Math.max(1, Math.round(Math.abs(netQty) / lotSize)),
    unrealisedPnl: Number(p.unrealizedProfit) || 0,
  };
}

/** Every currently open (non-flat, non-CLOSED) position on this Dhan account. */
async function fetchDhanOpenPositions(creds) {
  const raw = await dhanGetPositions(creds);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return list
    .filter((p) => p?.positionType !== "CLOSED" && Number(p?.netQty) !== 0)
    .map(mapDhanPositionToOpenPosition);
}

/**
 * panicLayer's orderExecutor for real Dhan close orders. Reuses dhanOrders.mjs's placeOrder() (the
 * exact path "place-order" uses), so lot size only ever comes from a resolved value. MARKET/IOC is
 * the panic-specific override from spec §5.
 */
function makeDhanCloseExecutor(creds) {
  return async function dhanCloseExecutor(intent) {
    const order = {
      transactionType: intent.transactionType,
      exchangeSegment: intent.exchangeSegment,
      productType: intent.productType || "INTRADAY",
      orderType: "MARKET",
      validity: "IOC",
      securityId: intent.securityId,
      lots: intent.lots,
      correlationId: `panic-${intent.positionId}-w${intent.wave}`.slice(0, 40),
    };
    return dhanPlaceOrder(creds, order, intent.lotSize);
  };
}

function makeDhanCancelExecutor(creds) {
  return async function dhanCancelExecutor(order) {
    return dhanCancelOrder(creds, order?.orderId ?? order?.id);
  };
}

/** A stable intentId for the audit trail even when the client did not send one. */
function panicIntentId(body, prefix) {
  if (body && typeof body.intentId === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(body.intentId)) return body.intentId;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Basket resolve support (1CLIQ-TRADE-SPEC.md §9) ──

// Enough expiries to cover weeksOut 0/1/2 and a "monthly" spec without fetching the whole calendar.
const BASKET_CHAIN_EXPIRY_LOOKAHEAD = 6;

/** Raw Dhan `oc` map → basketEngine's ChainOptionRow[] (only the fields resolveBasket reads). */
function dhanOcToChainRows(oc) {
  if (!oc || typeof oc !== "object") return [];
  const toLeg = (l) => {
    if (!l) return { securityId: null, exchangeSegment: null, delta: undefined };
    const securityId = l.security_id !== undefined && l.security_id !== null ? String(l.security_id) : null;
    const delta = l.greeks?.delta ?? l.delta;
    return { securityId, exchangeSegment: securityId ? "NSE_FNO" : null, delta };
  };
  return Object.keys(oc).map((strikeStr) => ({
    strikePrice: parseFloat(strikeStr),
    ce: toLeg(oc[strikeStr]?.ce),
    pe: toLeg(oc[strikeStr]?.pe),
  }));
}

/** Strike step from the chain's own listed strikes; never a hardcoded constant. */
function inferStepSizeFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const strikes = [...new Set(rows.map((r) => r.strikePrice))].sort((a, b) => a - b);
  return strikes.length >= 2 ? strikes[1] - strikes[0] : null;
}

function requireCreds(creds) {
  if (!creds) throw new TradeError(401, "NO_CREDENTIALS", "Dhan credentials not configured (Broker settings or .env)");
  return creds;
}

/**
 * One trading endpoint. `creds` is already resolved under the proxy's credential policy (null when
 * none may be used); `body` is the parsed JSON body for POST endpoints, null for GET.
 * Returns { status, body }.
 */
export async function handleTradeEndpoint(endpoint, params, creds, body) {
  if (!TRADE_NO_CREDS.has(endpoint)) requireCreds(creds);
  const by = creds?.clientId || "unknown";

  switch (endpoint) {
    case "place-order": {
      const order = body || {};
      // The validation ladder runs here, on the server, not only in the UI. It also resolves the
      // authoritative lot size from the exchange instrument master; the client's lotSize is ignored.
      const key = tickKeyOf(order.exchangeSegment || "NSE_FNO", order.securityId);
      const verdict = await validateOrder(order, {
        clientId: by,
        liveArmed: order.liveArmed === true,
        ltp: latestTicks.get(key)?.ltp ?? null,
        limits: order.limits || null,
      });
      if (!verdict.ok) {
        console.log(`  🛑 Order blocked [${verdict.code}]: ${truncate(verdict.message, 160)}`);
        throw new TradeError(422, verdict.code, verdict.message);
      }
      recordOrder(by, order);
      const result = await dhanPlaceOrder(creds, order, verdict.lotSize);
      return { status: 200, body: { ...result, resolvedLotSize: verdict.lotSize, quantity: verdict.quantity, warnings: verdict.warnings } };
    }
    case "orders":
      return { status: 200, body: await dhanGetOrders(creds) };
    case "order-status":
      return { status: 200, body: await dhanGetOrderStatus(creds, vOrderId(params.get("orderId"))) };
    case "cancel-order":
      return { status: 200, body: await dhanCancelOrder(creds, vOrderId(body?.orderId ?? params.get("orderId"))) };

    // ── Portfolio reads (spec §B3/§11 Phase 3): thin pass-throughs, never cached ──
    case "positions":
      return { status: 200, body: await dhanGetPositions(creds) };
    case "holdings":
      return { status: 200, body: await dhanGetHoldings(creds) };
    case "funds":
      return { status: 200, body: await dhanGetFunds(creds) };
    case "trades": {
      const orderId = params.get("orderId");
      return { status: 200, body: await dhanGetTrades(creds, orderId ? vOrderId(orderId) : undefined) };
    }
    case "modify-order": {
      const orderId = vOrderId(body?.orderId ?? params.get("orderId"));
      // orderId/dhanClientId are never read from the payload being edited: buildModifyOrderBody()
      // always wins with the authoritative values, so a caller cannot smuggle another order or account in.
      const { orderId: _ignoredOrderId, dhanClientId: _ignoredClientId, ...changes } = body || {};
      return { status: 200, body: await dhanModifyOrder(creds, orderId, changes) };
    }

    // ── Basket resolution (spec §9/§11 Phase 4): resolve and report ONLY, never places an order ──
    case "basket-deploy": {
      const basket = body?.basket;
      if (!basket || !Array.isArray(basket.legs) || basket.legs.length === 0 || basket.legs.length > 20) {
        throw new TradeError(422, "BASKET_INVALID", "basket.legs must hold 1-20 legs");
      }
      const symbol = vSymbol(params.get("symbol"), "NIFTY");
      const intentId = panicIntentId(body, "basket-resolve");
      const expiryList = await dhanExpiryList(symbol, creds);
      const allExpiries = Array.isArray(expiryList?.data) ? expiryList.data : [];
      const lookahead = allExpiries.slice(0, BASKET_CHAIN_EXPIRY_LOOKAHEAD);
      // Also fetch any absolute expirySpec date a leg names explicitly, even outside the window.
      for (const leg of basket.legs) {
        const d = leg?.expirySpec?.kind === "absolute" ? toIso(String(leg.expirySpec.date || "")) : null;
        if (d && allExpiries.includes(d) && !lookahead.includes(d)) lookahead.push(d);
      }
      const byExpiry = {};
      let spot = null;
      await Promise.all(lookahead.map(async (exp) => {
        try {
          const oc = await dhanOptionChain(symbol, exp, creds);
          byExpiry[exp] = dhanOcToChainRows(oc?.data?.oc);
          if (spot == null && Number.isFinite(oc?.data?.last_price)) spot = oc.data.last_price;
        } catch (e) {
          // Leave this expiry empty: resolveBasket() then honestly blocks whichever leg needed it.
          console.log(`  ⚠️ basket-deploy: chain fetch failed for ${symbol} ${exp}: ${truncate(e.message, 120)}`);
          byExpiry[exp] = [];
        }
      }));
      const chain = { expiries: allExpiries, byExpiry };
      const stepSize = Number.isFinite(body?.stepSize) && body.stepSize > 0
        ? body.stepSize
        : inferStepSizeFromRows(byExpiry[lookahead[0]]) ?? 50;
      const resolved = basketEngine.resolveBasket(basket, chain, spot, stepSize);
      auditLog.appendAuditEvent({
        intentId,
        type: "BASKET_RESOLVE",
        payload: { symbol, spot, stepSize, blockedForLive: resolved.blockedForLive, blockedLegIds: resolved.blockedLegIds },
      });
      return { status: 200, body: { ...resolved, spot, stepSize, symbol } };
    }

    // ── Server-side risk engine (spec §3/§4). Paper-only: riskEngine's exitExecutor is a stub ──
    case "risk-status": {
      const s = riskEngine.getStatus();
      return { status: 200, body: { alive: s.alive, lastTickAgeMs: s.lastTickAgeMs, armedCount: s.armedCount, dhanConnected: dhanWSConnected } };
    }
    case "risk-arm": {
      // armPosition() runs its own validation ladder; a rejection means nothing was armed.
      const result = riskEngine.armPosition(body || {});
      if (!result.ok) throw new TradeError(422, "RISK_ARM_REJECTED", result.reason);
      return { status: 200, body: result };
    }
    case "risk-disarm": {
      const result = riskEngine.disarmPosition(body?.id ?? params.get("id"));
      if (!result.ok) throw new TradeError(422, "RISK_DISARM_REJECTED", result.reason);
      return { status: 200, body: result };
    }

    // ── Panic layer (spec §5): Close All / Cancel All / the trading lock. Callable regardless of the
    // lock state: a lock blocks getting INTO positions, never getting OUT of them. ──
    case "panic-close-all": {
      // F6 is the combined action: cancel every resting order first (so nothing fills behind our
      // back), THEN close every position. The order is enforced here, not trusted from two requests.
      const intentId = panicIntentId(body, "panic-close");
      const onEvent = (evt) => auditLog.appendAuditEvent({ intentId, type: `PANIC_${evt.type}`, payload: evt });
      auditLog.appendAuditEvent({ intentId, type: "PANIC_CLOSE_ALL_REQUESTED", payload: { source: String(body?.source || "F6").slice(0, 40) } });
      const strayCancels = panicGate.drainPendingCancelQueue().filter((o) => o && (o.orderId || o.id));
      const strayCloses = panicGate.drainPendingCloseQueue();
      if (strayCancels.length || strayCloses.length) {
        auditLog.appendAuditEvent({ intentId, type: "PANIC_STRAY_FILLS_DETECTED", payload: { strayCancels, strayCloses } });
      }
      // openOrders/openPositions are ALWAYS the fresh, authoritative broker fetch, never the client
      // body: a client-supplied position list would carry client lot sizes into a real order.
      const openOrders = await fetchDhanOpenOrders(creds);
      const cancelResult = await panicLayer.cancelAll(
        [...openOrders, ...strayCancels],
        makeDhanCancelExecutor(creds),
        () => fetchDhanOpenOrders(creds),
        { onEvent },
      );
      const openPositions = await fetchDhanOpenPositions(creds);
      const closeResult = await panicLayer.closeAll(
        openPositions,
        makeDhanCloseExecutor(creds),
        () => fetchDhanOpenPositions(creds),
        { onEvent },
      );
      auditLog.appendAuditEvent({ intentId, type: "PANIC_CLOSE_ALL_COMPLETE", payload: { cancelSuccess: cancelResult.success, closeSuccess: closeResult.success } });
      return { status: 200, body: { cancelAll: cancelResult, closeAll: closeResult } };
    }
    case "panic-cancel-all": {
      // F7: cancel resting orders only; open positions are untouched.
      const intentId = panicIntentId(body, "panic-cancel");
      const onEvent = (evt) => auditLog.appendAuditEvent({ intentId, type: `PANIC_${evt.type}`, payload: evt });
      auditLog.appendAuditEvent({ intentId, type: "PANIC_CANCEL_ALL_REQUESTED", payload: { source: String(body?.source || "F7").slice(0, 40) } });
      const strayCancels = panicGate.drainPendingCancelQueue().filter((o) => o && (o.orderId || o.id));
      const openOrders = await fetchDhanOpenOrders(creds); // always the fresh broker fetch
      const result = await panicLayer.cancelAll(
        [...openOrders, ...strayCancels],
        makeDhanCancelExecutor(creds),
        () => fetchDhanOpenOrders(creds),
        { onEvent },
      );
      auditLog.appendAuditEvent({ intentId, type: "PANIC_CANCEL_ALL_COMPLETE", payload: { success: result.success } });
      return { status: 200, body: result };
    }
    case "panic-lock-state":
      return { status: 200, body: tradingLockState.getLockState() };
    case "panic-set-lock": {
      // User-initiated only. Loss-triggered states are set by the engine and cleared only through
      // requestUnlock()'s cooling-off + typed-figure ritual; there is no bare "unlock" bypass.
      const desired = body?.state;
      const current = tradingLockState.getLockState();
      const intentId = panicIntentId(body, "lock");
      const S = tradingLockState.LOCK_STATES;
      if (desired === S.LOCKED_BY_USER) {
        const record = tradingLockState.setLockState(desired, { by });
        auditLog.appendAuditEvent({ intentId, type: "TRADING_LOCK_SET", payload: record });
        return { status: 200, body: record };
      }
      if (desired === S.UNLOCKED) {
        const lossTriggered = current.state === S.LOCKED_BY_MTM_LOSS || current.state === S.LOCKED_BY_DAILY_LOSS_LIMIT;
        if (lossTriggered) {
          // coolingElapsedMs and actualRealisedLoss are computed SERVER-side, never taken from the
          // body; only `typedFigure` comes from the client. No recorded figure means this fails closed.
          const coolingElapsedMs = Number.isFinite(current.since) ? Date.now() - current.since : 0;
          const check = tradingLockState.requestUnlock(current.state, body?.typedFigure, current.meta?.realisedLoss, coolingElapsedMs);
          if (!check.ok) throw new TradeError(422, "UNLOCK_REJECTED", check.reason);
        }
        const record = tradingLockState.setLockState(desired, { by });
        auditLog.appendAuditEvent({ intentId, type: "TRADING_LOCK_CLEARED", payload: record });
        return { status: 200, body: record };
      }
      throw new TradeError(422, "BAD_LOCK_STATE", `panic-set-lock only accepts "${S.LOCKED_BY_USER}" or "${S.UNLOCKED}" from a client; the other states are engine-set.`);
    }
    default:
      throw new InputError("Unknown trading endpoint");
  }
}

// ══════════════════════════════════════════════
// ── SECTION 2c: Generic multi-broker proxy (server/brokers/registry.mjs) ──
// ══════════════════════════════════════════════
// Every read capability an adapter declares, for whichever broker the user connected
// (endpoint table and input rules: server/brokers/brokerProxyRoutes.mjs):
//   market data  — option-chain, expiry-list, ltp, quotes, depth, historical, instruments.
//                  Cache and last-good keys carry a hash of the credentials (like credTag), so a caller
//                  never receives data fetched with someone else's session.
//   portfolio    — positions, holdings, funds, order-book, trade-book. Never cached, never served stale,
//                  Origin-less callers only from loopback.
//   orders       — place-order / modify-order / cancel-order are refused with 403 ORDER_PATH_BLOCKED on
//                  every method: the browser order path for these brokers is blocked pending owner review
//                  and no route mints an order gate (adapters also refuse without one, see orderGate.mjs).
// Dhan keeps its richer /api/dhan-proxy path, which is also where 1Cliq orders go.

const brokerRegistry = createBrokerRegistry();
const BROKER_ID_RE = /^[a-z0-9]{2,20}$/;

/** Decode the base64-JSON x-broker-credentials header into a flat string map, or null. */
export function decodeBrokerCreds(header) {
  if (!header || typeof header !== "string" || header.length > 8192) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      // Passwords, PINs and TOTP values never ride in this header (they would end up in cache keys):
      // session-login brokers send them once, in the body of POST /api/broker-session-login.
      if (typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(k) && !FORBIDDEN_SECRET_KEY.test(k)) out[k] = v.slice(0, 4096);
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function brokerCredTag(creds) {
  if (!creds) return "none";
  const sorted = Object.keys(creds).sort().map((k) => `${k}=${creds[k]}`).join("&");
  return createHash("sha256").update(sorted).digest("hex").slice(0, 12);
}

function vBrokerId(v) {
  const id = String(v || "dhan").toLowerCase();
  if (!BROKER_ID_RE.test(id) || !brokerRegistry.has(id)) throw new InputError(`Unknown broker. Supported: ${brokerRegistry.list().join(", ")}`);
  return id;
}

/** Map an adapter failure onto the proxy's answer: 422 refusals pass through with their code. */
function brokerFailure(brokerId, e) {
  if (e instanceof BrokerError && e.statusCode === 422) {
    return { status: 422, body: { status: "error", code: e.code, reason: truncate(e.message, 240) } };
  }
  return null;
}

async function callBrokerCapability(mod, method, capability, creds, params, symbol, expiry) {
  switch (capability) {
    case "expiries":
      return mod[method](creds, symbol);
    case "ltp":
      return mod[method](creds, symbol);
    case "optionChain": {
      let exp = expiry;
      if (!exp) {
        try {
          const list = await mod.fetchExpiryList(creds, symbol);
          exp = list?.data?.[0];
        } catch { /* some brokers default to the nearest expiry */ }
      }
      return mod[method](creds, symbol, exp);
    }
    case "instruments":
      return filterInstruments(await mod[method](creds), parseInstrumentFilter(params));
    default:
      return mod[method](creds, ...parseBrokerArgs(capability, params));
  }
}

async function handleBrokerProxy(brokerId, params, creds, { originless = false, loopback = true } = {}) {
  const endpoint = params.get("endpoint");
  const route = resolveBrokerEndpoint(endpoint);
  if (!route) throw new InputError(`Unknown endpoint. Use: ${BROKER_PROXY_ENDPOINTS.join(", ")}`);
  if (route.kind === "order") {
    return {
      status: 403,
      body: {
        status: "error",
        code: "ORDER_PATH_BLOCKED",
        reason: `Orders for ${brokerId} are not available through the browser yet: this path is blocked pending review. No order was sent.`,
      },
    };
  }
  if (route.kind === "portfolio" && originless && !loopback) {
    return { status: 403, body: { status: "error", code: "FORBIDDEN", reason: "Portfolio endpoints accept non-browser clients only from loopback" } };
  }
  const mod = brokerRegistry.get(brokerId);
  const method = capabilityMethod(mod, route.capability);
  if (!method) {
    return { status: 422, body: { status: "error", code: "CAPABILITY_UNSUPPORTED", reason: `${brokerId} does not offer ${endpoint} through its API (or it is not wired yet).` } };
  }
  if (!creds) return { status: 401, body: { status: "error", reason: `No ${brokerId} credentials sent` } };

  const symbol = vSymbol(params.get("symbol"), "NIFTY");
  const expiry = vExpiry(params.get("expiry"));

  if (route.kind === "portfolio") {
    // The user's own book: always fresh, never cached, never served stale.
    try {
      const result = await mod[method](creds);
      return { status: 200, body: result ?? { status: "success", data: null } };
    } catch (e) {
      const refused = brokerFailure(brokerId, e);
      if (refused) return refused;
      return { status: 502, body: { status: "error", reason: truncate(e?.message || `${brokerId} request failed`, 240) } };
    }
  }

  let extra;
  try {
    extra = argsKey(route.capability, params);
  } catch (e) {
    const refused = brokerFailure(brokerId, e);
    if (refused) return refused;
    throw e;
  }
  const tag = brokerCredTag(creds);
  const key = `broker:${brokerId}:${tag}:${endpoint}:${symbol}:${expiry || ""}:${extra}`;
  const lgKey = `lastgood:${key}`;
  const hit = cache.get(key);
  if (hit) return { status: 200, body: hit };
  const lgEligible = route.capability === "optionChain" || route.capability === "expiries" || route.capability === "ltp";
  try {
    const result = await coalesce(key, () => callBrokerCapability(mod, method, route.capability, creds, params, symbol, expiry));
    // Every adapter returns the contract shapes (server/brokers/contract.mjs).
    if (hasBrokerData(route.capability, result)) {
      cache.set(key, result, MARKET_TTL_MS[endpoint] ?? 3000);
      if (lgEligible) setLastGood(lgKey, result, brokerId);
      return { status: 200, body: result };
    }
    const lg = lgEligible ? getLastGood(lgKey) : null;
    if (lg) return { status: 200, body: { ...lg.data, stale: true, afterHours: true, cachedAt: lg.timestamp } };
    if (route.capability === "instruments" || route.capability === "historical" || route.capability === "quotes") {
      return { status: 200, body: result ?? { status: "success", data: [] } };
    }
    return { status: 502, body: { status: "error", reason: `${brokerId} returned no data` } };
  } catch (e) {
    if (e instanceof InputError) throw e;
    // A refusal from the adapter (not logged in / session expired / bad input) is not an outage:
    // answer 422 with its code so the UI can ask the user to log in, instead of serving stale data.
    const refused = brokerFailure(brokerId, e);
    if (refused) return refused;
    const lg = lgEligible ? getLastGood(lgKey) : null;
    if (lg) return { status: 200, body: { ...lg.data, stale: true, afterHours: true, cachedAt: lg.timestamp, reason: truncate(e.message, 160) } };
    return { status: 502, body: { status: "error", reason: truncate(e?.message || `${brokerId} request failed`, 240) } };
  }
}

// ── Session login (/api/broker-session-login, server/brokers/sessionLogin.mjs) ──
// POST + JSON only, 4 KB body cap, Host/Origin allowlists like every route, Origin-less callers only from
// loopback, and its own strict per-IP+broker limiter on top of the global bucket. The body carries the
// user's password/PIN and current TOTP code: it is never logged, never cached, never part of a cache key,
// and only the broker's session token goes back to the browser.
const sessionLoginLimiter = createLoginRateLimiter({ max: 5, windowMs: 60_000 });
// Per caller across every session-login broker: stops one IP multiplying its attempts by switching broker.
const sessionLoginIpLimiter = createLoginRateLimiter({ max: 10, windowMs: 60_000 });

async function dhanHistorical({ secId, exchSeg, instrument, interval, fromDate, toDate }, creds) {
  const isDaily = interval === "D";
  const today = istNow().iso;
  let from = fromDate || `${addDaysIso(today, isDaily ? -365 : -3)}${isDaily ? "" : " 09:15"}`;
  const to = toDate || `${today}${isDaily ? "" : " 15:30"}`;
  if (!isDaily) {
    // Dhan allows at most 90 days per intraday request (DH-905).
    const fromIso = from.slice(0, 10);
    const toIsoStr = to.slice(0, 10);
    const days = Math.round((Date.parse(toIsoStr) - Date.parse(fromIso)) / 86400000);
    if (days > 89) from = `${addDaysIso(toIsoStr, -89)} 09:15`;
  }
  const key = `dhan:hist:${credTag(creds)}:${secId}:${exchSeg}:${interval}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const body = {
      securityId: secId,
      exchangeSegment: exchSeg,
      instrument,
      fromDate: isDaily ? from.slice(0, 10) : from.includes(" ") ? from : `${from} 09:15`,
      toDate: isDaily ? to.slice(0, 10) : to.includes(" ") ? to : `${to} 15:30`,
      oi: exchSeg === "NSE_FNO",
    };
    if (isDaily) body.expiryCode = 0;
    else body.interval = interval;
    const json = await dhanFetch(isDaily ? "/charts/historical" : "/charts/intraday", body, creds);
    const out = { status: "success", source: "dhan", data: json?.data && typeof json.data === "object" && !Array.isArray(json.data) ? json.data : json };
    cache.set(key, out, isDaily ? 300000 : 60000);
    return out;
  });
}

async function instrumentMaster() {
  const key = "dhan:instruments-master";
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const res = await upstreamFetch("dhan", "https://images.dhan.co/api-data/api-scrip-master.csv", { headers: { "User-Agent": UA } }, 90000);
    const rows = parseCsv(await res.text());
    markSuccess("dhan");
    const header = (rows.shift() || []).map((h) => h.trim());
    const col = (name) => header.indexOf(name);
    const idx = {
      exch: col("SEM_EXM_EXCH_ID"), seg: col("SEM_SEGMENT"), id: col("SEM_SMST_SECURITY_ID"), instr: col("SEM_INSTRUMENT_NAME"),
      ts: col("SEM_TRADING_SYMBOL"), lot: col("SEM_LOT_UNITS"), cs: col("SEM_CUSTOM_SYMBOL"), exp: col("SEM_EXPIRY_DATE"),
      strike: col("SEM_STRIKE_PRICE"), opt: col("SEM_OPTION_TYPE"),
    };
    const SEGMENT_MAP = { "NSE:E": "NSE_EQ", "NSE:D": "NSE_FNO", "NSE:I": "IDX_I", "BSE:I": "IDX_I", "BSE:D": "BSE_FNO" };
    const ALLOWED = new Set(["NSE_EQ", "NSE_FNO", "IDX_I", "BSE_FNO"]);
    const instruments = [];
    for (const c of rows) {
      const exchangeSegment = SEGMENT_MAP[`${c[idx.exch]?.trim()}:${c[idx.seg]?.trim()}`];
      if (!exchangeSegment || !ALLOWED.has(exchangeSegment)) continue;
      const tradingSymbol = c[idx.ts]?.trim() || "";
      const customSymbol = c[idx.cs]?.trim() || "";
      const expiry = (c[idx.exp] || "").trim().slice(0, 10);
      const strike = toNum(c[idx.strike]);
      const opt = (c[idx.opt] || "").trim();
      instruments.push({
        securityId: (c[idx.id] || "").trim(),
        symbol: customSymbol.split(" ")[0] || tradingSymbol.split("-")[0] || tradingSymbol,
        tradingSymbol,
        exchangeSegment,
        instrumentType: (c[idx.instr] || "").trim(),
        lotSize: Math.max(1, Math.round(toNum(c[idx.lot]) || 1)),
        expiryDate: expiry && !expiry.startsWith("0001") ? expiry : undefined,
        strikePrice: strike > 0 ? strike : undefined,
        optionType: opt && opt !== "XX" ? opt : undefined,
      });
    }
    const out = { instruments, count: instruments.length };
    cache.set(key, out, 3600000);
    console.log(`  ✅ Instrument master: ${instruments.length} rows`);
    return out;
  });
}

// ══════════════════════════════════════════════
// ── SECTION 3: NSE India ──
// ══════════════════════════════════════════════

let nseCookie = "";
let nseCookieExpiry = 0;
let nseSessionPromise = null;
/** www.nseindia.com sometimes blocks a client outright (Akamai 403). Back off instead of hammering. */
let nseWwwBlockedUntil = 0;
const NSE_BLOCK_BACKOFF_MS = 60000;

function assertNseWwwOpen() {
  if (Date.now() < nseWwwBlockedUntil) {
    const secs = Math.ceil((nseWwwBlockedUntil - Date.now()) / 1000);
    throw new UpstreamError("nse", 403, `NSE website is blocking this network (HTTP 403). Retrying in ${secs}s`);
  }
}

/** Collect Set-Cookie values (Node 19.7+ getSetCookie, with a fallback). */
export function collectCookies(headers) {
  let list = [];
  if (typeof headers.getSetCookie === "function") list = headers.getSetCookie();
  else {
    const raw = headers.get("set-cookie") || "";
    list = raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  }
  return list.map((c) => c.split(";")[0].trim()).filter((c) => c.includes("="));
}

function invalidateNseSession() {
  nseCookie = "";
  nseCookieExpiry = 0;
}

/** Shared NSE session: concurrent callers wait on one warm-up instead of racing. */
async function getNseSession(force = false) {
  if (!force && nseCookie && Date.now() < nseCookieExpiry) return nseCookie;
  if (nseSessionPromise) return nseSessionPromise;
  assertNseWwwOpen();
  nseSessionPromise = (async () => {
    const jar = new Map();
    for (const page of ["/", "/option-chain"]) {
      try {
        const res = await upstreamFetch("nse", `${NSE_BASE}${page}`, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-IN,en;q=0.9",
            ...(jar.size ? { Cookie: [...jar.values()].join("; ") } : {}),
          },
          redirect: "follow",
        }, 8000);
        for (const c of collectCookies(res.headers)) jar.set(c.split("=")[0], c);
        await res.text();
      } catch (e) {
        if (page === "/") {
          if (e?.status === 403) {
            nseWwwBlockedUntil = Date.now() + NSE_BLOCK_BACKOFF_MS;
            console.warn("  ⚠️ NSE website returned 403 (blocked). Backing off for 60 s; archive files still work.");
            throw e;
          }
          console.warn(`  ⚠️ NSE warm-up failed: ${truncate(e.message, 120)}`);
        }
      }
    }
    nseCookie = [...jar.values()].join("; ");
    nseCookieExpiry = Date.now() + (nseCookie ? 4 * 60 * 1000 : 15000);
    return nseCookie;
  })().finally(() => { nseSessionPromise = null; });
  return nseSessionPromise;
}

/** GET an NSE JSON API with the shared session, retrying once with a fresh session. */
async function nseJson(path, { referer = `${NSE_BASE}/option-chain`, timeoutMs = 15000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      assertNseWwwOpen();
      const cookie = await getNseSession(attempt > 0);
      const json = await queues.nse.schedule(async () => {
        const res = await upstreamFetch("nse", `${NSE_BASE}${path}`, {
          headers: { "User-Agent": UA, Accept: "application/json, text/plain, */*", "Accept-Language": "en-IN,en;q=0.9", Referer: referer, Cookie: cookie },
        }, timeoutMs);
        const ct = res.headers.get("content-type") || "";
        const text = await res.text();
        if (!ct.includes("json") && !/^\s*[[{]/.test(text)) throw new UpstreamError("nse", 403, "NSE returned HTML instead of JSON (session or bot check)");
        return JSON.parse(text);
      });
      markSuccess("nse");
      return json;
    } catch (e) {
      lastErr = e;
      if (e?.status === 429 || Date.now() < nseWwwBlockedUntil) break;
      if (e?.status === 403 && attempt > 0) nseWwwBlockedUntil = Date.now() + NSE_BLOCK_BACKOFF_MS;
      invalidateNseSession();
    }
  }
  throw lastErr;
}

/** GET a file from nsearchives (CSV/ZIP). Returns a Buffer. 404 → UpstreamError(404). */
async function nseArchive(path, { timeoutMs = 30000 } = {}) {
  // Archives do not need a session; reuse the cookie only when one is already warm.
  const cookie = nseCookie && Date.now() < nseCookieExpiry ? nseCookie : "";
  const buf = await queues.nseArchive.schedule(async () => {
    const res = await upstreamFetch("nse", `${NSE_ARCHIVES}${path}`, {
      headers: { "User-Agent": UA, Accept: "*/*", Referer: `${NSE_BASE}/`, ...(cookie ? { Cookie: cookie } : {}) },
    }, timeoutMs, "nse:archive"); // nsearchives has its own rate limit; do not block www.nseindia.com
    return Buffer.from(await res.arrayBuffer());
  });
  markSuccess("nse");
  return buf;
}

const NSE_INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);
const BSE_ONLY = new Set(["SENSEX", "BANKEX"]);

async function nseExpiries(symbol) {
  const key = `nse:expiries:${symbol}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const json = await nseJson(`/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`);
    const list = (json?.expiryDates || []).map(toIso).filter(Boolean).sort();
    if (list.length === 0) throw new UpstreamError("nse", 204, "NSE returned no expiries");
    cache.set(key, list, 300000);
    return list;
  });
}

/** Normalise a v3 response (single expiry) into the legacy option-chain shape. */
export function normaliseNseV3(json, expiryIso) {
  const rows = json?.records?.data || json?.filtered?.data || [];
  const data = rows.map((r) => ({ ...r, expiryDate: r.expiryDate || r.expiryDates || (expiryIso ? isoToNse(expiryIso) : undefined) }));
  return {
    records: {
      expiryDates: json?.records?.expiryDates?.length ? json.records.expiryDates : expiryIso ? [isoToNse(expiryIso)] : [],
      data,
      underlyingValue: json?.records?.underlyingValue,
      timestamp: json?.records?.timestamp,
    },
    filtered: json?.filtered ? { CE: json.filtered.CE, PE: json.filtered.PE } : undefined,
  };
}

/** NSE option chain: option-chain-v3 for one expiry, falling back to the legacy endpoint. */
async function nseOptionChain(symbol, expiryIso) {
  if (BSE_ONLY.has(symbol)) throw new UpstreamError("nse", 404, `${symbol} trades on BSE; NSE has no chain. Add Dhan keys for BSE indices.`);
  const isIndex = NSE_INDEX_SYMBOLS.has(symbol);
  const key = `nse:oc:${symbol}:${expiryIso || "near"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    let out = null;
    let v3Err = null;
    try {
      const expiries = await nseExpiries(symbol);
      const exp = expiryIso && expiries.includes(expiryIso) ? expiryIso : expiries[0];
      const json = await nseJson(`/api/option-chain-v3?type=${isIndex ? "Indices" : "Equity"}&symbol=${encodeURIComponent(symbol)}&expiry=${isoToNse(exp)}`);
      out = normaliseNseV3(json, exp);
      out.records.expiryDates = expiries.map(isoToNse);
      if (!out.records.data.length) throw new UpstreamError("nse", 204, "NSE v3 returned an empty chain");
    } catch (e) {
      v3Err = e;
      out = null;
    }
    if (!out && Date.now() < nseWwwBlockedUntil) throw v3Err;
    if (!out) {
      const json = await nseJson(isIndex ? `/api/option-chain-indices?symbol=${encodeURIComponent(symbol)}` : `/api/option-chain-equities?symbol=${encodeURIComponent(symbol)}`);
      if (!json?.records?.data?.length) throw v3Err || new UpstreamError("nse", 204, "NSE returned an empty chain");
      out = json;
    }
    cache.set(key, out, 15000);
    setLastGood(`lastgood:nse:oc:${symbol}:${expiryIso || "near"}`, out, "nse");
    return out;
  });
}

const NSE_SIMPLE = {
  indices: { path: "/api/allIndices", ttl: 15000 },
  "market-status": { path: "/api/marketStatus", ttl: 15000 },
  "equity-derivatives": { path: "/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O", ttl: 30000 },
  "market-data-pre-open": { path: "/api/market-data-pre-open?key=FO", ttl: 60000 },
  "fii-dii": { path: "/api/fiidiiTradeReact", ttl: 300000 },
};

async function handleNSEProxy(params) {
  const endpoint = params.get("endpoint");
  if (endpoint === "option-chain") {
    const symbol = vSymbol(params.get("symbol"), "NIFTY");
    const expiry = vExpiry(params.get("expiry"));
    try {
      return { status: 200, body: await nseOptionChain(symbol, expiry) };
    } catch (e) {
      const lg = getLastGood(`lastgood:nse:oc:${symbol}:${expiry || "near"}`);
      if (lg) return { status: 200, body: { ...lg.data, stale: true, cachedAt: lg.timestamp } };
      return { status: 502, body: { error: "NSE option chain unavailable", reason: truncate(e.message, 200) } };
    }
  }
  const def = NSE_SIMPLE[endpoint];
  if (!def) throw new InputError(`Unknown NSE endpoint: ${truncate(endpoint, 30)}`);
  const key = `nse:${endpoint}`;
  const hit = cache.get(key);
  if (hit) return { status: 200, body: hit };
  try {
    const json = await coalesce(key, () => nseJson(def.path, { referer: `${NSE_BASE}/` }));
    if (!json || (typeof json === "object" && Object.keys(json).length === 0)) throw new UpstreamError("nse", 204, "NSE returned an empty response");
    cache.set(key, json, def.ttl);
    setLastGood(`lastgood:nse:${endpoint}`, json, "nse");
    return { status: 200, body: json };
  } catch (e) {
    const lg = getLastGood(`lastgood:nse:${endpoint}`);
    if (lg) {
      const body = Array.isArray(lg.data) ? lg.data : { ...lg.data, stale: true, cachedAt: lg.timestamp };
      return { status: 200, body };
    }
    return { status: 502, body: { error: `NSE ${endpoint} unavailable`, reason: truncate(e.message, 200) } };
  }
}

// ══════════════════════════════════════════════
// ── SECTION 3c: Yahoo Finance charts ──
// ══════════════════════════════════════════════

const YAHOO_SYMBOL_MAP = {
  NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK", FINNIFTY: "NIFTY_FIN_SERVICE.NS", MIDCPNIFTY: "NIFTY_MID_SELECT.NS",
  INDIAVIX: "^INDIAVIX", SENSEX: "^BSESN", BANKEX: "BSE-BANK.BO",
};
const YAHOO_INTERVAL = { 1: "1m", 5: "5m", 15: "15m", 25: "30m", 60: "1h", D: "1d" };

/**
 * Cache and coalesce key for a Yahoo chart request. It is built from the IST dates, not the raw
 * epoch seconds: an open-ended range (no toDate, or toDate today or later) ends "now", which
 * changes every second and would make the cache never hit.
 */
export function yahooCacheKey(ySym, yInt, fromIso, toIso, nowMs = Date.now()) {
  const todayIst = istNow(new Date(nowMs)).iso;
  const end = toIso && toIso < todayIst ? toIso : "today";
  return `yahoo:${ySym}:${yInt}:${fromIso || "d365"}:${end}`;
}

async function yahooChart(symbol, interval, fromIso, toIso) {
  const ySym = YAHOO_SYMBOL_MAP[symbol] || `${symbol}.NS`;
  const yInt = YAHOO_INTERVAL[interval] || "1d";
  const now = Math.floor(Date.now() / 1000);
  // Dates are IST calendar days: start at 00:00 IST, end at 23:59 IST.
  const p1 = fromIso ? Math.floor(Date.parse(`${fromIso}T00:00:00+05:30`) / 1000) : now - 365 * 86400;
  const p2 = toIso ? Math.min(now, Math.floor(Date.parse(`${toIso}T23:59:59+05:30`) / 1000)) : now;
  const key = yahooCacheKey(ySym, yInt, fromIso, toIso, now * 1000);
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, () => queues.yahoo.schedule(async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?period1=${p1}&period2=${p2}&interval=${yInt}&includePrePost=false`;
    const res = await upstreamFetch("yahoo", url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    const raw = await res.json();
    const result = raw?.chart?.result?.[0];
    if (!result) throw new UpstreamError("yahoo", 204, "Yahoo returned an empty result");
    markSuccess("yahoo");
    const q = result.indicators?.quote?.[0] || {};
    const out = {
      status: "success",
      source: "yahoo",
      data: { open: q.open || [], high: q.high || [], low: q.low || [], close: q.close || [], volume: q.volume || [], timestamp: result.timestamp || [] },
    };
    cache.set(key, out, interval === "D" ? 300000 : 60000);
    return out;
  }));
}

async function handleYahooChart(params) {
  const symbol = vSymbol(params.get("symbol"));
  const interval = vEnum(params.get("interval"), INTERVALS, "D", "interval");
  const fromDate = vDate(params.get("fromDate"));
  const toDate = vDate(params.get("toDate"));
  try {
    return { status: 200, body: await yahooChart(symbol, interval, fromDate, toDate) };
  } catch (e) {
    return { status: 502, body: { error: "Yahoo Finance unavailable", reason: truncate(e.message, 200) } };
  }
}

// ══════════════════════════════════════════════
// ── SECTION 3d: Envelope routes (/api/x/*) ──
// ══════════════════════════════════════════════

/**
 * Cache → fetch (coalesced) → last-good. Always resolves to { status, body: envelope }.
 * fetcher returns { data, source?, asOf? }.
 */
async function envelope(key, ttlMs, defaultSource, fetcher) {
  const hit = cache.get(`x:${key}`);
  if (hit) return { status: 200, body: { data: hit.data, meta: { source: hit.source, asOf: hit.asOf, stale: false } } };
  try {
    const r = await coalesce(`x:${key}`, fetcher);
    const entry = { data: r.data, source: r.source || defaultSource, asOf: r.asOf || Date.now() };
    cache.set(`x:${key}`, entry, ttlMs);
    setLastGood(key.startsWith("archive:") ? key : `lastgood:x:${key}`, entry, entry.source);
    const meta = { source: entry.source, asOf: entry.asOf, stale: false };
    if (r.reason) meta.reason = r.reason;
    return { status: 200, body: { data: entry.data, meta } };
  } catch (e) {
    if (e instanceof InputError) throw e;
    const lg = getLastGood(key.startsWith("archive:") ? key : `lastgood:x:${key}`);
    const reason = truncate(e?.message || "upstream failed", 200);
    if (lg) return { status: 200, body: { data: lg.data.data, meta: { source: "cache", asOf: lg.data.asOf || lg.timestamp, stale: true, reason } } };
    return { status: 502, body: { data: null, meta: { source: defaultSource, asOf: Date.now(), stale: true, reason } } };
  }
}

/**
 * The list an NSE JSON payload should carry, or an UpstreamError when the field is missing or not
 * an array. An unexpected payload (schema change, bot-check JSON, `{}`) must not be cached and saved
 * as last-good as an empty list; a real empty array (no deals today) is still accepted.
 */
export function requireList(value, what) {
  if (!Array.isArray(value)) throw new UpstreamError("nse", 204, `NSE returned an unexpected ${what} payload`);
  return value;
}

// ── participant OI / volume ──

const PARTICIPANTS = { CLIENT: "Client", DII: "DII", FII: "FII", PRO: "Pro" };

/** Parse fao_participant_oi / fao_participant_vol CSV into rows. */
export function parseParticipantCsv(text, dateIso) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => /client\s*type/i.test(r[0] || ""));
  if (hi < 0) throw new Error("Participant file has no header row");
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, "");
  const header = rows[hi].map(norm);
  const col = (name) => header.indexOf(name);
  const c = {
    futIdxLong: col("futureindexlong"), futIdxShort: col("futureindexshort"),
    futStkLong: col("futurestocklong"), futStkShort: col("futurestockshort"),
    optIdxCallLong: col("optionindexcalllong"), optIdxPutLong: col("optionindexputlong"),
    optIdxCallShort: col("optionindexcallshort"), optIdxPutShort: col("optionindexputshort"),
  };
  if (Object.values(c).some((i) => i < 0)) throw new Error("Participant file is missing expected columns");
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const p = PARTICIPANTS[String(r[0] || "").trim().toUpperCase()];
    if (!p) continue;
    const row = { date: dateIso, participant: p };
    for (const [k, i] of Object.entries(c)) row[k] = toNum(r[i]);
    out.push(row);
  }
  if (out.length === 0) throw new Error("Participant file has no participant rows");
  return out;
}

async function participantFile(kind, dateIso) {
  const key = `archive:participant-${kind}:${dateIso}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const lg = getLastGood(key);
    if (lg) return lg.data;
    const buf = await nseArchive(`/content/nsccl/fao_participant_${kind}_${ddmmyyyy(dateIso)}.csv`);
    const rows = parseParticipantCsv(buf.toString("utf8"), dateIso);
    cache.set(key, rows, 12 * 3600000);
    setLastGood(key, rows, "nse");
    return rows;
  });
}

/**
 * Whether an archive walk-back (trying earlier dates) should stop on this error. Only "file not
 * there" answers (404/403) move on to the previous date. Network failures and timeouts (status 0),
 * rate limits and server errors stop the walk: retrying older dates against a dead or hanging host
 * would only spend minutes of timeouts. Parse errors (a corrupt file for one date) still move on.
 */
export function isWalkBackFatal(e) {
  if (!(e instanceof UpstreamError)) return false;
  return e.status !== 404 && e.status !== 403;
}

/** Latest available participant file on or before `dateIso` (walks back over weekdays). */
export async function latestParticipant(kind, dateIso) {
  let lastErr = null;
  for (const d of recentWeekdays(dateIso, 6)) {
    try {
      return await participantFile(kind, d);
    } catch (e) {
      lastErr = e;
      if (isWalkBackFatal(e)) break;
    }
  }
  throw lastErr || new Error("No participant file found");
}

/** Default "latest" date: today after 19:00 IST, otherwise yesterday. */
function defaultArchiveDate() {
  const t = istNow();
  return t.hh >= 19 ? t.iso : addDaysIso(t.iso, -1);
}

export async function participantHistory(days) {
  const out = [];
  const dates = recentWeekdays(defaultArchiveDate(), Math.ceil(days * 1.5) + 4);
  for (const d of dates) {
    if (out.length >= days) break;
    try {
      out.push(...(await participantFile("oi", d)));
      // keep counting distinct dates below
    } catch (e) {
      if (isWalkBackFatal(e)) break;
    }
    const distinct = new Set(out.map((r) => r.date)).size;
    if (distinct >= days) break;
  }
  const keep = [...new Set(out.map((r) => r.date))].sort().slice(-days);
  return out.filter((r) => keep.includes(r.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.participant.localeCompare(b.participant)));
}

// ── FII statistics (derived from participant OI and volume) ──

export function deriveFiiStats(oiRows, volRows) {
  const fii = oiRows.find((r) => r.participant === "FII");
  if (!fii) throw new Error("No FII row in participant OI");
  const vol = volRows?.find((r) => r.participant === "FII");
  const seg = (segment, l, s) => {
    const longOi = fii[l];
    const shortOi = fii[s];
    const buyVol = vol ? vol[l] : null;
    const sellVol = vol ? vol[s] : null;
    return {
      date: fii.date, segment, longOi, shortOi, netOi: longOi - shortOi,
      longPct: longOi + shortOi > 0 ? Math.round((longOi / (longOi + shortOi)) * 10000) / 100 : 0,
      buyVol, sellVol, netVol: buyVol !== null && sellVol !== null ? buyVol - sellVol : null,
    };
  };
  return [
    seg("Index Futures", "futIdxLong", "futIdxShort"),
    seg("Index Calls", "optIdxCallLong", "optIdxCallShort"),
    seg("Index Puts", "optIdxPutLong", "optIdxPutShort"),
    seg("Stock Futures", "futStkLong", "futStkShort"),
  ];
}

// ── Ban list, MWPL, lot sizes ──

export function parseBanList(text) {
  const dateMatch = /trade date\s*([0-9]{1,2}-[A-Za-z]{3}-[0-9]{4})/i.exec(text);
  const symbols = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\d+\s*,\s*([A-Z0-9&-]+)\s*$/.exec(line);
    if (m) symbols.push(m[1]);
  }
  return { date: dateMatch ? toIso(dateMatch[1]) : "", symbols };
}

export function parseMwplCsv(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => r.some((c) => /mwpl/i.test(c)) && r.some((c) => /symbol/i.test(c)));
  if (hi < 0) throw new Error("MWPL file has no header row");
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const iSym = h.findIndex((c) => c.includes("nse symbol")) >= 0 ? h.findIndex((c) => c.includes("nse symbol")) : h.findIndex((c) => c.includes("symbol"));
  const iMwpl = h.findIndex((c) => c === "mwpl" || c.startsWith("mwpl"));
  const iOi = h.findIndex((c) => c.includes("open interest"));
  const iLimit = h.findIndex((c) => c.includes("limit"));
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const symbol = String(r[iSym] || "").trim().toUpperCase();
    const mwpl = toNum(r[iMwpl]);
    const oi = toNum(r[iOi]);
    if (!symbol || !(mwpl > 0)) continue;
    out.push({ symbol, mwplPct: Math.round((oi / mwpl) * 10000) / 100, mwpl, oi, limitNextDay: iLimit >= 0 ? toNum(r[iLimit]) : undefined });
  }
  return out.sort((a, b) => b.mwplPct - a.mwplPct);
}

export function parseLotSizes(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => String(r[1] || "").trim().toUpperCase() === "SYMBOL");
  if (hi < 0) throw new Error("Lot size file has no header row");
  const months = rows[hi].slice(2).map((m) => m.trim()).filter(Boolean);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const symbol = String(r[1] || "").trim().toUpperCase();
    if (!symbol || symbol === "SYMBOL") continue;
    const byMonth = months.map((month, i) => ({ month, lotSize: toNum(r[i + 2]) })).filter((x) => x.lotSize > 0);
    if (byMonth.length === 0) continue;
    out.push({ symbol, underlying: String(r[0] || "").trim(), lotSize: byMonth[0].lotSize, byMonth });
  }
  return out;
}

// ── Bhavcopy (UDiFF F&O) ──

export function parseBhavcopyFo(text) {
  const rows = parseCsv(text);
  const h = (rows.shift() || []).map((c) => c.trim());
  const i = (n) => h.indexOf(n);
  const c = { sym: i("TckrSymb"), exp: i("XpryDt"), strike: i("StrkPric"), opt: i("OptnTp"), tp: i("FinInstrmTp"), close: i("ClsPric"), settle: i("SttlmPric"), oi: i("OpnIntrst"), chg: i("ChngInOpnIntrst"), vol: i("TtlTradgVol"), und: i("UndrlygPric") };
  if (c.sym < 0 || c.exp < 0) throw new Error("Bhavcopy header not recognised (expected UDiFF format)");
  const out = [];
  for (const r of rows) {
    const tp = String(r[c.tp] || "").trim().toUpperCase();
    const opt = String(r[c.opt] || "").trim().toUpperCase();
    const type = opt === "CE" || opt === "PE" ? opt : tp.endsWith("F") ? "FUT" : null;
    if (!type) continue;
    out.push({
      symbol: String(r[c.sym] || "").trim().toUpperCase(),
      expiry: toIso(r[c.exp]),
      strike: type === "FUT" ? 0 : toNum(r[c.strike]),
      type,
      close: toNum(r[c.close]),
      settle: toNum(r[c.settle]),
      oi: toNum(r[c.oi]),
      chgOi: toNum(r[c.chg]),
      volume: toNum(r[c.vol]),
      underlyingClose: toNum(r[c.und]),
    });
  }
  return out;
}

async function bhavcopyRows(dateIso) {
  const key = `bhav:${dateIso}`;
  const hit = cache.get(key);
  if (hit) return hit;
  return coalesce(key, async () => {
    const yyyymmdd = dateIso.replace(/-/g, "");
    const buf = await nseArchive(`/content/fo/BhavCopy_NSE_FO_0_0_0_${yyyymmdd}_F_0000.csv.zip`, { timeoutMs: 60000 });
    const rows = parseBhavcopyFo(unzipFirst(buf));
    cache.set(key, rows, 6 * 3600000);
    return rows;
  });
}

// ── NSE JSON lists ──

const n2 = (v) => Math.round(toNum(v) * 100) / 100;

export function normaliseMostActive(items) {
  return (items || []).map((d) => {
    const ot = String(d.optionType || "").toLowerCase();
    const optionType = ot.startsWith("c") ? "CE" : ot.startsWith("p") ? "PE" : String(d.instrumentType || d.instrument || "").toUpperCase().startsWith("FUT") ? "FUT" : null;
    return {
      symbol: String(d.underlying || d.symbol || "").toUpperCase(),
      instrument: String(d.instrumentType || d.instrument || ""),
      expiry: toIso(d.expiryDate || ""),
      strike: toNum(d.strikePrice) > 0 ? toNum(d.strikePrice) : null,
      optionType,
      ltp: n2(d.lastPrice),
      pChange: n2(d.pChange),
      contracts: toNum(d.numberOfContractsTraded ?? d.volume),
      turnoverLakh: n2(d.totalTurnover),
      premiumTurnoverLakh: d.premiumTurnover !== undefined ? n2(d.premiumTurnover) : null,
      oi: toNum(d.openInterest),
      underlyingValue: n2(d.underlyingValue),
    };
  });
}

const SPURT_CATEGORY = {
  "Rise-in-OI-Rise": "Long build-up",
  "Rise-in-OI-Slide": "Short build-up",
  "Slide-in-OI-Rise": "Short covering",
  "Slide-in-OI-Slide": "Long unwinding",
};

export function normaliseOiSpurts(json, type) {
  const spurtRow = (d, category) => {
    const latestOi = toNum(d.latestOI ?? d.latestOi);
    const prevOi = toNum(d.prevOI ?? d.previousOI ?? d.prevOi);
    const chgOi = d.changeInOI !== undefined ? toNum(d.changeInOI) : d.oiChange !== undefined ? toNum(d.oiChange) : latestOi - prevOi;
    const ot = String(d.optionType || "").toUpperCase();
    return {
      symbol: String(d.symbol || d.underlying || "").toUpperCase(),
      instrument: d.instrument || d.instrumentType || undefined,
      expiry: d.expiryDate ? toIso(d.expiryDate) : undefined,
      strike: toNum(d.strikePrice) > 0 ? toNum(d.strikePrice) : undefined,
      optionType: ot === "CE" || ot === "PE" ? ot : ot.startsWith("C") ? "CE" : ot.startsWith("P") ? "PE" : d.instrument && String(d.instrument).startsWith("FUT") ? "FUT" : undefined,
      category,
      ltp: d.ltp !== undefined ? n2(d.ltp) : d.lastPrice !== undefined ? n2(d.lastPrice) : undefined,
      pChange: d.pChange !== undefined ? n2(d.pChange) : undefined,
      latestOi, prevOi, chgOi,
      chgOiPct: prevOi > 0 ? Math.round((chgOi / prevOi) * 10000) / 100 : n2(d.avgInOI ?? d.pctChange),
      volume: toNum(d.volume ?? d.totalTradedVolume),
      underlyingValue: d.underlyingValue !== undefined ? n2(d.underlyingValue) : undefined,
    };
  };
  if (type === "underlyings") return (json?.data || []).map((d) => spurtRow(d));
  const out = [];
  for (const block of json?.data || []) {
    for (const [k, list] of Object.entries(block || {})) {
      if (!Array.isArray(list)) continue;
      for (const d of list) out.push(spurtRow(d, SPURT_CATEGORY[k] || k));
    }
  }
  return out;
}

export function normaliseDeals(list) {
  return (list || []).map((d) => ({
    date: toIso(d.date || ""),
    symbol: String(d.symbol || "").toUpperCase(),
    name: d.name || "",
    client: d.clientName || "",
    side: /sell/i.test(d.buySell || "") ? "SELL" : "BUY",
    qty: toNum(d.qty),
    price: n2(d.watp ?? d.tradePrice),
    remarks: d.remarks && d.remarks !== "-" ? d.remarks : undefined,
  }));
}

// ── Chain rows for chain-multi (same shape as the client's OptionDataExt) ──

function legFromNse(l) {
  if (!l) return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
  const ltp = toNum(l.lastPrice);
  const change = l.change !== undefined ? n2(l.change) : undefined;
  const leg = {
    ltp, oi: toNum(l.openInterest), oiChange: toNum(l.changeinOpenInterest), volume: toNum(l.totalTradedVolume),
    iv: toNum(l.impliedVolatility), delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: toNum(l.bidprice), askPrice: toNum(l.askPrice),
  };
  if (change !== undefined) { leg.change = change; if (ltp > 0) leg.prevClose = n2(ltp - change); }
  if (l.pChange !== undefined || l.pchange !== undefined) leg.pChange = n2(l.pChange ?? l.pchange);
  if (l.bidQty !== undefined) leg.bidQty = toNum(l.bidQty);
  if (l.askQty !== undefined) leg.askQty = toNum(l.askQty);
  if (l.identifier) leg.securityId = String(l.identifier);
  return leg;
}

function legFromDhan(l) {
  if (!l) return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
  const g = l.greeks || {};
  const ltp = toNum(l.last_price ?? l.ltp);
  const oi = toNum(l.oi);
  const leg = {
    ltp, oi, oiChange: l.previous_oi !== undefined ? oi - toNum(l.previous_oi) : 0, volume: toNum(l.volume),
    iv: toNum(l.implied_volatility), delta: toNum(g.delta), gamma: toNum(g.gamma), theta: toNum(g.theta), vega: toNum(g.vega),
    bidPrice: toNum(l.top_bid_price), askPrice: toNum(l.top_ask_price),
  };
  const pc = toNum(l.previous_close_price);
  if (pc > 0) { leg.prevClose = pc; if (ltp > 0) { leg.change = n2(ltp - pc); leg.pChange = n2(((ltp - pc) / pc) * 100); } }
  if (l.top_bid_quantity !== undefined) leg.bidQty = toNum(l.top_bid_quantity);
  if (l.top_ask_quantity !== undefined) leg.askQty = toNum(l.top_ask_quantity);
  if (l.security_id !== undefined) leg.securityId = String(l.security_id);
  return leg;
}

export function chainRowsFromNse(json, expiryIso) {
  const rows = (json?.records?.data || []).filter((r) => !expiryIso || toIso(r.expiryDate || r.expiryDates || "") === expiryIso);
  return rows.map((r) => ({ strikePrice: toNum(r.strikePrice), ce: legFromNse(r.CE), pe: legFromNse(r.PE) })).filter((r) => r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
}

function chainRowsFromDhan(data) {
  return Object.entries(data?.oc || {}).map(([k, v]) => ({ strikePrice: toNum(k), ce: legFromDhan(v?.ce), pe: legFromDhan(v?.pe) })).filter((r) => r.strikePrice > 0).sort((a, b) => a.strikePrice - b.strikePrice);
}

async function chainMulti(symbol, expiriesParam, creds) {
  const pick = (list) => {
    if (expiriesParam === "all") return list.slice(0, 8);
    if (expiriesParam === "next3") return list.slice(0, 3);
    const wanted = expiriesParam.split(",").map((s) => vExpiry(s.trim())).filter(Boolean).slice(0, 8);
    return wanted.filter((w) => list.includes(w));
  };
  if (creds && UNDERLYING_MAP[symbol]) {
    try {
      const list = (await dhanExpiryList(symbol, creds)).data;
      const exps = pick(list);
      const out = [];
      let spot = 0;
      for (const e of exps) {
        const oc = await dhanOptionChain(symbol, e, creds);
        spot = spot || toNum(oc.data?.last_price);
        out.push({ expiry: e, chain: chainRowsFromDhan(oc.data) });
      }
      if (out.some((x) => x.chain.length)) return { data: { symbol, spot, expiries: out }, source: "dhan" };
    } catch (e) {
      if (e instanceof InputError) throw e;
      if (BSE_ONLY.has(symbol)) throw e;
    }
  }
  const list = await nseExpiries(symbol);
  const exps = pick(list);
  const out = [];
  let spot = 0;
  for (const e of exps) {
    const json = await nseOptionChain(symbol, e);
    spot = spot || toNum(json?.records?.underlyingValue) || toNum(json?.records?.data?.[0]?.CE?.underlyingValue);
    out.push({ expiry: e, chain: chainRowsFromNse(json, e) });
  }
  if (!out.some((x) => x.chain.length)) throw new UpstreamError("nse", 204, "No chain data for the requested expiries");
  return { data: { symbol, spot, expiries: out }, source: "nse" };
}

// ── Opt-in server snapshot recorder ──
//
// RECORD_SYMBOLS=NIFTY,BANKNIFTY turns it on. During NSE market hours (Mon–Fri 09:15–15:30 IST,
// NSE F&O holidays skipped when the holiday list is reachable) the proxy fetches the nearest
// RECORD_EXPIRIES (1–3, default 1) chains every RECORD_INTERVAL_SEC (60–180, default 60) and appends
// one NDJSON line per symbol/expiry to ./data/snapshots/<SYMBOL>/<yyyy-mm-dd>.ndjson (RECORD_DIR to
// move it). A chain identical to the previous one (frozen feed, holiday) is not written. Files older
// than RECORD_RETENTION_DAYS (default 30) are deleted. Read back with GET /api/x/snapshots (JSON
// envelope) or /api/x/snapshots.csv; /api/x/snapshots/status describes the recorder.

/** Parse recorder settings from the environment. Invalid symbols are dropped; numbers are clamped. */
export function parseRecordConfig(env = process.env, baseDir = __dirname) {
  const symbols = [...new Set(String(env.RECORD_SYMBOLS || "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s)))].slice(0, 10);
  const num = (v, min, max, dflt) => {
    const n = Number(v);
    if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    enabled: symbols.length > 0,
    symbols,
    intervalSec: num(env.RECORD_INTERVAL_SEC, 60, 180, 60),
    expiries: num(env.RECORD_EXPIRIES, 1, 3, 1),
    retentionDays: num(env.RECORD_RETENTION_DAYS, 1, 365, 30),
    dir: resolve(baseDir, env.RECORD_DIR || "data/snapshots"),
  };
}

/** True Mon–Fri between 09:15 and 15:30 IST inclusive (holidays are checked separately). */
export function isRecordingWindow(now = new Date()) {
  const t = istNow(now);
  if (t.weekday === 0 || t.weekday === 6) return false;
  const m = t.hh * 60 + t.mm;
  return m >= 9 * 60 + 15 && m <= 15 * 60 + 30;
}

const r2 = (v) => Math.round(toNum(v) * 100) / 100;
const qtyOrNull = (v) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : toNum(v));

/**
 * One NDJSON line object for a chain: rows are compact tuples
 * [strike, side (0 = CE, 1 = PE), ltp, oi, volume, iv%, bid, ask, bidQty|null, askQty|null].
 * Legs with no price, OI, volume or quote are left out (same rule as the browser store).
 */
export function chainToSnapshotLine({ ts, symbol, expiry, spot, source, chain }) {
  const rows = [];
  const sorted = (Array.isArray(chain) ? chain : []).filter((r) => r && toNum(r.strikePrice) > 0).sort((a, b) => a.strikePrice - b.strikePrice);
  for (const r of sorted) {
    for (const [side, leg] of [[0, r.ce], [1, r.pe]]) {
      if (!leg) continue;
      const ltp = r2(leg.ltp);
      const oi = toNum(leg.oi);
      const vol = toNum(leg.volume);
      const bid = r2(leg.bidPrice);
      const ask = r2(leg.askPrice);
      if (ltp <= 0 && oi <= 0 && vol <= 0 && bid <= 0 && ask <= 0) continue;
      rows.push([toNum(r.strikePrice), side, ltp, oi, vol, r2(leg.iv), bid, ask, qtyOrNull(leg.bidQty), qtyOrNull(leg.askQty)]);
    }
  }
  return { v: 1, ts, symbol, expiry, spot: r2(spot), source: source || "unknown", rows };
}

/** Parse one NDJSON line into the browser ChainSnapshot shape, or null when it is malformed. */
export function decodeSnapshotLine(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.v !== 1 || !Number.isFinite(o.ts) || typeof o.symbol !== "string" || typeof o.expiry !== "string" || !Array.isArray(o.rows)) return null;
  const rows = [];
  for (const t of o.rows) {
    if (!Array.isArray(t) || t.length < 8 || !(toNum(t[0]) > 0)) continue;
    const row = { strike: toNum(t[0]), side: t[1] === 1 ? "PE" : "CE", ltp: toNum(t[2]), oi: toNum(t[3]), vol: toNum(t[4]), iv: toNum(t[5]), bid: toNum(t[6]), ask: toNum(t[7]) };
    if (t[8] !== null && t[8] !== undefined) row.bidQty = toNum(t[8]);
    if (t[9] !== null && t[9] !== undefined) row.askQty = toNum(t[9]);
    rows.push(row);
  }
  return { id: `${o.symbol}|${o.expiry}|${o.ts}`, symbol: o.symbol, expiry: o.expiry, ts: o.ts, spot: toNum(o.spot), source: o.source || "unknown", rows };
}

/** Cheap fingerprint of a line's rows: identical consecutive chains are not written twice. */
export function snapshotFingerprint(line) {
  const h = createHash("sha1");
  h.update(String(line.spot));
  for (const r of line.rows) h.update(`${r[0]},${r[1]},${r[2]},${r[3]},${r[4]};`);
  return h.digest("hex");
}

export function snapshotFileFor(dir, symbol, dateIso) {
  return join(dir, symbol, `${dateIso}.ndjson`);
}

const IST_MS = 330 * 60000;
const istIsoOf = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istStartOf = (iso) => Date.parse(`${iso}T00:00:00Z`) - IST_MS;

/** Validate /api/x/snapshots query params. from/to accept epoch ms or yyyy-mm-dd (IST days). */
export function parseSnapshotQuery(params, now = Date.now()) {
  const get = (k) => (typeof params?.get === "function" ? params.get(k) : params?.[k]);
  const symbol = vSymbol(get("symbol"));
  const expiry = vExpiry(get("expiry"));
  const time = (v, endOfDay) => {
    if (v === null || v === undefined || v === "") return null;
    const s = String(v).trim();
    if (ISO_RE.test(s)) {
      const iso = vDate(s, { optional: false });
      return istStartOf(iso) + (endOfDay ? 86400000 - 1 : 0);
    }
    if (!/^\d{10,14}$/.test(s)) throw new InputError("from/to must be epoch milliseconds or yyyy-mm-dd");
    return Number(s);
  };
  const to = time(get("to"), true) ?? now;
  const from = time(get("from"), false) ?? istStartOf(istIsoOf(to));
  if (from > to) throw new InputError("from must be before to");
  if (to - from > 31 * 86400000) throw new InputError("Range too long (31 days at most)");
  const limit = vInt(get("limit"), { min: 1, max: 5000, fallback: 2000 });
  const strikeRaw = get("strike");
  const strike = strikeRaw === null || strikeRaw === undefined || strikeRaw === "" ? null : Number(strikeRaw);
  if (strike !== null && !(Number.isFinite(strike) && strike > 0 && strike < 1e7)) throw new InputError("Invalid strike");
  const typeRaw = get("type");
  const type = typeRaw === null || typeRaw === undefined || typeRaw === "" ? null : String(typeRaw).toUpperCase();
  if (type !== null && type !== "CE" && type !== "PE") throw new InputError("type must be CE or PE");
  return { symbol, expiry, from, to, limit, strike, type };
}

/** IST dates (yyyy-mm-dd) touched by [from, to], oldest first. */
export function istDaysInRange(from, to) {
  const out = [];
  for (let d = istIsoOf(from); d <= istIsoOf(to) && out.length < 40; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** Apply expiry, time and row filters (pure). Returns snapshots oldest first. */
export function filterSnapshots(snaps, q) {
  const out = [];
  for (const s of snaps) {
    if (!s || s.ts < q.from || s.ts > q.to) continue;
    if (q.expiry && s.expiry !== q.expiry) continue;
    const rows = q.strike !== null || q.type !== null ? s.rows.filter((r) => (q.strike === null || r.strike === q.strike) && (q.type === null || r.side === q.type)) : s.rows;
    if (rows.length === 0) continue;
    out.push(rows === s.rows ? s : { ...s, rows });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

const SNAP_TS_RE = /"ts":(\d+)/;
const SNAP_EXPIRY_RE = /"expiry":"([^"\\]*)"/;

/** Cheap pre-check on the raw NDJSON text: false when ts or expiry rule the line out before a full decode. */
function snapshotLineMayMatch(line, q) {
  const ts = SNAP_TS_RE.exec(line);
  if (ts) {
    const n = Number(ts[1]);
    if (n < q.from || n > q.to) return false;
  }
  if (q.expiry) {
    const ex = SNAP_EXPIRY_RE.exec(line);
    if (ex && ex[1] !== q.expiry) return false;
  }
  return true;
}

/**
 * Read and filter recorded snapshots from disk. Missing files are skipped. Day files are streamed
 * line by line (oldest day first, lines appended in time order) and reading stops once `limit` + 1
 * matches are in hand, so a small `limit` never decodes a month of files.
 */
export async function readRecordedSnapshots(dir, q) {
  const matches = [];
  outer: for (const day of istDaysInRange(q.from, q.to)) {
    const stream = createReadStream(snapshotFileFor(dir, q.symbol, day), { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim() || !snapshotLineMayMatch(line, q)) continue;
        const s = decodeSnapshotLine(line);
        if (!s) continue;
        const kept = filterSnapshots([s], q);
        if (kept.length === 0) continue;
        matches.push(kept[0]);
        if (matches.length > q.limit) break outer;
      }
    } catch {
      // unreadable file: skip it, like a missing one
    } finally {
      lines.close();
      stream.destroy();
    }
  }
  const filtered = filterSnapshots(matches, q);
  const truncated = filtered.length > q.limit;
  return { snapshots: truncated ? filtered.slice(0, q.limit) : filtered, truncated };
}

const csvCell = (v) => {
  if (v === undefined || v === null || (typeof v === "number" && !Number.isFinite(v))) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const istStamp = (ts) => new Date(ts + IST_MS).toISOString().slice(0, 19).replace("T", " ");

/** Same columns as the browser's snapshot CSV export (src/lib/snapshotStore.ts). */
export const SERVER_SNAPSHOT_CSV_HEADER = "time_ist,ts,symbol,expiry,spot,strike,side,ltp,oi,volume,iv,bid,ask,bid_qty,ask_qty";

export function snapshotsToCsvText(snaps) {
  const lines = [SERVER_SNAPSHOT_CSV_HEADER];
  for (const s of snaps) {
    const t = istStamp(s.ts);
    for (const r of s.rows) lines.push([t, s.ts, s.symbol, s.expiry, s.spot, r.strike, r.side, r.ltp, r.oi, r.vol, r.iv, r.bid, r.ask, r.bidQty, r.askQty].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function appendSnapshotLine(dir, line) {
  const file = snapshotFileFor(dir, line.symbol, istIsoOf(line.ts));
  await fsp.mkdir(dirname(file), { recursive: true });
  await fsp.appendFile(file, `${JSON.stringify(line)}\n`, "utf8");
  return file;
}

/** Delete day files older than keepDays (by file name date). Returns the number removed. */
export async function pruneSnapshotFiles(dir, keepDays, now = Date.now()) {
  const cutoff = addDaysIso(istIsoOf(now), -keepDays);
  let removed = 0;
  let symbols = [];
  try { symbols = await fsp.readdir(dir); } catch { return 0; }
  for (const sym of symbols) {
    if (!SYMBOL_RE.test(sym)) continue;
    let files = [];
    try { files = await fsp.readdir(join(dir, sym)); } catch { continue; }
    for (const f of files) {
      const m = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(f);
      if (m && m[1] < cutoff) {
        try { await fsp.unlink(join(dir, sym, f)); removed++; } catch { /* in use */ }
      }
    }
  }
  return removed;
}

const recorderState = {
  config: parseRecordConfig(),
  running: false,
  lastRunAt: null,
  lastWriteAt: null,
  lastError: null,
  writes: 0,
  skippedSame: 0,
  timer: null,
  prunedOn: "",
};
const lastFingerprint = new Map();

async function isNseHolidayToday() {
  try {
    const out = await handleX("holidays", new URLSearchParams("segment=FO"), null);
    const rows = out?.body?.data;
    if (!Array.isArray(rows)) return false;
    const today = istNow().iso;
    return rows.some((h) => h.date === today);
  } catch {
    return false;
  }
}

async function recordOnce(now = new Date()) {
  const cfg = recorderState.config;
  recorderState.lastRunAt = now.getTime();
  const today = istNow(now).iso;
  if (recorderState.prunedOn !== today) {
    recorderState.prunedOn = today;
    pruneSnapshotFiles(cfg.dir, cfg.retentionDays, now.getTime()).catch(() => undefined);
  }
  if (!isRecordingWindow(now) || (await isNseHolidayToday())) return;
  const creds = envDhanCreds();
  for (const symbol of cfg.symbols) {
    try {
      let list = [];
      if (creds && UNDERLYING_MAP[symbol]) {
        try { list = (await dhanExpiryList(symbol, creds)).data; } catch { list = []; }
      }
      if (list.length === 0 && !BSE_ONLY.has(symbol)) list = await nseExpiries(symbol);
      const wanted = list.filter((e) => e >= today).slice(0, cfg.expiries);
      if (wanted.length === 0) continue;
      const res = await chainMulti(symbol, wanted.join(","), creds);
      for (const e of res.data.expiries) {
        if (!e.chain.length) continue;
        const line = chainToSnapshotLine({ ts: Date.now(), symbol, expiry: e.expiry, spot: res.data.spot, source: res.source, chain: e.chain });
        if (line.rows.length === 0) continue;
        const key = `${symbol}|${e.expiry}`;
        const fp = snapshotFingerprint(line);
        if (lastFingerprint.get(key) === fp) { recorderState.skippedSame++; continue; }
        await appendSnapshotLine(cfg.dir, line);
        lastFingerprint.set(key, fp);
        recorderState.writes++;
        recorderState.lastWriteAt = line.ts;
      }
      recorderState.lastError = null;
    } catch (e) {
      recorderState.lastError = `${symbol}: ${truncate(e?.message || "fetch failed", 160)}`;
    }
  }
}

export function startRecorder() {
  const cfg = recorderState.config;
  if (!cfg.enabled || recorderState.running) return false;
  recorderState.running = true;
  const loop = async () => {
    try { await recordOnce(); } catch (e) { recorderState.lastError = truncate(e?.message, 160); }
    if (recorderState.running) recorderState.timer = setTimeout(loop, cfg.intervalSec * 1000);
  };
  recorderState.timer = setTimeout(loop, 2000);
  return true;
}

export function stopRecorder() {
  recorderState.running = false;
  if (recorderState.timer) clearTimeout(recorderState.timer);
  recorderState.timer = null;
}

function recorderStatus() {
  const cfg = recorderState.config;
  return {
    enabled: cfg.enabled,
    running: recorderState.running,
    symbols: cfg.symbols,
    intervalSec: cfg.intervalSec,
    expiries: cfg.expiries,
    retentionDays: cfg.retentionDays,
    inWindow: isRecordingWindow(),
    lastRunAt: recorderState.lastRunAt,
    lastWriteAt: recorderState.lastWriteAt,
    writes: recorderState.writes,
    skippedSame: recorderState.skippedSame,
    lastError: recorderState.lastError,
  };
}

async function handleSnapshots(params) {
  const q = parseSnapshotQuery(params);
  const { snapshots, truncated } = await readRecordedSnapshots(recorderState.config.dir, q);
  const meta = { source: "cache", asOf: snapshots.length ? snapshots[snapshots.length - 1].ts : Date.now(), stale: false };
  if (!recorderState.config.enabled) meta.reason = "Server recorder is off (set RECORD_SYMBOLS to enable); showing any files already on disk";
  return { status: 200, body: { data: { symbol: q.symbol, expiry: q.expiry || null, from: q.from, to: q.to, snapshots, truncated }, meta } };
}

// ── /api/x router ──

/**
 * `creds` is a function, called only by the routes that use Dhan: a malformed x-dhan-* header must
 * not turn NSE-only routes (ban list, holidays, snapshots and so on) into 400s.
 */
export async function handleX(route, params, creds = () => null) {
  switch (route) {
    case "lot-sizes":
      return envelope("lot-sizes", 6 * 3600000, "nse", async () => {
        const buf = await nseArchive("/content/fo/fo_mktlots.csv");
        return { data: parseLotSizes(buf.toString("utf8")) };
      });

    case "holidays": {
      const segment = vEnum(params.get("segment"), new Set(["FO", "CM", "CD", "COM"]), "FO", "segment");
      return envelope(`holidays:${segment}`, 12 * 3600000, "nse", async () => {
        const json = await nseJson("/api/holiday-master?type=trading", { referer: `${NSE_BASE}/resources/exchange-communication-holidays` });
        const rows = (json?.[segment] || []).map((h) => ({ date: toIso(h.tradingDate), weekday: h.weekDay || "", description: h.description || "", segment })).filter((h) => h.date);
        if (rows.length === 0) throw new UpstreamError("nse", 204, "NSE returned no holidays");
        return { data: rows.sort((a, b) => (a.date < b.date ? -1 : 1)) };
      });
    }

    case "participant-oi":
    case "participant-vol": {
      const kind = route === "participant-oi" ? "oi" : "vol";
      const date = vDate(params.get("date"));
      return envelope(`participant-${kind}:${date || "latest"}`, date ? 12 * 3600000 : 30 * 60000, "nse", async () => {
        const rows = date ? await participantFile(kind, date) : await latestParticipant(kind, defaultArchiveDate());
        return { data: rows, asOf: Date.parse(`${rows[0].date}T18:30:00+05:30`) };
      });
    }

    case "participant-oi/history": {
      const days = vInt(params.get("days"), { min: 1, max: 60, fallback: 20 });
      return envelope(`participant-oi-history:${days}`, 30 * 60000, "nse", async () => {
        const rows = await participantHistory(days);
        if (rows.length === 0) throw new UpstreamError("nse", 404, "No participant OI files found");
        return { data: rows, asOf: Date.parse(`${rows[rows.length - 1].date}T18:30:00+05:30`) };
      });
    }

    case "fii-stats": {
      const date = vDate(params.get("date"));
      return envelope(`fii-stats:${date || "latest"}`, 30 * 60000, "nse", async () => {
        const oi = date ? await participantFile("oi", date) : await latestParticipant("oi", defaultArchiveDate());
        let vol = null;
        try { vol = await participantFile("vol", oi[0].date); } catch { vol = null; }
        return {
          data: deriveFiiStats(oi, vol),
          asOf: Date.parse(`${oi[0].date}T18:30:00+05:30`),
          reason: "Derived from NSE participant-wise OI and volume (FII rows)",
        };
      });
    }

    case "ban-list":
      return envelope("ban-list", 30 * 60000, "nse", async () => {
        const buf = await nseArchive("/content/fo/fo_secban.csv");
        return { data: parseBanList(buf.toString("utf8")) };
      });

    case "mwpl":
      return envelope("mwpl", 60 * 60000, "nse", async () => {
        let lastErr = null;
        for (const d of recentWeekdays(istNow().iso, 6)) {
          try {
            const buf = await nseArchive(`/archives/nsccl/mwpl/combineoi_${ddmmyyyy(d)}.zip`);
            return { data: parseMwplCsv(unzipFirst(buf)), asOf: Date.parse(`${d}T18:30:00+05:30`) };
          } catch (e) {
            lastErr = e;
            if (isWalkBackFatal(e)) break;
          }
        }
        throw lastErr || new Error("No MWPL file found");
      });

    case "vix-history": {
      const days = vInt(params.get("days"), { min: 5, max: 730, fallback: 365 });
      return envelope(`vix-history:${days}`, 60 * 60000, "nse", async () => {
        const to = istNow().iso;
        const from = addDaysIso(to, -days);
        try {
          const rows = [];
          for (let start = from; start <= to; start = addDaysIso(start, 365)) {
            const end = addDaysIso(start, 364) < to ? addDaysIso(start, 364) : to;
            const json = await nseJson(`/api/historical/vixhistory?from=${ddDashMmDashYyyy(start)}&to=${ddDashMmDashYyyy(end)}`, { referer: `${NSE_BASE}/reports-indices-historical-vix` });
            for (const d of json?.data || []) {
              const date = toIso(d.EOD_TIMESTAMP || d.TIMESTAMP || "");
              const close = toNum(d.EOD_CLOSE_INDEX_VAL);
              if (date && close > 0) rows.push({ date, close, open: toNum(d.EOD_OPEN_INDEX_VAL) || undefined, high: toNum(d.EOD_HIGH_INDEX_VAL) || undefined, low: toNum(d.EOD_LOW_INDEX_VAL) || undefined });
            }
          }
          if (rows.length === 0) throw new UpstreamError("nse", 204, "NSE returned no VIX history");
          const uniq = [...new Map(rows.map((r) => [r.date, r])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
          return { data: uniq, source: "nse" };
        } catch (nseErr) {
          const y = await yahooChart("INDIAVIX", "D", from, to);
          const rows = [];
          y.data.timestamp.forEach((t, i) => {
            const close = y.data.close[i];
            if (close == null) return;
            const opt = (v) => (v == null ? undefined : n2(v));
            rows.push({ date: istNow(new Date(t * 1000)).iso, close: n2(close), open: opt(y.data.open[i]), high: opt(y.data.high[i]), low: opt(y.data.low[i]) });
          });
          if (rows.length === 0) throw nseErr;
          return { data: rows, source: "yahoo", reason: `NSE unavailable (${truncate(nseErr.message, 80)}); Yahoo Finance used` };
        }
      });
    }

    case "oi-spurts": {
      const type = vEnum(params.get("type"), new Set(["underlyings", "contracts"]), "underlyings", "type");
      return envelope(`oi-spurts:${type}`, 3 * 60000, "nse", async () => {
        const json = await nseJson(`/api/live-analysis-oi-spurts-${type}`, { referer: `${NSE_BASE}/market-data/oi-spurts` });
        requireList(json?.data, "OI spurts");
        return { data: normaliseOiSpurts(json, type) };
      });
    }

    case "most-active": {
      const type = vEnum(params.get("type"), new Set(["contracts", "futures"]), "contracts", "type");
      const sort = vEnum(params.get("sort"), new Set(["volume", "value"]), "volume", "sort");
      return envelope(`most-active:${type}:${sort}`, 2 * 60000, "nse", async () => {
        const json = await nseJson(`/api/snapshot-derivatives-equity?index=${type}&limit=20`, { referer: `${NSE_BASE}/market-data/most-active-contracts` });
        return { data: normaliseMostActive(requireList(json?.[sort]?.data, "most-active")) };
      });
    }

    case "bhavcopy-fo": {
      const date = vDate(params.get("date"));
      const symbol = params.get("symbol") ? vSymbol(params.get("symbol")) : "";
      const exp = vExpiry(params.get("expiry"));
      return envelope(`bhavcopy-fo:${date || "latest"}:${symbol}:${exp}`, 6 * 3600000, "nse", async () => {
        let rows = null;
        let usedDate = date;
        if (date) rows = await bhavcopyRows(date);
        else {
          let lastErr = null;
          for (const d of recentWeekdays(defaultArchiveDate(), 6)) {
            try { rows = await bhavcopyRows(d); usedDate = d; break; } catch (e) { lastErr = e; if (isWalkBackFatal(e)) break; }
          }
          if (!rows) throw lastErr || new Error("No bhavcopy found");
        }
        const filtered = rows.filter((r) => (!symbol || r.symbol === symbol) && (!exp || r.expiry === exp));
        return { data: filtered, asOf: Date.parse(`${usedDate}T18:30:00+05:30`) };
      });
    }

    case "event-calendar":
      return envelope("event-calendar", 6 * 3600000, "nse", async () => {
        const json = await nseJson("/api/event-calendar", { referer: `${NSE_BASE}/companies-listing/corporate-filings-event-calendar` });
        const list = Array.isArray(json) ? json : requireList(json?.data, "event calendar");
        return { data: list.map((d) => ({ symbol: String(d.symbol || "").toUpperCase(), company: d.company || "", purpose: d.purpose || "", description: d.bm_desc || "", date: toIso(d.date || "") })).filter((d) => d.symbol && d.date) };
      });

    case "bulk-deals":
    case "block-deals": {
      const field = route === "bulk-deals" ? "BULK_DEALS_DATA" : "BLOCK_DEALS_DATA";
      return envelope(route, 15 * 60000, "nse", async () => {
        const json = await nseJson("/api/snapshot-capital-market-largedeal", { referer: `${NSE_BASE}/market-data/large-deals` });
        return { data: normaliseDeals(requireList(json?.[field], route)) };
      });
    }

    case "snapshots":
      return handleSnapshots(params);

    case "snapshots/status":
      return { status: 200, body: { data: recorderStatus(), meta: { source: "cache", asOf: Date.now(), stale: false } } };

    case "chain-multi": {
      const symbol = vSymbol(params.get("symbol"), "NIFTY");
      const raw = String(params.get("expiries") || "next3");
      if (raw !== "next3" && raw !== "all" && !/^[0-9A-Za-z,-]{10,120}$/.test(raw)) throw new InputError("expiries must be next3, all or a comma list of dates");
      const dhanCreds = creds();
      return envelope(`chain-multi:${symbol}:${raw}:${dhanCreds ? `d${credTag(dhanCreds)}` : "n"}`, 15000, dhanCreds ? "dhan" : "nse", () => chainMulti(symbol, raw, dhanCreds));
    }

    default:
      return null;
  }
}

// ══════════════════════════════════════════════
// ── SECTION 4: Dhan WebSocket live market feed ──
// ══════════════════════════════════════════════

const EXCHANGE_SEGMENTS = { 0: "IDX_I", 1: "NSE_EQ", 2: "NSE_FNO", 3: "NSE_CURRENCY", 4: "BSE_EQ", 5: "MCX_COMM", 7: "BSE_CURRENCY", 8: "BSE_FNO" };
const SEGMENT_NAMES = new Set(Object.values(EXCHANGE_SEGMENTS));
const SECURITY_ID_TO_SYMBOL = Object.fromEntries(Object.entries(INDEX_SECURITY_IDS).map(([s, id]) => [id, s]));

/** Fixed packet sizes from the Dhan v2 live feed spec (bytes, including the 8-byte header). */
const PACKET_SIZES = { 2: 16, 4: 50, 5: 12, 6: 16, 7: 8, 8: 162, 50: 10 };

export const DISCONNECT_MESSAGES = {
  805: "Too many Dhan feed connections for this account.",
  806: "Dhan Data APIs are not enabled on this account.",
  807: "Dhan access token has expired.",
  808: "Dhan rejected the client ID or access token.",
  809: "Dhan access token is invalid.",
  810: "Dhan client ID is invalid.",
};

/** Parse one packet at `offset`. Prices are float32, quantities int32, little-endian. */
function parsePacket(view, offset) {
  const code = view.getUint8(offset);
  const segNum = view.getUint8(offset + 3);
  const securityId = view.getUint32(offset + 4, true);
  const exchangeSegment = EXCHANGE_SEGMENTS[segNum] || `SEG_${segNum}`;
  const base = {
    responseCode: code,
    exchangeSegment,
    securityId,
    key: `${exchangeSegment}:${securityId}`,
    symbol: (exchangeSegment === "IDX_I" && SECURITY_ID_TO_SYMBOL[securityId]) || `ID_${securityId}`,
  };
  const f32 = (o) => Math.round(view.getFloat32(offset + o, true) * 100) / 100;
  const i32 = (o) => view.getInt32(offset + o, true);
  const i16 = (o) => view.getInt16(offset + o, true);
  switch (code) {
    case 2:
      return { ...base, type: "ticker", ltp: f32(8), ltt: i32(12) };
    case 4:
      return {
        ...base, type: "quote", ltp: f32(8), ltq: i16(12), ltt: i32(14), avgPrice: f32(18), volume: i32(22),
        totalSellQty: i32(26), totalBuyQty: i32(30), open: f32(34), close: f32(38), high: f32(42), low: f32(46),
      };
    case 5:
      return { ...base, type: "oi", oi: i32(8) };
    case 6:
      return { ...base, type: "prevClose", prevClose: f32(8), prevOI: i32(12) };
    case 8: {
      const depth = [];
      for (let lvl = 0; lvl < 5; lvl++) {
        const o = 62 + lvl * 20;
        depth.push({ bidQty: i32(o), askQty: i32(o + 4), bidOrders: i16(o + 8), askOrders: i16(o + 10), bid: f32(o + 12), ask: f32(o + 16) });
      }
      return {
        ...base, type: "full", ltp: f32(8), ltq: i16(12), ltt: i32(14), avgPrice: f32(18), volume: i32(22),
        totalSellQty: i32(26), totalBuyQty: i32(30), oi: i32(34), oiDayHigh: i32(38), oiDayLow: i32(42),
        open: f32(46), close: f32(50), high: f32(54), low: f32(58), depth,
      };
    }
    case 50:
      return { ...base, type: "disconnect", disconnectCode: i16(8) };
    default:
      return null;
  }
}

/** Parse a WebSocket frame that may hold several concatenated packets. */
export function parseDhanFrame(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.length);
  const out = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const code = view.getUint8(offset);
    const headerLen = view.getUint16(offset + 1, true);
    const size = PACKET_SIZES[code] || (headerLen >= 8 ? headerLen : 0);
    if (!size || offset + size > buf.length) break;
    const p = parsePacket(view, offset);
    if (p) out.push(p);
    offset += size;
  }
  return out;
}

/**
 * Upstream feed subscriptions, reference-counted per browser socket.
 *
 * Dhan caps one feed connection at 5000 instruments; we keep a 4000 budget. Pinned keys (the
 * index feeds) are never released. Other keys are released when no socket uses them any more
 * (explicit unsubscribe or socket close). If one long-lived socket keeps subscribing new
 * instruments, the least recently subscribed unpinned keys are evicted to make room instead of
 * failing every later subscribe until the proxy restarts.
 */
export class SubscriptionRegistry {
  constructor({ limit = 4000, pinned = [] } = {}) {
    this.limit = limit;
    this.entries = new Map(); // key → instrument, in least-recently-subscribed-first order
    this.refs = new Map(); // key → Set<owner>
    this.byOwner = new Map(); // owner → Set<key>
    this.pinned = new Set();
    for (const i of pinned) {
      const key = SubscriptionRegistry.keyOf(i);
      this.pinned.add(key);
      this.entries.set(key, i);
    }
  }

  static keyOf(i) {
    return `${i.ExchangeSegment}:${i.SecurityId}`;
  }

  get size() {
    return this.entries.size;
  }

  has(key) {
    return this.entries.has(key);
  }

  values() {
    return this.entries.values();
  }

  /** Add `owner`'s interest in `list`. Returns { added, released } instrument lists for upstream. */
  subscribe(owner, list) {
    const keys = [...new Map(list.map((i) => [SubscriptionRegistry.keyOf(i), i])).entries()];
    const freshCount = keys.filter(([k]) => !this.entries.has(k)).length;
    const requested = new Set(keys.map(([k]) => k));
    const need = this.entries.size + freshCount - this.limit;
    if (need > 0) {
      let evictable = 0;
      for (const key of this.entries.keys()) if (!this.pinned.has(key) && !requested.has(key)) evictable++;
      if (evictable < need) throw new InputError("Subscription limit reached");
    }
    const added = [];
    const released = [];
    let owned = this.byOwner.get(owner);
    if (!owned) { owned = new Set(); this.byOwner.set(owner, owned); }
    // Touch the keys that are already present first, so they are not chosen for eviction.
    for (const [key, inst] of keys) {
      if (!this.entries.has(key)) continue;
      const cur = this.entries.get(key);
      this.entries.delete(key);
      this.entries.set(key, cur || inst);
    }
    let overflow = this.entries.size + freshCount - this.limit;
    if (overflow > 0) {
      for (const key of [...this.entries.keys()]) {
        if (overflow <= 0) break;
        if (this.pinned.has(key) || requested.has(key)) continue;
        released.push(this.#drop(key));
        overflow--;
      }
    }
    for (const [key, inst] of keys) {
      if (!this.entries.has(key)) { this.entries.set(key, inst); added.push(inst); }
      let set = this.refs.get(key);
      if (!set) { set = new Set(); this.refs.set(key, set); }
      set.add(owner);
      owned.add(key);
    }
    return { added, released };
  }

  /** Remove `owner`'s interest in `list`. Returns instruments no longer used by anyone. */
  unsubscribe(owner, list) {
    const owned = this.byOwner.get(owner);
    if (!owned) return [];
    const released = [];
    for (const i of list) {
      const key = SubscriptionRegistry.keyOf(i);
      if (!owned.has(key)) continue;
      owned.delete(key);
      const r = this.#unref(owner, key);
      if (r) released.push(r);
    }
    if (owned.size === 0) this.byOwner.delete(owner);
    return released;
  }

  /** Drop every subscription held by `owner` (socket closed). Returns released instruments. */
  release(owner) {
    const owned = this.byOwner.get(owner);
    if (!owned) return [];
    this.byOwner.delete(owner);
    const released = [];
    for (const key of owned) {
      const r = this.#unref(owner, key);
      if (r) released.push(r);
    }
    return released;
  }

  #unref(owner, key) {
    const set = this.refs.get(key);
    if (set) {
      set.delete(owner);
      if (set.size > 0) return null;
      this.refs.delete(key);
    }
    if (this.pinned.has(key) || !this.entries.has(key)) return null;
    const inst = this.entries.get(key);
    this.entries.delete(key);
    return inst;
  }

  #drop(key) {
    const inst = this.entries.get(key);
    this.entries.delete(key);
    for (const owner of this.refs.get(key) || []) {
      const owned = this.byOwner.get(owner);
      if (owned) { owned.delete(key); if (owned.size === 0) this.byOwner.delete(owner); }
    }
    this.refs.delete(key);
    return inst;
  }
}

const latestTicks = new Map(); // "segment:id" → merged tick
const subscribed = new SubscriptionRegistry({
  limit: 4000,
  pinned: Object.values(INDEX_SECURITY_IDS).map((id) => ({ ExchangeSegment: "IDX_I", SecurityId: String(id) })),
});

let dhanWS = null;
let dhanWSTimer = null;
let dhanWSDelay = 1000;
let dhanWSConnected = false;
let dhanWSCreds = null;
let dhanWSHalted = false;
let lastDisconnectCode = null;

function feedStatus() {
  return {
    type: "status",
    connected: dhanWSConnected,
    dhanConnected: dhanWSConnected,
    disconnectCode: lastDisconnectCode,
    message: lastDisconnectCode ? DISCONNECT_MESSAGES[lastDisconnectCode] || `Dhan disconnect code ${lastDisconnectCode}` : null,
    instrumentCount: subscribed.size,
  };
}

function sendSubscriptions(list) {
  if (!dhanWS || dhanWS.readyState !== WebSocket.OPEN) return;
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    dhanWS.send(JSON.stringify({ RequestCode: 21, InstrumentCount: chunk.length, InstrumentList: chunk }));
  }
}

/** Tell Dhan to stop streaming instruments no browser socket uses, and forget their last ticks. */
function releaseInstruments(list) {
  if (!list.length) return;
  for (const i of list) latestTicks.delete(SubscriptionRegistry.keyOf(i));
  if (!dhanWS || dhanWS.readyState !== WebSocket.OPEN) return;
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    // RequestCode 22 = unsubscribe (full packet), the counterpart of 21.
    dhanWS.send(JSON.stringify({ RequestCode: 22, InstrumentCount: chunk.length, InstrumentList: chunk }));
  }
}

/**
 * Drop an upstream socket for good. Its listeners are removed, so a no-op 'error' listener is
 * attached first: terminate() on a socket that is still CONNECTING aborts the handshake and
 * emits 'error' on the next tick, and an 'error' with no listener crashes the whole process.
 */
export function closeUpstream(socket) {
  if (!socket) return;
  try {
    socket.removeAllListeners();
    socket.on("error", () => undefined);
    socket.terminate();
  } catch { /* ignore */ }
}

function connectDhanWebSocket(creds) {
  if (!creds) return;
  const same = dhanWSCreds && dhanWSCreds.clientId === creds.clientId && dhanWSCreds.accessToken === creds.accessToken;
  if (same && dhanWS && (dhanWS.readyState === WebSocket.OPEN || dhanWS.readyState === WebSocket.CONNECTING)) return;
  if (same && dhanWSHalted) return; // wait for different credentials
  if (!same) {
    dhanWSHalted = false;
    lastDisconnectCode = null;
    dhanWSDelay = 1000;
  }
  dhanWSCreds = creds;
  if (dhanWS) {
    closeUpstream(dhanWS);
    dhanWS = null;
  }
  if (dhanWSTimer) { clearTimeout(dhanWSTimer); dhanWSTimer = null; }

  console.log("  🔌 Connecting to the Dhan live feed…");
  try {
    dhanWS = new WebSocket(`wss://api-feed.dhan.co?version=2&token=${encodeURIComponent(creds.accessToken)}&clientId=${encodeURIComponent(creds.clientId)}&authType=2`);
  } catch (e) {
    console.error(`  ❌ Dhan feed connection error: ${truncate(e.message, 100)}`);
    scheduleDhanReconnect();
    return;
  }

  dhanWS.on("open", () => {
    dhanWSConnected = true;
    dhanWSDelay = 1000;
    markSuccess("dhan");
    console.log("  ✅ Dhan live feed connected");
    sendSubscriptions([...subscribed.values()]);
    broadcast(feedStatus());
  });

  dhanWS.on("message", (data) => {
    let packets;
    try { packets = parseDhanFrame(data); } catch { return; }
    for (const p of packets) {
      if (p.type === "disconnect") {
        handleDisconnectCode(p.disconnectCode);
        continue;
      }
      const prev = latestTicks.get(p.key) || {};
      const merged = { ...prev, ...p, timestamp: Date.now() };
      if (merged.prevClose && merged.ltp) {
        merged.change = Math.round((merged.ltp - merged.prevClose) * 100) / 100;
        merged.changePercent = Math.round(((merged.ltp - merged.prevClose) / merged.prevClose) * 10000) / 100;
      }
      latestTicks.set(p.key, merged);
      // In-process consumers (the server risk engine, via tickBus) run BEFORE the browser fan-out,
      // so an exit is never delayed by however many browser clients are attached (spec §3).
      tickBus.publish(merged);
      broadcast(merged);
    }
  });

  dhanWS.on("close", (code) => {
    dhanWSConnected = false;
    console.log(`  🔴 Dhan live feed closed (${code})`);
    broadcast(feedStatus());
    scheduleDhanReconnect();
  });

  dhanWS.on("error", (err) => {
    dhanWSConnected = false;
    markFailure("dhan", err);
    if (String(err?.message).includes("429")) dhanWSDelay = 120000;
  });
}

/** Close the upstream feed and forget its credentials (no reconnect). */
function disconnectDhanWebSocket() {
  if (dhanWSTimer) { clearTimeout(dhanWSTimer); dhanWSTimer = null; }
  if (dhanWS) {
    closeUpstream(dhanWS);
    dhanWS = null;
  }
  const wasActive = !!dhanWSCreds;
  dhanWSCreds = null;
  dhanWSConnected = false;
  dhanWSHalted = false;
  lastDisconnectCode = null;
  dhanWSDelay = 1000;
  if (wasActive) {
    console.log("  🔌 Dhan live feed stopped (no credentials)");
    broadcast(feedStatus());
  }
}

function handleDisconnectCode(code) {
  lastDisconnectCode = code;
  console.warn(`  ⚠️ Dhan feed disconnect code ${code}: ${DISCONNECT_MESSAGES[code] || "unknown"}`);
  markFailure("dhan", new Error(`Feed disconnect ${code}`));
  if (code === 805) dhanWSDelay = 120000; // too many connections: back off hard
  else if (code >= 806 && code <= 810) dhanWSHalted = true; // needs new credentials or account change
  broadcast(feedStatus());
}

function scheduleDhanReconnect() {
  if (dhanWSTimer) clearTimeout(dhanWSTimer);
  if (dhanWSHalted || !dhanWSCreds) return;
  dhanWSDelay = Math.max(dhanWSDelay, Math.min(dhanWSDelay * 2, 30000));
  dhanWSTimer = setTimeout(() => connectDhanWebSocket(dhanWSCreds), dhanWSDelay);
}

// ── Local WebSocket server (browser ↔ proxy) ──

const localWSS = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const client of localWSS.clients) if (client.readyState === WebSocket.OPEN) client.send(json);
}

/** Validate a browser subscribe payload. Returns a clean list or throws InputError. */
export function validateSubscribe(instruments) {
  if (!Array.isArray(instruments) || instruments.length === 0 || instruments.length > 100) throw new InputError("instruments must be an array of 1-100 items");
  return instruments.map((i) => {
    const seg = String(i?.ExchangeSegment ?? "");
    const id = String(i?.SecurityId ?? "");
    if (!SEGMENT_NAMES.has(seg) || !/^\d{1,10}$/.test(id)) throw new InputError("Invalid instrument in subscribe payload");
    return { ExchangeSegment: seg, SecurityId: id };
  });
}

// Browser sockets that supplied their own Dhan credentials, in the order they configured.
// The most recent one owns the single upstream feed; when it leaves or clears its keys the feed
// falls back to the next most recent socket, then to .env credentials, then stops.
const feedCredsBySocket = new Map(); // ws → { clientId, accessToken }

function envDhanCreds() {
  try { return resolveDhanCreds("", ""); } catch { return null; }
}

function sameCreds(a, b) {
  return !!a && !!b && a.clientId === b.clientId && a.accessToken === b.accessToken;
}

function reselectFeedCreds() {
  const owners = [...feedCredsBySocket.values()];
  const next = owners[owners.length - 1] || envDhanCreds();
  if (!next) return disconnectDhanWebSocket();
  if (sameCreds(next, dhanWSCreds)) return;
  connectDhanWebSocket(next);
}

function releaseFeedCreds(ws) {
  if (!feedCredsBySocket.has(ws)) return;
  const owned = sameCreds(feedCredsBySocket.get(ws), dhanWSCreds);
  feedCredsBySocket.delete(ws);
  if (owned) reselectFeedCreds();
}

localWSS.on("connection", (ws) => {
  let msgCount = 0;
  const msgWindow = setInterval(() => { msgCount = 0; }, 10000);
  const cleanup = () => {
    clearInterval(msgWindow);
    releaseFeedCreds(ws);
    releaseInstruments(subscribed.release(ws));
  };
  // ws emits 'error' for protocol violations (frame over maxPayload, invalid UTF-8, bad opcode).
  // Without a listener Node throws and the whole proxy exits.
  ws.on("error", () => {
    cleanup();
    try { ws.terminate(); } catch { /* ignore */ }
  });
  ws.on("close", cleanup);

  ws.send(JSON.stringify(feedStatus()));
  for (const tick of latestTicks.values()) ws.send(JSON.stringify(tick));

  ws.on("message", (raw) => {
    if (++msgCount > 30) return; // ignore floods
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    try {
      if (msg.type === "configure") {
        if (!msg.clientId || !msg.accessToken) throw new InputError("configure needs clientId and accessToken");
        const creds = resolveDhanCreds(String(msg.clientId), String(msg.accessToken));
        if (creds) {
          feedCredsBySocket.delete(ws); // re-insert so this socket becomes the most recent owner
          feedCredsBySocket.set(ws, creds);
          connectDhanWebSocket(creds);
        }
      } else if (msg.type === "unconfigure") {
        // Sent by the browser when the user removes their keys.
        releaseFeedCreds(ws);
      } else if (msg.type === "subscribe") {
        const list = validateSubscribe(msg.instruments);
        const { added, released } = subscribed.subscribe(ws, list);
        releaseInstruments(released);
        sendSubscriptions(added);
      } else if (msg.type === "unsubscribe") {
        const list = validateSubscribe(msg.instruments);
        releaseInstruments(subscribed.unsubscribe(ws, list));
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", message: truncate(e.message, 120) }));
    }
  });
});

// ══════════════════════════════════════════════
// ── SECTION 5: HTTP server ──
// ══════════════════════════════════════════════

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function clientIp(req) {
  return req.socket?.remoteAddress || "unknown";
}

export function isLoopbackAddress(addr) {
  const a = String(addr || "");
  return a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127.");
}

function hostnameOf(hostHeader) {
  const h = String(hostHeader || "").trim().toLowerCase();
  if (!h) return "";
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(1, end) : "";
  }
  return h.replace(/:\d*$/, "");
}

// Host-header allowlist (DNS-rebinding defence): loopback names, the bind address when it is a
// specific host, every host named in the Origin allowlist, plus PROXY_ALLOWED_HOSTS.
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
if (HOST && HOST !== "0.0.0.0" && HOST !== "::") ALLOWED_HOSTS.add(hostnameOf(HOST.includes(":") && !HOST.startsWith("[") ? `[${HOST}]` : HOST));
for (const o of ALLOWED_ORIGINS) {
  try { ALLOWED_HOSTS.add(hostnameOf(new URL(o).host)); } catch { /* ignore malformed */ }
}
for (const h of (process.env.PROXY_ALLOWED_HOSTS || "").split(",")) {
  const name = hostnameOf(h);
  if (name) ALLOWED_HOSTS.add(name);
}

export function isAllowedHost(hostHeader, allowed = ALLOWED_HOSTS) {
  const name = hostnameOf(hostHeader);
  return !!name && allowed.has(name);
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4ToInt(addr) {
  const m = IPV4_RE.exec(addr);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/** Parse PROXY_TRUSTED_NETS: comma-separated IPv4 addresses, IPv4 CIDRs or exact IPv6 addresses. */
export function parseTrustedNets(value) {
  const out = [];
  for (const raw of String(value || "").split(",")) {
    const item = raw.trim().toLowerCase();
    if (!item) continue;
    const [addr, bitsRaw] = item.split("/");
    const base = ipv4ToInt(addr);
    if (base !== null) {
      const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      out.push({ kind: 4, base: (base & mask) >>> 0, mask });
    } else if (addr.includes(":") && bitsRaw === undefined) {
      out.push({ kind: 6, addr });
    }
  }
  return out;
}

const TRUSTED_NETS = parseTrustedNets(process.env.PROXY_TRUSTED_NETS);

/**
 * Whether a client socket address may use the .env Dhan credentials and the shared live feed:
 * loopback, or an address listed in PROXY_TRUSTED_NETS (for Docker, the bridge gateway the host
 * browser arrives from). Header values (Origin, Host) are never the trust signal: any non-browser
 * client can forge them.
 */
export function isTrustedClient(addr, nets = TRUSTED_NETS) {
  const a = String(addr || "").toLowerCase();
  if (isLoopbackAddress(a)) return true;
  const v4 = ipv4ToInt(a.startsWith("::ffff:") ? a.slice(7) : a);
  for (const n of nets) {
    if (n.kind === 4 && v4 !== null && ((v4 & n.mask) >>> 0) === n.base) return true;
    if (n.kind === 6 && n.addr === a) return true;
  }
  return false;
}

/**
 * Whether a request may fall back to the .env Dhan credentials. Decided by the socket's remote
 * address only (see isTrustedClient). Requests that bring their own header credentials are unaffected.
 */
function mayUseEnvCreds(req) {
  return isTrustedClient(clientIp(req));
}

function send(res, status, body, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function isTradeEndpointPath(path, params) {
  if (path !== "/api/dhan-proxy") return false;
  const e = params.get("endpoint");
  return TRADE_POST_ENDPOINTS.has(e) || TRADE_GET_ENDPOINTS.has(e);
}

function healthPayload() {
  return {
    status: "ok",
    version: VERSION,
    uptime: process.uptime(),
    websocket: {
      dhanConnected: dhanWSConnected,
      browserClients: localWSS.clients.size,
      instrumentsSubscribed: subscribed.size,
      cachedTicks: latestTicks.size,
      lastDisconnectCode,
    },
    upstreams: upstreamHealth,
    // Back-compat flags: sources.dhan = credentials present in .env.
    sources: { dhan: !!(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN), nse: true, yahoo: true },
    cache: { entries: cache.size, lastGood: lastGood.size, inflight: inflight.size },
    recorder: recorderStatus(),
    security: { host: HOST, allowedOrigins: [...ALLOWED_ORIGINS] },
    brokers: brokerRegistry.list(),
    riskEngine: riskEngine.getStatus(),
  };
}

export const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedHost(req.headers.host)) return send(res, 403, { error: "Host not allowed", reason: "Add this host to PROXY_ALLOWED_HOSTS" });
  if (!isAllowedOrigin(origin)) return send(res, 403, { error: "Origin not allowed", reason: `Add ${truncate(origin, 80)} to PROXY_ALLOWED_ORIGINS` });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dhan-client-id, x-dhan-access-token, x-broker-credentials");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "GET" && req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  if (!takeToken(clientIp(req))) return send(res, 429, { error: "Too many requests", reason: "Slow down: per-IP rate limit" }, { "Retry-After": "1" });

  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); } catch { return send(res, 400, { error: "Bad URL" }); }
  const params = url.searchParams;
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // POST exists only for the 1Cliq trading endpoints (JSON body). Everything else stays GET-only.
  const tradeEndpoint = path === "/api/dhan-proxy" ? params.get("endpoint") : null;
  const isTradePost = !!tradeEndpoint && TRADE_POST_ENDPOINTS.has(tradeEndpoint);
  const isTradeGet = !!tradeEndpoint && TRADE_GET_ENDPOINTS.has(tradeEndpoint);
  const isSessionLogin = path === "/api/broker-session-login";
  if (isSessionLogin && req.method !== "POST") return send(res, 405, { error: "Method not allowed", reason: "Use POST with a JSON body" }, { Allow: "POST" });
  if (req.method === "POST" && !isTradePost && !isSessionLogin) return send(res, 405, { error: "Method not allowed" });
  if (req.method === "GET" && isTradePost) return send(res, 405, { error: "Method not allowed", reason: "Use POST with a JSON body" }, { Allow: "POST" });

  try {
    const headerId = req.headers["x-dhan-client-id"];
    const headerToken = req.headers["x-dhan-access-token"];
    const envOk = mayUseEnvCreds(req);
    const creds = () => {
      const id = typeof headerId === "string" ? headerId : "";
      const token = typeof headerToken === "string" ? headerToken : "";
      if (!envOk && !(id && token)) return null;
      return resolveDhanCreds(id, token);
    };

    if (isTradePost || isTradeGet) {
      // Trading: a browser must come from an allowlisted Origin (checked above); a request without
      // an Origin header is a non-browser client and is accepted only from this machine.
      if (!origin && !isLoopbackAddress(clientIp(req))) return send(res, 403, { error: "Forbidden", reason: "Trading endpoints accept non-browser clients only from loopback" });
      const body = isTradePost ? await readJsonBody(req) : null;
      const { status, body: out } = await handleTradeEndpoint(tradeEndpoint, params, creds(), body);
      return send(res, status, out);
    }
    if (isSessionLogin) {
      if (!origin && !isLoopbackAddress(clientIp(req))) return send(res, 403, { error: "Forbidden", reason: "Session login accepts non-browser clients only from loopback" });
      const brokerId = vBrokerId(params.get("broker"));
      const body = await readJsonBody(req, SESSION_LOGIN_BODY_LIMIT);
      const out = await handleSessionLogin({ registry: brokerRegistry, brokerId, body, rateKey: clientIp(req), limiter: sessionLoginLimiter, ipLimiter: sessionLoginIpLimiter });
      return send(res, out.status, out.body);
    }
    if (path === "/api/dhan-proxy") {
      const { status, body } = await handleDhanProxy(params, creds());
      return send(res, status, body);
    }
    if (path === "/api/broker-capabilities") {
      // Static, credential-free description of what each adapter offers (no secrets, nothing per-user).
      const one = params.get("broker");
      if (one) return send(res, 200, describeAdapter(brokerRegistry.get(vBrokerId(one))));
      return send(res, 200, { brokers: brokerRegistry.list().map((id) => describeAdapter(brokerRegistry.get(id))) });
    }
    if (path === "/api/broker-proxy" || path === "/api/broker-test-connection") {
      const brokerId = vBrokerId(params.get("broker"));
      let bc = decodeBrokerCreds(req.headers["x-broker-credentials"]);
      // Dhan through the generic path follows the same credential policy as /api/dhan-proxy, with one
      // tightening: the owner's portfolio (positions/holdings/funds/books) is read with the .env keys
      // only for a browser on an allowlisted Origin (checked above), never for an Origin-less caller
      // such as another local process or a no-cors request. Header credentials are unaffected.
      if (brokerId === "dhan") {
        if (bc?.clientId && bc?.accessToken) {
          bc = resolveDhanCreds(bc.clientId, bc.accessToken);
        } else {
          const isPortfolio = path === "/api/broker-proxy" && resolveBrokerEndpoint(params.get("endpoint"))?.kind === "portfolio";
          bc = isPortfolio && !origin ? null : creds();
        }
      }
      if (path === "/api/broker-proxy") {
        const { status, body } = await handleBrokerProxy(brokerId, params, bc, { originless: !origin, loopback: isLoopbackAddress(clientIp(req)) });
        return send(res, status, body);
      }
      if (!bc) return send(res, 200, { status: "error", message: "No credentials sent" });
      try {
        const result = await brokerRegistry.get(brokerId).testConnection(bc);
        return send(res, 200, { status: result?.status === "success" ? "success" : "error", message: truncate(result?.message || "", 240) });
      } catch (e) {
        return send(res, 200, { status: "error", message: truncate(e?.message, 200) });
      }
    }
    if (path === "/api/nse-proxy") {
      const { status, body } = await handleNSEProxy(params);
      return send(res, status, body);
    }
    if (path === "/api/yahoo-chart") {
      const { status, body } = await handleYahooChart(params);
      return send(res, status, body);
    }
    if (path === "/api/x/snapshots.csv") {
      const q = parseSnapshotQuery(params);
      const { snapshots, truncated } = await readRecordedSnapshots(recorderState.config.dir, q);
      if (res.headersSent) return;
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${q.symbol}${q.expiry ? `_${q.expiry}` : ""}_snapshots_${istIsoOf(q.from)}.csv"`,
        "X-Truncated": truncated ? "1" : "0",
      });
      return res.end(snapshotsToCsvText(snapshots));
    }
    if (path.startsWith("/api/x/")) {
      const out = await handleX(path.slice("/api/x/".length), params, creds);
      if (!out) return send(res, 404, { data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: "Unknown /api/x route" } });
      return send(res, out.status, out.body);
    }
    if (path === "/api/test-connection") {
      try {
        const c = creds();
        if (!c) return send(res, 200, { status: "error", message: "No Dhan keys. Add them in Broker settings or .env." });
        const result = await dhanFetch("/optionchain/expirylist", { UnderlyingScrip: 13, UnderlyingSeg: "IDX_I" }, c);
        return send(res, 200, { status: "success", message: `Dhan API connected (${(result?.data || []).length} NIFTY expiries)` });
      } catch (e) {
        return send(res, 200, { status: "error", message: truncate(e.message, 200) });
      }
    }
    if (path === "/health") return send(res, 200, healthPayload());
    return send(res, 404, { error: "Not found", routes: ["/api/dhan-proxy", "/api/broker-proxy", "/api/broker-test-connection", "/api/broker-capabilities", "/api/broker-session-login", "/api/nse-proxy", "/api/yahoo-chart", "/api/x/*", "/api/x/snapshots.csv", "/api/test-connection", "/health", "/ws"] });
  } catch (err) {
    if (err instanceof TradeError) {
      // A guard rejection (422) or a credential/body problem: machine-readable code, never a 500, so
      // the client can tell "we refused this" apart from "the upstream broke".
      return send(res, err.statusCode, { status: "error", error: err.message, message: err.message, code: err.code });
    }
    if (isTradeEndpointPath(path, params) && !(err instanceof InputError)) {
      // Real-money paths surface the broker's own error text (e.g. a static-IP rejection) verbatim.
      console.error(`[proxy] trade ${truncate(params.get("endpoint"), 40)}: ${truncate(err?.message, 200)}`);
      return send(res, 502, { status: "error", error: truncate(err?.message, 400), message: truncate(err?.message, 400), code: "UPSTREAM_ERROR" });
    }
    if (err instanceof InputError) {
      if (path.startsWith("/api/x/")) return send(res, 400, { data: null, meta: { source: "cache", asOf: Date.now(), stale: true, reason: truncate(err.message, 200) } });
      return send(res, 400, { status: "error", error: "Bad request", reason: truncate(err.message, 200) });
    }
    console.error(`[proxy] ${path}: ${truncate(err?.message, 200)}`);
    return send(res, 500, { status: "error", error: "Proxy error", reason: truncate(err?.message, 200) });
  }
});

server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try { pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname; } catch { /* bad url */ }
  const origin = req.headers.origin;
  // The feed is shared and runs on the owner's .env token, so the socket address must be trusted
  // (loopback or PROXY_TRUSTED_NETS); a forged Origin header is not enough. A browser must also
  // send an allowed Origin (cross-site WebSocket hijacking defence).
  const originOk = !origin || ALLOWED_ORIGINS.has(origin);
  if (pathname !== "/ws" || !isAllowedHost(req.headers.host) || !originOk || !isTrustedClient(req.socket?.remoteAddress)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  localWSS.handleUpgrade(req, socket, head, (ws) => localWSS.emit("connection", ws, req));
});

export function startServer() {
  server.listen(PORT, HOST, () => {
    const base = `http://${HOST}:${PORT}`;
    console.log("");
    console.log(`  🚀 Mr. Chartist proxy v${VERSION}`);
    console.log(`  ├─ HTTP:      ${base}`);
    console.log(`  ├─ WebSocket: ws://${HOST}:${PORT}/ws`);
    console.log(`  ├─ Health:    ${base}/health`);
    console.log(`  ├─ Envelope:  ${base}/api/x/ban-list (see docs/DATA_ENDPOINTS.md)`);
    console.log(`  └─ Origins:   ${[...ALLOWED_ORIGINS].join(", ")}`);
    console.log("");
    console.log("  Dhan keys in .env:", process.env.DHAN_CLIENT_ID ? "yes" : "no (browser keys are used per request)");
    const rc = recorderState.config;
    console.log("  Snapshot recorder:", rc.enabled ? `on · ${rc.symbols.join(", ")} every ${rc.intervalSec}s · ${rc.dir}` : "off (set RECORD_SYMBOLS=NIFTY,BANKNIFTY to record chains during market hours)");
    console.log("");
    startRecorder();
    // The risk engine's dead-man's switch runs unconditionally, so risk-status can truthfully
    // report "not alive" when no ticks arrive.
    riskEngine.startRiskEngine();
    // Warm up the NSE session so the first request is fast.
    getNseSession().catch(() => undefined);
    try {
      const envCreds = resolveDhanCreds("", "");
      if (envCreds) connectDhanWebSocket(envCreds);
    } catch (e) {
      console.warn(`  ⚠️ ${e.message}`);
    }
  });
}

const isMain = (() => {
  try { return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href; } catch { return false; }
})();

if (isMain) {
  // Runs unattended through the session: log an unexpected rejection instead of exiting and cutting
  // the live feed (and the risk engine) for everyone.
  process.on("unhandledRejection", (reason) => {
    console.error("  ❌ [unhandledRejection]", reason instanceof Error ? reason.stack : reason);
  });
  startServer();
}
