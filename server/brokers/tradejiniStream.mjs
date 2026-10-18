/**
 * Tradejini "NxtradStream" live feed — connection lifecycle + subscriptions.
 *
 * Official docs (checked 2026-10): https://developer.tradejini.com/docs/websocket-sdks and the official TypeScript SDK
 * (lib/NxtradStream.js):
 *  - URL: wss://api.tradejini.com/v2.1/stream?version=3.1&token=<api_key>:<access_token>. No separate login frame;
 *    an expired/invalid token closes the socket with code 4001 "Unauthorized Access".
 *  - Requests are newline-terminated JSON: { type: "L1"|"greeks", action: "sub"|"unsub", tokens: [{ t: "<excToken>_<exch>" }] }.
 *  - REPLACEMENT SEMANTICS: "A subscription request replaces the previous symbol list for that feed — it does not append
 *    to it." (verbatim from https://developer.tradejini.com/docs/websocket-sdks, section 4 "Subscription Replacement
 *    Semantics", re-checked 2026-10; the same section adds that the last request wins). So every subscribe sends the complete list for that feed in ONE frame. (The previous version of this file
 *    sent 100-symbol chunks, so only the last chunk ever streamed, and a second call dropped the first call's symbols.)
 *  - Limits: 5 concurrent connections per user, 3,000 instruments per connection.
 *  - Binary frames are decoded by tradejiniCodec.mjs.
 *
 * One connection per (api key, session) is kept in memory and reused, bounded by upstreamFeedLimits.mjs: closed after
 * two idle minutes with no snapshot request and no live listener, and at most MAX_CONNECTIONS sockets (Tradejini allows
 * 5 per user; least recently used closed first). Ticks of symbols dropped from both feeds are forgotten. The WebSocket
 * class is read from globalThis at connect time, so tests can install a fake one and nothing reaches the network.
 */

import { createHash } from "node:crypto";
import { BrokerError, SessionRequiredError } from "./contract.mjs";
import { getSession, pairedToken } from "./tradejiniAuth.mjs";
import { parseFrame } from "./tradejiniCodec.mjs";
import { sleep } from "../lib/batch.mjs";
import { createFeedPoolGuard } from "./upstreamFeedLimits.mjs";

const WS_URL = "wss://api.tradejini.com/v2.1/stream";
const STREAM_VERSION = "3.1";
const TICK_WAIT_MS = 3000;
const TICK_POLL_MS = 100;
const PING_INTERVAL_MS = 25_000;
export const MAX_INSTRUMENTS_PER_CONN = 3000;
export const MAX_CONNECTIONS = 5;
const OPEN = 1;

const connections = new Map(); // sha256(apiKey:accessToken) -> entry

export const tradejiniFeedGuard = createFeedPoolGuard(connections, {
  label: "Tradejini",
  limits: { maxConnections: MAX_CONNECTIONS, maxSubscriptions: MAX_INSTRUMENTS_PER_CONN },
  isBusy: (entry) => entry.tickListeners.size > 0,
  closeEntry: (_key, entry) => {
    cleanup(entry);
    try { entry.ws?.close(); } catch { /* ignore */ }
  },
});

/** Close every Tradejini socket (session expired, logout, tests). */
export function closeTradejiniStreams() {
  tradejiniFeedGuard.closeAll();
}

/** Test hook: close and forget every connection. */
export function __resetTradejiniStreams() {
  closeTradejiniStreams();
  connections.clear();
}

function keyOf(session) {
  return createHash("sha256").update(pairedToken(session)).digest("hex");
}

function cleanup(entry) {
  entry.connected = false;
  if (entry.pingTimer) { clearInterval(entry.pingTimer); entry.pingTimer = null; }
}

function send(entry, req) {
  if (entry.ws && entry.ws.readyState === OPEN) entry.ws.send(`${JSON.stringify(req)}\n`);
}

/** Send the complete list for one feed (replacement semantics). An empty list unsubscribes the feed. */
function syncFeed(entry, type) {
  const list = [...entry.lists[type]];
  if (list.length === 0) return send(entry, { type, action: "unsub" });
  send(entry, { type, action: "sub", tokens: list.map((t) => ({ t })) });
}

