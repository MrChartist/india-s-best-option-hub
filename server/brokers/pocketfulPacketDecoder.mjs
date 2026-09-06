/**
 * Binary decoder for Pocketful's WebSocket "detailed marketdata" packet
 * (mode byte = 1). Field layout + byte offsets transcribed from OpenAlgo's
 * production Python adapter (broker/pocketful/api/packet_decoder.py,
 * decodeDetailedMarketData — struct format ">b"/">I"/">Q", i.e. big-endian
 * signed-byte / unsigned-32 / unsigned-64). Price fields are transmitted as
 * integer paise and must be divided by 100 to get rupees — confirmed against
 * the same source's data.py, which does this for every price field it reads.
 *
 * Only "detailed marketdata" (mode 1) is decoded here — it is the one
 * subscription mode that carries LTP + OI + volume + bid/ask in a single
 * packet, so fetchOptionChain/fetchLTP never need "compact_marketdata" (mode 2,
 * no OI) or "full_snapquote" (mode 4, no OI either, per the same source).
 */

const DETAILED_MIN_LEN = 102;

/** Returns null if `buf` is too short or is not a detailed-marketdata (mode 1) packet. */
export function decodeDetailedMarketData(buf) {
  if (!buf || buf.length < DETAILED_MIN_LEN) return null;
  if (buf.readInt8(0) !== 1) return null;

  return {
    mode: buf.readInt8(0),
    exchangeCode: buf.readInt8(1),
    instrumentToken: buf.readUInt32BE(2),
    lastTradedPrice: buf.readUInt32BE(6) / 100,
    lastTradedTime: buf.readUInt32BE(10),
    lastTradedQuantity: buf.readUInt32BE(14),
    tradeVolume: buf.readUInt32BE(18),
    bestBidPrice: buf.readUInt32BE(22) / 100,
    bestBidQuantity: buf.readUInt32BE(26),
    bestAskPrice: buf.readUInt32BE(30) / 100,
    bestAskQuantity: buf.readUInt32BE(34),
    totalBuyQuantity: Number(buf.readBigUInt64BE(38)),
    totalSellQuantity: Number(buf.readBigUInt64BE(46)),
    averageTradePrice: buf.readUInt32BE(54) / 100,
    exchangeTimestamp: buf.readUInt32BE(58),
    openPrice: buf.readUInt32BE(62) / 100,
    highPrice: buf.readUInt32BE(66) / 100,
    lowPrice: buf.readUInt32BE(70) / 100,
    closePrice: buf.readUInt32BE(74) / 100,
    currentOpenInterest: buf.readUInt32BE(94),
    initialOpenInterest: buf.readUInt32BE(98),
  };
}
