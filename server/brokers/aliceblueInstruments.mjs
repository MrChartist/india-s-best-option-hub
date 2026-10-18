/**
 * Alice Blue contract master (V2 CSVs) — download, parse and map to contract Instrument rows.
 *
 * Official docs: https://ant.aliceblueonline.com/productdocumentation/Contract%20Master/ (checked 2026-10).
 * "Version 2.0 (Enhanced)" CSVs: https://v2api.aliceblueonline.com/restpy/static/contract_master/V2/<EXCH>.csv,
 * refreshed daily at 08:00 IST. (The legacy V1 downloads were discontinued on 5 October 2026.)
 * Headers seen in the live V2 files (2026-10):
 *   NFO: Exch, Exchange Segment, Symbol, Token, Instrument Type, Option Type, Strike Price, Instrument Name,
 *        Formatted Ins Name, Trading Symbol, Expiry Date (YYYY-MM-DD), Lot Size, Tick Size
 *   BFO: same names, Trading Symbol and Formatted Ins Name swapped, plus pdc; Instrument Type is IO / IF / SO / SF
 *        (index option, index future, stock option, stock future) instead of OPTIDX / FUTIDX / OPTSTK / FUTSTK.
 *   INDICES: exch, symbol, token (e.g. NSE,NIFTY 50,26000; BSE,SENSEX,1; BSE,BANKEX,12).
 * Columns are read by header name (case-insensitive), so the BFO column swap is harmless.
 */

import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

export const CONTRACT_MASTER_BASE = "https://v2api.aliceblueonline.com/restpy/static/contract_master/V2";

/** Option-chain exchange code (getUnderlying/getOptionChain `exch`) per underlying. */
export const CHAIN_EXCH = { NIFTY: "nse_fo", BANKNIFTY: "nse_fo", FINNIFTY: "nse_fo", MIDCPNIFTY: "nse_fo", SENSEX: "bse_fo", BANKEX: "bse_fo" };

/** INDICES.csv rows for each index's spot. */
export const INDEX_SPOT = {
  NIFTY: { rawSymbol: "NIFTY 50", exch: "NSE" },
  BANKNIFTY: { rawSymbol: "NIFTY BANK", exch: "NSE" },
  FINNIFTY: { rawSymbol: "NIFTY FIN SERVICE", exch: "NSE" },
  MIDCPNIFTY: { rawSymbol: "NIFTY MIDCAP SELECT", exch: "NSE" },
  SENSEX: { rawSymbol: "SENSEX", exch: "BSE" },
  BANKEX: { rawSymbol: "BANKEX", exch: "BSE" },
};

/** Minimal CSV line splitter (simple double-quoted fields). */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** CSV text -> array of objects keyed by lower-cased header. */
export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j] ?? ""; });
    rows.push(row);
  }
  return rows;
}

async function download(fileKey) {
  const res = await brokerFetch(`${CONTRACT_MASTER_BASE}/${fileKey}.csv`, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Alice Blue contract master download failed [${fileKey}]: HTTP ${res.status}`);
  return res.text();
}

const TYPE = { OPTIDX: "OPTIDX", FUTIDX: "FUTIDX", OPTSTK: "OPTSTK", FUTSTK: "FUTSTK", IO: "OPTIDX", IF: "FUTIDX", SO: "OPTSTK", SF: "FUTSTK" };

/** One NFO/BFO CSV row -> Instrument, or null for rows outside the contract. */
export function toInstrument(row) {
  const instrumentType = TYPE[String(row["instrument type"] ?? "").toUpperCase()];
  const exchange = String(row.exch ?? "").toUpperCase();
  if (!instrumentType || (exchange !== "NFO" && exchange !== "BFO")) return null;
  const underlying = String(row.symbol ?? "").toUpperCase();
  if (instrumentType.endsWith("IDX") && !CANONICAL_UNDERLYINGS.includes(underlying)) return null;
  const isOption = instrumentType.startsWith("OPT");
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(row["expiry date"]) ? row["expiry date"] : null;
  const lotSize = Number(row["lot size"]);
  const tickSize = Number(row["tick size"]);
  const strike = isOption ? Number(row["strike price"]) : null;
  const optionType = isOption ? String(row["option type"] ?? "").toUpperCase() : null;
  const token = String(row.token ?? "").trim();
  if (!token || !expiry || !(lotSize > 0) || !(tickSize > 0)) return null;
  if (isOption && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  return { token, exchange, tradingSymbol: String(row["trading symbol"] ?? ""), underlying, instrumentType, expiry, strike, optionType, lotSize, tickSize };
}

/** NFO + BFO derivatives, cached for a day. */
export async function getDerivativeInstruments() {
  return getCachedOrFetch("aliceblue:v2:derivatives", async () => {
    const [nfo, bfo] = await Promise.all([download("NFO"), download("BFO")]);
    const out = [];
    for (const row of [...parseCsv(nfo), ...parseCsv(bfo)]) {
      const ins = toInstrument(row);
      if (ins) out.push(ins);
    }
    return out;
  }, ONE_DAY_MS);
}

async function getIndices() {
  return getCachedOrFetch("aliceblue:v2:indices", async () => parseCsv(await download("INDICES")), ONE_DAY_MS);
}

/** { token, exch } of an index spot from INDICES.csv. */
export async function resolveIndexSpotToken(symbol) {
  const spot = INDEX_SPOT[symbol];
  if (!spot) return null;
  const rows = await getIndices();
  const row = rows.find((r) => String(r.symbol).toUpperCase() === spot.rawSymbol && String(r.exch).toUpperCase() === spot.exch);
  const token = String(row?.token ?? "").trim();
  return token ? { token, exch: spot.exch } : null;
}
