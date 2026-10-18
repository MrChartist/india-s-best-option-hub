/**
 * Bigul market-data feed (HSWebSocket "HSM" binary protocol), used for LTP, quotes, depth and option-chain prices:
 * Bigul's REST API has no quote endpoint.
 *
 * Official sources (checked 2026-10): https://connect.bigul.co/docs#ws_intro ... #ws_option_chain, which say native
 * server-side WebSocket clients are allowed, and Bigul's official Python SDK linked there
 * (https://bigul.co/downloads/pythonSDK.zip, SDK/hsm_sdk.py + SDK/map.json), which gives the URL and the binary layout:
 *  - URL wss://cbc.bigul.co/broadcast/socket. Frames are binary: u16 length, u8 type, u8 field count, then fields of
 *    u8 id, u16 length, value (big-endian). The session token goes in the first frame, not in the URL.
 *  - Requests: 1 = connect { 1: token, 2: "N", 3: 0x01, 4: source }; 12 = mode { 1: u64 channel bitmask, 2: "F" full };
 *    4 / 5 = subscribe / unsubscribe { 1: u16 count + (u8 length + key)*, 2: channel }; 3 = ack { 1: u32 message no }.
 *    Keys are "sf|<segment>|<token>" (scrip), "if|<segment>|<index name>" (index, e.g. "if|nse_cm|Nifty 50") and
 *    "dp|<segment>|<token>" (5-level depth). The SDK sends at most 100 keys per frame.
 *  - Responses: type 1 (connect: field 1 "K" = accepted, field 2 = u32 ack interval), 6 (data). A data frame is
 *    u32 message number, u16 record count, then records: 'S' snapshot (u16 topic id, key, u8 n, n x u32, 2 spare bytes,
 *    u16 multiplier, u8 precision, three short strings), 'U' update (u16 topic id, u8 n, n x u32) and 'L' (u16 topic id,
 *    u32 LTP). 0x80000000 means "no value". Prices are integers divided by 10^precision x multiplier.
 *  - When the connect reply carries an ack interval, every that-many data frames are acknowledged with the last
 *    message number. The SDK sends a text "Ping" every 10 s.
 * The docs' JSON request examples ({ type: "mws" | "opc", ... }) are what Bigul's browser library turns into these
 * frames; the option-chain ("opc") request has no published binary form, so chains subscribe their strikes one by one.
 *
 * One connection per session token (keyed by its SHA-256), bounded by upstreamFeedLimits.mjs. The WebSocket class is
 * read from globalThis at connect time so tests can install a fake one and nothing reaches the network.
 */

import { createHash } from "node:crypto";
import { BrokerError, SessionRequiredError } from "./contract.mjs";
import { getSession } from "./bigulAuth.mjs";
import { chunkArray, sleep } from "../lib/batch.mjs";
import { createFeedPoolGuard, trimSubscriptions } from "./upstreamFeedLimits.mjs";

export const WS_URL = "wss://cbc.bigul.co/broadcast/socket";
const FEED_SOURCE = "API";
const CHANNEL = 1;
const PING_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const KEYS_PER_FRAME = 100;
const TICK_WAIT_MS = 4000;
const TICK_POLL_MS = 100;
const OPEN = 1;
export const NO_VALUE = 0x80000000;

export const REQ = Object.freeze({ CONNECT: 1, ACK: 3, SUBSCRIBE: 4, UNSUBSCRIBE: 5, DATA: 6, MODE: 12 });
const REC = Object.freeze({ SNAPSHOT: 0x53, UPDATE: 0x55, LITE: 0x4c });

/** Field names by position (SDK map.json) and which positions are prices. */
export const SCRIP_FIELDS = ["ltp", "volume", "lastTradeTime", "feedTime", "bidQty", "askQty", "bid", "ask", "lastTradeQty", "totalBuyQty",
  "totalSellQty", "avgPrice", "oi", "low", "high", "yearHigh", "yearLow", "lowerCircuit", "upperCircuit", "open", "close"];
