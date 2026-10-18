/**
 * Size-capped download and decompression helpers for broker instrument masters.
 *
 * Masters come from broker CDNs over HTTPS, but the proxy is one process that also runs 1Cliq, the risk engine and
 * panic close. A compromised or intercepted CDN must not be able to stall the event loop or exhaust memory with an
 * oversized body or a zip bomb. So every download is read up to a byte cap (Content-Length is checked first), every
 * inflate/gunzip runs with maxOutputLength, ZIP headers are bounds-checked, an entry whose declared size is over the
 * cap is refused before inflating, and only the stored (0) and deflate (8) methods are accepted. Every failure is a
 * BrokerError, never a raw RangeError.
 */

import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { BrokerError } from "../brokers/contract.mjs";

/** Largest master body we will download (compressed or plain). */
export const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
/** Largest decompressed master we will produce. */
export const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 65_535;

/**
 * Read a fetch Response body into a Buffer, refusing anything over `maxBytes`. Checks Content-Length first, then
 * counts streamed bytes so a lying or missing header cannot get past the cap.
 */
export async function readBodyCapped(res, { maxBytes = MAX_DOWNLOAD_BYTES, label = "Broker master" } = {}) {
  const declared = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BrokerError(`${label}: download is ${declared} bytes, over the ${maxBytes}-byte limit`);
  }
  const reader = res.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new BrokerError(`${label}: download is over the ${maxBytes}-byte limit`);
    return buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BrokerError(`${label}: download is over the ${maxBytes}-byte limit`);
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

function capped(fn, buf, maxBytes, label) {
  try {
    return fn(buf, { maxOutputLength: maxBytes });
  } catch (e) {
    if (e?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|buffer.*too large/i.test(String(e?.message))) {
      throw new BrokerError(`${label}: decompressed data is over the ${maxBytes}-byte limit`);
    }
    throw new BrokerError(`${label}: could not decompress (${e?.code || e?.message || "bad data"})`);
  }
}

/** gunzip with an output cap. */
export function gunzipCapped(buf, { maxBytes = MAX_INFLATED_BYTES, label = "Broker data" } = {}) {
  return capped(gunzipSync, buf, maxBytes, label);
}

/** zlib (RFC 1950) inflate with an output cap. */
export function inflateCapped(buf, { maxBytes = MAX_INFLATED_BYTES, label = "Broker data" } = {}) {
  return capped(inflateSync, buf, maxBytes, label);
}

function u16(buf, at, label) {
  if (at < 0 || at + 2 > buf.length) throw new BrokerError(`${label}: corrupt ZIP (offset out of range)`);
  return buf.readUInt16LE(at);
}
function u32(buf, at, label) {
  if (at < 0 || at + 4 > buf.length) throw new BrokerError(`${label}: corrupt ZIP (offset out of range)`);
  return buf.readUInt32LE(at);
}

/**
 * Central-directory listing of a classic (non-ZIP64) archive: [{ name, method, compressedSize, size, headerOffset }].
 */
export function listZipEntries(buf, { label = "Broker master" } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN; i >= Math.max(0, buf.length - EOCD_MIN - MAX_COMMENT); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new BrokerError(`${label}: not a ZIP archive`);
  const count = u16(buf, eocd + 10, label);
  const cdSize = u32(buf, eocd + 12, label);
  const cdStart = u32(buf, eocd + 16, label);
  if (cdStart + cdSize > eocd) throw new BrokerError(`${label}: corrupt ZIP (central directory out of range)`);

  const entries = [];
  let pos = cdStart;
  for (let n = 0; n < count && pos < cdStart + cdSize; n++) {
    if (u32(buf, pos, label) !== CDH_SIG) throw new BrokerError(`${label}: corrupt ZIP (bad central directory entry)`);
    const nameLen = u16(buf, pos + 28, label);
    const extraLen = u16(buf, pos + 30, label);
    const commentLen = u16(buf, pos + 32, label);
    if (pos + 46 + nameLen > buf.length) throw new BrokerError(`${label}: corrupt ZIP (name out of range)`);
    entries.push({
      name: buf.toString("utf8", pos + 46, pos + 46 + nameLen),
      method: u16(buf, pos + 10, label),
      compressedSize: u32(buf, pos + 20, label),
      size: u32(buf, pos + 24, label),
      headerOffset: u32(buf, pos + 42, label),
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** One entry's bytes, inflated under the cap. Refuses unknown methods and over-cap declared sizes up front. */
export function readZipEntry(buf, entry, { maxBytes = MAX_INFLATED_BYTES, label = "Broker master" } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (entry.method !== 0 && entry.method !== 8) throw new BrokerError(`${label}: unsupported ZIP compression method ${entry.method}`);
  if (entry.size > maxBytes) throw new BrokerError(`${label}: ZIP entry declares ${entry.size} bytes, over the ${maxBytes}-byte limit`);
  const at = entry.headerOffset;
  if (u32(buf, at, label) !== LFH_SIG) throw new BrokerError(`${label}: corrupt ZIP (bad local header)`);
  const start = at + 30 + u16(buf, at + 26, label) + u16(buf, at + 28, label);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new BrokerError(`${label}: corrupt ZIP (entry data out of range)`);
  const data = buf.subarray(start, end);
  if (entry.method === 0) {
    if (data.length > maxBytes) throw new BrokerError(`${label}: ZIP entry is over the ${maxBytes}-byte limit`);
    return data;
  }
  return capped(inflateRawSync, data, maxBytes, label);
}
