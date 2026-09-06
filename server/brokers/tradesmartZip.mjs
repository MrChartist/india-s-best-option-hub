/**
 * Minimal ZIP-archive reader — extracts the first entry from a ZIP buffer
 * using only node:zlib + Buffer. No `unzip`/`adm-zip`/etc dependency.
 *
 * TradeSmart's Noren scrip masters (https://v2api.tradesmartonline.in/<EXCH>_symbols.txt.zip)
 * are single-entry archives (one "<EXCH>_symbols.txt" per zip) — structurally
 * identical to HDFC Sky's Security Master archive (see hdfcskyZip.mjs, which
 * this is modelled on), just with a ".txt" entry instead of ".csv". Walks the
 * End-Of-Central-Directory record backwards from EOF, then the Central
 * Directory, to find the entry's real compressed size and local-header offset
 * (robust against the streamed/data-descriptor case, unlike naively parsing
 * only the first Local File Header). Classic (32-bit) ZIP only — sufficient
 * for an archive well under 4 GB; ZIP64 is not implemented.
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

    if (name && !name.endsWith("/")) {
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      const raw = method === 0 ? compData : inflateRawSync(compData);
      return raw.toString("utf8");
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("ZIP archive has no file entry");
}
