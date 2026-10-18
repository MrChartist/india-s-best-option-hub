/**
 * Pocketful live feed — authenticated WebSocket with binary "detailed marketdata" packets.
 *
 * Official sources (checked 2026-10): https://api.pocketful.in/docs/curl/connecting-websockets and
 * /docs/curl/detailed-marketdata, plus the official JavaScript SDK (PocketfulAPI/wsclient.js, pocketfulwebsocket.js).
 *  - URL: wss://algo.pocketful.in/ws/v1/feeds?login_id=<client id>&access_token=<token> (SDK socketConnect). The docs
 *    page says "wss://algo.pocketful.in/api/v1/ws" without saying how the token is passed; the SDK's working path is used.
 *  - Subscribe: { a: "subscribe", v: [[exchangeCode, token], ...], m: "marketdata" }; unsubscribe with a: "unsubscribe".
 *    Subscriptions add up (the SDK subscribes instrument by instrument), so only new instruments are sent, 50 per frame.
 *  - Heartbeat: { a: "h", v: [], m: "" } (SDK).
 *  - Detailed packets (mode 1) are decoded by pocketfulPacketDecoder.mjs; prices are integer paise.
 *
 * One connection per (token, client id), kept in memory and bounded by upstreamFeedLimits.mjs: closed after two idle
 * minutes with no snapshot request and no live listener, at most FEED_LIMITS.maxConnections sockets (least recently
 * used closed first) and FEED_LIMITS.maxSubscriptions instruments each (oldest unsubscribed first). The WebSocket class
 * is read from globalThis at connect time so tests can install a fake one and nothing reaches the network.
 */

import { createHash } from "node:crypto";
import { BrokerError } from "./contract.mjs";
import { resolveClientId } from "./pocketfulAuth.mjs";
import { decodeDetailedMarketData } from "./pocketfulPacketDecoder.mjs";
import { chunkArray, sleep } from "../lib/batch.mjs";
import { createFeedPoolGuard, trimSubscriptions } from "./upstreamFeedLimits.mjs";

const WS_URL = "wss://algo.pocketful.in/ws/v1/feeds";
const HEARTBEAT_MS = 15_000;
const SUBSCRIBE_CHUNK = 50;
const SUBSCRIBE_GAP_MS = 100;
const TICK_WAIT_MS = 4000;
const TICK_POLL_MS = 100;
const OPEN = 1;

const connections = new Map();

function closeEntry(_key, entry) {
  if (entry.heartbeat) { clearInterval(entry.heartbeat); entry.heartbeat = null; }
  entry.connected = false;
  try { entry.ws?.close(); } catch { /* ignore */ }
}

export const pocketfulFeedGuard = createFeedPoolGuard(connections, {
  label: "Pocketful",
  closeEntry,
  isBusy: (entry) => entry.tickListeners.size > 0,
});

/** Close every Pocketful socket (session expired, logout, tests). */
export function closePocketfulStreams() {
  pocketfulFeedGuard.closeAll();
}

/** Test hook. */
export function __resetPocketfulStreams() {
  closePocketfulStreams();
  connections.clear();
}

export const tickKey = (exchangeCode, token) => `${exchangeCode}|${token}`;

function send(entry, msg) {
  if (entry.ws && entry.ws.readyState === OPEN) entry.ws.send(JSON.stringify(msg));
}

