/**
 * Minimal hand-rolled protobuf (proto3) wire-format decoder for InvestRight's
 * market-data feed. No npm dependency is allowed for this, so this file reads
 * ONLY the exact field numbers/types the app needs, taken verbatim from HDFC's
 * published schema:
 *   https://developer.hdfcsec.com/ir-docs/assets/files/GenericDTO3-...proto
 * Field numbers and the PacketType enum below come from that schema.
 *
 * Wire format refresher: each field is `tag = (fieldNumber << 3) | wireType`
 * as a varint, followed by wireType 0 (varint), 1 (fixed64: double/int64),
 * 2 (length-delimited: string/bytes/submessage) or 5 (fixed32).
 * Order/Trade submessages (huge, order-management only) are never decoded —
 * their bytes are skipped whole via the generic field-map pass.
 */

function readVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i];
    i++;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, i - offset];
}

/** Parse one message's bytes into Map<fieldNumber, Array<{wireType, raw}>>. Unknown/unsupported wire types abort the remaining scan defensively rather than mis-parsing. */
function decodeFields(buf) {
  const fields = new Map();
  let i = 0;
  while (i < buf.length) {
    const [tag, tagLen] = readVarint(buf, i);
    if (tagLen === 0) break;
    i += tagLen;
    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 7n);
    let raw;
    if (wireType === 0) {
      const [v, len] = readVarint(buf, i);
      if (len === 0) break;
      i += len;
      raw = v;
    } else if (wireType === 1) {
      raw = buf.subarray(i, i + 8);
      i += 8;
    } else if (wireType === 2) {
      const [len, lenLen] = readVarint(buf, i);
      if (lenLen === 0) break;
      i += lenLen;
      const l = Number(len);
      raw = buf.subarray(i, i + l);
      i += l;
    } else if (wireType === 5) {
      raw = buf.subarray(i, i + 4);
      i += 4;
    } else {
      break; // wireType 3/4 (deprecated groups) — not used by this schema
    }
    if (!fields.has(fieldNum)) fields.set(fieldNum, []);
    fields.get(fieldNum).push({ wireType, raw });
  }
  return fields;
}

function lastEntry(fields, num) {
  const arr = fields.get(num);
  return arr && arr.length ? arr[arr.length - 1] : null;
}

function getInt(fields, num, def = 0) {
  const e = lastEntry(fields, num);
  if (!e || typeof e.raw !== "bigint") return def;
  return Number(e.raw);
}

function getDouble(fields, num, def = 0) {
  const e = lastEntry(fields, num);
  if (!e || !Buffer.isBuffer(e.raw) || e.raw.length < 8) return def;
  return e.raw.readDoubleLE(0);
}

function getBool(fields, num, def = false) {
  return getInt(fields, num, def ? 1 : 0) !== 0;
}

function getMessageFields(fields, num) {
  const e = lastEntry(fields, num);
  if (!e || !Buffer.isBuffer(e.raw)) return null;
  return decodeFields(e.raw);
}

function getRepeatedMessageFields(fields, num) {
  const arr = fields.get(num);
  if (!arr) return [];
  return arr.filter((e) => Buffer.isBuffer(e.raw)).map((e) => decodeFields(e.raw));
}

/**
 * The PacketType enum from HDFC's GenericDTO .proto, one row per value, with the GenericDTO field that carries
 * the data for that packet ("payload"):
 *   mbp     - market-by-price quote in mbpData (field 2)
 *   index   - index value in indexData (field 3)
 *   oi      - open-interest refresh; the OI sits in mbpData.oi (field 2 -> 17)
 *   circuit - price-band refresh only; nothing this app shows
 *   skip    - order/trade/greek/heartbeat packets, not market quotes
 */
const PACKET_TABLE = [
  ["NSE_CM_ALL", 0, "mbp"],
  ["NSE_CD_ALL", 1, "mbp"],
  ["NSE_INDEX", 2, "index"],
  ["NSE_FO_ALL", 3, "mbp"],
  ["BSE_CM", 4, "mbp"],
  ["BSE_INDEX", 5, "index"],
  ["BSE_FO_ALL", 6, "mbp"],
  ["MCX_PKT", 7, "mbp"],
  ["ORDER", 8, "skip"],
  ["TRADE", 9, "skip"],
  ["NSE_CM_CIRC", 10, "circuit"],
  ["NSE_CD_CIRC", 11, "circuit"],
  ["NSE_CD_OI", 12, "oi"],
  ["NSE_FO_CIRC", 13, "circuit"],
  ["NSE_FO_OI", 14, "oi"],
  ["BSE_FO_OI", 15, "oi"],
  ["HEARTBEAT", 16, "skip"],
  ["NSE_FO_GREEK", 17, "skip"],
  ["BSE_FO_GREEK", 18, "skip"],
];

