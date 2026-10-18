/**
 * Market-data WebSocket client shared by the two HDFC Securities products (InvestRight and HDFC Sky).
 * Both publish the same gateway design and the same GenericDTO protobuf schema
 * (hdfcsecuritiesProtobuf.mjs); only the host differs. Both products are owned by this adapter group,
 * so hdfcsky.mjs imports from here.
 *
 * Official docs:
 *   https://developer.hdfcsec.com/ir-docs/docs/market_data_websocket
 *   https://developer.hdfcsky.com/sky-docs/docs/websocket
 *   endpoint     wss://<host>/wsapi/v1/session
 *   subscribe    {"heart_beat": false, "subscribe":   [{"scripId": "NFO_48521", "type": "ALL"}]}
 *   unsubscribe  {"heart_beat": false, "unSubscribe": [{"scripId": "NFO_48521", "type": "ALL"}]}
 *   heartbeat    {"heart_beat": true}
 *   scripId      <PREFIX>_<TOKEN>; prefixes NSE, NFO, NCD, NSE_INDEX, BSE, BFO, BSE_INDEX, MCX
 *   limits       InvestRight: 1500 instruments per connection; HDFC Sky: 300; both: 3 connections per key.
 * The docs do not say how the socket authenticates. The access token and api key travel on the query
 * string as `token` and `api_key` (the browser WebSocket API cannot set headers); this is the one fact
 * taken from OpenAlgo that the official docs leave out, so it needs live verification.
 *
 * Two entry points:
 *  - createSnapshotPool(): a per-credential persistent socket used by REST-shaped calls (option chain,
 *    depth) to collect one tick per instrument within a short window. The pool is bounded by
 *    upstreamFeedLimits.mjs: a socket with no snapshot request for two minutes is closed, at most
 *    FEED_LIMITS.maxConnections sockets stay open (least recently used closed first), and each keeps at most
 *    FEED_LIMITS.maxSubscriptions instruments (oldest unsubscribed, and its tick forgotten, first).
 *  - openStreamingFeed(): the contract's createFeed() for a caller that wants a live stream.
 * The URL carries the token, so it is never logged; errors only say what failed.
 */

import { createHash } from "node:crypto";
import { parseFrame } from "./hdfcsecuritiesProtobuf.mjs";
import { batchWithDelay, sleep } from "../lib/batch.mjs";
import { createFeedPoolGuard, trimSubscriptions } from "./upstreamFeedLimits.mjs";

const SUBSCRIBE_CHUNK = 100;
const SUBSCRIBE_DELAY_MS = 300;
const HEARTBEAT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const COLLECT_WINDOW_MS = 4_000;
const COLLECT_POLL_MS = 150;

/** WebSocket implementation (swappable in tests; Node 22+ has a global WebSocket). */
let WebSocketImpl = globalThis.WebSocket;
export function setHdfcWebSocketImpl(impl) {
  WebSocketImpl = impl ?? globalThis.WebSocket;
}

/** scripId prefix for a contract exchange + token (indices use a reserved token band on NSE/BSE). */
export function scripPrefix(exchange, token, { isIndex = false } = {}) {
  const ex = String(exchange || "").toUpperCase();
  if (isIndex || ex === "NSE_INDEX" || ex === "BSE_INDEX") return ex.startsWith("BSE") ? "BSE_INDEX" : "NSE_INDEX";
  if (ex === "CDS") return "NCD";
  return ex;
}

export function scripIdFor(exchange, token, opts) {
  return `${scripPrefix(exchange, token, opts)}_${token}`;
}

