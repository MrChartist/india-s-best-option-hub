/**
 * TradeSmart (Noren v2) instrument-master + index-spot-token resolution.
 *
 * TradeSmart's v2 REST host serves its own daily Noren scrip-master files —
 * same `*_symbols.txt.zip` layout as sibling Noren brokers (Shoonya/Flattrade),
 * confirmed against openalgo's production tradesmart adapter:
 *   https://v2api.tradesmartonline.in/<EXCH>_symbols.txt.zip
 * Each zip is a single-entry archive containing one "<EXCH>_symbols.txt" —
 * a header-first comma-delimited file (no auth needed to download; unzipped
 * with tradesmartZip.mjs, no npm dependency).
 *
 * TradeSmart has no native option-chain endpoint, so strikes/expiries/tokens
 * are resolved from these masters instead. NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY
 * option contracts live in NFO_symbols.txt (column `Symbol` = underlying root,
 * reliable for index F&O); SENSEX lives in BFO_symbols.txt, where openalgo's
 * adapter deliberately ignores the raw `Symbol` column (unreliable for BSE
 * derivatives) and instead extracts the underlying root from the leading
 * letters of `TradingSymbol` — replicated here for the same reason.
 *
 * Index *spot* tokens are not in the derivatives files. NSE_symbols.txt does
 * carry index rows (Instrument=="INDEX") for the NIFTY family, resolved by
 * normalizing TradingSymbol and matching against the same alias table
 * openalgo's adapter uses (NIFTY 50 -> NIFTY, NIFTY BANK -> BANKNIFTY, etc).
 * BSE's derivatives file has no reliable SENSEX/BANKEX index row, so — same
 * as openalgo's adapter — SENSEX's spot token is hardcoded (BSE, token "1"),
 * a value openalgo's source comments as verified live; flag for re-check if
 * TradeSmart ever changes it.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { unzipFirstEntry } from "./tradesmartZip.mjs";

const ZIP_URLS = {
  NSE: "https://v2api.tradesmartonline.in/NSE_symbols.txt.zip",
  NFO: "https://v2api.tradesmartonline.in/NFO_symbols.txt.zip",
  BSE: "https://v2api.tradesmartonline.in/BSE_symbols.txt.zip",
  BFO: "https://v2api.tradesmartonline.in/BFO_symbols.txt.zip",
};

// Which scrip-master file each app symbol's option contracts live in.
export const UNDERLYING_FILE = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// SENSEX's spot index is not resolvable from BFO/BSE master rows on this
// broker (see file header) — hardcoded per openalgo's verified adapter.
const SENSEX_INDEX = { exch: "BSE", token: "1" };

// Raw (uppercased, spaces/hyphens stripped) NSE index TradingSymbol -> app symbol.
// Verified live against TradeSmart's own NSE_symbols.txt (2026-09): it carries
// exactly 4 INDEX rows — NIFTY ("NIFTY INDEX"), BANKNIFTY ("NIFTY BANK"),
// INDIA VIX, and FINNIFTY (literally "FINNIFTY", token 26037). No MIDCPNIFTY
// row exists at all — TradeSmart's index master does not publish a live spot
// quote for NIFTY MIDCAP SELECT even though MIDCPNIFTY options trade on NFO;
// resolveIndexSpot throws a clear error for it below rather than guessing a
// candidate string that isn't there. The extra NIFTYFINSERVICE/
// NIFTYFINANCIALSERVICES aliases are kept as defensive fallbacks in case the
// live TradingSymbol ever changes.
const NSE_INDEX_ALIASES = {
  NIFTY50: "NIFTY",
  NIFTYINDEX: "NIFTY",
  NIFTYBANK: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  NIFTYFIN: "FINNIFTY",
  NIFTYFINSERVICE: "FINNIFTY",
  NIFTYFINANCIALSERVICES: "FINNIFTY",
  NIFTYMIDSELECT: "MIDCPNIFTY",
  NIFTYMIDCAPSELECT: "MIDCPNIFTY",
};

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "25-SEP-2026" -> "2026-09-25". TradeSmart's Noren masters use DD-MMM-YYYY. */
function parseExpiryToIso(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const [, dd, mon, yyyy] = m;
  const mm = MONTHS[mon.toUpperCase()];
  return mm ? `${yyyy}-${mm}-${dd.padStart(2, "0")}` : null;
}

