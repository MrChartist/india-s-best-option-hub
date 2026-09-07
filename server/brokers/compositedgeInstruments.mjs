/**
 * CompositEdge (XTS) F&O instrument master + index-spot resolution.
 *
 * Both the contract master (`/instruments/master`) and the index list
 * (`/instruments/indexlist`) are UNAUTHENTICATED endpoints on CompositEdge's
 * market-data API — confirmed from openalgo's production adapter, which
 * calls them with a bare `Content-Type` header and no session token. That
 * means expiry lists can be served without the caller holding valid
 * credentials at all; only the actual quote calls need a logged-in session.
 *
 * Master rows arrive pipe-delimited with no header row on the wire — the
 * 23-field column order below for the "NSEFO"/"BSEFO" segments is
 * openalgo's own documented mapping, reproduced here. CompositEdge has no
 * dedicated option-chain or expiry-list endpoint; both are derived by
 * filtering this master.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { MARKET_DATA_URL } from "./compositedgeAuth.mjs";

// underlying -> F&O master segment + quote exchangeSegment id + name/spot aliases.
// exchangeSegmentId values match CompositEdge's documented numeric map: NSE=1,
// NFO=2, BSE=11, BFO=12 (NSE_INDEX/BSE_INDEX quotes reuse the NSE/BSE ids).
export const SYMBOL_CONFIG = {
  NIFTY: { segment: "NSEFO", exchangeSegmentId: 2, nameAliases: ["NIFTY"], spotAliases: ["NIFTY 50"], spotSegmentId: 1 },
  BANKNIFTY: { segment: "NSEFO", exchangeSegmentId: 2, nameAliases: ["BANKNIFTY"], spotAliases: ["NIFTY BANK"], spotSegmentId: 1 },
  FINNIFTY: { segment: "NSEFO", exchangeSegmentId: 2, nameAliases: ["FINNIFTY"], spotAliases: ["NIFTY FIN SERVICE", "NIFTY FINANCIAL SERVICES"], spotSegmentId: 1 },
  MIDCPNIFTY: { segment: "NSEFO", exchangeSegmentId: 2, nameAliases: ["MIDCPNIFTY"], spotAliases: ["NIFTY MID SELECT", "NIFTY MIDCAP SELECT"], spotSegmentId: 1 },
  SENSEX: { segment: "BSEFO", exchangeSegmentId: 12, nameAliases: ["SENSEX"], spotAliases: ["SENSEX"], spotSegmentId: 11 },
};

const FO_COLUMNS = [
  "ExchangeSegment", "ExchangeInstrumentID", "InstrumentType", "Name", "Description", "Series",
  "NameWithSeries", "InstrumentID", "PriceBandHigh", "PriceBandLow", "FreezeQty", "TickSize",
  "LotSize", "Multiplier", "UnderlyingInstrumentId", "UnderlyingIndexName", "ContractExpiration",
  "StrikePrice", "OptionType", "DisplayName", "PriceNumerator", "PriceDenominator", "DetailedDescription",
];

function parseMasterText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = new Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const fields = lines[i].split("|");
    const row = {};
    for (let j = 0; j < FO_COLUMNS.length; j++) row[FO_COLUMNS[j]] = fields[j];
    rows[i] = row;
  }
  return rows;
}

async function downloadMaster(segment) {
  const res = await fetch(`${MARKET_DATA_URL}/instruments/master`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exchangeSegmentList: [segment] }),
  });
  if (!res.ok) throw new Error(`CompositEdge instrument master download failed [${res.status}] for ${segment}`);
  const json = await res.json();
  const result = json?.result;
  if (typeof result !== "string") throw new Error(`CompositEdge instrument master: unexpected response shape for ${segment}`);
  return parseMasterText(result);
}

/** Cached once/day per segment — this master covers the whole exchange segment. */
export async function getMaster(segment) {
  return getCachedOrFetch(`compositedge:master:${segment}`, () => downloadMaster(segment), ONE_DAY_MS);
}

