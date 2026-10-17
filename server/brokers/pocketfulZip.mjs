/**
 * Minimal multi-entry ZIP-archive reader — extracts every ".csv" entry from a
 * ZIP buffer using only node:zlib + Buffer. No `unzip`/`adm-zip`/etc dependency.
 *
 * Pocketful's contract master download
 * (GET /api/v1/contract/Compact?info=download&exchanges=...) is a single ZIP
 * containing one CSV per exchange (NSECompactScrip.csv, NFOCompactScrip.csv,
 * BSECompactScrip.csv, BFOCompactScrip.csv, ...) — unlike HDFC Sky's single-entry
 * archive (see hdfcskyZip.mjs, which this is structurally modelled on), we need
 * several named entries out of the same archive, so this walks the End-Of-
 * Central-Directory record backwards from EOF, then the Central Directory, and
 * returns every *.csv entry keyed by its lowercased filename. Classic (32-bit)
 * ZIP only — sufficient for an archive well under 4 GB; ZIP64 is not implemented.
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

/** Extracts and inflates every *.csv entry in a ZIP archive buffer. Returns Map<lowercasedName, utf8Text>. */
export function extractCsvEntries(buf) {
  const eocdPos = findEndOfCentralDirectory(buf);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  const out = new Map();
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

    if (name.toLowerCase().endsWith(".csv")) {
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      const raw = method === 0 ? compData : inflateRawSync(compData);
      // Basename only — entries observed as flat "NFOCompactScrip.csv" but be defensive about a leading path.
      const base = name.toLowerCase().split("/").pop();
      out.set(base, raw.toString("utf8"));
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