const SCRIP_PRICES = new Set([0, 6, 7, 11, 13, 14, 15, 16, 17, 18, 19, 20]);
export const INDEX_FIELDS = ["ltp", "close", "feedTime", "high", "low", "open", "yearHigh", "yearLow"];
const INDEX_PRICES = new Set([0, 1, 3, 4, 5, 6, 7]);
export const DEPTH_FIELDS = [
  ...[1, 2, 3, 4, 5].map((i) => `bidPrice${i}`), ...[1, 2, 3, 4, 5].map((i) => `askPrice${i}`),
  ...[1, 2, 3, 4, 5].map((i) => `bidQty${i}`), ...[1, 2, 3, 4, 5].map((i) => `askQty${i}`),
  ...[1, 2, 3, 4, 5].map((i) => `bidOrders${i}`), ...[1, 2, 3, 4, 5].map((i) => `askOrders${i}`),
];
const LAYOUT = {
  sf: { names: SCRIP_FIELDS, isPrice: (i) => SCRIP_PRICES.has(i) },
  if: { names: INDEX_FIELDS, isPrice: (i) => INDEX_PRICES.has(i) },
  dp: { names: DEPTH_FIELDS, isPrice: (i) => i < 10 },
};

// ── codec (pure) ──

/** Build one request frame from [fieldId, Buffer] pairs. */
export function encodeFrame(type, fields) {
  const parts = fields.map(([id, value]) => {
    const head = Buffer.alloc(3);
    head.writeUInt8(id, 0);
    head.writeUInt16BE(value.length, 1);
    return Buffer.concat([head, value]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(body.length + 2, 0);
  head.writeUInt8(type, 2);
  head.writeUInt8(fields.length, 3);
  return Buffer.concat([head, body]);
}

const byte = (v) => Buffer.from([v]);

export function connectFrame(token, source = FEED_SOURCE) {
  return encodeFrame(REQ.CONNECT, [[1, Buffer.from(token, "utf8")], [2, Buffer.from("N")], [3, byte(1)], [4, Buffer.from(source, "utf8")]]);
}

export function modeFrame(channel = CHANNEL, full = true) {
  const mask = Buffer.alloc(8);
  mask.writeBigUInt64BE(1n << BigInt(channel));
  return encodeFrame(REQ.MODE, [[1, mask], [2, Buffer.from(full ? "F" : "L")]]);
}

function keyList(keys) {
  const count = Buffer.alloc(2);
  count.writeUInt16BE(keys.length);
  return Buffer.concat([count, ...keys.map((k) => { const b = Buffer.from(k, "ascii"); return Buffer.concat([byte(b.length), b]); })]);
}

export function subscribeFrame(keys, channel = CHANNEL, unsubscribe = false) {
  return encodeFrame(unsubscribe ? REQ.UNSUBSCRIBE : REQ.SUBSCRIBE, [[1, keyList(keys)], [2, byte(channel)]]);
}

export function ackFrame(messageNo) {
  const v = Buffer.alloc(4);
  v.writeUInt32BE(messageNo >>> 0);
  return encodeFrame(REQ.ACK, [[1, v]]);
}

/** Generic response fields after the 4-byte header: Map<id, Buffer>. */
export function readFields(buf) {
  const out = new Map();
  let at = 4;
  for (let n = 0; n < buf[3] && at + 3 <= buf.length; n++) {
    const id = buf[at];
    const len = buf.readUInt16BE(at + 1);
    out.set(id, buf.subarray(at + 3, at + 3 + len));
    at += 3 + len;
  }
  return out;
}

/** Connect reply -> { ok, ackEvery }. */
export function readConnectReply(buf) {
  const f = readFields(buf);
  const ack = f.get(2);
  return { ok: f.get(1)?.toString("utf8") === "K", ackEvery: ack && ack.length >= 4 ? ack.readUInt32BE(0) : 0 };
}

function readShort(buf, at) {
  const len = buf[at];
  return { text: buf.toString("utf8", at + 1, at + 1 + len), next: at + 1 + len };
}

/**
 * Decode a data frame into raw records (no scaling). Stops at an unknown record kind, whose length cannot be known.
 * @returns {{ messageNo: number, records: Array<{ kind: "S"|"U"|"L", topic: number, key?: string, values: number[],
 *   multiplier?: number, precision?: number }> }}
 */
export function decodeData(buf) {
  const messageNo = buf.readUInt32BE(3);
  const count = buf.readUInt16BE(7);
  const records = [];
  let at = 9;
  try {
    for (let n = 0; n < count && at < buf.length; n++) {
      const kind = buf[at];
      const topic = buf.readUInt16BE(at + 1);
      at += 3;
      if (kind === REC.SNAPSHOT) {
        const key = readShort(buf, at);
        at = key.next;
        const nVals = buf[at++];
        const values = [];
        for (let i = 0; i < nVals; i++, at += 4) values.push(buf.readUInt32BE(at));
        at += 2;
        const multiplier = buf.readUInt16BE(at);
        const precision = buf[at + 2];
        at += 3;
        for (let i = 0; i < 3; i++) at = readShort(buf, at).next;
        records.push({ kind: "S", topic, key: key.text, values, multiplier, precision });
      } else if (kind === REC.UPDATE) {
        const nVals = buf[at++];
        const values = [];
        for (let i = 0; i < nVals; i++, at += 4) values.push(buf.readUInt32BE(at));
        records.push({ kind: "U", topic, values });
      } else if (kind === REC.LITE) {
        records.push({ kind: "L", topic, values: [buf.readUInt32BE(at)] });
        at += 4;
      } else break;
    }
  } catch {
    // A truncated frame keeps the records read so far.
  }
  return { messageNo, records };
}

/** Merge raw values into a topic and return its scaled, named tick (prices in rupees). */
export function applyRecord(topic, values) {
  values.forEach((v, i) => { if (v !== NO_VALUE) topic.raw[i] = v; });
  const layout = LAYOUT[topic.key.slice(0, 2)];
  const scale = 10 ** (topic.precision || 0) * (topic.multiplier || 1);
  const tick = { key: topic.key };
  topic.raw.forEach((v, i) => {
    const name = layout?.names[i];
    if (name === undefined || v === undefined) return;
    tick[name] = layout.isPrice(i) ? v / scale : v;
  });
  return tick;
}

// ── connection pool ──

const connections = new Map();

function closeEntry(_key, entry) {
  if (entry.ping) { clearInterval(entry.ping); entry.ping = null; }
  entry.connected = false;
  try { entry.ws?.close(); } catch { /* already closed */ }
}

export const bigulFeedGuard = createFeedPoolGuard(connections, {
  label: "Bigul",
  closeEntry,
  isBusy: (entry) => entry.tickListeners.size > 0,
});

/** Close every Bigul socket (session expired, logout, tests). */
export function closeBigulFeeds() {
  bigulFeedGuard.closeAll();
}

/** Test hook. */
export function __resetBigulFeeds() {
  closeBigulFeeds();
  connections.clear();
}

function send(entry, frame) {
  if (entry.ws && entry.ws.readyState === OPEN) entry.ws.send(frame);
}

function onData(entry, buf) {
  const { messageNo, records } = decodeData(buf);
  if (entry.ackEvery > 0 && ++entry.sinceAck >= entry.ackEvery) {
    entry.sinceAck = 0;
    send(entry, ackFrame(messageNo));
  }
  for (const r of records) {
    let topic = entry.topics.get(r.topic);
    if (r.kind === "S") {
      topic = { key: r.key, raw: [], multiplier: r.multiplier, precision: r.precision };
      entry.topics.set(r.topic, topic);
    }
    if (!topic) continue;
    const tick = applyRecord(topic, r.values);
    if (!entry.subscribed.has(topic.key)) continue;
    entry.latest.set(topic.key, tick);
    for (const fn of entry.tickListeners) fn(topic.key, tick);
  }
}

function open(token, key, entry) {
  const WS = globalThis.WebSocket;
  if (typeof WS !== "function") throw new BrokerError("Bigul: this Node.js build has no WebSocket client");
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    const ws = new WS(WS_URL);
    ws.binaryType = "arraybuffer";
    entry.ws = ws;
    const timer = setTimeout(() => { fail(new BrokerError("Bigul feed connection timed out")); try { ws.close(); } catch { /* ignore */ } }, CONNECT_TIMEOUT_MS);
    ws.addEventListener("open", () => ws.send(connectFrame(token)));
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") return; // "Pong" and other text frames
      const buf = Buffer.from(ev.data);
      if (buf.length < 4) return;
      const type = buf[2];
      if (type === REQ.CONNECT) {
        const reply = readConnectReply(buf);
        if (!reply.ok) {
          clearTimeout(timer);
          fail(new SessionRequiredError("Bigul: the market-data feed rejected the session. Log in again from Broker Settings."));
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        entry.ackEvery = reply.ackEvery;
        ws.send(modeFrame(CHANNEL, true));
        clearTimeout(timer);
        entry.connected = true;
        entry.ping = setInterval(() => { if (ws.readyState === OPEN) ws.send("Ping"); }, PING_MS);
        entry.ping.unref?.();
        for (const fn of entry.statusListeners) fn({ connected: true });
        if (!settled) { settled = true; resolve(entry); }
      } else if (type === REQ.DATA && buf.length >= 9) {
        onData(entry, buf);
      }
    });
    const end = (reason) => {
      clearTimeout(timer);
      entry.connected = false;
      if (entry.ping) { clearInterval(entry.ping); entry.ping = null; }
      if (connections.get(key) === entry) connections.delete(key);
      for (const fn of entry.statusListeners) fn({ connected: false, reason });
      fail(new BrokerError(`Bigul feed ${reason}`));
    };
    ws.addEventListener("error", () => end("connection error"));
    ws.addEventListener("close", () => end("closed"));
  });
}

