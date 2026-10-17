/**
 * Tradejini "NxtradStream" live feed client — connection lifecycle + subscribe.
 *
 * Tradejini's REST API has no multi-symbol quote or option-chain endpoint —
 * all live prices (and, usefully, server-computed IV/Greeks) come from a
 * persistent authenticated WebSocket, confirmed against marketcalls/openalgo's
 * production broker/tradejini/api/{data,nxtradstream}.py (the only reference
 * for this broker; no public docs mirror exists). Same shape as this app's
 * Alice Blue integration (persistent WS instead of REST quotes), except
 * Tradejini's wire format is a custom binary protocol, decoded by
 * tradejiniCodec.mjs.
 *
 * One persistent connection per distinct credential set, cached in-memory and
 * reused across calls (per-connect handshake cost + Tradejini's documented
 * ~3,000-instrument-per-connection cap make reconnecting per request wasteful).
 */

import { getSession } from "./tradejiniAuth.mjs";
import { parseFrame } from "./tradejiniCodec.mjs";
import { batchWithDelay, sleep } from "../lib/batch.mjs";

const WS_HOST = "api.tradejini.com";
const STREAM_VERSION = "3.1";
const TICK_WAIT_MS = 3000;
const TICK_POLL_MS = 150;
const PING_INTERVAL_MS = 25_000;
const SUB_CHUNK_SIZE = 100; // practical batch size for subscribe writes, not a documented hard cap
const MAX_INSTRUMENTS_PER_CONN = 3000; // documented Tradejini WS cap (see data.py get_multiquotes docstring)

const wsCache = new Map(); // credKey -> connection entry

function credKey(creds) {
  return JSON.stringify(creds || {});
}

function cleanup(entry) {
  entry.connected = false;
  if (entry.pingTimer) { clearInterval(entry.pingTimer); entry.pingTimer = null; }
}

async function openConnection(creds, key, entry) {
  const session = await getSession(creds);
  const wsToken = `${session.apiKey}:${session.accessToken}`;
  const url = `wss://${WS_HOST}/v2.1/stream?token=${encodeURIComponent(wsToken)}&version=${STREAM_VERSION}`;

  await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    entry.ws = ws;

    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("Tradejini WebSocket connection timed out")); }
    }, 10_000);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      entry.connected = true;
      entry.pingTimer = setInterval(() => {
        try { ws.send(`${JSON.stringify({ type: "PING" })}\n`); } catch { /* next poll reconnects */ }
      }, PING_INTERVAL_MS);
      if (!settled) { settled = true; resolve(); }
    });

    ws.addEventListener("message", (event) => {
      try {
        const buf = Buffer.from(event.data);
        for (const tick of parseFrame(buf)) {
          entry.latestTicks.set(tick.symbol, { ...(entry.latestTicks.get(tick.symbol) || {}), ...tick });
        }
      } catch (e) {
        console.warn(`[tradejini] WS message decode failed: ${e.message}`);
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanup(entry);
      if (wsCache.get(key) === entry) wsCache.delete(key);
      if (!settled) { settled = true; reject(new Error("Tradejini WebSocket connection error")); }
    });

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      cleanup(entry);
      if (wsCache.get(key) === entry) wsCache.delete(key);
      if (!settled) { settled = true; reject(new Error("Tradejini WebSocket closed before authentication")); }
    });
  });

  return entry;
}

async function getConnection(creds) {
  const key = credKey(creds);
  const existing = wsCache.get(key);
  if (existing?.ws && existing.ws.readyState === WebSocket.OPEN && existing.connected) return existing;
  if (existing?.connectingPromise) return existing.connectingPromise;

  const entry = {
    ws: null,
    connected: false,
    latestTicks: new Map(), // "token_EXCH" -> merged L1 + Greeks fields
    subscribed: new Set(),
    pingTimer: null,
    connectingPromise: null,
  };
  entry.connectingPromise = openConnection(creds, key, entry);
  wsCache.set(key, entry);

  const resolved = await entry.connectingPromise;
  resolved.connectingPromise = null;
  return resolved;
}

/**
 * Subscribe to a batch of "token_EXCH" keys (L1 always, Greeks optionally) and
 * wait up to `windowMs` (or until every key has reported at least once) for
 * the feed to push ticks. Leaves the socket subscribed + open for reuse.
 */
export async function subscribeAndCollect(creds, tickKeys, { withGreeks = true, windowMs = TICK_WAIT_MS } = {}) {
  const entry = await getConnection(creds);
  const newKeys = tickKeys.filter((k) => !entry.subscribed.has(k));

  if (entry.subscribed.size + newKeys.length > MAX_INSTRUMENTS_PER_CONN) {
    console.warn(`[tradejini] subscription count would exceed the documented ${MAX_INSTRUMENTS_PER_CONN}-instrument cap`);
  }

  if (newKeys.length) {
    await batchWithDelay(newKeys, SUB_CHUNK_SIZE, 150, async (chunk) => {
      const tokens = chunk.map((t) => ({ t }));
      entry.ws.send(`${JSON.stringify({ type: "L1", action: "sub", tokens })}\n`);
      if (withGreeks) entry.ws.send(`${JSON.stringify({ type: "greeks", action: "sub", tokens })}\n`);
      chunk.forEach((k) => entry.subscribed.add(k));
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
