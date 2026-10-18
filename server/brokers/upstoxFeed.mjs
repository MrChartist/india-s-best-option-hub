/**
 * Upstox Market Data Feed V3 (contract capability `feed`). Re-exported from upstox.mjs.
 *
 * Official sources (October 2026):
 *  - https://upstox.com/developer/api-documentation/v3/get-market-data-feed and
 *    .../get-market-data-feed-authorize-v3: GET https://api.upstox.com/v3/feed/market-data-feed/authorize
 *    returns { data: { authorized_redirect_uri: "wss://...upstox.com/..." } } (single use). Requests are
 *    sent as BINARY frames holding JSON { guid, method: "sub"|"unsub"|"change_mode", data: { mode, instrumentKeys } };
 *    modes ltpc, option_greeks, full, full_d30. Limits: 2 connections per user; full mode 2000 keys.
 *  - Messages are protobuf FeedResponse per Upstox's published schema
 *    https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto. Field numbers used:
 *      FeedResponse { 1 type, 2 feeds map<string, Feed>, 3 currentTs }
 *      Feed { 1 ltpc LTPC, 2 fullFeed FullFeed, 3 firstLevelWithGreeks }
 *      LTPC { 1 ltp double, 2 ltt int64, 3 ltq int64, 4 cp double }
 *      FullFeed { 1 marketFF MarketFullFeed, 2 indexFF IndexFullFeed }
 *      MarketFullFeed { 1 ltpc, 2 marketLevel { 1 repeated Quote }, 4 marketOHLC { 1 repeated OHLC }, 6 vtt int64, 7 oi double }
 *      IndexFullFeed { 1 ltpc, 2 marketOHLC }
 *      FirstLevelWithGreeks { 1 ltpc, 2 firstDepth Quote, 4 vtt int64, 5 oi double }
 *      Quote { 1 bidQ int64, 2 bidP double, 3 askQ int64, 4 askP double }
 *      OHLC { 1 interval string, 2 open, 3 high, 4 low, 5 close double, 6 vol int64, 7 ts int64 }
 *    A minimal wire-format reader is implemented here rather than adding a protobuf dependency.
 */

import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { upstoxFetch } from "./upstoxClient.mjs";
import { exchangeOfKey } from "./upstoxInstruments.mjs";

// ── protobuf wire reader ──

function readVarint(buf, pos) {
  let result = 0;
  let mul = 1;
  for (let i = 0; i < 10; i++) {
    if (pos.i >= buf.length) throw new Error("truncated varint");
    const b = buf[pos.i++];
    result += (b & 0x7f) * mul;
    if (b < 0x80) return result;
    mul *= 128;
  }
  throw new Error("varint too long");
}

/** Decode one message into { fieldNo: [values] } (varint -> number, 64/32-bit -> Buffer slice, bytes -> Buffer). */
export function readFields(buf) {
  const fields = {};
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const tag = readVarint(buf, pos);
    const no = Math.floor(tag / 8);
    const wt = tag & 7;
    let value;
    if (wt === 0) value = readVarint(buf, pos);
    else if (wt === 1) { value = buf.subarray(pos.i, pos.i + 8); pos.i += 8; }
    else if (wt === 2) { const len = readVarint(buf, pos); value = buf.subarray(pos.i, pos.i + len); pos.i += len; }
    else if (wt === 5) { value = buf.subarray(pos.i, pos.i + 4); pos.i += 4; }
    else throw new Error(`unsupported wire type ${wt}`);
    if (pos.i > buf.length) throw new Error("truncated field");
    (fields[no] ||= []).push(value);
  }
  return fields;
}

const dbl = (f, no) => (f[no]?.[0]?.length === 8 ? f[no][0].readDoubleLE(0) : undefined);
const int = (f, no) => (typeof f[no]?.[0] === "number" ? f[no][0] : undefined);
const msg = (f, no) => (f[no]?.[0] ? readFields(f[no][0]) : null);

function ltpcOf(f) {
  return f ? { ltp: dbl(f, 1), cp: dbl(f, 4) } : {};
}

function quoteOf(f) {
  return f ? { bidP: dbl(f, 2), askP: dbl(f, 4) } : {};
}

function dayOhlc(ohlcMsg) {
  for (const raw of ohlcMsg?.[1] ?? []) {
    const o = readFields(raw);
    if (o[1]?.[0]?.toString("utf-8") === "1d") return { open: dbl(o, 2), high: dbl(o, 3), low: dbl(o, 4) };
  }
  return {};
}