/** Enum name -> number, e.g. PACKET_TYPE.NSE_FO_ALL === 3. */
export const PACKET_TYPE = Object.freeze(Object.fromEntries(PACKET_TABLE.map(([name, value]) => [name, value])));
const PAYLOAD_OF = new Map(PACKET_TABLE.map(([, value, payload]) => [value, payload]));

function decodeMarketDepth(mdListFields) {
  if (!mdListFields) return { buy: [], sell: [] };
  const entries = getRepeatedMessageFields(mdListFields, 1); // repeated MarketDepthDTO = 1
  const buy = [];
  const sell = [];
  for (const e of entries) {
    const level = {
      quantity: getInt(e, 1),
      price: getDouble(e, 2),
      orders: getInt(e, 3),
    };
    (getBool(e, 4) ? buy : sell).push(level);
  }
  return { buy: buy.slice(0, 5), sell: sell.slice(0, 5) };
}

function decodeMbp(mbpFields) {
  return {
    ltp: getDouble(mbpFields, 1),
    open: getDouble(mbpFields, 5),
    high: getDouble(mbpFields, 6),
    close: getDouble(mbpFields, 7),
    low: getDouble(mbpFields, 8),
    volume: getInt(mbpFields, 9),
    avgPrice: getDouble(mbpFields, 11),
    depth: decodeMarketDepth(getMessageFields(mbpFields, 12)),
    totalBuyQty: getInt(mbpFields, 13),
    totalSellQty: getInt(mbpFields, 14),
    lowerCircuit: getDouble(mbpFields, 15),
    upperCircuit: getDouble(mbpFields, 16),
    oi: getInt(mbpFields, 17),
  };
}

function decodeIndex(indexFields) {
  return {
    ltp: getDouble(indexFields, 2),
    open: getDouble(indexFields, 5),
    high: getDouble(indexFields, 3),
    low: getDouble(indexFields, 4),
    close: getDouble(indexFields, 6),
  };
}

/** Payload readers by kind; each returns the tick fields, or null when the expected submessage is missing. */
const PAYLOAD_READERS = {
  index: (dto) => {
    const fields = getMessageFields(dto, 3);
    return fields ? { kind: "index", ...decodeIndex(fields) } : null;
  },
  oi: (dto) => {
    const fields = getMessageFields(dto, 2);
    return fields ? { kind: "oi", oi: getInt(fields, 17) } : null;
  },
  circuit: () => ({ kind: "circuit" }),
  mbp: (dto) => {
    const fields = getMessageFields(dto, 2);
    return fields ? { kind: "mbp", ...decodeMbp(fields) } : null;
  },
};

/**
 * One GenericDTO -> a normalised tick, or null for packets that carry no market quote. A PacketType value that is
 * not in the table (one HDFC adds later) is read as mbp, so any packet carrying mbpData still yields a tick.
 */
function decodePacket(dtoFields) {
  const packetType = getInt(dtoFields, 9);
  const payload = PAYLOAD_OF.get(packetType) ?? "mbp";
  if (payload === "skip") return null;
  const token = getInt(dtoFields, 1);
  if (!token) return null;
  const body = PAYLOAD_READERS[payload](dtoFields);
  return body ? { token, packetType, ...body } : null;
}

/** Decode one binary WS frame (GenericDTOList, falling back to a bare GenericDTO) into normalized ticks. Never throws — returns [] on anything unparseable. */
export function parseFrame(payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  try {
    const listFields = decodeFields(buf);
    const dtoBufs = getRepeatedMessageFields(listFields, 1); // repeated GenericDTO genericDTOList = 1
    const packets = dtoBufs.length ? dtoBufs : [decodeFields(buf)];
    const ticks = [];
    for (const dtoFields of packets) {
      const tick = decodePacket(dtoFields);
      if (tick) ticks.push(tick);
    }
    return ticks;
  } catch {
    return [];
  }
}
