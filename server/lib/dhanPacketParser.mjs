/**
 * Dhan binary market-feed frame parser.
 *
 * Extracted from proxy-server.mjs to fix two defects that only bite at scale:
 *
 * 1. MULTI-PACKET FRAMES. Dhan packs several instrument updates into one
 *    WebSocket frame. The previous inline parser read the packet at offset 0
 *    and returned, silently discarding the rest. With 5 subscribed indices that
 *    rarely mattered; with an option chain subscribed (40+ instruments) most
 *    ticks were being thrown away. Every packet header carries its own length
 *    at bytes 1-2 — this parser walks the frame using it.
 *
 * 2. KEY COLLISION. Ticks were cached by securityId alone, but securityId is
 *    only unique WITHIN an exchange segment. IDX_I 13 (NIFTY spot) and an
 *    NSE_FNO contract with id 13 overwrite each other — and the spot price is
 *    exactly what a spot-referenced stop-loss reads. Keys are now composite.
 *
 * Packet header (8 bytes, little-endian):
 *   byte 0     Feed response code
 *   bytes 1-2  Message length, INCLUDING this header
 *   byte 3     Exchange segment
 *   bytes 4-7  Security ID
 */

/** Exchange segment enum (from Dhan Annexure). */
export const EXCHANGE_SEGMENTS = {
  0: "IDX_I",    // Index
  1: "NSE_EQ",   // NSE Equity
  2: "NSE_FNO",  // NSE F&O
  3: "NSE_CUR",  // NSE Currency
  4: "BSE_EQ",   // BSE Equity
  5: "MCX_COMM", // MCX Commodity
  7: "BSE_CUR",  // BSE Currency
  8: "BSE_FNO",  // BSE F&O
};

/** Reverse lookup: segment name → number. */
export const SEGMENT_NUMBERS = Object.fromEntries(
  Object.entries(EXCHANGE_SEGMENTS).map(([k, v]) => [v, parseInt(k, 10)]),
);

/** Security ID → human-readable name, for the indices we care about by name. */
export const SECURITY_ID_TO_SYMBOL = {
  13: "NIFTY",
  25: "BANKNIFTY",
  27: "FINNIFTY",
  442: "MIDCPNIFTY",
  26: "INDIAVIX",
  1: "SENSEX",
};

const HEADER_BYTES = 8;
// A single packet is never larger than the full-mode packet plus depth. Anything
// claiming more than this is a corrupt length field, not a real packet.
const MAX_PACKET_BYTES = 512;

/**
 * The cache/subscription key for an instrument.
 *
 * securityId alone is NOT unique across segments — see the header comment. Every
 * map keyed by instrument must use this, on both the server and the browser.
 */
export function tickKey(exchangeSegment, securityId) {
  return `${exchangeSegment}:${securityId}`;
}

/**
 * Parse one packet at `offset`. Returns null when the buffer is too short for
 * the packet type, so a truncated tail is dropped rather than read as garbage.
 */
function parsePacketAt(view, buffer, offset) {
  if (offset + HEADER_BYTES > buffer.length) return null;

  const responseCode = view.getUint8(offset);
  const exchangeSegmentNum = view.getUint8(offset + 3);
  const securityId = view.getUint32(offset + 4, true);

  const exchangeSegment = EXCHANGE_SEGMENTS[exchangeSegmentNum] || `UNKNOWN_${exchangeSegmentNum}`;
  // Named indices keep their name; everything else is identified by its id. The
  // human-readable option symbol is resolved separately from the instrument
  // master — the feed does not carry it.
  const symbol = exchangeSegmentNum === 0
    ? (SECURITY_ID_TO_SYMBOL[securityId] || `ID_${securityId}`)
    : `ID_${securityId}`;

  const avail = buffer.length - offset;
  const base = { responseCode, exchangeSegment, securityId, symbol, key: tickKey(exchangeSegment, securityId) };

  switch (responseCode) {
    case 2: { // Ticker: LTP + LTT
      if (avail < 16) return null;
      return {
        ...base,
        type: "ticker",
        ltp: view.getInt32(offset + 8, true) / 100,
        ltt: view.getUint32(offset + 12, true),
      };
    }

    case 4: { // Quote: full trade data
      if (avail < 50) return null;
      return { ...base, type: "quote", ...readQuoteBody(view, offset) };
    }

    case 5: { // Open interest
      if (avail < 12) return null;
      return { ...base, type: "oi", oi: view.getUint32(offset + 8, true) };
    }

    case 6: { // Previous close
      if (avail < 16) return null;
      return {
        ...base,
        type: "prevClose",
        prevClose: view.getInt32(offset + 8, true) / 100,
        prevOI: view.getUint32(offset + 12, true),
      };
    }

    case 8: { // Full: quote + OI (+ depth, not yet decoded)
      if (avail < 62) return null;
      return {
        ...base,
        type: "full",
        ...readQuoteBody(view, offset),
        oi: view.getUint32(offset + 50, true),
        oiDayHigh: view.getUint32(offset + 54, true),
        oiDayLow: view.getUint32(offset + 58, true),
      };
    }

    case 50: { // Disconnection
      const disconnectCode = avail >= 10 ? view.getUint16(offset + 8, true) : 0;
      return { ...base, type: "disconnect", disconnectCode };
    }

    default:
      return null;
  }
}

/** The 42-byte trade body shared by the quote (4) and full (8) packets. */
function readQuoteBody(view, offset) {
  return {
    ltp: view.getInt32(offset + 8, true) / 100,
    ltq: view.getUint16(offset + 12, true),
    ltt: view.getUint32(offset + 14, true),
    avgPrice: view.getInt32(offset + 18, true) / 100,
    volume: view.getUint32(offset + 22, true),
    totalSellQty: view.getUint32(offset + 26, true),
    totalBuyQty: view.getUint32(offset + 30, true),
    open: view.getInt32(offset + 34, true) / 100,
    close: view.getInt32(offset + 38, true) / 100,
    high: view.getInt32(offset + 42, true) / 100,
    low: view.getInt32(offset + 46, true) / 100,
  };
}

/**
 * Parse a whole WebSocket frame into every packet it contains.
 *
 * Walks packets using each header's own length field. If a length field is
 * unusable (zero, negative, absurd, or running past the buffer) we parse the
 * packet at the current offset and stop — degrading to the old single-packet
 * behaviour rather than looping forever or reading misaligned bytes.
 *
 * @returns {Array<object>} zero or more parsed packets, in frame order
 */
export function parseDhanFrame(buffer) {
  if (!buffer || buffer.length < HEADER_BYTES) return [];

  const view = new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.length);
  const packets = [];
  let offset = 0;

  while (offset + HEADER_BYTES <= buffer.length) {
    const declaredLength = view.getUint16(offset + 1, true);
    const parsed = parsePacketAt(view, buffer, offset);
    if (parsed) packets.push(parsed);

    const usable =
      declaredLength >= HEADER_BYTES &&
      declaredLength <= MAX_PACKET_BYTES &&
      offset + declaredLength <= buffer.length;

    if (!usable) break; // corrupt/absent length — take what we parsed and stop
    offset += declaredLength;
  }

  return packets;
}