/**
 * Header-name-based delimited parser — deliberately not position-based,
 * because TradeSmart's own BFO file carries a trailing unnamed column (extra
 * comma) that would otherwise shift every downstream field by one.
 */
function parseDelimited(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      row[headers[c]] = (cols[c] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

async function downloadMasterText(exchangeKey) {
  const url = ZIP_URLS[exchangeKey];
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TradeSmart scrip master download failed [${exchangeKey}] (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return unzipFirstEntry(buf);
}

/** Cached once/day per exchange file (NSE/NFO/BSE/BFO), shared across all users' credentials. */
async function getRawRows(exchangeKey) {
  return getCachedOrFetch(
    `tradesmart:instruments:${exchangeKey}`,
    async () => parseDelimited(await downloadMasterText(exchangeKey)),
    ONE_DAY_MS
  );
}

function extractUnderlyingFromTradingSymbol(tradingsymbol) {
  const m = /^[A-Za-z]+/.exec(String(tradingsymbol || ""));
  return m ? m[0] : tradingsymbol;
}

/** All CE/PE option rows for a given app symbol, across all expiries. */
export async function getOptionRows(symbol) {
  const exchangeKey = UNDERLYING_FILE[symbol];
  if (!exchangeKey) throw new Error(`Unknown symbol for TradeSmart: ${symbol}`);

  const raw = await getRawRows(exchangeKey);
  const out = [];
  for (const r of raw) {
    const optionType = r.OptionType;
    if (optionType !== "CE" && optionType !== "PE") continue; // skip FUT ("XX") rows

    const underlying = exchangeKey === "BFO" ? extractUnderlyingFromTradingSymbol(r.TradingSymbol) : r.Symbol;
    if (underlying !== symbol) continue;

    const expiryIso = parseExpiryToIso(r.Expiry);
    const strike = Number(r.StrikePrice ?? r.Strike);
    if (!expiryIso || !Number.isFinite(strike) || strike <= 0) continue;

    out.push({
      exch: exchangeKey,
      token: r.Token,
      tradingsymbol: r.TradingSymbol,
      expiryIso,
      strike,
      optionType,
      lotsize: Number(r.LotSize) || 0,
    });
  }
  return out;
}

/** Distinct ISO ("YYYY-MM-DD") expiry dates, ascending. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiryIso))).sort();
}

function normalizeIdxSymbol(s) {
  return String(s || "").toUpperCase().replace(/[\s-]/g, "");
}

/** Resolves an app symbol to its GetQuotes-ready { exch, token } spot index contract. */
export async function resolveIndexSpot(symbol) {
  if (symbol === "SENSEX") return SENSEX_INDEX;

  const raw = await getRawRows("NSE");
  for (const r of raw) {
    if (r.Instrument !== "INDEX") continue;
    const alias = NSE_INDEX_ALIASES[normalizeIdxSymbol(r.TradingSymbol)];
    if (alias === symbol) return { exch: "NSE", token: r.Token };
  }
  throw new Error(
    `TradeSmart does not publish a live NSE index quote for ${symbol} in its own instrument master ` +
      `(confirmed: its NSE_symbols.txt INDEX rows cover NIFTY/BANKNIFTY/FINNIFTY/INDIA VIX only as of last ` +
      `refresh). Spot price and Black-Scholes IV/Greeks are unavailable for ${symbol} on this broker; ` +
      `raw option-leg quotes (LTP/OI/volume/bid/ask) are still resolvable via its NFO option chain.`
  );
}