function open(creds, clientId, key, entry) {
  const WS = globalThis.WebSocket;
  if (typeof WS !== "function") throw new BrokerError("Pocketful: this Node.js build has no WebSocket client");
  const url = `${WS_URL}?login_id=${encodeURIComponent(clientId)}&access_token=${encodeURIComponent(creds.accessToken)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WS(url);
    ws.binaryType = "arraybuffer";
    entry.ws = ws;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new BrokerError("Pocketful feed connection timed out")); } }, 10_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      entry.connected = true;
      entry.heartbeat = setInterval(() => send(entry, { a: "h", v: [], m: "" }), HEARTBEAT_MS);
      entry.heartbeat.unref?.();
      for (const fn of entry.statusListeners) fn({ connected: true });
      if (!settled) { settled = true; resolve(entry); }
    });
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") return; // JSON control frames
      const tick = decodeDetailedMarketData(Buffer.from(ev.data));
      if (!tick) return;
      const k = tickKey(tick.exchangeCode, tick.instrumentToken);
      entry.latest.set(k, tick);
      for (const fn of entry.tickListeners) fn(k, tick);
    });
    const end = (reason) => {
      clearTimeout(timer);
      entry.connected = false;
      if (entry.heartbeat) { clearInterval(entry.heartbeat); entry.heartbeat = null; }
      if (connections.get(key) === entry) connections.delete(key);
      for (const fn of entry.statusListeners) fn({ connected: false, reason });
      if (!settled) { settled = true; reject(new BrokerError(`Pocketful feed ${reason}`)); }
    };
    ws.addEventListener("error", () => end("connection error"));
    ws.addEventListener("close", () => end("closed"));
  });
}

export async function getConnection(creds) {
  const clientId = await resolveClientId(creds);
  const key = createHash("sha256").update(`${clientId}|${creds.accessToken}`).digest("hex");
  const existing = connections.get(key);
  if (existing?.connected && existing.ws?.readyState === OPEN) return pocketfulFeedGuard.touch(existing);
  if (existing?.connecting) return existing.connecting;
  if (existing) connections.delete(key);
  pocketfulFeedGuard.beforeOpen();
  const entry = { ws: null, connected: false, latest: new Map(), subscribed: new Set(), tickListeners: new Set(), statusListeners: new Set(), heartbeat: null, connecting: null };
  pocketfulFeedGuard.touch(entry);
  connections.set(key, entry);
  entry.connecting = open(creds, clientId, key, entry).finally(() => { entry.connecting = null; });
  return entry.connecting;
}

/** Subscribe "exchangeCode|token" keys not yet subscribed (50 per frame). */
export async function subscribe(entry, keys) {
  const fresh = keys.filter((k) => !entry.subscribed.has(k));
  // Stay under the per-socket cap: unsubscribe the oldest instruments this request does not need.
  const room = new Set([...entry.subscribed, ...fresh]);
  const dropped = trimSubscriptions(room, new Set(keys), pocketfulFeedGuard.limits.maxSubscriptions).filter((k) => entry.subscribed.has(k));
  if (dropped.length) unsubscribe(entry, dropped);
  const chunks = chunkArray(fresh, SUBSCRIBE_CHUNK);
  for (let i = 0; i < chunks.length; i++) {
    send(entry, { a: "subscribe", v: chunks[i].map((k) => k.split("|").map(Number)), m: "marketdata" });
    chunks[i].forEach((k) => entry.subscribed.add(k));
    if (i < chunks.length - 1) await sleep(SUBSCRIBE_GAP_MS);
  }
}

export function unsubscribe(entry, keys) {
  const gone = keys.filter((k) => entry.subscribed.delete(k));
  for (const k of gone) entry.latest.delete(k);
  for (const chunk of chunkArray(gone, SUBSCRIBE_CHUNK)) send(entry, { a: "unsubscribe", v: chunk.map((k) => k.split("|").map(Number)), m: "marketdata" });
}

/** Subscribe and wait up to `windowMs` (or until every key has a tick). Leaves the socket open for reuse. */
export async function subscribeAndCollect(creds, keys, windowMs = TICK_WAIT_MS) {
  const entry = await getConnection(creds);
  await subscribe(entry, keys);
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    if (keys.every((k) => entry.latest.has(k))) break;
    await sleep(TICK_POLL_MS);
  }
  const out = new Map();
  for (const k of keys) out.set(k, entry.latest.get(k));
  return out;
}
