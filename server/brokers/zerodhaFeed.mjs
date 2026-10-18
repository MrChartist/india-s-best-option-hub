/**
 * Zerodha Kite Connect WebSocket feed (contract capability `feed`). Re-exported from zerodha.mjs.
 *
 * Official source: https://kite.trade/docs/connect/v3/websocket/ (October 2026)
 *  - wss://ws.kite.trade?api_key=<key>&access_token=<token>; up to 3000 instruments per connection,
 *    3 connections per API key.
 *  - Requests are JSON text: { a: "subscribe"|"unsubscribe", v: [instrument_token...] } and
 *    { a: "mode", v: ["ltp"|"quote"|"full", [instrument_token...]] }.
 *  - Market data is binary. Frame: int16 packet count, then per packet int16 length + bytes.
 *    Prices are int32 paise (divide by 100; currency segment by 10,000,000).
 *      tradeable: 8 bytes (ltp mode), 44 (quote), 184 (full: + ltt, oi, oi high/low, exchange
 *      timestamp, 10 depth entries of qty i32, price i32, orders i16, 2 padding bytes; 5 bids then 5 offers)
 *      index:     28 bytes (quote: ltp, high, low, open, close, change), 32 (full: + exchange timestamp)
 *    A 1-byte frame is a heartbeat. Text frames carry order postbacks / errors / messages (ignored here).
 *  - Byte order: big-endian (network order), as implemented by Zerodha's official client libraries;
 *    the docs page lists offsets and sizes but not the byte order.
 */

import WebSocket from "ws";

export const KITE_WS_URL = "wss://ws.kite.trade";

/**
 * Decode one binary frame. `divisorOf(token)` returns the price divisor (100, or 1e7 for currency).
 * @returns {Array<{ token: string, kind: "ltp"|"quote"|"full"|"index", ltp: number, [k: string]: unknown }>}
 */
export function parseKiteFrame(input, divisorOf = () => 100) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buf.length < 4) return []; // heartbeat
  const count = buf.readInt16BE(0);
  const out = [];
  let off = 2;
  for (let p = 0; p < count && off + 2 <= buf.length; p++) {
    const len = buf.readInt16BE(off);
    off += 2;
    if (len <= 0 || off + len > buf.length) break;
    const tokenNum = buf.readUInt32BE(off);
    const token = String(tokenNum);
    const d = divisorOf(token);
    const px = (o) => buf.readInt32BE(off + o) / d;
    const i32 = (o) => buf.readInt32BE(off + o);
    if (len === 8) out.push({ token, kind: "ltp", ltp: px(4) });
    else if (len === 28 || len === 32) {
      out.push({ token, kind: "index", ltp: px(4), high: px(8), low: px(12), open: px(16), close: px(20) });
    } else if (len === 44 || len === 184) {
      const q = { token, kind: len === 44 ? "quote" : "full", ltp: px(4), volume: i32(16), open: px(28), high: px(32), low: px(36), close: px(40) };
      if (len === 184) {
        q.oi = i32(48);
        const depth = (start) => Array.from({ length: 5 }, (_, i) => {
          const b = start + i * 12;
          return { qty: i32(b), price: px(b + 4), orders: buf.readInt16BE(off + b + 8) };
        });
        q.bids = depth(64);
        q.asks = depth(124);
      }
      out.push(q);
    }
    off += len;
  }
  return out;
}

/**
 * createFeed(creds, { onTick, onStatus }, { WebSocketImpl }) -> { subscribe, unsubscribe, close }.
 * Instruments are refs with the numeric instrument_token. Subscribes in full mode (depth + OI),
 * reconnects with backoff (1 s doubling to 30 s) and re-subscribes; stops on close() or when the
 * handshake is refused (expired token: a fresh one is needed, retrying would not help).
 */
export function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket } = {}) {
  if (!creds?.apiKey || !creds?.accessToken) throw new Error("Zerodha feed needs apiKey and accessToken.");
  const wanted = new Map(); // token -> ref
  const state = new Map();
  let ws = null;
  let closed = false;
  let delay = 1000;
  let timer = null;

  const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const subscribeTokens = (tokens) => {
    if (!tokens.length) return;
    send({ a: "subscribe", v: tokens });
    send({ a: "mode", v: ["full", tokens] });
  };
  const divisorOf = (token) => (wanted.get(token)?.exchange === "CDS" ? 10_000_000 : 100);

  const emit = (p) => {
    const ref = wanted.get(p.token);
    if (!ref) return;
    const prev = state.get(p.token) ?? { token: p.token, exchange: ref.exchange, ltp: 0, open: null, high: null, low: null, close: null, volume: null, oi: null, bid: null, ask: null };
    const next = { ...prev, ltp: p.ltp > 0 ? p.ltp : prev.ltp };
    for (const k of ["open", "high", "low", "close", "volume", "oi"]) if (p[k] !== undefined) next[k] = p[k];
    if (p.bids) next.bid = p.bids[0].price > 0 ? p.bids[0].price : null;
    if (p.asks) next.ask = p.asks[0].price > 0 ? p.asks[0].price : null;
    state.set(p.token, next);
    if (next.ltp > 0) onTick(next);
  };

  const connect = () => {
    ws = new WebSocketImpl(`${KITE_WS_URL}?api_key=${encodeURIComponent(creds.apiKey)}&access_token=${encodeURIComponent(creds.accessToken)}`);
    ws.on("open", () => {
      delay = 1000;
      onStatus({ connected: true });
      subscribeTokens([...wanted.keys()].map(Number));
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary === false) return;
      for (const p of parseKiteFrame(data, divisorOf)) emit(p);
    });
    ws.on("unexpected-response", (_req, res) => {
      closed = true;
      onStatus({ connected: false, reason: `Zerodha refused the feed (HTTP ${res?.statusCode ?? "?"}). Generate a fresh access token.` });
    });
    ws.on("error", () => { /* reported by close */ });
    ws.on("close", () => {
      ws = null;
      if (closed) return;
      onStatus({ connected: false, reason: "Zerodha feed disconnected; reconnecting." });
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    });
  };

  connect();
  return {
    subscribe(refs = []) {
      const added = [];
      for (const ref of refs) {
        const token = String(ref?.token ?? "");
        if (!/^\d+$/.test(token) || wanted.has(token)) continue;
        wanted.set(token, ref);
        added.push(Number(token));
      }
      subscribeTokens(added);
    },
    unsubscribe(refs = []) {
      const removed = [];
      for (const ref of refs) {
        const token = String(ref?.token ?? "");
        if (wanted.delete(token)) { state.delete(token); removed.push(Number(token)); }
      }
      if (removed.length) send({ a: "unsubscribe", v: removed });
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
