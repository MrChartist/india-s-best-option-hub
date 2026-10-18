/**
 * Dhan v2 live market feed (contract capability `feed`). Re-exported from dhan.mjs.
 *
 * Official source: https://dhanhq.co/docs/v2/live-market-feed/ and the annexure (feed request and
 * response codes), checked October 2026.
 *  - URL: wss://api-feed.dhan.co?version=2&token=<access token>&clientId=<client id>&authType=2
 *  - Subscribe: JSON { RequestCode, InstrumentCount, InstrumentList: [{ ExchangeSegment, SecurityId }] },
 *    at most 100 instruments per message, 5000 per connection, 5 connections per user.
 *    Codes: 15/16 ticker, 17/18 quote, 21/22 full (sub/unsub), 12 disconnect.
 *  - Responses are little-endian binary. Header (8 bytes): response code (u8), message length (i16),
 *    exchange segment (u8, annexure numbering), security id (i32). Prices are float32.
 *      2 ticker     16 bytes  ltp f32 @8, ltt i32 @12
 *      4 quote      50 bytes  ltp f32 @8, ltq i16 @12, ltt i32 @14, atp f32 @18, volume i32 @22,
 *                             total sell i32 @26, total buy i32 @30, open f32 @34, close f32 @38,
 *                             high f32 @42, low f32 @46
 *      5 OI         12 bytes  oi i32 @8
 *      6 prev close 16 bytes  prev close f32 @8, prev OI i32 @12
 *      8 full      162 bytes  ltp f32 @8, ltq i16 @12, ltt i32 @14, atp f32 @18, volume i32 @22,
 *                             total sell i32 @26, total buy i32 @30, oi i32 @34, oi high i32 @38,
 *                             oi low i32 @42, open f32 @46, close f32 @50, high f32 @54, low f32 @58,
 *                             5 depth levels x 20 bytes @62 (bid qty i32, ask qty i32, bid orders i16,
 *                             ask orders i16, bid price f32, ask price f32)
 *     50 disconnect          reason code i16 @8
 *
 * NOTE for the platform owner: server/lib/dhanPacketParser.mjs (used by proxy-server.mjs's own feed)
 * reads prices as int32/100 and places OI after the OHLC block in the full packet. The official v2
 * layout above has float32 prices and OI before OHLC. This module decodes per the official layout
 * and does not touch that shared parser.
 *
 * The access token rides in the URL (Dhan's documented scheme); it is never logged here.
 */

import WebSocket from "ws";

export const DHAN_FEED_URL = "wss://api-feed.dhan.co";
const SEGMENT_NAME = { 0: "IDX_I", 1: "NSE_EQ", 2: "NSE_FNO", 3: "NSE_CURRENCY", 4: "BSE_EQ", 5: "MCX_COMM", 7: "BSE_CURRENCY", 8: "BSE_FNO" };
const PACKET_SIZE = { 2: 16, 4: 50, 5: 12, 6: 16, 8: 162, 50: 10 };
const CHUNK = 100;
const SUB_FULL = 21;
const UNSUB_FULL = 22;

/**
 * Decode one binary frame into packets. Pure; unknown codes are skipped using the header length.
 * @returns {Array<{ code: number, segment: string, securityId: string, [k: string]: unknown }>}
 */
export function parseDhanFeedFrame(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const out = [];
  let off = 0;
  while (off + 8 <= buf.length) {
    const code = buf.readUInt8(off);
    const declared = buf.readUInt16LE(off + 1);
    const size = PACKET_SIZE[code] ?? declared;
    if (!(size >= 8) || off + size > buf.length) break;
    const segCode = buf.readUInt8(off + 3);
    const head = { code, segment: SEGMENT_NAME[segCode] ?? "UNKNOWN", securityId: String(buf.readUInt32LE(off + 4)) };
    // float32 carries ~7 significant digits: round to paise (4 decimals for currency segments 3 and 7).
    const scale = segCode === 3 || segCode === 7 ? 10_000 : 100;
    const f32 = (o) => Math.round(buf.readFloatLE(off + o) * scale) / scale;
    const i32 = (o) => buf.readInt32LE(off + o);
    if (code === 2) out.push({ ...head, ltp: f32(8), ltt: i32(12) });
    else if (code === 4) {
      out.push({ ...head, ltp: f32(8), volume: i32(22), open: f32(34), close: f32(38), high: f32(42), low: f32(46) });
    } else if (code === 5) out.push({ ...head, oi: i32(8) });
    else if (code === 6) out.push({ ...head, prevClose: f32(8), prevOi: i32(12) });
    else if (code === 8) {
      const depth = [];
      for (let l = 0; l < 5; l++) {
        const b = 62 + l * 20;
        depth.push({ bidQty: i32(b), askQty: i32(b + 4), bidOrders: buf.readInt16LE(off + b + 8), askOrders: buf.readInt16LE(off + b + 10), bid: f32(b + 12), ask: f32(b + 16) });
      }
      out.push({ ...head, ltp: f32(8), volume: i32(22), oi: i32(34), open: f32(46), close: f32(50), high: f32(54), low: f32(58), depth });
    } else if (code === 50) out.push({ ...head, disconnectCode: buf.readInt16LE(off + 8) });
    off += size;
  }
  return out;
}