/** Later partial packets (OI-only, index) must not zero out fields an earlier packet filled. */
export function mergeTick(prev, incoming) {
  const merged = { ...(prev || {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if ((v === 0 || v === undefined || v === null) && merged[k]) continue;
    if (k === "depth" && v && !v.buy?.length && !v.sell?.length && merged.depth) continue;
    merged[k] = v;
  }
  return merged;
}

function frameBytes(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function credKey(creds) {
  return createHash("sha256").update(`${creds?.apiKey ?? ""}|${creds?.accessToken ?? ""}`).digest("hex");
}

/**
 * Persistent per-credential snapshot sockets. `wsUrlFor(creds)` builds the authenticated URL.
 * Returns { subscribeAndCollect(creds, scripIds, windowMs) -> Map<token, tick>, closeAll() }.
 */
export function createSnapshotPool({ label, wsUrlFor, limits = {} }) {
  const connections = new Map();

  function cleanup(entry, key) {
    entry.connected = false;
    if (entry.heartbeat) clearInterval(entry.heartbeat);
    entry.heartbeat = null;
    if (connections.get(key) === entry) connections.delete(key);
  }

  const guard = createFeedPoolGuard(connections, {
    label,
    limits,
    closeEntry: (key, entry) => {
      cleanup(entry, key);
      try { entry.ws?.close(); } catch { /* ignore */ }
    },
  });

  function open(creds, key, entry) {
    return new Promise((resolve, reject) => {
      if (typeof WebSocketImpl !== "function") {
        reject(new Error(`${label} market feed needs a WebSocket implementation (Node 22+).`));
        return;
      }
      let settled = false;
      const ws = new WebSocketImpl(wsUrlFor(creds));
      ws.binaryType = "arraybuffer";
      entry.ws = ws;
      const fail = (why) => {
        cleanup(entry, key);
        if (!settled) {
          settled = true;
          reject(new Error(`${label} market feed ${why}`));
        }
      };
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        fail("connection timed out");
      }, CONNECT_TIMEOUT_MS);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        entry.connected = true;
        entry.heartbeat = setInterval(() => {
          try { ws.send(JSON.stringify({ heart_beat: true })); } catch { /* the next call reconnects */ }
        }, HEARTBEAT_MS);
        entry.heartbeat.unref?.();
        if (!settled) {
          settled = true;
          resolve(entry);
        }
      });
      ws.addEventListener("message", (event) => {
        const bytes = frameBytes(event.data);
        if (!bytes) return; // JSON text frames are acks or errors
        for (const tick of parseFrame(bytes)) {
          if (tick.kind === "circuit") continue;
          const t = String(tick.token);
          entry.ticks.set(t, mergeTick(entry.ticks.get(t), tick));
        }
      });
      ws.addEventListener("error", () => { clearTimeout(timer); fail("connection error"); });
      ws.addEventListener("close", () => { clearTimeout(timer); fail("closed before it became ready"); });
    });
  }

  async function connection(creds) {
    const key = credKey(creds);
    const existing = connections.get(key);
    if (existing?.connected && existing.ws?.readyState === 1) return guard.touch(existing);
    if (existing?.pending) return existing.pending;
    if (existing) connections.delete(key);
    guard.beforeOpen();
    const entry = { ws: null, connected: false, ticks: new Map(), subscribed: new Set(), heartbeat: null, pending: null };
    guard.touch(entry);
    connections.set(key, entry);
    entry.pending = open(creds, key, entry);
    try {
      return await entry.pending;
    } finally {
      entry.pending = null;
    }
  }

  async function subscribeAndCollect(creds, scripIds, windowMs = COLLECT_WINDOW_MS) {
    const entry = await connection(creds);
    const fresh = scripIds.filter((s) => !entry.subscribed.has(s));
    // Stay under the per-socket cap: unsubscribe the oldest instruments this request does not need.
    const room = new Set([...entry.subscribed, ...fresh]);
    const dropped = trimSubscriptions(room, new Set(scripIds), guard.limits.maxSubscriptions).filter((s) => entry.subscribed.has(s));
    if (dropped.length) {
      dropped.forEach((s) => { entry.subscribed.delete(s); entry.ticks.delete(s.slice(s.lastIndexOf("_") + 1)); });
      entry.ws.send(JSON.stringify({ heart_beat: false, unSubscribe: dropped.map((scripId) => ({ scripId, type: "ALL" })) }));
    }
    if (fresh.length) {
      await batchWithDelay(fresh, SUBSCRIBE_CHUNK, SUBSCRIBE_DELAY_MS, async (chunk) => {
        entry.ws.send(JSON.stringify({ heart_beat: false, subscribe: chunk.map((scripId) => ({ scripId, type: "ALL" })) }));
        chunk.forEach((s) => entry.subscribed.add(s));
      });
    }
    const tokens = scripIds.map((s) => s.slice(s.lastIndexOf("_") + 1));
    const start = Date.now();
    while (Date.now() - start < windowMs) {
      if (tokens.every((t) => entry.ticks.has(t))) break;
      await sleep(COLLECT_POLL_MS);
    }
    const out = new Map();
    for (const t of tokens) if (entry.ticks.has(t)) out.set(t, entry.ticks.get(t));
    return out;
  }

  function closeAll() {
    guard.closeAll();
  }

  return { subscribeAndCollect, closeAll, sweepIdle: guard.sweep, size: () => connections.size };
}

