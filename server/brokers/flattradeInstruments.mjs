/**
 * Flattrade instrument-master + index-token resolution.
 *
 * Flattrade publishes daily contract-master CSVs (public S3 objects, no auth
 * needed) per exchange segment — confirmed columns via a live download:
 *   Exchange,Token,Lotsize,Symbol,Tradingsymbol,Instrument,Expiry,Strike,Optiontype
 * `Symbol` is the underlying root (e.g. "NIFTY", "SENSEX"), `Expiry` is
 * "DD-MON-YYYY". NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY live in the NFO (index
 * derivatives) file, SENSEX in the BFO file — verified against a live
 * download, all five app symbols are present in exactly one file each.
 *
 * There's also a native `POST /GetOptionChain` endpoint, but it needs a seed
 * trading symbol + mid price + "cnt" (strikes per side) and only returns
 * contract identity (tsym/token/strike/optt) — no LTP/OI/greeks — so it saves
 * nothing over reading the master CSV directly, which already carries every
 * strike/expiry/token triple in one shot. Skipped in favor of the CSV.
 *
 * Index (spot) tokens aren't in these derivatives CSVs, so they're resolved
 * via `POST /GetIndexList` (needs an authenticated session) and cached
 * alongside the CSVs.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { postJData } from "./flattradeAuth.mjs";

const SCRIP_MASTER_URLS = {
  NFO: "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/Nfo_Index_Derivatives.csv",
  BFO: "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/Bfo_Index_Derivatives.csv",
};

// Which scrip-master file each app symbol's option contracts live in.
export const UNDERLYING_EXCHANGE = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// GetIndexList is called per cash exchange (NSE for the NIFTY family, BSE for SENSEX).
const INDEX_EXCH = {
  NIFTY: "NSE",
  BANKNIFTY: "NSE",
  FINNIFTY: "NSE",
  MIDCPNIFTY: "NSE",
  SENSEX: "BSE",
};

// Candidate `idxname` strings (normalized: uppercased, non-alphanumerics stripped)
// returned by GetIndexList for each symbol. NIFTY/BANKNIFTY match the doc's own
// example ("Nifty 50" / "Nifty Bank"); FINNIFTY/MIDCPNIFTY/SENSEX names are
// best-effort common NSE/BSE index display names — unverified against a live
// GetIndexList call. If a symbol's token can't be resolved, the error message
// names the candidates tried so a real response's naming can be added here.
const INDEX_NAME_CANDIDATES = {
  NIFTY: ["NIFTY50"],
  BANKNIFTY: ["NIFTYBANK"],
  FINNIFTY: ["NIFTYFINSERVICE", "NIFTYFINANCIALSERVICES", "FINNIFTY"],
  MIDCPNIFTY: ["NIFTYMIDCAPSELECT", "NIFTYMIDSELECT", "MIDCPNIFTY"],
  SENSEX: ["SENSEX"],
};

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

function parseExpiryToIso(raw) {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(String(raw || "").trim().toUpperCase());
  if (!m) return null;
  const [, dd, mon, yyyy] = m;
  const mm = MONTHS[mon];
  return mm ? `${yyyy}-${mm}-${dd}` : null;
}

/** Flattrade's scrip master has no embedded commas/quotes in its columns — plain split is safe. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = cols[c]?.trim();
    rows.push(row);
  }
  return rows;
}

async function downloadMaster(exchange) {
  const url = SCRIP_MASTER_URLS[exchange];
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Flattrade scrip master download failed [${exchange}] (HTTP ${res.status})`);
  }
  const text = await res.text();
  const rows = parseCsv(text);

  const out = [];
  for (const r of rows) {
    if (r.Instrument !== "OPTIDX") continue;
    if (r.Optiontype !== "CE" && r.Optiontype !== "PE") continue;
    const expiryIso = parseExpiryToIso(r.Expiry);
    const strike = Number(r.Strike);
    if (!expiryIso || !Number.isFinite(strike)) continue;
    out.push({
      exch: r.Exchange,
      token: r.Token,
      underlying: r.Symbol,
      tradingsymbol: r.Tradingsymbol,
      expiryIso,
      strike,
      optionType: r.Optiontype,
      lotsize: Number(r.Lotsize) || 0,
    });
  }
  return out;
}

/** Cached once/day per exchange segment (NFO/BFO), shared across all users' credentials. */
export async function getInstrumentMaster(exchange) {
  return getCachedOrFetch(`flattrade:instruments:${exchange}`, () => downloadMaster(exchange), ONE_DAY_MS);
}

/** All CE/PE option rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown symbol for Flattrade: ${symbol}`);
  const rows = await getInstrumentMaster(exchange);
  return rows.filter((r) => r.underlying === symbol);
}

/** Distinct ISO ("YYYY-MM-DD") expiry dates, ascending. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiryIso))).sort();
}

function normalizeIdxName(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function downloadIndexList(creds, exch) {
  const json = await postJData(creds, "/GetIndexList", { exch });
  if (json?.stat !== "Ok") {
    throw new Error(`Flattrade GetIndexList [${exch}] failed: ${json?.emsg || "unknown error"}`);
  }
  return json.values || [];
}

/** Cached once/day per cash exchange (NSE/BSE) — needs a valid session for the first fetch only. */
async function getIndexList(creds, exch) {
  return getCachedOrFetch(`flattrade:idxlist:${exch}`, () => downloadIndexList(creds, exch), ONE_DAY_MS);
}

/** Resolves an app symbol to its GetQuotes-ready { exch, token } spot index contract. */
export async function resolveIndexToken(creds, symbol) {
  const exch = INDEX_EXCH[symbol];
  const candidates = INDEX_NAME_CANDIDATES[symbol];
  if (!exch || !candidates) throw new Error(`Unknown symbol for Flattrade: ${symbol}`);

  const list = await getIndexList(creds, exch);
  const normalizedCandidates = candidates.map(normalizeIdxName);
  const match = list.find((v) => normalizedCandidates.includes(normalizeIdxName(v.idxname)));
  if (!match) {
    throw new Error(
      `Flattrade GetIndexList [${exch}] did not return a token for ${symbol} ` +
        `(looked for: ${candidates.join(", ")}; got: ${list.map((v) => v.idxname).join(", ")})`
    );
  }
  return { exch, token: match.token };
}
