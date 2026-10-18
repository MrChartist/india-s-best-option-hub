/**
 * Shoonya-family symbol masters (NFO_symbols.txt.zip, BFO_symbols.txt.zip, NSE_symbols.txt.zip, ...) are ZIPs with a
 * single ".txt" entry. This returns the first entry with the wanted extension as UTF-8 text. Parsing, bounds checks
 * and the size caps live in server/lib/safeArchive.mjs.
 */

import { BrokerError } from "./contract.mjs";
import { listZipEntries, readZipEntry } from "../lib/safeArchive.mjs";

const LABEL = "Symbol master";

/** The first entry whose name ends with `ext` (case-insensitive), as UTF-8 text. */
export function unzipFirstEntry(buf, ext) {
  const want = String(ext).toLowerCase();
  const entry = listZipEntries(buf, { label: LABEL }).find((e) => e.name.toLowerCase().endsWith(want));
  if (!entry) throw new BrokerError(`${LABEL}: ZIP archive has no entry ending in "${ext}"`);
  return readZipEntry(buf, entry, { label: LABEL }).toString("utf8");
}