/** Keep each feed under the per-connection cap by dropping the oldest symbols first. */
function capList(set, keep) {
  while (set.size > MAX_INSTRUMENTS_PER_CONN) {
    const oldest = [...set].find((k) => !keep.has(k));
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

/** Forget the last tick of every symbol that is in neither feed any more, so `latest` cannot grow without bound. */
function pruneTicks(entry) {
  for (const k of entry.latest.keys()) {
    if (!entry.lists.L1.has(k) && !entry.lists.greeks.has(k)) entry.latest.delete(k);
  }
}

function openConnection(session, key, entry) {
  const WS = globalThis.WebSocket;
  if (typeof WS !== "function") throw new BrokerError("Tradejini: this Node.js build has no WebSocket client");
  const url = `${WS_URL}?version=${STREAM_VERSION}&token=${encodeURIComponent(pairedToken(session))}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WS(url);
    ws.binaryType = "arraybuffer";
    entry.ws = ws;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new BrokerError("Tradejini stream connection timed out")); }
    }, 10_000);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      entry.connected = true;
      entry.pingTimer = setInterval(() => send(entry, { type: "PING" }), PING_INTERVAL_MS);
      entry.pingTimer.unref?.();
      for (const fn of entry.statusListeners) fn({ connected: true });
      if (!settled) { settled = true; resolve(entry); }
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return; // control/ack frames are JSON text; market data is binary
      try {
        for (const tick of parseFrame(Buffer.from(event.data))) {
          const merged = { ...(entry.latest.get(tick.symbol) || {}), ...tick };
          entry.latest.set(tick.symbol, merged);
          for (const fn of entry.tickListeners) fn(merged);
        }
      } catch (e) {
        console.warn(`[tradejini] stream decode failed: ${e.message}`);
      }
    });

    const onEnd = (reason, code) => {
      clearTimeout(timeout);
      cleanup(entry);
      if (connections.get(key) === entry) connections.delete(key);
      for (const fn of entry.statusListeners) fn({ connected: false, reason });
      if (!settled) {
        settled = true;
        reject(code === 4001 ? new SessionRequiredError("Tradejini: the stream refused the session (4001). Log in again from Broker Settings.") : new BrokerError(`Tradejini stream ${reason}`));
      }
    };
    ws.addEventListener("error", () => onEnd("connection error"));
    ws.addEventListener("close", (ev) => onEnd(ev?.code === 4001 ? "unauthorised (4001)" : "closed", ev?.code));
  });
}

/** The open connection for these creds (opening one if needed). Throws SessionRequiredError without a session. */
export async function getConnection(creds) {
  const session = getSession(creds);
  const key = keyOf(session);
  const existing = connections.get(key);
  if (existing?.connected && existing.ws?.readyState === OPEN) return tradejiniFeedGuard.touch(existing);
  if (existing?.connecting) return existing.connecting;
  if (existing) connections.delete(key);
  tradejiniFeedGuard.beforeOpen();
  const entry = {
    ws: null,
    connected: false,
    latest: new Map(), // "excToken_EXCH" -> merged L1 + greeks fields
    lists: { L1: new Set(), greeks: new Set() },
    tickListeners: new Set(),
    statusListeners: new Set(),
    pingTimer: null,
    connecting: null,
  };
  tradejiniFeedGuard.touch(entry);
  connections.set(key, entry);
  entry.connecting = openConnection(session, key, entry).finally(() => { entry.connecting = null; });
  return entry.connecting;
}

/** Add symbols to a feed and resend that feed's full list. */
export function addSymbols(entry, type, keys) {
  const set = entry.lists[type];
  let added = false;
  for (const k of keys) {
    if (!set.has(k)) { set.add(k); added = true; }
  }
  capList(set, new Set(keys));
  pruneTicks(entry);
  if (added) syncFeed(entry, type);
}

export function removeSymbols(entry, type, keys) {
  const set = entry.lists[type];
  let changed = false;
  for (const k of keys) changed = set.delete(k) || changed;
  pruneTicks(entry);
  if (changed) syncFeed(entry, type);
}

/**
 * Subscribe "excToken_EXCH" keys (L1 always, greeks optionally) and wait up to `windowMs`, or until every key has
 * reported, for ticks. Leaves the socket open and subscribed for reuse.
 */
export async function subscribeAndCollect(creds, keys, { withGreeks = true, windowMs = TICK_WAIT_MS } = {}) {
  const entry = await getConnection(creds);
  if (keys.length > MAX_INSTRUMENTS_PER_CONN) throw new BrokerError(`Tradejini: at most ${MAX_INSTRUMENTS_PER_CONN} instruments per connection`);
  addSymbols(entry, "L1", keys);
  if (withGreeks) addSymbols(entry, "greeks", keys);
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    if (keys.every((k) => entry.latest.get(k)?.ltp !== undefined)) break;
    await sleep(TICK_POLL_MS);
  }
  const out = new Map();
  for (const k of keys) out.set(k, entry.latest.get(k));
  return out;
}
