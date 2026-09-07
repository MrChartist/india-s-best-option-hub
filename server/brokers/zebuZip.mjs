/**
 * Minimal ZIP-archive reader — extracts the single entry from a ZIP buffer as
 * UTF-8 text, using only node:zlib + Buffer (no `unzip`/`adm-zip`/etc dependency).
 *
 * Zebu (Mynt) publishes its daily contract masters as single-entry ZIPs —
 * `NSE_symbols.txt.zip` containing one `NSE_symbols.txt`, etc (confirmed
 * against openalgo's zebu adapter, which downloads+extracts the same URLs).
 * Unlike server/brokers/hdfcskyZip.mjs (which hunts for a *.csv entry inside
 * a large multi-purpose archive), Zebu's archives always hold exactly one
 * file of unknown-but-irrelevant extension, so this just returns whatever
 * the first Central Directory entry is.
 *
 * Walks the End-Of-Central-Directory record backwards from EOF, then the
 * Central Directory, to find the entry's real compressed size and local-header
 * offset (robust against the streamed/data-descriptor case). Classic (32-bit)
 * ZIP only — fine for these sub-few-MB archives; ZIP64 is not implemented.
 */

import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const MAX_COMMENT_LEN = 65535;

function findEndOfCentralDirectory(buf) {
  const minPos = Math.max(0, buf.length - 22 - MAX_COMMENT_LEN);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error("Not a valid ZIP archive (End-Of-Central-Directory record not found)");
}

/** Extracts and inflates the first entry found in a ZIP archive buffer. Returns UTF-8 text. */
export function unzipFirstEntry(buf) {
  const eocdPos = findEndOfCentralDirectory(buf);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  const pos = cdOffset;
  const end = cdOffset + cdSize;
  if (pos >= end) throw new Error("ZIP archive has no entries");
  if (buf.readUInt32LE(pos) !== CDH_SIG) {
    throw new Error("Corrupt ZIP archive (bad Central Directory File Header signature)");
  }

  const method = buf.readUInt16LE(pos + 10);
  const compSize = buf.readUInt32LE(pos + 20);
  const localHeaderOffset = buf.readUInt32LE(pos + 42);

  const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
  const compData = buf.subarray(dataStart, dataStart + compSize);
  const raw = method === 0 ? compData : inflateRawSync(compData);
  return raw.toString("utf8");
}
