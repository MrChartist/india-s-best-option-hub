/**
 * Local proxy server for the Mr. Chartist Options Terminal.
 *
 *   1. HTTP proxy to Dhan API v2, NSE India (www + archives), TradingView scanner and Yahoo Finance,
 *      with CORS handled, caching, request coalescing, rate queues and last-good fallbacks.
 *   2. Envelope routes under /api/x/* that always answer { data, meta: { source, asOf, stale, reason? } }.
 *      Row shapes are documented in docs/DATA_ENDPOINTS.md.
 *   3. WebSocket relay: connects to the Dhan live market feed, parses the binary packets and
 *      broadcasts JSON ticks to browser clients on ws://127.0.0.1:4002/ws.
 *
 * Security defaults: binds 127.0.0.1 (PROXY_HOST to change), CORS and WebSocket Origin allowlist
 * (localhost:8080/5173/4001 plus PROXY_ALLOWED_ORIGINS), Host-header allowlist against DNS
 * rebinding (loopback names, origin hosts, PROXY_ALLOWED_HOSTS), .env Dhan keys only for browser
 * or loopback callers, per-IP token bucket, strict input whitelists, upstream timeouts and
 * truncated error bodies.
 *
 * Usage:  npm run proxy   |   npm run dev:live
 * Env:    PROXY_PORT (4002), PROXY_HOST (127.0.0.1), PROXY_ALLOWED_ORIGINS (comma list),
 *         PROXY_ALLOWED_HOSTS (comma list of extra Host names),
 *         DHAN_CLIENT_ID, DHAN_ACCESS_TOKEN (optional; browser keys are sent per request instead)
 */

import http from "node:http";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, mkdirSync, readdirSync, existsSync, unlinkSync, promises as fsp } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { WebSocketServer, WebSocket } from "ws";

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
  tv: new RateQueue(200),
};

// ── Upstream health ──
const upstreamHealth = {
  dhan: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  nse: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  bse: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  yahoo: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
  tv: { lastSuccess: null, lastFailure: null, lastError: null, blockedUntil: null },
};

function markSuccess(source) {
  const h = upstreamHealth[source];
  if (h) h.lastSuccess = Date.now();
}

function markFailure(source, err) {
  const h = upstreamHealth[source];
  if (!h) return;
  h.lastFailure = Date.now();
  h.lastError = truncate(err?.message || String(err), 160);
  if (err?.retryAfterMs) h.blockedUntil = Date.now() + err.retryAfterMs;
}

function isBlocked(source) {
  const h = upstreamHealth[source];
  return !!(h?.blockedUntil && Date.now() < h.blockedUntil);
}

/**
 * fetch() with a timeout, health tracking, Retry-After handling and truncated error bodies.
 * Returns the Response on 2xx; throws UpstreamError otherwise.
 */
