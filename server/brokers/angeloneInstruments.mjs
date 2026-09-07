/**
 * Angel One instrument/scrip master — daily JSON download + parsing helpers.
 * Angel has no dedicated option-chain or expiry-list endpoint; both are
 * derived by filtering this master, which is also how strike/expiry map to
 * the numeric `token` every other Angel API call needs.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function isoToDDMMMYYYY(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MONTHS[m - 1]}${y}`;
}

export function ddmmmyyyyToIso(s) {
  if (!s || s.length < 9) return null;
  const day = s.slice(0, 2);
  const mon = s.slice(2, 5).toUpperCase();
  const year = s.slice(5, 9);
  const mi = MONTHS.indexOf(mon);
  if (mi === -1) return null;
  return `${year}-${String(mi + 1).padStart(2, "0")}-${day}`;
}

// OPTIDX `name` values for each underlying. MIDCPNIFTY's name in the master
// is unconfirmed across all master snapshots, so multiple spellings are
// checked (unverified — best-effort per the research notes).
export const OPTIDX_NAME_ALIASES = {
  NIFTY: ["NIFTY"],
  BANKNIFTY: ["BANKNIFTY"],
  FINNIFTY: ["FINNIFTY"],
  MIDCPNIFTY: ["MIDCPNIFTY", "NIFTY MIDCAP SELECT", "NIFTYMIDCAPSELECT"],
  SENSEX: ["SENSEX"],
};

// exch_seg candidates to check (in order) for OPTIDX rows of each underlying.
export const OPTIDX_EXCH_SEG = {
  NIFTY: ["NFO"],
  BANKNIFTY: ["NFO"],
  FINNIFTY: ["NFO"],
  MIDCPNIFTY: ["NFO"],
  SENSEX: ["BFO", "NFO"], // BFO if present, else fall back to NFO
};

// AMXIDX (index spot) `name` column variants + exchange for each underlying's live
// quote. Verified against real OpenAPIScripMaster.json rows: the NIFTY 50 AMXIDX row
// is {"symbol":"Nifty 50","name":"NIFTY",...} and Nifty Bank is {"symbol":"Nifty
// Bank","name":"BANKNIFTY",...} — i.e. `name` holds the SHORT form, not the display
// string ("NIFTY 50"/"NIFTY BANK") that was previously the only alias checked here,
// which meant this never matched and indexSpotToken() silently returned null for
// NIFTY/BANKNIFTY. The long-form strings are kept as secondary fallbacks in case a
// future scrip-master snapshot varies.
export const INDEX_SPOT_ALIASES = {
  NIFTY: { names: ["NIFTY", "NIFTY 50"], exch: "NSE" },
  BANKNIFTY: { names: ["BANKNIFTY", "NIFTY BANK"], exch: "NSE" },
  FINNIFTY: { names: ["NIFTY FIN SERVICE", "FINNIFTY"], exch: "NSE" },
  MIDCPNIFTY: { names: ["NIFTY MIDCAP SELECT", "NIFTY MID SELECT", "MIDCPNIFTY"], exch: "NSE" },
  SENSEX: { names: ["SENSEX"], exch: "BSE" },
};

export async function getInstrumentMaster() {
  return getCachedOrFetch("angelone:instrument-master", async () => {
    console.log("[angelone] downloading instrument master (OpenAPIScripMaster.json)");
    const res = await fetch(SCRIP_MASTER_URL);
    if (!res.ok) throw new Error(`Angel One instrument master download failed [${res.status}]`);
    return res.json();
  }, ONE_DAY_MS);
}

/** CE/PE detection follows Angel's own convention: OPTIDX `symbol` ends with CE/PE. */
function legType(row) {
  if (row.symbol?.endsWith("CE")) return "ce";
  if (row.symbol?.endsWith("PE")) return "pe";
  return null;
}

function matchesUnderlying(row, symbol) {
  const aliases = OPTIDX_NAME_ALIASES[symbol] || [];
  const name = (row.name || "").toUpperCase();
  return aliases.some((a) => a.toUpperCase() === name);
}

/** Distinct ascending ISO expiry dates for an underlying, derived from OPTIDX rows. */
export function listExpiries(master, symbol) {
  const segs = OPTIDX_EXCH_SEG[symbol] || ["NFO"];
  const set = new Set();
  for (const row of master) {
    if (row.instrumenttype !== "OPTIDX") continue;
    if (!segs.includes(row.exch_seg)) continue;
    if (!matchesUnderlying(row, symbol)) continue;
    const iso = ddmmmyyyyToIso(row.expiry || "");
    if (iso) set.add(iso);
  }
  return [...set].sort();
}

/** OPTIDX rows (one per strike+leg) for symbol+expiry, strike converted to rupees (master stores paise). */
export function optionRowsForExpiry(master, symbol, expiryIso) {
  const segs = OPTIDX_EXCH_SEG[symbol] || ["NFO"];
  const targetExpiry = isoToDDMMMYYYY(expiryIso);
  const rows = [];
  for (const row of master) {
    if (row.instrumenttype !== "OPTIDX") continue;
    if (!segs.includes(row.exch_seg)) continue;
    if (!matchesUnderlying(row, symbol)) continue;
    if ((row.expiry || "").toUpperCase() !== targetExpiry) continue;
    const type = legType(row);
    if (!type) continue;
    rows.push({ token: row.token, strike: Number(row.strike) / 100, type, exch_seg: row.exch_seg });
  }
  return rows;
}

/** {token, exch_seg} for the underlying's live index-spot quote, or null if not found in the master. */
export function indexSpotToken(master, symbol) {
  const cfg = INDEX_SPOT_ALIASES[symbol];
  if (!cfg) return null;
  const namesUpper = cfg.names.map((n) => n.toUpperCase());
  for (const row of master) {
    if (row.instrumenttype !== "AMXIDX") continue;
    if (row.exch_seg !== cfg.exch) continue;
    if (namesUpper.includes((row.name || "").toUpperCase())) {
      return { token: row.token, exch_seg: row.exch_seg };
    }
  }
  return null;
}