/** Feed tick -> contract Quote. `ref` is the subscribed { token, exchange }. */
export function tickToQuote(tick, ref) {
  const bid = tick.depth?.buy?.[0]?.price;
  const ask = tick.depth?.sell?.[0]?.price;
  const numOrNull = (v) => (Number.isFinite(v) && v !== 0 ? v : null);
  return {
    token: String(ref.token),
    exchange: ref.exchange,
    ltp: Number(tick.ltp) || 0,
    open: numOrNull(tick.open),
    high: numOrNull(tick.high),
    low: numOrNull(tick.low),
    close: numOrNull(tick.close),
    volume: Number.isFinite(tick.volume) ? tick.volume : null,
    oi: Number.isFinite(tick.oi) ? tick.oi : null,
    bid: numOrNull(bid),
    ask: numOrNull(ask),
  };
}

/** Feed tick -> contract Depth. */
export function tickToDepth(tick) {
  const side = (levels) => (levels || []).map((l) => ({ price: Number(l.price) || 0, qty: Number(l.quantity) || 0, orders: Number.isFinite(l.orders) ? l.orders : null }));
  return { bids: side(tick?.depth?.buy), asks: side(tick?.depth?.sell) };
}

/**
 * The contract's createFeed(): one socket per call. `refToScripId(ref)` maps an InstrumentRef to the
 * broker scripId. Ticks are keyed by token only (GenericDTO carries instrumentId, not the exchange), so
 * a token subscribed on two exchanges at once is reported against the first ref.
 */
export function openStreamingFeed({ label, url, refToScripId, onTick = () => {}, onStatus = () => {} }) {
  if (typeof WebSocketImpl !== "function") throw new Error(`${label} market feed needs a WebSocket implementation (Node 22+).`);
  const refsByToken = new Map();
  const ticks = new Map();
  const queued = [];
  let ws = new WebSocketImpl(url);
  ws.binaryType = "arraybuffer";
  let open = false;
  let heartbeat = null;

  const send = (msg) => {
    if (open) ws.send(JSON.stringify(msg));
    else queued.push(msg);
  };
  ws.addEventListener("open", () => {
    open = true;
    heartbeat = setInterval(() => { try { ws.send(JSON.stringify({ heart_beat: true })); } catch { /* ignore */ } }, HEARTBEAT_MS);
    for (const msg of queued.splice(0)) ws.send(JSON.stringify(msg));
    onStatus({ connected: true });
  });
  ws.addEventListener("message", (event) => {
    const bytes = frameBytes(event.data);
    if (!bytes) return;
    for (const tick of parseFrame(bytes)) {
      if (tick.kind === "circuit") continue;
      const token = String(tick.token);
      const ref = refsByToken.get(token);
      if (!ref) continue;
      const merged = mergeTick(ticks.get(token), tick);
      ticks.set(token, merged);
      if (merged.ltp > 0) onTick(tickToQuote(merged, ref));
    }
  });
  const down = (reason) => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (open || reason !== "closed") onStatus({ connected: false, reason });
    open = false;
  };
  ws.addEventListener("error", () => down("error"));
  ws.addEventListener("close", () => down("closed"));

  return {
    subscribe(refs = []) {
      const fresh = refs.filter((r) => !refsByToken.has(String(r.token)));
      fresh.forEach((r) => refsByToken.set(String(r.token), r));
      for (let i = 0; i < fresh.length; i += SUBSCRIBE_CHUNK) {
        send({ heart_beat: false, subscribe: fresh.slice(i, i + SUBSCRIBE_CHUNK).map((r) => ({ scripId: refToScripId(r), type: "ALL" })) });
      }
    },
    unsubscribe(refs = []) {
      const gone = refs.filter((r) => refsByToken.has(String(r.token)));
      gone.forEach((r) => { refsByToken.delete(String(r.token)); ticks.delete(String(r.token)); });
      if (gone.length) send({ heart_beat: false, unSubscribe: gone.map((r) => ({ scripId: refToScripId(r), type: "ALL" })) });
    },
    close() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      try { ws.close(); } catch { /* ignore */ }
      ws = null;
    },
  };
}
