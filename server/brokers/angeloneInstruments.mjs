/**
 * Angel One instrument/scrip master — daily JSON download + parsing helpers.
 *
 * Official docs (https://smartapi.angelone.in/docs/Instruments): the master is a public JSON array at
 * https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json (the older
 * margincalculator.angelbroking.com host serves the same file). Row fields:
 *   token, symbol, name, expiry ("DDMMMYYYY"), strike (paise, e.g. "2500000.000000" = 25000),
 *   lotsize, instrumenttype (AMXIDX, OPTIDX, OPTSTK, FUTIDX, FUTSTK, ...), exch_seg (NSE, BSE, NFO, BFO,
 *   MCX, CDS), tick_size (paise, "5.000000" = 0.05).
 * Verified against the live file (2026-10): index spots are AMXIDX rows whose `name` is the short form
 * (NIFTY 99926000, BANKNIFTY 99926009, FINNIFTY 99926037, MIDCPNIFTY 99926074, SENSEX 99919000,
 * BANKEX 99919012); SENSEX and BANKEX options are on BFO; option symbols end in CE/PE.
 * Angel has no expiry-list endpoint; expiries and strike->token come from this master.
 */

import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

export const SCRIP_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function isoToDDMMMYYYY(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MONTHS[m - 1]}${y}`;
}

export function ddmmmyyyyToIso(s) {
  const m = /^(\d{2})([A-Za-z]{3})(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toUpperCase());
  return mi === -1 ? null : `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]}`;
}

/** OPTIDX `name` per underlying (live master uses the short canonical names). */
export const OPTIDX_NAME_ALIASES = {
  NIFTY: ["NIFTY"],
  BANKNIFTY: ["BANKNIFTY"],
  FINNIFTY: ["FINNIFTY"],
  MIDCPNIFTY: ["MIDCPNIFTY"],
  SENSEX: ["SENSEX"],
  BANKEX: ["BANKEX"],
};

/** Derivative segment per index underlying. Anything else is treated as an NSE stock (NFO OPTSTK). */
export const OPTIDX_EXCH_SEG = { NIFTY: "NFO", BANKNIFTY: "NFO", FINNIFTY: "NFO", MIDCPNIFTY: "NFO", SENSEX: "BFO", BANKEX: "BFO" };

/** AMXIDX row `name` + segment for each index's spot quote. */
export const INDEX_SPOT_ALIASES = {
  NIFTY: { names: ["NIFTY"], exch: "NSE" },
  BANKNIFTY: { names: ["BANKNIFTY"], exch: "NSE" },
  FINNIFTY: { names: ["FINNIFTY"], exch: "NSE" },
  MIDCPNIFTY: { names: ["MIDCPNIFTY"], exch: "NSE" },
  SENSEX: { names: ["SENSEX"], exch: "BSE" },
  BANKEX: { names: ["BANKEX"], exch: "BSE" },
};

export async function getInstrumentMaster() {
  return getCachedOrFetch("angelone:instrument-master", async () => {
    const res = await brokerFetch(SCRIP_MASTER_URL, { redirect: "follow" }, { kind: "master" });
    if (!res.ok) throw new Error(`Angel One instrument master download failed [${res.status}]`);
    return res.json();
  }, ONE_DAY_MS);
}

/** CE/PE from the option symbol suffix (Angel's own convention). */
function legType(row) {
  if (row.symbol?.endsWith("CE")) return "ce";
  if (row.symbol?.endsWith("PE")) return "pe";
  return null;
}

/** { type: "OPTIDX"|"OPTSTK", seg, names } describing which master rows belong to `symbol`'s options. */
function optionScope(symbol) {
  const s = String(symbol ?? "").toUpperCase();
  if (OPTIDX_NAME_ALIASES[s]) return { type: "OPTIDX", seg: OPTIDX_EXCH_SEG[s], names: OPTIDX_NAME_ALIASES[s] };
  return { type: "OPTSTK", seg: "NFO", names: [s] };
}

function inScope(row, scope) {
  return row.instrumenttype === scope.type && row.exch_seg === scope.seg && scope.names.includes(String(row.name || "").toUpperCase());
}

/** Distinct ascending ISO expiry dates for an index or stock underlying. */
export function listExpiries(master, symbol) {
  const scope = optionScope(symbol);
  const set = new Set();
  for (const row of master) {
    if (!inScope(row, scope)) continue;
    const iso = ddmmmyyyyToIso(row.expiry);
    if (iso) set.add(iso);
  }
  return [...set].sort();
}

/** Option rows (one per strike+leg) for symbol+expiry, strike converted to rupees (master stores paise). */
export function optionRowsForExpiry(master, symbol, expiryIso) {
  const scope = optionScope(symbol);
  const targetExpiry = isoToDDMMMYYYY(expiryIso);
  const rows = [];
  for (const row of master) {
    if (!inScope(row, scope)) continue;
    if (String(row.expiry || "").toUpperCase() !== targetExpiry) continue;
    const type = legType(row);
    if (!type) continue;
    rows.push({ token: String(row.token), strike: Number(row.strike) / 100, type, exch_seg: row.exch_seg, symbol: row.symbol });
  }
  return rows;
}

/** {token, exch_seg} for the underlying's spot quote: AMXIDX for indices, the NSE "-EQ" row for stocks. */
export function indexSpotToken(master, symbol) {
  const s = String(symbol ?? "").toUpperCase();
  const cfg = INDEX_SPOT_ALIASES[s];
  for (const row of master) {
    if (cfg) {
      if (row.instrumenttype === "AMXIDX" && row.exch_seg === cfg.exch && cfg.names.includes(String(row.name || "").toUpperCase())) {
        return { token: String(row.token), exch_seg: row.exch_seg };
      }
    } else if (row.exch_seg === "NSE" && row.symbol === `${s}-EQ`) {
      return { token: String(row.token), exch_seg: "NSE" };
    }
  }
  return null;
}

const DERIV_TYPES = new Set(["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"]);

/** Master row -> contract Instrument, or null for rows outside the contract (non-canonical indices, MCX, CDS). */
export function toInstrument(row) {
  const instrumentType = row?.instrumenttype;
  if (!DERIV_TYPES.has(instrumentType) || (row.exch_seg !== "NFO" && row.exch_seg !== "BFO")) return null;
  const underlying = String(row.name || "").toUpperCase();
  if (instrumentType.endsWith("IDX") && !CANONICAL_UNDERLYINGS.includes(underlying)) return null;
  const isOption = instrumentType.startsWith("OPT");
  const expiry = ddmmmyyyyToIso(row.expiry);
  const lotSize = Number(row.lotsize);
  const tickSize = Number(row.tick_size) / 100;
  const optionType = isOption ? (legType(row) || "").toUpperCase() : null;
  const strike = isOption ? Number(row.strike) / 100 : null;
  if (!expiry || !(lotSize > 0) || !(tickSize > 0) || (isOption && (!(strike > 0) || !optionType))) return null;
  return {
    token: String(row.token),
    exchange: row.exch_seg,
    tradingSymbol: String(row.symbol),
    underlying,
    instrumentType,
    expiry,
    strike,
    optionType,
    lotSize,
    tickSize,
  };
}