async function downloadIndexList(exchangeSegmentId) {
  const res = await fetch(`${MARKET_DATA_URL}/instruments/indexlist?exchangeSegment=${exchangeSegmentId}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`CompositEdge index list download failed [${res.status}] for segment ${exchangeSegmentId}`);
  const json = await res.json();
  const list = json?.result?.indexList || [];
  // Entries are "<name>_<token>" (e.g. "NIFTY 50_26000") — split on the LAST
  // underscore since index names can themselves contain underscores/spaces.
  return list.map((entry) => {
    const idx = entry.lastIndexOf("_");
    return idx === -1 ? { name: entry, token: null } : { name: entry.slice(0, idx), token: entry.slice(idx + 1) };
  });
}

/** Cached once/day — combined NSE (segment 1) + BSE (segment 11) index list. */
export async function getIndexList() {
  return getCachedOrFetch("compositedge:indexlist", async () => {
    const [nse, bse] = await Promise.all([downloadIndexList(1), downloadIndexList(11)]);
    return [
      ...nse.map((e) => ({ ...e, exchangeSegmentId: 1 })),
      ...bse.map((e) => ({ ...e, exchangeSegmentId: 11 })),
    ];
  }, ONE_DAY_MS);
}

// ── expiry / date parsing ────────────────────────────────────────────────

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/**
 * The exact wire format of ContractExpiration wasn't observable without live
 * credentials — openalgo just hands the raw string to pandas' permissive
 * date parser. This tries the common shapes (ISO prefix, "DD-MON-YYYY")
 * before falling back to JS's own Date parser, reading back the calendar
 * date in IST (exchange-local) rather than the host server's own local
 * timezone, which could otherwise shift a contract's calendar date by a day
 * on a non-IST server. Matches the IST-safe fallback already used by this
 * registry's jainamxtsInstruments.mjs / wisdomInstruments.mjs siblings.
 * Unverified against a live response — flagged here for whoever revisits
 * this once real credentials are available.
 */
export function contractExpirationToIso(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (dmy) {
    const mon = MONTHS[dmy[2].toUpperCase()];
    if (mon) return `${dmy[3]}-${mon}-${dmy[1]}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  return null;
}

function matchesName(row, aliases) {
  const name = (row.Name || "").trim().toUpperCase();
  return aliases.some((a) => a.toUpperCase() === name);
}

/** Distinct ascending ISO expiry dates for a symbol's CE/PE contracts (OptionType 3=CE, 4=PE). */
export function listExpiries(masterRows, symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) return [];
  const set = new Set();
  for (const row of masterRows) {
    if (!matchesName(row, cfg.nameAliases)) continue;
    const optType = Number(row.OptionType);
    if (optType !== 3 && optType !== 4) continue;
    const iso = contractExpirationToIso(row.ContractExpiration);
    if (iso) set.add(iso);
  }
  return [...set].sort();
}

/** {token, strike, type ("ce"|"pe")} rows for a symbol+expiry. Strikes are already in rupees. */
export function optionRowsForExpiry(masterRows, symbol, expiryIso) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) return [];
  const rows = [];
  for (const row of masterRows) {
    if (!matchesName(row, cfg.nameAliases)) continue;
    const optType = Number(row.OptionType);
    if (optType !== 3 && optType !== 4) continue;
    if (contractExpirationToIso(row.ContractExpiration) !== expiryIso) continue;
    const strike = Number(row.StrikePrice);
    if (!Number.isFinite(strike)) continue;
    rows.push({ token: row.ExchangeInstrumentID, strike, type: optType === 3 ? "ce" : "pe" });
  }
  return rows;
}

/** {token, exchangeSegmentId} for a symbol's live index-spot quote, or null if not found. */
export function indexSpotToken(indexList, symbol) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) return null;
  const aliasesUpper = cfg.spotAliases.map((a) => a.toUpperCase());
  const entry = indexList.find(
    (e) => e.exchangeSegmentId === cfg.spotSegmentId && aliasesUpper.includes((e.name || "").trim().toUpperCase())
  );
  return entry ? { token: entry.token, exchangeSegmentId: entry.exchangeSegmentId } : null;
}
