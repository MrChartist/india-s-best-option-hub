/**
 * Shoonya symbol masters (official: https://shoonya.com/api-documentation/symbol-master). Daily ZIPs
 * served from the API root, each wrapping one comma-separated .txt with a header row:
 *   NFO/BFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize
 *   NSE:     Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize
 * (a trailing comma adds one empty column; the header-keyed reader ignores it). In BFO the Symbol column
 * is a bucket name rather than the root, so the core derives SENSEX / BANKEX from TradingSymbol and keeps
 * SENSEX50 apart (see bfoRoot in shoonyaNorenCore.mjs).
 *
 * Also used by tradesmartInstruments.mjs (same file layout on TradeSmart's host).
 */

import { parseMasterCsv } from "./shoonyaNorenCore.mjs";
import { unzipFirstEntry } from "./shoonyaZip.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";
import { brokerFetch } from "./contract.mjs";

export const MASTER_ROOT = "https://api.shoonya.com";
const SEGMENT_FILES = { NFO: "NFO_symbols.txt.zip", BFO: "BFO_symbols.txt.zip", NSE: "NSE_symbols.txt.zip" };

/** Download + unzip + parse one segment's master from `root`. Public files, no session needed. */
export async function loadZippedSegment(root, segment, label) {
  const file = SEGMENT_FILES[segment];
  if (!file) throw new Error(`${label}: unknown master segment ${segment}`);
  const res = await brokerFetch(`${root}/${file}`, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`${label} symbol master download failed (${file}, HTTP ${res.status})`);
  return parseMasterCsv(unzipFirstEntry(await readBodyCapped(res, { label: `${label} symbol master` }), ".txt"));
}

export const loadSegment = (segment) => loadZippedSegment(MASTER_ROOT, segment, "Shoonya");
