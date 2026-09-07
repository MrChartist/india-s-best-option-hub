/**
 * Definedge Securities (INTEGRATE API) instrument master + index-token map.
 *
 * Definedge publishes daily per-segment master ZIPs (public, no auth needed)
 * at app.definedgesecurities.com/public/*.zip. Each ZIP contains exactly one
 * headerless CSV whose column order is documented (and confirmed via a live
 * download at implementation time):
 *   Exchange,Token,Symbol,TradingSymbol,InstrumentType,Expiry(DDMMYYYY),
 *   TickSize(paise),LotSize,OptionType,Strike(paise),PricePrec,Multiplier,
 *   ISIN,PriceMult,Company
 * Strike (rupees) = Strike / (Multiplier * 10^PricePrec) — per Definedge's
 * own docs; Multiplier=1/PricePrec=2 for every NIFTY-family/SENSEX row
 * observed live, but the formula is applied generally for correctness.
 *
 * NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY option contracts live in the NFO
 * (nsefno.zip) file; SENSEX lives in the BFO (bsefno.zip) file — confirmed
 * live (InstrumentType "OPTIDX", Symbol column exactly "NIFTY"/"BANKNIFTY"/
 * "FINNIFTY"/"MIDCPNIFTY"/"SENSEX").
 *
 * Index (spot) tokens are NOT re-derived from the cash-segment master on
 * every request — they're small, stable, well-known NSE/BSE index tokens,
 * hardcoded below after being verified live against a real nsecash.zip /
 * bsecash.zip download (rows: "Nifty 50"->26000, "Nifty Bank"->26009,
 * "Nifty Fin Service"->26037, "NIFTY MID SELECT"->26074, all exchange NSE;
 * "SENSEX"->1, exchange BSE).
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { unzipFirstCsv } from "./hdfcskyZip.mjs";

const MASTER_URLS = {
  NFO: "https://app.definedgesecurities.com/public/nsefno.zip",
  BFO: "https://app.definedgesecurities.com/public/bsefno.zip",
};

// Which master-file segment each app symbol's option contracts live in.
export const OPTION_EXCHANGE = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// Only keep rows for symbols we actually care about — the raw NFO file also
// carries thousands of single-stock-option (OPTSTK) rows we'd otherwise cache.
const KNOWN_SYMBOLS_BY_EXCHANGE = {
  NFO: new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]),
  BFO: new Set(["SENSEX"]),
};

// Verified live against Definedge's own nsecash.zip / bsecash.zip (see module
// docblock). Used directly for standalone spot LTP — no cash-master download needed.
export const SPOT_INDEX = {
  NIFTY: { exchange: "NSE", token: "26000" },
  BANKNIFTY: { exchange: "NSE", token: "26009" },
  FINNIFTY: { exchange: "NSE", token: "26037" },
  MIDCPNIFTY: { exchange: "NSE", token: "26074" },
  SENSEX: { exchange: "BSE", token: "1" },
};

function ddmmyyyyToIso(raw) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/** Parses the headerless master CSV, keeping only OPTIDX rows for `knownSymbols`. */
function parseMasterRows(csvText, knownSymbols) {
  const lines = csvText.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length < 12) continue;
    if (cols[4] !== "OPTIDX") continue;
    const symbol = cols[2];
    if (!knownSymbols.has(symbol)) continue;
    const optionType = cols[8];
    if (optionType !== "CE" && optionType !== "PE") continue;

    const expiryIso = ddmmyyyyToIso(cols[5]);
    const strikeRaw = Number(cols[9]);
    const priceprec = Number(cols[10]);
    const multiplier = Number(cols[11]);
    const divisor = (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1) *
      Math.pow(10, Number.isFinite(priceprec) ? priceprec : 2);
    const strike = strikeRaw / divisor;
    if (!expiryIso || !Number.isFinite(strike) || strike <= 0) continue;

    out.push({
      exchange: cols[0],
      token: cols[1],
      symbol,
      tradingsymbol: cols[3],
      expiryIso,
      strike,
      optionType,
      lotsize: Number(cols[7]) || 0,
    });
  }
  return out;
}

async function downloadMaster(exchange) {
  const url = MASTER_URLS[exchange];
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Definedge master file download failed [${exchange}] (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const csvText = unzipFirstCsv(buf);
  return parseMasterRows(csvText, KNOWN_SYMBOLS_BY_EXCHANGE[exchange]);
}

/** Cached once/day per segment (NFO/BFO), shared across all users' credentials — public file, no auth needed. */
export async function getInstrumentMaster(exchange) {
  return getCachedOrFetch(`definedge:instruments:${exchange}`, () => downloadMaster(exchange), ONE_DAY_MS);
}

/** All CE/PE option rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const exchange = OPTION_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown symbol for Definedge: ${symbol}`);
  const rows = await getInstrumentMaster(exchange);
  return rows.filter((r) => r.symbol === symbol);
}

/** Distinct ISO ("YYYY-MM-DD") expiry dates, ascending. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiryIso))).sort();
}
