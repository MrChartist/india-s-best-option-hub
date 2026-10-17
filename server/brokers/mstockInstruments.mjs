/**
 * mStock instrument/scrip master — daily JSON download + option-chain parsing.
 *
 * mStock has no dedicated option-chain or expiry-list endpoint (per
 * broker/mstock/api/data.py in marketcalls/openalgo — only quote/historical/
 * intraday/depth calls exist), so both are derived by filtering this master,
 * exactly like the Angel One module. The master's JSON schema is Angel's
 * OpenAPIScripMaster schema with the symbol/name columns swapped (confirmed
 * via openalgo's broker/mstock/mapping/*.py, which renames the raw API
 * `symbol` field to the DB `name` column and vice versa): a raw row's
 * `symbol` field is the short underlying name ("NIFTY", "SENSEX", ...) and
 * its `name` field is the full tradingsymbol ("NIFTY28MAR2420800CE").
 *
 * Unlike Angel, mStock's master download requires an authenticated session
 * (it's served from the same api.mstock.trade/openapi/typeb host as every
 * other call), so getInstrumentMaster takes creds and reuses mstockAuth's
 * session/retry logic rather than a bare fetch().
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { authRequest } from "./mstockAuth.mjs";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// NSE index-spot tokens per mStock's own docs (tradingapi.mstock.com/docs/v1/Annexure/) —
// these are NOT present in the OpenAPIScripMaster download (same limitation openalgo notes
// for Angel-family masters), so they're hardcoded from the documented Annexure table rather
// than resolved dynamically. They also match Angel One's own numbering exactly, which is
// further evidence of a shared backend/data vendor between the two brokers.
export const INDEX_SPOT_TOKENS = {
  NIFTY: { token: "26000", exch: "NSE" },
  BANKNIFTY: { token: "26009", exch: "NSE" },
  FINNIFTY: { token: "26037", exch: "NSE" },
  MIDCPNIFTY: { token: "26074", exch: "NSE" },
  SENSEX: { token: "51", exch: "BSE" },
};

// OPTIDX underlying `symbol` spellings to try, per underlying. MIDCPNIFTY's exact spelling
// in the live master is unconfirmed (Angel's own equivalent file flags the same uncertainty
// for its clone of this schema) so multiple candidates are checked defensively.
const OPTIDX_NAME_ALIASES = {
  NIFTY: ["NIFTY"],
  BANKNIFTY: ["BANKNIFTY"],
  FINNIFTY: ["FINNIFTY"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTYMIDCAPSELECT", "NIFTY MIDCAP SELECT"],
  SENSEX: ["SENSEX"],
};

// exch_seg candidates to check (in order) for OPTIDX rows of each underlying.
const OPTIDX_EXCH_SEG = {
  NIFTY: ["NFO"],
  BANKNIFTY: ["NFO"],
  FINNIFTY: ["NFO"],
  MIDCPNIFTY: ["NFO"],
  SENSEX: ["BFO", "NFO"],
};

/** Best-effort parse of mStock's various observed expiry-string formats into ISO "YYYY-MM-DD". */
function parseExpiryToIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/^(\d{2})-([A-Z]{3})-(\d{2}|\d{4})$/); // 19-MAR-24 or 19-MAR-2024
  if (m) return fromParts(m[1], m[2], m[3]);

  m = s.match(/^(\d{2})([A-Z]{3})(\d{4}|\d{2})$/); // 19MAR2024 or 19MAR24
  if (m) return fromParts(m[1], m[2], m[3]);

  return null;
}

function fromParts(dd, mon, yy) {
  const mi = MONTHS.indexOf(mon);
  if (mi === -1) return null;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return `${year}-${String(mi + 1).padStart(2, "0")}-${dd}`;
}

export async function getInstrumentMaster(creds) {
  return getCachedOrFetch(
    "mstock:instrument-master",
    async () => {
      console.log("[mstock] downloading instrument master (OpenAPIScripMaster)");
      const json = await authRequest(creds, "/instruments/OpenAPIScripMaster", { method: "GET" });
      // mStock's Type B master returns a bare JSON array of rows (unlike Angel's, which
      // wraps nothing either) — but defend against a {status,data:[...]} envelope too.
      const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
      if (!rows) throw new Error("mStock instrument master: unexpected response shape");
      return rows;
    },
    ONE_DAY_MS
  );
}

function legType(row) {
  const name = String(row.name || "").toUpperCase();
  if (name.endsWith("CE")) return "ce";
  if (name.endsWith("PE")) return "pe";
  return null;
}

function matchesUnderlying(row, symbol) {
  const aliases = OPTIDX_NAME_ALIASES[symbol] || [];
  const base = String(row.symbol || "").toUpperCase();
  return aliases.some((a) => a === base);
}

/** Distinct ascending ISO expiry dates for an underlying, derived from OPTIDX rows. */
export function listExpiries(master, symbol) {
  const segs = OPTIDX_EXCH_SEG[symbol] || ["NFO"];
  const set = new Set();
  for (const row of master) {
    if (row.instrumenttype !== "OPTIDX") continue;
    if (!segs.includes(row.exch_seg)) continue;
    if (!matchesUnderlying(row, symbol)) continue;
    const iso = parseExpiryToIso(row.expiry);
    if (iso) set.add(iso);
  }
  return [...set].sort();
}

/** OPTIDX rows (one per strike+leg) for symbol+expiry. Strikes are already in rupees. */
export function optionRowsForExpiry(master, symbol, expiryIso) {
  const segs = OPTIDX_EXCH_SEG[symbol] || ["NFO"];
  const rows = [];
  for (const row of master) {
    if (row.instrumenttype !== "OPTIDX") continue;
    if (!segs.includes(row.exch_seg)) continue;
    if (!matchesUnderlying(row, symbol)) continue;
    if (parseExpiryToIso(row.expiry) !== expiryIso) continue;
    const type = legType(row);
    if (!type) continue;
    const strike = Number(row.strike);
    if (!(strike > 0)) continue;
    rows.push({ token: String(row.token), strike, type, exch: row.exch_seg });
  }
  return rows;
}
