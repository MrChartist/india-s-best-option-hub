/**
 * IndMoney (INDstocks) price feed (contract capability `feed`). Official Postman collection, "Streaming
 * (WebSocket) > Price Feed", checked 2026-10:
 *  - wss://ws-prices.indstocks.com/api/v1/ws/prices, header `Authorization: <access token>` (raw, no Bearer).
 *  - Send { action: "subscribe" | "unsubscribe", mode: "ltp" | "quote", instruments: ["NSE:2885", "NFO:51011",
 *    "NIDX:26000"] } (SEGMENT:TOKEN with a colon).
 *  - Ticks are JSON strings: { mode: "ltp", instrument: "2885", timestamp, data: { ltp } } or
 *    { mode: "quote", instrument, timestamp, data: { open, high, low, close, volume } }. Heartbeats are ignored.
 * Ticks name the bare token without its segment, so a tick is matched back to the subscribed ref by token;
 * if two subscribed refs share a token on different segments, both receive it (documented ambiguity).
 * This module only streams prices; it never sends orders.
 */

import WebSocket from "ws";
import { sessionToken } from "./indmoneyAuth.mjs";
import { scripPrefix } from "./indmoneyInstruments.mjs";

export const PRICE_FEED_URL = "wss://ws-prices.indstocks.com/api/v1/ws/prices";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Contract ref -> "SEGMENT:TOKEN". Index refs pass `isIndex: true` (or exchange NIDX/BIDX). */
export function wsCode(ref) {
  const token = String(ref?.token ?? "");
  if (!/^\d+$/.test(token)) return null;
  if (ref?.exchange === "NIDX" || ref?.exchange === "BIDX") return `${ref.exchange}:${token}`;
  const prefix = scripPrefix(ref?.exchange, ref?.isIndex === true);
  return prefix ? `${prefix}:${token}` : null;
}

/** Parse one feed message into { token, ltp?, open?, high?, low?, close?, volume? } or null (heartbeat/other). */
export function parseTick(raw) {
  let msg = raw;
  if (Buffer.isBuffer(raw)) msg = raw.toString("utf8");
  if (typeof msg === "string") {
    try { msg = JSON.parse(msg); } catch { return null; }
  }
  if (typeof msg === "string") {
    try { msg = JSON.parse(msg); } catch { return null; }
  }
  if (!msg || typeof msg !== "object" || !msg.instrument || !msg.data) return null;
  const token = String(msg.instrument).includes(":") ? String(msg.instrument).split(":")[1] : String(msg.instrument);
  const d = msg.data;
  return { token, mode: msg.mode, ltp: num(d.ltp), open: num(d.open), high: num(d.high), low: num(d.low), close: num(d.close), volume: num(d.volume) };
}

/**
 * createFeed(creds, { onTick, onStatus }, { WebSocketImpl, mode }) -> { subscribe, unsubscribe, close }.
 * mode "ltp" (default) yields a positive ltp per tick; "quote" yields OHLC/volume (ltp taken from close).
 */
export function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket, mode = "ltp" } = {}) {
  const token = sessionToken(creds);
  const refs = new Map(); // wsCode -> ref
  let ws = null;
  let open = false;
  let closed = false;

  const send = (action, codes) => {
    if (open && codes.length) ws.send(JSON.stringify({ action, mode, instruments: codes }));
  };

  ws = new WebSocketImpl(PRICE_FEED_URL, { headers: { Authorization: token } });
  ws.on("open", () => {
    open = true;
    onStatus({ connected: true });
    send("subscribe", [...refs.keys()]);
  });
  ws.on("message", (data) => {
    const t = parseTick(data);
    if (!t) return;
    const ltp = t.ltp ?? t.close;
    if (!(ltp > 0)) return;
    for (const [code, ref] of refs) {
      if (code.split(":")[1] !== t.token) continue;
      onTick({ token: String(ref.token), exchange: ref.exchange, ltp, open: t.open, high: t.high, low: t.low, close: t.close, volume: t.volume, oi: null, bid: null, ask: null });
    }
  });
  ws.on("close", () => {
    open = false;
    onStatus({ connected: false, reason: closed ? "closed" : "disconnected" });
  });
  ws.on("error", (e) => onStatus({ connected: false, reason: String(e?.message || "error").replace(token, "***") }));

  return {
    subscribe(list = []) {
      const codes = [];
      for (const ref of list) {
        const code = wsCode(ref);
        if (code && !refs.has(code)) { refs.set(code, ref); codes.push(code); }
      }
      send("subscribe", codes);
    },
    unsubscribe(list = []) {
      const codes = list.map(wsCode).filter((c) => c && refs.delete(c));
      send("unsubscribe", codes);
    },
    close() {
      closed = true;
      refs.clear();
      try { ws.close(); } catch { /* already closed */ }
    },
  };
}
