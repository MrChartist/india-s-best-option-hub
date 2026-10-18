/**
 * Pocketful's contract-master download (GET /api/v1/contract/Compact?info=download&exchanges=...) is one ZIP holding
 * a CSV per exchange (NSECompactScrip.csv, NFOCompactScrip.csv, ...). This returns every CSV entry keyed by its
 * lower-cased base name. Parsing, bounds checks and the size caps live in server/lib/safeArchive.mjs; the inflated
 * total across entries is capped too.
 */

import { BrokerError } from "./contract.mjs";
import { MAX_INFLATED_BYTES, listZipEntries, readZipEntry } from "../lib/safeArchive.mjs";

const LABEL = "Pocketful contract master";

/** Every *.csv entry in a ZIP archive buffer: Map<lowercasedBaseName, utf8Text>. */
export function extractCsvEntries(buf) {
  const out = new Map();
  let budget = MAX_INFLATED_BYTES;
  for (const entry of listZipEntries(buf, { label: LABEL })) {
    if (!entry.name.toLowerCase().endsWith(".csv")) continue;
    if (budget <= 0) throw new BrokerError(`${LABEL}: archive inflates past the ${MAX_INFLATED_BYTES}-byte limit`);
    const bytes = readZipEntry(buf, entry, { label: LABEL, maxBytes: budget });
    budget -= bytes.length;
    out.set(entry.name.toLowerCase().split("/").pop(), bytes.toString("utf8"));
  }
  return out;
}
