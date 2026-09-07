/**
 * Minimal ZIP-archive reader — extracts the first entry whose name matches a
 * given extension from a ZIP buffer, using only node:zlib + Buffer. Same
 * walk-the-Central-Directory approach as server/brokers/hdfcskyZip.mjs (which
 * is hardcoded to ".csv" for HDFC Sky's security master); duplicated here as
 * a small sibling, generalized to any extension, so Shoonya's ".txt"
 * instrument-master ZIPs (NFO_symbols.txt.zip / BFO_symbols.txt.zip /
 * NSE_symbols.txt.zip / BSE_symbols.txt.zip — all confirmed single-entry
 * live downloads) can be read without editing a file another broker depends
 * on.
 *
 * Classic (32-bit) ZIP only — Shoonya's symbol archives are well under 4 GB,
 * so ZIP64 is not implemented.
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

/** Extracts and inflates the first entry whose name ends with `ext` (case-insensitive). Returns UTF-8 text. */
export function unzipFirstEntry(buf, ext) {
  const eocdPos = findEndOfCentralDirectory(buf);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  let pos = cdOffset;
  const end = cdOffset + cdSize;
  while (pos < end) {
    if (buf.readUInt32LE(pos) !== CDH_SIG) {
      throw new Error("Corrupt ZIP archive (bad Central Directory File Header signature)");
    }
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);

    if (name.toLowerCase().endsWith(ext.toLowerCase())) {
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      const raw = method === 0 ? compData : inflateRawSync(compData);
      return raw.toString("utf8");
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`ZIP archive has no entry ending in "${ext}"`);
}
