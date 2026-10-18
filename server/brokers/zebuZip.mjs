/**
 * Zebu (Mynt) contract masters are single-entry ZIPs (`NSE_symbols.txt.zip` holds one `NSE_symbols.txt`, and so on).
 * This returns that entry as UTF-8 text. Parsing, bounds checks and the size caps live in server/lib/safeArchive.mjs.
 */

import { BrokerError } from "./contract.mjs";
import { listZipEntries, readZipEntry } from "../lib/safeArchive.mjs";

const LABEL = "Zebu symbol master";

/** The first entry of a ZIP archive buffer, as UTF-8 text. */
export function unzipFirstEntry(buf) {
  const [first] = listZipEntries(buf, { label: LABEL });
  if (!first) throw new BrokerError(`${LABEL}: ZIP archive has no entries`);
  return readZipEntry(buf, first, { label: LABEL }).toString("utf8");
}
