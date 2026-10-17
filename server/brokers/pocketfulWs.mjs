/**
 * Pocketful live quotes — persistent authenticated WebSocket feed.
 *
 * Pocketful's REST API has no multi-symbol quote or option-chain endpoint at
 * all (confirmed against OpenAlgo's production adapter, broker/pocketful/api/data.py
 * — its own get_quotes()/get_multiquotes() go through this exact WebSocket,
 * with no REST fallback). Same shape as Alice Blue's integration in this
 * codebase (aliceblueAuth.mjs) — subscribe to the tokens we need and collect
 * whatever ticks arrive within a short window — except Pocketful's feed is a
 * binary protocol (pocketfulPacketDecoder.mjs) authenticated via query-string
 * params rather than a post-connect login frame.
 *
 * Connection is cached per credential set (module-level Map) and reused
 * across calls; Pocketful's documented per-message subscribe batch size is 50
 * instruments (OpenAlgo's own BATCH_SIZE constant for this broker), which we
 * mirror via batchWithDelay.
 *
 * NEVER log accessToken — only field names / presence / status codes.
 */

import { resolveClientId, credKey } from "./pocketfulAuth.mjs";
import { decodeDetailedMarketData } from "./pocketfulPacketDecoder.mjs";
import { batchWithDelay, sleep } from "../lib/batch.mjs";

const WS_BASE = "wss://trade.pocketful.in/ws/v1/feeds";
const HEARTBEAT_MS = 15_000;
const SUBSCRIBE_CHUNK = 50;
const SUBSCRIBE_CHUNK_DELAY_MS = 150;
const TICK_WAIT_MS = 4_000;
const TICK_POLL_MS = 200;

const wsCache = new Map(); // credKey -> connection entry

function cleanupEntry(entry) {
  entry.authenticated = false;
  if (entry.heartbeatTimer) { clearInterval(entry.heartbeatTimer); entry.heartbeatTimer = null; }
}

// `entry` is created and cached by getConnection *before* this function's first
// await, and mutated in place throughout the handshake, so a second caller
// arriving mid-connect joins the same in-flight connection instead of opening
// a duplicate socket (same pattern as aliceblueAuth.mjs's openWsConnection).
async function openConnection(creds, key, entry) {
  const clientId = await resolveClientId(creds);
  const url = `${WS_BASE}?login_id=${encodeURIComponent(clientId)}&access_token=${encodeURIComponent(creds.accessToken)}`;

  await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    entry.ws = ws;

    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("Pocketful WebSocket connection timed out")); }
    }, 10_000);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      entry.authenticated = true;
      entry.heartbeatTimer = setInterval(() => {
        try { ws.send(JSON.stringify({ a: "h" })); } catch { /* next poll reconnects */ }
      }, HEARTBEAT_MS);
      if (!settled) { settled = true; resolve(); }
    });

    ws.addEventListener("message", (event) => {
      if (!(event.data instanceof ArrayBuffer)) return; // ignore any JSON control frames
      const buf = Buffer.from(event.data);
      const tick = decodeDetailedMarketData(buf);
      if (!tick) return;
      entry.latestTicks.set(`${tick.exchangeCode}|${tick.instrumentToken}`, tick);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanupEntry(entry);
      if (wsCache.get(key) === entry) wsCache.delete(key);
      if (!settled) { settled = true; reject(new Error("Pocketful WebSocket connection error")); }
    });

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      cleanupEntry(entry);
      if (wsCache.get(key) === entry) wsCache.delete(key);
      if (!settled) { settled = true; reject(new Error("Pocketful WebSocket closed before it opened")); }
    });
  });

  return entry;
}

async function getConnection(creds) {
  const key = credKey(creds);
  const existing = wsCache.get(key);
  if (existing && existing.ws && existing.ws.readyState === WebSocket.OPEN && existing.authenticated) {
    return existing;
  }
  if (existing?.connectingPromise) return existing.connectingPromise;

  const entry = {
    ws: null,
    authenticated: false,
    latestTicks: new Map(), // "exchangeCode|instrumentToken" -> decoded tick
    subscribedKeys: new Set(),
    heartbeatTimer: null,
    connectingPromise: null,
  };
  entry.connectingPromise = openConnection(creds, key, entry);
  wsCache.set(key, entry);

  const resolved = await entry.connectingPromise;
  resolved.connectingPromise = null;
  return resolved;
}

/**
 * Subscribe to a batch of "exchangeCode|instrumentToken" keys and wait up to
 * `windowMs` (or until every key has reported at least once) for ticks to
 * arrive. Leaves the socket subscribed + open for reuse by the next call.
 */
export async function subscribeAndCollect(creds, tickKeys, windowMs = TICK_WAIT_MS) {
  const entry = await getConnection(creds);
  const newKeys = tickKeys.filter((k) => !entry.subscribedKeys.has(k));

  if (newKeys.length) {
    await batchWithDelay(newKeys, SUBSCRIBE_CHUNK, SUBSCRIBE_CHUNK_DELAY_MS, async (chunk) => {
      const v = chunk.map((k) => k.split("|").map(Number));
      entry.ws.send(JSON.stringify({ a: "subscribe", v, m: "marketdata" }));
      chunk.forEach((k) => entry.subscribedKeys.add(k));
    });
  }

  const start = Date.now();
  while (Date.now() - start < windowMs) {
    if (tickKeys.every((k) => entry.latestTicks.has(k))) break;
    await sleep(TICK_POLL_MS);
  }

  const result = new Map();
  for (const k of tickKeys) result.set(k, entry.latestTicks.get(k));
  return result;
}