/** Decode a FeedResponse buffer into flat ticks keyed by instrument_key. */
export function decodeUpstoxFeed(input) {
  const top = readFields(Buffer.isBuffer(input) ? input : Buffer.from(input));
  const ticks = [];
  for (const entryRaw of top[2] ?? []) {
    const entry = readFields(entryRaw);
    const key = entry[1]?.[0]?.toString("utf-8");
    const feed = msg(entry, 2);
    if (!key || !feed) continue;
    const t = { key };
    if (feed[1]) Object.assign(t, ltpcOf(readFields(feed[1][0])));
    const full = msg(feed, 2);
    if (full) {
      const mff = msg(full, 1);
      const iff = msg(full, 2);
      if (mff) {
        Object.assign(t, ltpcOf(msg(mff, 1)), dayOhlc(msg(mff, 4)));
        const ml = msg(mff, 2);
        if (ml?.[1]?.[0]) { const q = quoteOf(readFields(ml[1][0])); t.bid = q.bidP; t.ask = q.askP; }
        t.volume = int(mff, 6);
        t.oi = dbl(mff, 7);
      } else if (iff) Object.assign(t, ltpcOf(msg(iff, 1)), dayOhlc(msg(iff, 2)));
    }
    const flg = msg(feed, 3);
    if (flg) {
      Object.assign(t, ltpcOf(msg(flg, 1)));
      const q = quoteOf(msg(flg, 2));
      t.bid = q.bidP;
      t.ask = q.askP;
      t.volume = int(flg, 4);
      t.oi = dbl(flg, 5);
    }
    ticks.push(t);
  }
  return ticks;
}

// ── feed ──

/** Only connect to sockets Upstox itself handed us. */
export function checkFeedUri(uri) {
  let u;
  try { u = new URL(String(uri)); } catch { throw new Error("Upstox returned an invalid feed URL."); }
  if (u.protocol !== "wss:" || !(u.hostname === "upstox.com" || u.hostname.endsWith(".upstox.com"))) {
    throw new Error("Upstox returned a feed URL outside upstox.com; refusing to connect.");
  }
  return u.toString();
}

async function authorize(creds) {
  const body = await upstoxFetch("/v3/feed/market-data-feed/authorize", creds);
  return checkFeedUri(body.data?.authorized_redirect_uri ?? body.data?.authorizedRedirectUri);
}

/**
 * createFeed(creds, { onTick, onStatus }, { WebSocketImpl }) -> { subscribe, unsubscribe, close }.
 * Refs carry the instrument_key as token. Full mode (depth + OI). Each (re)connect fetches a fresh
 * single-use authorised URL; reconnects back off 1 s doubling to 30 s; authorisation failures stop.
 */
export function createFeed(creds, { onTick = () => {}, onStatus = () => {} } = {}, { WebSocketImpl = WebSocket } = {}) {
  if (!creds?.accessToken) throw new Error("Upstox feed needs an access token.");
  const wanted = new Map();
  const state = new Map();
  let ws = null;
  let closed = false;
  let delay = 1000;
  let timer = null;

  const send = (method, keys) => {
    if (!keys.length || !ws || ws.readyState !== 1) return;
    ws.send(Buffer.from(JSON.stringify({ guid: randomUUID(), method, data: { mode: "full", instrumentKeys: keys } })));
  };

  const emit = (t) => {
    const ref = wanted.get(t.key);
    if (!ref) return;
    const prev = state.get(t.key) ?? { token: t.key, exchange: ref.exchange ?? exchangeOfKey(t.key) ?? "NSE", ltp: 0, open: null, high: null, low: null, close: null, volume: null, oi: null, bid: null, ask: null };
    const next = { ...prev };
    if (t.ltp > 0) next.ltp = t.ltp;
    if (t.cp > 0) next.close = t.cp;
    for (const k of ["open", "high", "low", "volume", "oi"]) if (Number.isFinite(t[k])) next[k] = t[k];
    if (t.bid !== undefined) next.bid = t.bid > 0 ? t.bid : null;
    if (t.ask !== undefined) next.ask = t.ask > 0 ? t.ask : null;
    state.set(t.key, next);
    if (next.ltp > 0) onTick(next);
  };

  const retry = () => {
    if (closed) return;
    onStatus({ connected: false, reason: "Upstox feed disconnected; reconnecting." });
    timer = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 30_000);
  };

  async function connect() {
    let uri;
    try {
      uri = await authorize(creds);
    } catch (e) {
      if (e?.code === "UPSTREAM_AUTH") { closed = true; onStatus({ connected: false, reason: e.message }); return; }
      retry();
      return;
    }
    if (closed) return;
    ws = new WebSocketImpl(uri);
    ws.on("open", () => { delay = 1000; onStatus({ connected: true }); send("sub", [...wanted.keys()]); });
    ws.on("message", (data) => {
      try { for (const t of decodeUpstoxFeed(data)) emit(t); } catch { /* skip a malformed frame */ }
    });
    ws.on("error", () => { /* close reports */ });
    ws.on("close", () => { ws = null; retry(); });
  }

  connect();
  return {
    subscribe(refs = []) {
      const added = [];
      for (const ref of refs) {
        const key = String(ref?.token ?? "");
        if (!key.includes("|") || wanted.has(key)) continue;
        wanted.set(key, ref);
        added.push(key);
      }
      send("sub", added);
    },
    unsubscribe(refs = []) {
      const removed = [];
      for (const ref of refs) {
        const key = String(ref?.token ?? "");
        if (wanted.delete(key)) { state.delete(key); removed.push(key); }
      }
      send("unsub", removed);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
  };
}
