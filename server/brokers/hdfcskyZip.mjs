/**
 * HDFC Sky's security master (server/brokers/hdfcskyInstruments.mjs) is served as a ZIP holding CompactScrip.csv.
 * This returns the first CSV entry as UTF-8 text. Parsing, bounds checks and the size caps live in
 * server/lib/safeArchive.mjs.
 */

import { BrokerError } from "./contract.mjs";
import { listZipEntries, readZipEntry } from "../lib/safeArchive.mjs";

const LABEL = "HDFC Sky security master";

/** The first *.csv entry of a ZIP archive buffer, as UTF-8 text. */
export function unzipFirstCsv(buf) {
  const entry = listZipEntries(buf, { label: LABEL }).find((e) => e.name.toLowerCase().endsWith(".csv"));
  if (!entry) throw new BrokerError(`${LABEL}: ZIP archive has no .csv entry`);
  return readZipEntry(buf, entry, { label: LABEL }).toString("utf8");
}
