/**
 * Zerodha (Kite Connect) instrument master helpers.
 *
 * Kite has no native option-chain endpoint, so strikes/expiries/tradingsymbols
 * have to be resolved from Kite's daily CSV instrument dump. The dump is public
 * market data (only the download call itself needs a valid Authorization header),
 * so it's cached once/day via instrumentCache and shared across every user's
 * credentials rather than keyed per-user.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";

export const KITE_BASE = "https://api.kite.trade";

// Which instrument-master file (NFO vs BFO) each app symbol's option contracts live in.
export const UNDERLYING_EXCHANGE = {
  NIFTY: "NFO",
  BANKNIFTY: "NFO",
  FINNIFTY: "NFO",
  MIDCPNIFTY: "NFO",
  SENSEX: "BFO",
};

// Kite's instrument-master `name` column value for each underlying's option contracts.
export const UNDERLYING_NAME = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
  SENSEX: "SENSEX",
};

// NSE/BSE index tickers for the standalone /quote/ltp endpoint. NIFTY/BANKNIFTY/SENSEX
// verified against Kite docs; FINNIFTY confirmed via Zerodha's own markets page
// (zerodha.com/markets/indices/NIFTY%20FIN%20SERVICE) + Kite marketwatch instructions
// ("type Index Nifty Fin Service"); MIDCPNIFTY confirmed via a Kite Connect forum
// staff answer ("You need to look for NIFTY MID SELECT, this is the index for
// MIDCPNIFTY instruments"). If either ever 404s, re-check against the NFO
// instrument master's index rows.
export const SPOT_TICKER = {
  NIFTY: "NSE:NIFTY 50",
  BANKNIFTY: "NSE:NIFTY BANK",
  FINNIFTY: "NSE:NIFTY FIN SERVICE",
  MIDCPNIFTY: "NSE:NIFTY MID SELECT",
  SENSEX: "BSE:SENSEX",
};

/** Builds the Authorization + version headers every Kite Connect call needs. Never logs raw values. */
export function authHeaders(creds) {
  if (!creds?.apiKey || !creds?.accessToken) {
    throw new Error("Zerodha credentials missing apiKey/accessToken — paste both in Broker Settings.");
  }
  return {
    Authorization: `token ${creds.apiKey}:${creds.accessToken}`,
    "X-Kite-Version": "3",
  };
}

/** Minimal CSV parser — Kite's instrument dump has no embedded commas/quotes in its columns. */
function parseCSV(text) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
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

async function downloadInstruments(creds, exchange) {
  const res = await fetch(`${KITE_BASE}/instruments/${exchange}`, { headers: authHeaders(creds) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      throw new Error("Zerodha access token expired or invalid — generate a fresh token and paste it in Broker Settings.");
    }
    throw new Error(`Zerodha instrument master fetch failed [${res.status}]: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return parseCSV(text);
}

/** Cached once/day per exchange (NFO/BFO), shared across all users' credentials. */
export async function getInstrumentMaster(creds, exchange) {
  return getCachedOrFetch(`zerodha:instruments:${exchange}`, () => downloadInstruments(creds, exchange), ONE_DAY_MS);
}

/** All CE/PE instrument rows for a given app symbol, across all expiries. */
export async function getOptionRows(creds, symbol) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  const name = UNDERLYING_NAME[symbol];
  if (!exchange || !name) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = await getInstrumentMaster(creds, exchange);
  return rows.filter((r) => r.name === name && (r.instrument_type === "CE" || r.instrument_type === "PE"));
}

/** Distinct expiry dates (already "YYYY-MM-DD" in the CSV), ascending. */
export function distinctExpiriesAscending(rows) {
  const set = new Set(rows.map((r) => r.expiry).filter(Boolean));
  return Array.from(set).sort();
}