/** The pooled, authenticated connection for this session (opens one when needed). */
export async function getConnection(creds) {
  const { token } = getSession(creds);
  const key = createHash("sha256").update(token).digest("hex");
  const existing = connections.get(key);
  if (existing?.connected && existing.ws?.readyState === OPEN) return bigulFeedGuard.touch(existing);
  if (existing?.connecting) return existing.connecting;
  if (existing) connections.delete(key);
  bigulFeedGuard.beforeOpen();
  const entry = { ws: null, connected: false, connecting: null, ping: null, ackEvery: 0, sinceAck: 0, topics: new Map(), latest: new Map(),
    subscribed: new Set(), tickListeners: new Set(), statusListeners: new Set() };
  bigulFeedGuard.touch(entry);
  connections.set(key, entry);
  entry.connecting = open(token, key, entry).finally(() => { entry.connecting = null; });
  return entry.connecting;
}

/** Subscribe feed keys not yet subscribed (100 per frame), keeping the socket under the subscription cap. */
export function subscribe(entry, keys) {
  const fresh = [...new Set(keys)].filter((k) => !entry.subscribed.has(k));
  const room = new Set([...entry.subscribed, ...fresh]);
  const dropped = trimSubscriptions(room, new Set(keys), bigulFeedGuard.limits.maxSubscriptions).filter((k) => entry.subscribed.has(k));
  if (dropped.length) unsubscribe(entry, dropped);
  for (const chunk of chunkArray(fresh, KEYS_PER_FRAME)) {
    chunk.forEach((k) => entry.subscribed.add(k));
    send(entry, subscribeFrame(chunk, CHANNEL));
  }
}

export function unsubscribe(entry, keys) {
  const gone = keys.filter((k) => entry.subscribed.delete(k));
  for (const k of gone) entry.latest.delete(k);
  for (const chunk of chunkArray(gone, KEYS_PER_FRAME)) send(entry, subscribeFrame(chunk, CHANNEL, true));
}

/** Subscribe and wait up to `windowMs` (or until every key has a tick). Leaves the socket open for reuse. */
export async function subscribeAndCollect(creds, keys, windowMs = TICK_WAIT_MS) {
  const entry = await getConnection(creds);
  subscribe(entry, keys);
  const start = Date.now();
  while (Date.now() - start < windowMs && !keys.every((k) => entry.latest.has(k))) await sleep(TICK_POLL_MS);
  bigulFeedGuard.touch(entry);
  return new Map(keys.map((k) => [k, entry.latest.get(k)]));
}

/** Feed key for a master row: indices by name, everything else by token. */
export function feedKey(row, kind = "sf") {
  if (row.instrumentType === "INDEX") return `if|${row.segment}|${row.feedName}`;
  return `${kind}|${row.segment}|${row.token}`;
}
