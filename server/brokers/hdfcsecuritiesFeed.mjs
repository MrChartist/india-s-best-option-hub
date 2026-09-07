/**
 * HDFC Securities (InvestRight) market-data WebSocket client.
 *
 * REST (/fetch-ltp) only returns {ltp, prev_close} — OI, volume and market
 * depth are WebSocket-only (docs: "for OHLC, volume, market depth, OI and
 * Greeks use the WebSocket feed"). So option-chain OI/volume/bid/ask come from
 * a persistent, per-credentials WebSocket connection that's kept open and
 * reused across polls (same pattern as aliceblueAuth.mjs), rather than
 * reconnecting every request.
 *
 * Protocol (see hdfcsecuritiesProtobuf.mjs for the frame decoder):
 *   wss://developer.hdfcsec.com/wsapi/v1/session?token=<accessToken>&api_key=<apiKey>
 *   subscribe:   {"heart_beat": false, "subscribe": [{"scripId": "NFO_48521", "type": "ALL"}]}
 *   unsubscribe: {"heart_beat": false, "unSubscribe": [...]}   (capital S — the server ignores lowercase)
 *   heartbeat:   {"heart_beat": true}   — sent by the client periodically to keep the session alive
 *   frames:      binary protobuf GenericDTOList; JSON text frames are acks/errors
 *
 * NEVER log creds or the WS URL (it carries the access token in the query string).
 */

import { wsUrl } from "./hdfcsecuritiesAuth.mjs";
import { parseFrame } from "./hdfcsecuritiesProtobuf.mjs";
import { batchWithDelay, sleep } from "../lib/batch.mjs";

const MAX_SCRIPS_PER_SUBSCRIBE = 100;
const SUBSCRIBE_DELAY_MS = 300;
const HEARTBEAT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const COLLECT_WINDOW_MS = 4_000;
const COLLECT_POLL_MS = 150;

const connections = new Map(); // credKey -> entry

function credKey(creds) {
  return JSON.stringify(creds || {});
}

function mergeTick(prev, incoming) {
  // Different packet types (mbp/oi/index) refresh different fields at
  // different times; never let a later partial packet zero out a value an
  // earlier one already filled (mirrors openalgo's merge behaviour).
  const merged = { ...(prev || {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if ((v === 0 || v === undefined || v === null) && merged[k]) continue;
    merged[k] = v;
  }
  return merged;
}

function openConnection(creds, key, entry) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(wsUrl(creds));
    ws.binaryType = "arraybuffer";
    entry.ws = ws;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Actively tear down + evict the stuck entry — otherwise this rejected
        // connectingPromise stays cached forever and every future call for
        // these creds would instantly reject with this same stale error
        // instead of retrying (the socket's own error/close events may never
        // fire if the connection attempt is hanging silently, e.g. a dropped
        // TCP handshake behind a firewall).
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        cleanupEntry(entry);
        if (connections.get(key) === entry) connections.delete(key);
        reject(new Error("HDFC Securities WebSocket connection timed out"));
      }
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      entry.connected = true;
      entry.heartbeatTimer = setInterval(() => {
        try {
          ws.send(JSON.stringify({ heart_beat: true }));
        } catch {
          /* next poll reconnects */
        }
      }, HEARTBEAT_MS);
      if (!settled) {
        settled = true;
        resolve(entry);
      }
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return; // JSON acks/errors — nothing this app needs to react to
      const ticks = parseFrame(Buffer.from(event.data));
      for (const tick of ticks) {
        if (tick.kind === "circuit") continue; // band-only refresh, no fields this app uses
        const key2 = String(tick.token);
        entry.latestTicks.set(key2, mergeTick(entry.latestTicks.get(key2), tick));
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      cleanupEntry(entry);
      if (connections.get(key) === entry) connections.delete(key);
      if (!settled) {
        settled = true;
        reject(new Error("HDFC Securities WebSocket connection error"));
      }
    });

    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      cleanupEntry(entry);
      if (connections.get(key) === entry) connections.delete(key);
      if (!settled) {
        settled = true;
        reject(new Error("HDFC Securities WebSocket closed before it became ready"));
      }
    });
  });
}

function cleanupEntry(entry) {
  entry.connected = false;
  if (entry.heartbeatTimer) {
    clearInterval(entry.heartbeatTimer);
    entry.heartbeatTimer = null;
  }
}

async function getConnection(creds) {
  const key = credKey(creds);
  const existing = connections.get(key);
  if (existing?.ws?.readyState === WebSocket.OPEN && existing.connected) return existing;
  if (existing?.connectingPromise) return existing.connectingPromise;

  const entry = {
    ws: null,
    connected: false,
    latestTicks: new Map(), // scripId token (string) -> merged tick
    subscribedScripIds: new Set(),
    heartbeatTimer: null,
    connectingPromise: null,
  };
  entry.connectingPromise = openConnection(creds, key, entry);
  connections.set(key, entry);

  const resolved = await entry.connectingPromise;
  resolved.connectingPromise = null;
  return resolved;
}

/**
 * Subscribe to `scripIds` ("NFO_48521", "NSE_INDEX_26000", ...) and wait up to
 * `windowMs` (or until every one has reported at least once) for ticks.
 * Returns Map<token, tick> keyed by the numeric token embedded in each scripId
 * (matches GenericDTO.instrumentId, which the decoder exposes as `tick.token`).
 * Leaves the connection subscribed + open for reuse by the next call.
 */
export async function subscribeAndCollect(creds, scripIds, windowMs = COLLECT_WINDOW_MS) {
  const entry = await getConnection(creds);
  const newScripIds = scripIds.filter((s) => !entry.subscribedScripIds.has(s));

  if (newScripIds.length) {
    await batchWithDelay(newScripIds, MAX_SCRIPS_PER_SUBSCRIBE, SUBSCRIBE_DELAY_MS, async (chunk) => {
      entry.ws.send(
        JSON.stringify({
          heart_beat: false,
          subscribe: chunk.map((scripId) => ({ scripId, type: "ALL" })),
        })
      );
      chunk.forEach((s) => entry.subscribedScripIds.add(s));
    });
  }

  const tokens = scripIds.map((s) => s.slice(s.lastIndexOf("_") + 1));
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    if (tokens.every((t) => entry.latestTicks.has(t))) break;
    await sleep(COLLECT_POLL_MS);
  }

  const result = new Map();
  for (const t of tokens) result.set(t, entry.latestTicks.get(t));
  return result;
}
