/**
 * Tradejini "NxtradStream" binary wire-format decoder.
 *
 * Each WS message is: int32 totalLen (unused) | int8 version | int8 compression
 * (100 = zlib) | payload. The payload is a back-to-back sequence of sub-packets,
 * each: int16 packetLen | int8 pktType | a run of `fieldId(u8) + value` pairs
 * whose types/lengths are declared per pktType in a spec table. Field ids are
 * emitted in ascending order, so exchSeg (the smallest id, 26) always decodes
 * before any price field that needs its divisor.
 *
 * Field ids, types and the exchSeg divisor table follow Tradejini's official streaming SDK
 * (https://developer.tradejini.com/docs/websocket-sdks -> TypeScript SDK, lib/BinaryDefaultSpec.js and
 * BinaryParser.js, downloaded 2026-10). Only L1 touchline (pktType 10) and
 * Greeks (pktType 17) are decoded; L5 depth/OHLC/market-status/events/ping are unused since this app's leg schema
 * only needs top-of-book bid/ask, which L1 already carries. Packet length is an unsigned little-endian int16 and
 * the packet type an unsigned byte (SDK decodePKT).
 *
 * One fact here is NOT from the SDK: field 45 (id 45, type i32, key "OIChngPer", divisor 100). The SDK's table leaves
 * it out, and its id, type, key name and divisor were taken from OpenAlgo (AGPL, used for facts only). It is kept so
 * a packet that carries it still decodes past it, and it NEEDS LIVE VERIFICATION against a real Tradejini stream.
 */

import { inflateSync } from "node:zlib";

const CURRENT_PROTOCOL_VERSION = 1;
// A stream frame holds a few hundred ticks at most; anything inflating past this is dropped, not decoded.
const MAX_FRAME_INFLATED_BYTES = 4 * 1024 * 1024;

// exchSeg id -> { name, divisor } — divisor converts the wire's scaled integer
// price fields back to rupees (paise-style fixed point).
const SEG_INFO = {
  1: { name: "NSE", divisor: 100 },
  2: { name: "BSE", divisor: 100 },
  3: { name: "NFO", divisor: 100 },
  4: { name: "BFO", divisor: 100 },
  5: { name: "CDS", divisor: 10000000 },
  6: { name: "BCD", divisor: 10000 },
  7: { name: "MCD", divisor: 10000 },
  8: { name: "MCX", divisor: 100 },
  9: { name: "NCO", divisor: 10000 },
  10: { name: "BCO", divisor: 10000 },
};

const PKT_TYPE_NAMES = { 10: "L1", 17: "GREEKS" }; // 11/12/13/14/15/16 (L5/OHLC/AUTH/status/events/ping) unused here

const FIELD_SIZE = { u8: 1, i32: 4, u32: 4, u16: 2, d64: 8 };

// L1 touchline packet (pktType 10): field id -> { key, type, scaled?, fixedDivisor? }
const L1_SPEC = {
  26: { key: "exchSeg", type: "u8" },
  27: { key: "token", type: "i32" },
  28: { key: "precision", type: "u8" },
  29: { key: "ltp", type: "i32", scaled: true },
  30: { key: "open", type: "i32", scaled: true },
  31: { key: "high", type: "i32", scaled: true },
  32: { key: "low", type: "i32", scaled: true },
  33: { key: "close", type: "i32", scaled: true },
  34: { key: "chng", type: "i32", scaled: true },
  35: { key: "chngPer", type: "i32", scaled: true, fixedDivisor: 100 },
  36: { key: "atp", type: "i32", scaled: true },
  37: { key: "yHigh", type: "i32", scaled: true },
  38: { key: "yLow", type: "i32", scaled: true },
  39: { key: "ltq", type: "u32" },
  40: { key: "vol", type: "u32" },
  // Field 41 ("ttv" = total traded value, an 8-byte double) is part of the
  // wire spec between vol(40) and ucl(42) (official SDK BinaryDefaultSpec).
  // Decoding here is REQUIRED even though this app never reads ttv: fields
  // are read sequentially off the wire with no fixed offsets, so omitting a
  // real field id from the spec previously made decodePacket() treat it as
  // "unknown" and abort the whole packet — silently losing every field after
  // it (OI, bid/ask, prevOI, spotPrice, ...) whenever a touchline tick
  // happened to include ttv.
  41: { key: "ttv", type: "d64" },
  42: { key: "ucl", type: "i32", scaled: true },
  43: { key: "lcl", type: "i32", scaled: true },
  44: { key: "OI", type: "u32" },
  45: { key: "OIChngPer", type: "i32", scaled: true, fixedDivisor: 100 }, // from OpenAlgo, not the SDK: verify live
  46: { key: "ltt", type: "i32" },
  49: { key: "bidPrice", type: "i32", scaled: true },
  50: { key: "bidQty", type: "u32" },
  51: { key: "bidOrders", type: "u32" },
  52: { key: "askPrice", type: "i32", scaled: true },
  53: { key: "askQty", type: "u32" },
  54: { key: "askOrders", type: "u32" },
  55: { key: "nDepth", type: "u8" },
  56: { key: "nLen", type: "u16" },
  58: { key: "prevOI", type: "u32" },
  59: { key: "dayHighOI", type: "u32" },
  60: { key: "dayLowOI", type: "u32" },
  70: { key: "spotPrice", type: "i32", scaled: true },
  71: { key: "dayClose", type: "i32", scaled: true },
  74: { key: "vwap", type: "i32", scaled: true },
};

