/**
 * Instrument-master + batched-quotes fallback for Paytm Money — used only
 * for SENSEX, since /fno/v1/option-chain (paytmChain.mjs) is confirmed
 * empty for SENSEX in production; see paytmChain.mjs's header for the source.
 *
 * Master: GET /data/v1/scrips/security_master.csv — public, NO auth header
 * required (verified directly: a plain unauthenticated GET returns 200 with
 * the full ~7.5MB file; every other filename tried against this same route
 * — index/equity master guesses — 403s, so this appears to be the only
 * whitelisted file). One row per NSE/BSE F&O contract; no equities or
 * indices. Columns (confirmed by direct download):
 *   security_id, symbol, name, series, tick_size, lot_size, instrument_type,
 *   segment, exchange, upper_limit, lower_limit, expiry_date, strike_price,
 *   freeze_quantity
 * SENSEX option rows carry `symbol` already formatted as
 * "SENSEX-<Mon><YYYY>-<strike>-<CE|PE>" (e.g. "SENSEX-Dec2026-77000-PE") on
 * exchange="BSE", instrument_type="OPTIDX".
 *
 * Quotes: GET /data/v1/price/live?mode=FULL&pref=<comma-joined "EXCH:id:OPTION">
 * mode=FULL (not QUOTE) is required so the response carries `oi`/`change_oi`/
 * `depth` — openalgo's production Paytm plugin calls this out explicitly
 * ("QUOTE mode omits them"). Batch size/delay below mirror openalgo's Paytm
 * plugin (BATCH_SIZE=100, 100ms between batches) since Paytm publishes no
 * documented rate limit for this endpoint.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { PAYTM_BASE, INDEX_IDS, paytmGet, toIsoDate } from "./paytmClient.mjs";

const MASTER_URL = `${PAYTM_BASE}/data/v1/scrips/security_master.csv`;
const QUOTE_BATCH_SIZE = 100;
const QUOTE_BATCH_DELAY_MS = 100;

/** Minimal RFC4180-ish CSV line parser — handles quoted fields (every field in this file is quoted). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (start >= lines.length) return [];
  const headers = parseCsvLine(lines[start]).map((h) => h.trim());
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = parseCsvLine(line);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

async function downloadMaster() {
  const res = await fetch(MASTER_URL);
  if (!res.ok) throw new Error(`Paytm Money instrument master download failed [${res.status}]`);
  return parseCsv(await res.text());
}

/** Cached once/day, shared across every user's credentials — it's public market data, needs no auth. */
async function getMaster() {
  return getCachedOrFetch("paytm:instruments:security_master", downloadMaster, ONE_DAY_MS);
}

async function getOptionRows(symbol) {
  const rows = await getMaster();
  const prefix = `${symbol}-`;
  return rows.filter((r) => r.instrument_type === "OPTIDX" && r.symbol?.startsWith(prefix));
}

export async function fetchInstrumentExpiries(symbol) {
  const rows = await getOptionRows(symbol);
  const dates = Array.from(new Set(rows.map((r) => toIsoDate(r.expiry_date)).filter(Boolean)));
  dates.sort();
  return dates;
}

/** Best-effort standalone index spot via the /price/live INDEX quote. Returns 0, never throws. */
export async function fetchIndexSpot(creds, symbol) {
  const info = INDEX_IDS[symbol];
  if (!info) return 0;
  try {
    const json = await paytmGet(`/data/v1/price/live?mode=LTP&pref=${info.exch}:${info.id}:INDEX`, creds);
    return Number(json?.data?.[0]?.last_price) || 0;
  } catch {
    return 0;
  }
}

async function fetchQuotesByToken(creds, exchange, tokens) {
  const batches = await batchWithDelay(tokens, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const pref = chunk.map((t) => `${exchange}:${t}:OPTION`).join(",");
    const json = await paytmGet(`/data/v1/price/live?mode=FULL&pref=${encodeURIComponent(pref)}`, creds);
    return json?.data || [];
  });
  const byToken = new Map();
  for (const batch of batches) {
    for (const quote of batch) {
      const token = String(quote.security_id || "");
      if (token) byToken.set(token, quote);
    }
  }
  return byToken;
}

export async function fetchInstrumentChain(creds, symbol, expiryIso) {
  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { oc: {}, last_price: 0 };

  const expiries = Array.from(new Set(rows.map((r) => toIsoDate(r.expiry_date)))).sort();
  const resolvedIso = expiryIso || expiries[0];
  if (!resolvedIso) return { oc: {}, last_price: 0 };

  rows = rows.filter((r) => toIsoDate(r.expiry_date) === resolvedIso);
  if (rows.length === 0) return { oc: {}, last_price: 0 };

  const exchange = rows[0].exchange || "BSE";
  const daysToExpiry = daysBetween(new Date(), resolvedIso);
  const quotesByToken = await fetchQuotesByToken(creds, exchange, rows.map((r) => r.security_id));

  // Paytm's /price/live response for an OPTION scrip carries no underlying
  // spot field, so fetch it separately via the INDEX quote. If that INDEX
  // security_id turns out to be wrong (unverified — see paytmClient.mjs),
  // fall back to the median listed strike as a coarse still-usable proxy
  // for Black-Scholes rather than leaving IV/Greeks at zero.
  let spot = await fetchIndexSpot(creds, symbol);
  if (!(spot > 0)) {
    const strikes = rows.map((r) => Number(r.strike_price)).filter((s) => s > 0).sort((a, b) => a - b);
    if (strikes.length > 0) spot = strikes[Math.floor(strikes.length / 2)];
  }

  const oc = {};
  for (const row of rows) {
    const quote = quotesByToken.get(String(row.security_id));
    if (!quote) continue;
    const strike = Number(row.strike_price);
    if (!(strike > 0)) continue;
    const type = (row.symbol || "").endsWith("-CE") ? "CE" : "PE";
    const ltp = Number(quote.last_price) || 0;
    const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
    const strikeKey = String(strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][type.toLowerCase()] = {
      last_price: ltp,
      oi: Number(quote.oi) || 0,
      oi_chg: Number(quote.change_oi) || 0,
      volume: Number(quote.volume_traded ?? quote.volume) || 0,
      ...greeks,
      bid_price: Number(quote.depth?.buy?.[0]?.price) || 0,
      ask_price: Number(quote.depth?.sell?.[0]?.price) || 0,
    };
  }
  return { oc, last_price: spot };
}
