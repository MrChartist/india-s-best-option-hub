/**
 * Flattrade scrip masters (official docs, section 10 "Scrip Master"): public CSVs on
 * flattrade.s3.ap-south-1.amazonaws.com/scripmaster/, refreshed daily, columns
 *   Exchange,Token,Lotsize,Symbol,Tradingsymbol,Instrument,Expiry,Strike,Optiontype
 * (derivatives; Expiry is DD-MMM-YYYY, Optiontype CE/PE or XX for futures) and the cash files without
 * the derivative columns. There is no tick-size column, so the core defaults it to 0.05.
 *
 * Segment -> files: NFO = NSE index + NSE stock derivatives, BFO = BSE index derivatives (SENSEX,
 * BANKEX; Symbol holds the root), NSE = NSE cash (EQ series give stock spot tokens). BSE equity
 * derivatives, currency and commodity files are not loaded.
 */

import { parseMasterCsv } from "./shoonyaNorenCore.mjs";
import { brokerFetch } from "./contract.mjs";

const BASE = "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster";
export const MASTER_FILES = Object.freeze({
  NFO: [`${BASE}/Nfo_Index_Derivatives.csv`, `${BASE}/Nfo_Equity_Derivatives.csv`],
  BFO: [`${BASE}/Bfo_Index_Derivatives.csv`],
  NSE: [`${BASE}/NSE_Equity.csv`],
});

/** Raw rows (header names lower-cased) for one segment. Public files, no session needed. */
export async function loadSegment(segment) {
  const urls = MASTER_FILES[segment];
  if (!urls) throw new Error(`Flattrade: unknown master segment ${segment}`);
  const rows = [];
  for (const url of urls) {
    const res = await brokerFetch(url, { redirect: "follow" }, { kind: "master" });
    if (!res.ok) throw new Error(`Flattrade scrip master download failed (${url.split("/").pop()}, HTTP ${res.status})`);
    rows.push(...parseMasterCsv(await res.text()));
  }
  return rows;
}