// Greeks packet (pktType 17) — doubles, no scaling.
const GREEKS_SPEC = {
  26: { key: "exchSeg", type: "u8" },
  27: { key: "token", type: "i32" },
  63: { key: "itm", type: "d64" },
  64: { key: "iv", type: "d64" },
  65: { key: "delta", type: "d64" },
  66: { key: "gamma", type: "d64" },
  67: { key: "theta", type: "d64" },
  68: { key: "rho", type: "d64" },
  69: { key: "vega", type: "d64" },
  72: { key: "highiv", type: "d64" },
  73: { key: "lowiv", type: "d64" },
};

const PKT_SPEC = { 10: L1_SPEC, 17: GREEKS_SPEC };

function readField(buf, idx, type) {
  switch (type) {
    case "u8": return buf.readUInt8(idx);
    case "i32": return buf.readInt32LE(idx);
    case "u32": return buf.readUInt32LE(idx);
    case "u16": return buf.readUInt16LE(idx);
    case "d64": return buf.readDoubleLE(idx);
    default: return null;
  }
}

/** Decode one framed sub-packet (L1 or GREEKS only — others are skipped by the caller). */
function decodePacket(buf, pktType) {
  const spec = PKT_SPEC[pktType];
  if (!spec) return null;

  let idx = 3; // bytes 0-1 = packet length (consumed by the caller), byte 2 = pktType
  let divisor = 100;
  const out = {};

  while (idx < buf.length) {
    const fieldId = buf.readUInt8(idx);
    idx += 1;
    const fspec = spec[fieldId];
    if (!fspec) break; // unknown field id — its length is unknowable, stop safely with what we have
    const size = FIELD_SIZE[fspec.type];
    if (idx + size > buf.length) break;

    const raw = readField(buf, idx, fspec.type);
    idx += size;

    if (fspec.key === "exchSeg") {
      const info = SEG_INFO[raw];
      out.exchSeg = info ? info.name : null;
      divisor = info ? info.divisor : 100;
    } else if (fspec.scaled) {
      out[fspec.key] = raw / (fspec.fixedDivisor || divisor);
    } else {
      out[fspec.key] = raw;
    }
  }

  out.msgType = PKT_TYPE_NAMES[pktType];
  if (out.token != null && out.exchSeg) out.symbol = `${out.token}_${out.exchSeg}`;
  return out;
}

/** One WS frame may contain multiple sub-packets, back to back, optionally zlib-compressed as a whole. */
export function parseFrame(buffer) {
  if (buffer.length < 6) return [];
  const version = buffer.readUInt8(4);
  if (version !== CURRENT_PROTOCOL_VERSION) return [];
  const compressionAlgo = buffer.readUInt8(5);

  let payload = buffer.subarray(6);
  if (compressionAlgo === 100) {
    try { payload = inflateSync(payload, { maxOutputLength: MAX_FRAME_INFLATED_BYTES }); } catch (e) {
      console.warn(`[tradejini] stream zlib inflate failed: ${e.message}`);
      return [];
    }
  }

  const packets = [];
  let offset = 0;
  while (offset + 2 <= payload.length) {
    const pktLen = payload.readUInt16LE(offset);
    if (pktLen <= 0 || offset + pktLen > payload.length) break;
    const pktType = payload.readUInt8(offset + 2);
    if (pktType === 10 || pktType === 17) {
      const decoded = decodePacket(payload.subarray(offset, offset + pktLen), pktType);
      if (decoded?.symbol) packets.push(decoded);
    }
    offset += pktLen;
  }
  return packets;
}
