/**
 * Rupeezy (Vortex) live price feed (contract capability `feed`). Official docs:
 * https://vortex.rupeezy.in/docs/latest/feed/ (checked 2026-10), with the framing cross-checked against
 * Rupeezy's own published Python SDK (pyvortex, vortex_feed.py):
 *  - wss://wire.rupeezy.in/ws?auth_token=<access_token>; at most 3 sockets per token and 1000 instruments per
 *    socket.
 *  - Subscribe / unsubscribe with TEXT frames: { exchange, token, mode: "ltp" | "ohlcv" | "full",
 *    message_type: "subscribe" | "unsubscribe" }.
 *  - Prices arrive as BINARY frames, little-endian: uint16 number of quotes, then for each quote a uint16 length
 *    followed by that many bytes. Length 22 = ltp, 62 = ohlcv, 266 = full:
 *      exchange char[10] (NUL padded), token int32, ltp float64                                   (22)
 *      + last_trade_time int32, open, high, low, close float64, volume int32                      (62)
 *      + last_update_time int32, last_trade_qty int32, avg_price float64, total_buy_qty int64,
 *        total_sell_qty int64, open_interest int32, 5 x bid { price f64, qty i32, orders i32 },
 *        5 x ask { ... }, dpr_high int32, dpr_low int32                                           (266)
 *  - Order updates arrive as JSON TEXT frames; this module ignores them (it only streams prices, never orders).
 */

import WebSocket from "ws";
import { SessionRequiredError, normaliseError } from "./contract.mjs";
import { session } from "./rupeezyAuth.mjs";
import { CONTRACT_EXCHANGE, VORTEX_EXCHANGE } from "./rupeezyInstruments.mjs";

export const FEED_URL = "wss://wire.rupeezy.in/ws";
export const MAX_INSTRUMENTS = 1000;

/** Decode one fixed-size quote packet; null for an unknown length. */
export function decodeQuote(buf) {
  const len = buf.length;
  if (len !== 22 && len !== 62 && len !== 266) return null;
  const exchange = buf.toString("latin1", 0, 10).replace(/\0+$/, "").trim();
  const q = { exchange, token: String(buf.readInt32LE(10)), ltp: buf.readDoubleLE(14) };
  if (len === 22) return q;
  Object.assign(q, { open: buf.readDoubleLE(26), high: buf.readDoubleLE(34), low: buf.readDoubleLE(42), close: buf.readDoubleLE(50), volume: buf.readInt32LE(58) });
  if (len === 62) return q;
  q.oi = buf.readInt32LE(94);
  q.bid = buf.readDoubleLE(98); // first bid level: price f64 at 98, qty i32 at 106, orders i32 at 110
  q.ask = buf.readDoubleLE(178); // first ask level after 5 x 16 bytes of bids
  return q;
}

/** Split one binary message into quote packets and decode them. Malformed tails are dropped. */
export function decodeMessage(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 2) return []; // heartbeat
  const count = buf.readUInt16LE(0);
  const out = [];
  let at = 2;
  for (let i = 0; i < count && at + 2 <= buf.length; i++) {
    const len = buf.readUInt16LE(at);
    if (at + 2 + len > buf.length) break;
    const q = decodeQuote(buf.subarray(at + 2, at + 2 + len));
    if (q) out.push(q);
    at += 2 + len;
  }
  return out;
}

const keyOf = (vexch, token) => `${vexch}|${token}`;
const nn = (v) => (Number.isFinite(v) ? v : null);

/**
 * createFeed(creds, { onTick, onStatus }, { WebSocketImpl, mode }) -> { subscribe, unsubscribe, close }.
 * Reconnects with backoff (1 s doubling to 30 s) and re-subscribes; stops for good when there is no session.
 */
export function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket, mode = "full" } = {}) {
  if (!String(creds?.accessToken ?? "").trim() && !String(creds?.authToken ?? "").trim()) {
    throw new SessionRequiredError("Rupeezy: no session for the live feed. Paste today's auth value or an access token in Broker Settings.");
  }
  const wanted = new Map(); // "NSE_FO|123" -> contract ref
  let ws = null;
  let closed = false;
  let open = false;
  let delay = 1000;
  let retry = null;
  let token = "";

  const send = (vexch, tok, type) => {
    if (open && ws?.readyState === 1) ws.send(JSON.stringify({ exchange: vexch, token: Number(tok), mode, message_type: type }));
  };

  async function connect() {
    if (closed) return;
    try {
      token = (await session.ensure(creds)).token;
    } catch (e) {
      closed = true;
      onStatus({ connected: false, reason: normaliseError(e).message });
      return;
    }
    if (closed) return;
    ws = new WebSocketImpl(`${FEED_URL}?auth_token=${encodeURIComponent(token)}`);
    ws.on("open", () => {
      open = true;
      delay = 1000;
      onStatus({ connected: true });
      for (const k of wanted.keys()) { const [vexch, tok] = k.split("|"); send(vexch, tok, "subscribe"); }
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary === false || typeof data === "string") return; // order updates (JSON text)
      for (const q of decodeMessage(data)) {
        const ref = wanted.get(keyOf(q.exchange, q.token));
        if (!ref || !(q.ltp > 0)) continue;
        onTick({
          token: String(ref.token), exchange: ref.exchange ?? CONTRACT_EXCHANGE[q.exchange], ltp: q.ltp, open: nn(q.open), high: nn(q.high), low: nn(q.low),
          close: nn(q.close), volume: nn(q.volume), oi: nn(q.oi), bid: nn(q.bid), ask: nn(q.ask),
        });
      }
    });
    ws.on("close", () => {
      open = false;
      if (closed) return;
      onStatus({ connected: false, reason: "disconnected" });
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    });
    ws.on("error", (e) => {
      const reason = String(e?.message || "error").split(token || "\u0000").join("***");
      onStatus({ connected: false, reason });
    });
  }

  connect();
  return {
    subscribe(refs = []) {
      for (const r of refs) {
        const vexch = VORTEX_EXCHANGE[r?.exchange];
        const tok = String(r?.token ?? "");
        if (!vexch || !/^\d+$/.test(tok) || wanted.has(keyOf(vexch, tok))) continue;
        if (wanted.size >= MAX_INSTRUMENTS) { onStatus({ connected: open, reason: `Rupeezy allows ${MAX_INSTRUMENTS} instruments per feed; the rest were not subscribed.` }); break; }
        wanted.set(keyOf(vexch, tok), r);
        send(vexch, tok, "subscribe");
      }
    },
    unsubscribe(refs = []) {
      for (const r of refs) {
        const vexch = VORTEX_EXCHANGE[r?.exchange];
        const tok = String(r?.token ?? "");
        if (vexch && wanted.delete(keyOf(vexch, tok))) send(vexch, tok, "unsubscribe");
      }
    },
    close() {
      closed = true;
      clearTimeout(retry);
      wanted.clear();
      try { ws?.close(); } catch { /* already closed */ }
    },
  };
}
