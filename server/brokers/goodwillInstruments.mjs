/**
 * Goodwill instrument masters. Official docs: https://developer.gwcindia.in/api/instruments (checked 2026-10)
 * list public ZIPs, each holding one Noren-format text file:
 *   NSE  https://giga.gwcindia.in/NSE_symbols.txt.zip   Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize
 *   NFO  https://giga.gwcindia.in/NFO_symbols.txt.zip   Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,
 *                                                       OptionType,StrikePrice,TickSize  (Expiry "29-DEC-2026")
 *   (also CDS, MCX, BSE, BCD; no BFO file is published, so SENSEX / BANKEX options are not available here).
 * The column layout is the standard Noren one, so the shared Noren parsers (shoonyaNorenCore.mjs) read it as is.
 */

import { BrokerError, brokerFetch } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { readBodyCapped } from "../lib/safeArchive.mjs";
import { INDEX_SPOT, parseMasterCsv, toInstrument } from "./shoonyaNorenCore.mjs";
import { unzipFirstEntry } from "./shoonyaZip.mjs";

export const MASTER_ROOT = "https://giga.gwcindia.in";

async function download(segment) {
  const res = await brokerFetch(`${MASTER_ROOT}/${segment}_symbols.txt.zip`, { redirect: "follow" }, { kind: "master", label: "Goodwill" });
  if (!res.ok) throw new BrokerError(`Goodwill ${segment} symbol master download failed (HTTP ${res.status})`);
  const text = unzipFirstEntry(await readBodyCapped(res, { label: `Goodwill ${segment} symbol master` }), ".txt");
  return parseMasterCsv(text).map((r) => toInstrument(r, segment)).filter(Boolean);
}

/** Daily-cached contract Instruments for "NSE" or "NFO" (public reference data). */
export function getSegment(segment) {
  return getCachedOrFetch(`goodwill:master:v1:${segment}`, () => download(segment), ONE_DAY_MS);
}

/** The six index spot rows (exchange tokens are the same on every Noren gateway). */
export function indexInstruments() {
  return Object.entries(INDEX_SPOT).map(([underlying, ref]) => ({
    token: ref.token, exchange: ref.exchange, tradingSymbol: ref.tradingSymbol, underlying, instrumentType: "INDEX",
    expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05,
  }));
}

/** Spot { exchange, token } for an index or an NSE stock, or null. */
export async function spotRef(symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_SPOT[u]) return { exchange: INDEX_SPOT[u].exchange, token: INDEX_SPOT[u].token };
  const eq = (await getSegment("NSE")).find((m) => m.instrumentType === "EQ" && m.underlying === u);
  return eq ? { exchange: "NSE", token: eq.token } : null;
}

/** The master row for a contract ref (NSE or NFO), or null. */
export async function findByRef(ref) {
  if (ref?.exchange !== "NSE" && ref?.exchange !== "NFO") return null;
  return (await getSegment(ref.exchange)).find((m) => m.token === String(ref.token)) ?? null;
}