async function upstreamFetch(source, url, init = {}, timeoutMs = 15000) {
  if (isBlocked(source)) {
    throw new UpstreamError(source, 429, `${source} rate-limited; retry after ${Math.ceil((upstreamHealth[source].blockedUntil - Date.now()) / 1000)}s`, upstreamHealth[source].blockedUntil - Date.now());
  }
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = new UpstreamError(source, 0, e?.name === "TimeoutError" ? `${source} timed out after ${timeoutMs} ms` : `${source} unreachable: ${truncate(e?.message, 120)}`);
    markFailure(source, err);
    throw err;
  }
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    const retryAfterMs = res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) || 60000 : 0;
    const clean = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const err = new UpstreamError(source, res.status, `${source} HTTP ${res.status}: ${truncate(clean, 160)}`, retryAfterMs);
    markFailure(source, err);
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
  return queue.schedule(async () => {
    const res = await upstreamFetch("dhan", `${DHAN_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "access-token": creds.accessToken, "client-id": creds.clientId },
      body: JSON.stringify(body),
    }, timeoutMs);
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
    }, timeoutMs);
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
// ── SECTION 3b: TradingView scanner ──
// ══════════════════════════════════════════════

const FNO_TICKERS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BHARTIARTL","ITC","KOTAKBANK","LT","AXISBANK",
  "ASIANPAINT","MARUTI","TATAMOTORS","SUNPHARMA","TITAN","WIPRO","ULTRACEMCO","BAJFINANCE","HCLTECH","NTPC","POWERGRID",
  "ONGC","ADANIENT","ADANIPORTS","COALINDIA","DRREDDY","NESTLEIND","CIPLA","BAJAJFINSV","GRASIM","JSWSTEEL","BRITANNIA",
  "TECHM","INDUSINDBK","HINDALCO","M_M","APOLLOHOSP","EICHERMOT","DIVISLAB","BPCL","HEROMOTOCO","TATASTEEL","SBILIFE",
  "HDFCLIFE","SHRIRAMFIN","TRENT","BAJAJ_AUTO","BANKBARODA","PNB","CANBK","IDFCFIRSTB","FEDERALBNK","BANDHANBNK",
  "RBLBANK","AUBANK","MANAPPURAM","MUTHOOTFIN","CHOLAFIN","LICHSGFIN","CANFINHOME","RECLTD","PFC","HAL","BEL","BHEL",
  "IRCTC","ETERNAL","PAYTM","DLF","GODREJPROP","OBEROIRLTY","VEDL","JINDALSTEL","SAIL","NMDC","IOC","GAIL","TATAPOWER",
  "SIEMENS","ABB","VOLTAS","HAVELLS","POLYCAB","LTIM","MPHASIS","COFORGE","PERSISTENT","TORNTPHARM","LUPIN","AUROPHARMA",
  "BIOCON","GODREJCP","DABUR","MARICO","COLPAL","MCX","INDIGO","TVSMOTOR","MRF","ASHOKLEY","DIXON","CROMPTON","JUBLFOOD",
].map((s) => `NSE:${s}`);
const INDEX_TICKERS = ["NSE:NIFTY", "NSE:BANKNIFTY", "NSE:CNXFINANCE", "BSE:SENSEX"];

async function handleTradingViewScan(params) {
  const scanType = vEnum(params.get("type"), new Set(["stocks", "indices"]), "stocks", "type");
  const key = `tv:scan:${scanType}`;
  const hit = cache.get(key);
  if (hit) return { status: 200, body: hit };
  const isIndices = scanType === "indices";
  const columns = ["name", "description", "close", "change", "change_abs", "volume", "open", "high", "low", "Perf.W", "Perf.1M", "market_cap_basic", "average_volume_10d_calc", ...(isIndices ? [] : ["sector"])];
  try {
    const out = await coalesce(key, () => queues.tv.schedule(async () => {
      const res = await upstreamFetch("tv", "https://scanner.tradingview.com/india/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA, Referer: "https://www.tradingview.com/" },
        body: JSON.stringify({ symbols: { tickers: isIndices ? INDEX_TICKERS : FNO_TICKERS }, columns }),
      });
      const raw = await res.json();
      markSuccess("tv");
      const stocks = (raw.data || []).map((item) => {
        const d = item.d || [];
        const o = {};
        columns.forEach((c, i) => { o[c] = d[i]; });
        const [exchange, sym] = String(item.s || "").split(":");
        const symbol = (sym || o.name || "").replace(/_/g, (m, i, s) => (s === "M_M" ? "&" : "-"));
        return {
          symbol, name: o.description || symbol, exchange: exchange || "NSE", ltp: o.close || 0, change: o.change || 0,
          changeAbs: o.change_abs || 0, changePercent: o.change || 0, volume: o.volume || 0, open: o.open || 0, high: o.high || 0,
          low: o.low || 0, weekChange: o["Perf.W"] || 0, monthChange: o["Perf.1M"] || 0, marketCap: o.market_cap_basic || 0,
          avgVolume10d: o.average_volume_10d_calc || 0, sector: o.sector || "",
        };
      });
      return { stocks, totalCount: raw.totalCount, timestamp: Date.now() };
    }));
    cache.set(key, out, 15000);
    setLastGood(`lastgood:tv:${scanType}`, out, "tv");
    return { status: 200, body: out };
  } catch (e) {
    const lg = getLastGood(`lastgood:tv:${scanType}`);
    if (lg) return { status: 200, body: { ...lg.data, stale: true, cachedAt: lg.timestamp } };
    return { status: 502, body: { error: "TradingView scanner unavailable", reason: truncate(e.message, 200) } };
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

async function yahooChart(symbol, interval, fromIso, toIso) {
  const ySym = YAHOO_SYMBOL_MAP[symbol] || `${symbol}.NS`;
  const yInt = YAHOO_INTERVAL[interval] || "1d";
  const now = Math.floor(Date.now() / 1000);
  // Dates are IST calendar days: start at 00:00 IST, end at 23:59 IST.
  const p1 = fromIso ? Math.floor(Date.parse(`${fromIso}T00:00:00+05:30`) / 1000) : now - 365 * 86400;
  const p2 = toIso ? Math.min(now, Math.floor(Date.parse(`${toIso}T23:59:59+05:30`) / 1000)) : now;
  const key = `yahoo:${ySym}:${yInt}:${p1}:${p2}`;
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

/** Latest available participant file on or before `dateIso` (walks back over weekdays). */
async function latestParticipant(kind, dateIso) {
  let lastErr = null;
  for (const d of recentWeekdays(dateIso, 6)) {
    try {
      return await participantFile(kind, d);
    } catch (e) {
      lastErr = e;
      if (e?.status && e.status !== 404 && e.status !== 403) break;
    }
  }
  throw lastErr || new Error("No participant file found");
}

/** Default "latest" date: today after 19:00 IST, otherwise yesterday. */
function defaultArchiveDate() {
  const t = istNow();
  return t.hh >= 19 ? t.iso : addDaysIso(t.iso, -1);
}

async function participantHistory(days) {
  const out = [];
  const dates = recentWeekdays(defaultArchiveDate(), Math.ceil(days * 1.5) + 4);
  for (const d of dates) {
    if (out.length >= days) break;
    try {
      out.push(...(await participantFile("oi", d)));
      // keep counting distinct dates below
    } catch (e) {
      if (e?.status === 429) break;
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

// ── /api/x router ──

async function handleX(route, params, creds) {
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
            if (e?.status && e.status !== 404 && e.status !== 403) break;
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
        return { data: normaliseOiSpurts(json, type) };
      });
    }

    case "most-active": {
      const type = vEnum(params.get("type"), new Set(["contracts", "futures"]), "contracts", "type");
      const sort = vEnum(params.get("sort"), new Set(["volume", "value"]), "volume", "sort");
      return envelope(`most-active:${type}:${sort}`, 2 * 60000, "nse", async () => {
        const json = await nseJson(`/api/snapshot-derivatives-equity?index=${type}&limit=20`, { referer: `${NSE_BASE}/market-data/most-active-contracts` });
        return { data: normaliseMostActive(json?.[sort]?.data) };
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
            try { rows = await bhavcopyRows(d); usedDate = d; break; } catch (e) { lastErr = e; if (e?.status && e.status !== 404 && e.status !== 403) break; }
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
        const list = Array.isArray(json) ? json : json?.data || [];
        return { data: list.map((d) => ({ symbol: String(d.symbol || "").toUpperCase(), company: d.company || "", purpose: d.purpose || "", description: d.bm_desc || "", date: toIso(d.date || "") })).filter((d) => d.symbol && d.date) };
      });

    case "bulk-deals":
    case "block-deals": {
      const field = route === "bulk-deals" ? "BULK_DEALS_DATA" : "BLOCK_DEALS_DATA";
      return envelope(route, 15 * 60000, "nse", async () => {
        const json = await nseJson("/api/snapshot-capital-market-largedeal", { referer: `${NSE_BASE}/market-data/large-deals` });
        return { data: normaliseDeals(json?.[field]) };
      });
    }

    case "chain-multi": {
      const symbol = vSymbol(params.get("symbol"), "NIFTY");
      const raw = String(params.get("expiries") || "next3");
      if (raw !== "next3" && raw !== "all" && !/^[0-9A-Za-z,-]{10,120}$/.test(raw)) throw new InputError("expiries must be next3, all or a comma list of dates");
      return envelope(`chain-multi:${symbol}:${raw}:${creds ? `d${credTag(creds)}` : "n"}`, 15000, creds ? "dhan" : "nse", () => chainMulti(symbol, raw, creds));
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

const latestTicks = new Map(); // "segment:id" → merged tick
const subscribed = new Map(); // "segment:id" → { ExchangeSegment, SecurityId }
for (const id of Object.values(INDEX_SECURITY_IDS)) subscribed.set(`IDX_I:${id}`, { ExchangeSegment: "IDX_I", SecurityId: String(id) });

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
    try { dhanWS.removeAllListeners(); dhanWS.terminate(); } catch { /* ignore */ }
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
    try { dhanWS.removeAllListeners(); dhanWS.on("error", () => undefined); dhanWS.terminate(); } catch { /* ignore */ }
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
        const fresh = list.filter((i) => !subscribed.has(`${i.ExchangeSegment}:${i.SecurityId}`));
        if (subscribed.size + fresh.length > 4000) throw new InputError("Subscription limit reached");
        for (const i of fresh) subscribed.set(`${i.ExchangeSegment}:${i.SecurityId}`, i);
        sendSubscriptions(fresh);
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

/**
 * Whether a request may fall back to the .env Dhan credentials. Browsers always send Origin on
 * cross-origin requests, so a request without one is a non-browser client; only trust it when it
 * comes from this machine. Requests that bring their own header credentials are unaffected.
 */
function mayUseEnvCreds(req) {
  return !!req.headers.origin || isLoopbackAddress(clientIp(req));
}

function send(res, status, body, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body));
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
    sources: { dhan: !!(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN), nse: true, tradingview: true, yahoo: true },
    cache: { entries: cache.size, lastGood: lastGood.size, inflight: inflight.size },
    security: { host: HOST, allowedOrigins: [...ALLOWED_ORIGINS] },
  };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedHost(req.headers.host)) return send(res, 403, { error: "Host not allowed", reason: "Add this host to PROXY_ALLOWED_HOSTS" });
  if (!isAllowedOrigin(origin)) return send(res, 403, { error: "Origin not allowed", reason: `Add ${truncate(origin, 80)} to PROXY_ALLOWED_ORIGINS` });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dhan-client-id, x-dhan-access-token");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  if (!takeToken(clientIp(req))) return send(res, 429, { error: "Too many requests", reason: "Slow down: per-IP rate limit" }, { "Retry-After": "1" });

  let url;
  try { url = new URL(req.url, `http://${HOST}:${PORT}`); } catch { return send(res, 400, { error: "Bad URL" }); }
  const params = url.searchParams;
  const path = url.pathname.replace(/\/+$/, "") || "/";

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

    if (path === "/api/dhan-proxy") {
      const { status, body } = await handleDhanProxy(params, creds());
      return send(res, status, body);
    }
    if (path === "/api/nse-proxy") {
      const { status, body } = await handleNSEProxy(params);
      return send(res, status, body);
    }
    if (path === "/api/tv-scan") {
      const { status, body } = await handleTradingViewScan(params);
      return send(res, status, body);
    }
    if (path === "/api/yahoo-chart") {
      const { status, body } = await handleYahooChart(params);
      return send(res, status, body);
    }
    if (path.startsWith("/api/x/")) {
      const out = await handleX(path.slice("/api/x/".length), params, creds());
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
    return send(res, 404, { error: "Not found", routes: ["/api/dhan-proxy", "/api/nse-proxy", "/api/tv-scan", "/api/yahoo-chart", "/api/x/*", "/api/test-connection", "/health", "/ws"] });
  } catch (err) {
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
  // No Origin means a non-browser client: only accept those from this machine.
  const originOk = origin ? ALLOWED_ORIGINS.has(origin) : isLoopbackAddress(req.socket?.remoteAddress);
  if (pathname !== "/ws" || !isAllowedHost(req.headers.host) || !originOk) {
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
    console.log("");
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

if (isMain) startServer();