const EXCHANGE_OF_SEGMENT = { IDX_I: null, NSE_EQ: "NSE", BSE_EQ: "BSE", NSE_FNO: "NFO", BSE_FNO: "BFO", MCX_COMM: "MCX", NSE_CURRENCY: "CDS", BSE_CURRENCY: "CDS" };
const SEGMENT_OF_EXCHANGE = { NSE: "NSE_EQ", BSE: "BSE_EQ", NFO: "NSE_FNO", BFO: "BSE_FNO", MCX: "MCX_COMM", CDS: "NSE_CURRENCY" };

function refKey(ref) {
  const token = String(ref?.token ?? "");
  const m = /^([A-Z_]+):(\d+)$/.exec(token);
  if (m) return { segment: m[1], securityId: m[2] };
  const segment = SEGMENT_OF_EXCHANGE[ref?.exchange];
  return segment && /^\d+$/.test(token) ? { segment, securityId: token } : null;
}

/**
 * createFeed(creds, { onTick, onStatus }, { WebSocketImpl }) -> { subscribe, unsubscribe, close }.
 * Subscribes in Full mode (21) so ticks carry OI and the best bid/ask. Reconnects with backoff
 * (1 s doubling to 30 s) and re-subscribes; stops after close() or a disconnect packet.
 */
export function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket } = {}) {
  if (!creds?.clientId || !creds?.accessToken) throw new Error("Dhan feed needs clientId and accessToken.");
  const wanted = new Map(); // "SEG:id" -> { ref, segment, securityId }
  const state = new Map(); // "SEG:id" -> merged quote
  let ws = null;
  let closed = false;
  let delay = 1000;
  let timer = null;

  const send = (code, entries) => {
    if (!ws || ws.readyState !== 1) return;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const list = entries.slice(i, i + CHUNK).map((e) => ({ ExchangeSegment: e.segment, SecurityId: e.securityId }));
      ws.send(JSON.stringify({ RequestCode: code, InstrumentCount: list.length, InstrumentList: list }));
    }
  };

  const emit = (p) => {
    const key = `${p.segment}:${p.securityId}`;
    const sub = wanted.get(key);
    if (!sub) return;
    const prev = state.get(key) ?? {
      token: String(sub.ref.token), exchange: sub.ref.exchange ?? EXCHANGE_OF_SEGMENT[p.segment] ?? "NSE",
      ltp: 0, open: null, high: null, low: null, close: null, volume: null, oi: null, bid: null, ask: null,
    };
    const next = { ...prev };
    if (p.ltp > 0) next.ltp = p.ltp;
    for (const k of ["open", "high", "low", "volume", "oi"]) if (p[k] !== undefined) next[k] = p[k];
    if (p.close > 0) next.close = p.close;
    if (p.prevClose > 0 && next.close === null) next.close = p.prevClose;
    if (p.depth) {
      next.bid = p.depth[0].bid > 0 ? p.depth[0].bid : null;
      next.ask = p.depth[0].ask > 0 ? p.depth[0].ask : null;
    }
    state.set(key, next);
    if (next.ltp > 0) onTick(next);
  };

  const connect = () => {
    const url = `${DHAN_FEED_URL}?version=2&token=${encodeURIComponent(creds.accessToken)}&clientId=${encodeURIComponent(creds.clientId)}&authType=2`;
    ws = new WebSocketImpl(url);
    ws.on("open", () => {
      delay = 1000;
      onStatus({ connected: true });
      send(SUB_FULL, [...wanted.values()]);
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary === false) return;
      for (const p of parseDhanFeedFrame(data)) {
        if (p.code === 50) {
          closed = true;
          onStatus({ connected: false, reason: `Dhan closed the feed (code ${p.disconnectCode}).` });
          ws.close();
          return;
        }
        emit(p);
      }
    });
    ws.on("error", () => { /* the close handler reports and reconnects */ });
    ws.on("close", () => {
      ws = null;
      if (closed) return;
      onStatus({ connected: false, reason: "Dhan feed disconnected; reconnecting." });
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30_000);
    });
  };

  connect();
  return {
    subscribe(refs = []) {
      const added = [];
      for (const ref of refs) {
        const k = refKey(ref);
        if (!k) continue;
        const key = `${k.segment}:${k.securityId}`;
        if (!wanted.has(key)) { wanted.set(key, { ref, ...k }); added.push(k); }
      }
      send(SUB_FULL, added);
    },
    unsubscribe(refs = []) {
      const removed = [];
      for (const ref of refs) {
        const k = refKey(ref);
        if (!k) continue;
        const key = `${k.segment}:${k.securityId}`;
        if (wanted.delete(key)) { state.delete(key); removed.push(k); }
      }
      send(UNSUB_FULL, removed);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ RequestCode: 12 }));
      ws?.close();
    },
  };
}
