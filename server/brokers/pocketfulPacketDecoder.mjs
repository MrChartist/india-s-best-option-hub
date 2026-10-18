/**
 * Binary decoder for Pocketful's WebSocket "detailed marketdata" packet (mode byte = 1).
 *
 * Layout from the official JavaScript SDK (github.com/pocketful-tech/pocketfulapi-javascript, PocketfulAPI/packetDecoder.js):
 * big-endian; int8 mode, int8 exchange code, uint32 token, then uint32 fields (LTP @6 ... close @74, yearly high/low,
 * DPR band) and current/initial open interest @94/@98, with total buy/sell quantity as uint64 @38/@46. The docs'
 * sample packet (https://api.pocketful.in/docs/curl/detailed-marketdata: HDFCBANK last_traded_price 144895) shows prices
 * are integer paise, so price fields are divided by 100 here.
 *
 * Only mode 1 is decoded: it is the one subscription mode that carries LTP + OI + volume + bid/ask in a single packet.
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
