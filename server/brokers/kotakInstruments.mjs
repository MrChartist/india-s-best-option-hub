/**
 * Kotak Securities (Neo) instrument/scrip master — daily CSV download + parsing.
 *
 * Neo has no native option-chain or expiry-list endpoint, so strikes/expiries/
 * pSymbol tokens are all resolved from Kotak's own daily scrip-master CSVs
 * (broker-api-docs/kotak-api-docs/04-market-data-instruments.md), the same
 * source marketcalls/openalgo's broker/kotak/database/master_contract_db.py uses.
 *
 * Discovery is two calls: GET .../masterscrip/file-paths returns per-segment CSV
 * URLs (they rotate daily), then each CSV is downloaded directly (no auth needed
 * on the CSV itself — it's a public CDN link). Cached once/day per exchange
 * segment, shared across all users' credentials, exactly like zerodhaInstruments.mjs.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

const FILE_PATHS_ENDPOINT = "/script-details/1.0/masterscrip/file-paths";

// Which scrip-master segment each app symbol's option contracts live in, and the
// pExchSeg value used in quote queries for that segment.
export const UNDERLYING_SEGMENT = {
  NIFTY: "nse_fo",
  BANKNIFTY: "nse_fo",
  FINNIFTY: "nse_fo",
  MIDCPNIFTY: "nse_fo",
  SENSEX: "bse_fo",
};

// pSymbolName column value for each underlying's option contracts.
export const UNDERLYING_NAME = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
  SENSEX: "SENSEX",
};

// Index-spot query targets, per the official docs' "Glossary: Index search
// values" (05-market-data-quotes.md) — exact case-sensitive names Kotak expects
// after the `nse_cm|` / `bse_cm|` exchange-segment prefix.
export const INDEX_SPOT_QUERY = {
  NIFTY: { exchSeg: "nse_cm", name: "Nifty 50" },
  BANKNIFTY: { exchSeg: "nse_cm", name: "Nifty Bank" },
  FINNIFTY: { exchSeg: "nse_cm", name: "Nifty Fin Service" },
  MIDCPNIFTY: { exchSeg: "nse_cm", name: "NIFTY MID SELECT" },
  SENSEX: { exchSeg: "bse_cm", name: "SENSEX" },
};

// nse_fo/cde_fo lExpiryDate values are seconds-since-1980-01-01-IST-midnight, not
// standard Unix epoch seconds; mcx_fo/bse_fo convert directly (no offset).
//
// CORRECTED 2026-09: the offset must be exactly (seconds from 1970-01-01T00:00:00Z
// to 1980-01-01T00:00:00Z) minus 5:30 (IST) = 315,532,800 - 19,800 = 315,513,000.
// This exact constant (315513000) is what marketcalls/openalgo's production Kotak
// plugin (broker/kotak/database/master_contract_db.py) adds to NSE_FO.csv's and
// CDE_FO.csv's lExpiryDate column before parsing as a Unix timestamp — confirmed
// against openalgo's live source on GitHub.
//
// The previous constant here (315511200 = 315,532,800 - 21,600, i.e. an IST-as-
// UTC+6:00 assumption instead of the correct UTC+5:30) was 1800s/30min short,
// which put every nse_fo lExpiryDate 30 minutes before true IST midnight — since
// epochSecondsToIsoDateIST() takes only the IST calendar date, that shifted EVERY
// Kotak NSE F&O expiry date (and therefore fetchOptionChain's expiry filter and
// distinctExpiriesAscending()'s listed dates) one full day too early.
const NSE_FO_EPOCH_OFFSET_SECONDS = 315513000;

function normalizeHeader(h) {
  return h.trim().replace(/;/g, "").replace(/\s+/g, "");
}

/** Minimal CSV parser — no embedded commas expected in Kotak's F&O scrip-master columns we read. */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map(normalizeHeader);
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

function epochSecondsToIsoDateIST(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function fetchFilePaths(session) {
  const res = await fetch(`${session.baseUrl}${FILE_PATHS_ENDPOINT}`, {
    headers: { Authorization: session.accessToken, "Content-Type": "application/json" },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.data?.filesPaths) {
    throw new Error(`Kotak Neo scrip-master file-paths lookup failed [${res.status}]: ${json?.message || "no filesPaths in response"}`);
  }
  return json.data.filesPaths;
}

async function downloadSegment(session, segmentKey) {
  const filePaths = await fetchFilePaths(session);
  const url = filePaths.find((u) => u.toLowerCase().includes(segmentKey));
  if (!url) throw new Error(`Kotak Neo scrip-master has no CSV for segment "${segmentKey}"`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kotak Neo scrip-master CSV download failed for "${segmentKey}" [${res.status}]`);
  const text = await res.text();
  return parseCSV(text);
}

/** Cached once/day per segment ("nse_fo"/"bse_fo"), shared across all users' credentials. */
async function getSegmentMaster(session, segmentKey) {
  return getCachedOrFetch(`kotak:instruments:${segmentKey}`, () => downloadSegment(session, segmentKey), ONE_DAY_MS);
}

/** All CE/PE option rows for `symbol`, across all expiries, with strike in rupees and expiry as ISO date. */
export async function getOptionRows(session, symbol) {
  const segment = UNDERLYING_SEGMENT[symbol];
  const name = UNDERLYING_NAME[symbol];
  if (!segment || !name) throw new Error(`Unknown symbol: ${symbol}`);

  const csvRows = await getSegmentMaster(session, segment);
  const isNseFo = segment === "nse_fo";
  const rows = [];

  for (const r of csvRows) {
    if (r.pSymbolName !== name) continue;
    const optType = (r.pOptionType || "").toUpperCase();
    if (optType !== "CE" && optType !== "PE") continue; // skip futures (XX) and anything unexpected

    const rawExpiry = Number(r.lExpiryDate);
    if (!Number.isFinite(rawExpiry)) continue;
    const expiryIso = isNseFo
      ? epochSecondsToIsoDateIST(rawExpiry + NSE_FO_EPOCH_OFFSET_SECONDS)
      : epochSecondsToIsoDateIST(rawExpiry);

    const strike = Number(r.dStrikePrice) / 100;
    if (!Number.isFinite(strike)) continue;

    rows.push({
      token: r.pSymbol,
      tradingSymbol: r.pTrdSymbol,
      exchSeg: r.pExchSeg || segment,
      strike,
      type: optType === "CE" ? "ce" : "pe",
      expiry: expiryIso,
      lotSize: Number(r.lLotSize) || 0,
    });
  }
  return rows;
}

/** Distinct ascending ISO expiry dates from a set of option rows. */
export function distinctExpiriesAscending(rows) {
  const set = new Set(rows.map((r) => r.expiry).filter(Boolean));
  return Array.from(set).sort();
}
