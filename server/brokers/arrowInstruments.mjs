/**
 * Arrow instrument master + quote helpers.
 *
 * Arrow has no native option-chain endpoint (verified against openalgo's
 * production adapter — data.py only exposes single/multi quote + history).
 * So the chain is built the Zerodha/Angel way: download the daily instrument
 * CSV (https://edge.arrow.trade/all, ~221k rows across every exchange), keep
 * only the option rows for our 5 supported underlyings, then batch-fetch
 * live quotes for whichever expiry is requested.
 *
 * CSV layout (docs/rest-api/symbols):
 *   Exchange,Segment,ExchSeg,Token,FullName,Symbol,TradingSymbol,Series,ISIN,
 *   LotSize,TickSize,PricePrecision,OptionType,Underlying,UnderlyingToken,
 *   StrikePrice,Expiry,FreezeQty,Lower Band,Upper Band,SurCodes,Events,ExchangeID
 *
 * Index options live under ExchSeg NSEFO (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY)
 * or BSEFO (SENSEX); StrikePrice/Expiry are plain (unscaled) values for these
 * segments — only NSECD/BSECD (currency derivatives) carry a x100000 strike
 * scale, which doesn't apply here.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { getAuthToken, authHeaders, invalidateSession, ROOT_URL } from "./arrowAuth.mjs";

/**
 * Reactive session-rejection handling: a live 401/403 proves the cached JWT is
 * dead (Arrow docs: tokens are valid 24h, but can be revoked earlier). Evicts
 * the stale cache entry so it isn't reused, and throws a message that tells the
 * user Arrow's one-time requestToken must be regenerated (a full silent retry
 * isn't possible here — see invalidateSession's docblock in arrowAuth.mjs).
 */
function throwIfAuthRejected(creds, res, context) {
  if (res.status === 401 || res.status === 403) {
    invalidateSession(creds);
    throw new Error(
      `Arrow authentication rejected on ${context} (HTTP ${res.status}) — the cached session token is no ` +
      "longer valid. Generate a fresh requestToken by logging in again at " +
      "https://app.arrow.trade/app/login?appID=<appId> and paste it into Broker Settings."
    );
  }
}

const INSTRUMENTS_URL = `${ROOT_URL}/all`;

// App symbol -> (Arrow ExchSeg for its option chain, Arrow CSV `Underlying` value,
// quote-endpoint exchange code used in /info/quote* request bodies).
export const UNDERLYING_CONFIG = {
  NIFTY: { exchSeg: "NSEFO", underlying: "NIFTY", quoteExchange: "NFO" },
  BANKNIFTY: { exchSeg: "NSEFO", underlying: "BANKNIFTY", quoteExchange: "NFO" },
  FINNIFTY: { exchSeg: "NSEFO", underlying: "FINNIFTY", quoteExchange: "NFO" },
  MIDCPNIFTY: { exchSeg: "NSEFO", underlying: "MIDCPNIFTY", quoteExchange: "NFO" },
  SENSEX: { exchSeg: "BSEFO", underlying: "SENSEX", quoteExchange: "BFO" },
};

// Arrow's INDEX-exchange quote vocabulary for the 5 supported underlyings —
// verified live (per openalgo's data.py): the NSE derivative indices answer
// only to their bare underlying name, and SENSEX to its CSV display name.
export const INDEX_QUOTE_SYMBOL = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
  SENSEX: "SENSEX",
};

// Arrow returns prices as exchange-native scaled integers (paise, i.e. x100).
// Volume / OI / quantities are NOT scaled.
const PRICE_SCALE = 100;
export function scalePrice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n / PRICE_SCALE : 0;
}

/** Minimal CSV parser — Arrow's instrument dump has no embedded commas in the columns we read. */
function parseCSV(text) {
  const lines = text.split("\n");
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cols = line.split(",");
    if (cols.length < headers.length) continue;
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = cols[c]?.trim();
    rows.push(row);
  }
  return rows;
}

/** "30-Mar-2026" -> "2026-03-30". Returns "" on an unparseable expiry. */
function toIsoExpiry(ddMonYyyy) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(ddMonYyyy || "").trim());
  if (!m) return "";
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const mon = months[m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  if (!mon) return "";
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}

async function downloadAndFilterInstruments(creds) {
  const token = await getAuthToken(creds);
  const res = await fetch(INSTRUMENTS_URL, { headers: authHeaders(creds.appId, token), signal: AbortSignal.timeout(120_000) });
  throwIfAuthRejected(creds, res, "instrument master fetch");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Arrow instrument master fetch failed [${res.status}]: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  const rows = parseCSV(text);

  const wantExchSeg = new Set(Object.values(UNDERLYING_CONFIG).map((c) => c.exchSeg));
  const wantUnderlying = new Set(Object.values(UNDERLYING_CONFIG).map((c) => c.underlying));

  const filtered = [];
  for (const row of rows) {
    const exchSeg = (row.ExchSeg || "").toUpperCase();
    if (!wantExchSeg.has(exchSeg)) continue;
    const optionType = (row.OptionType || "").toUpperCase();
    if (optionType !== "CE" && optionType !== "PE") continue;
    if (!wantUnderlying.has(row.Underlying)) continue;

    const isoExpiry = toIsoExpiry(row.Expiry);
    if (!isoExpiry) continue;

    filtered.push({
      token: row.Token,
      tradingsymbol: row.TradingSymbol,
      exchSeg,
      underlying: row.Underlying,
      optionType,
      strike: Number(row.StrikePrice) || 0,
      expiry: isoExpiry,
    });
  }
  return filtered;
}

/** All CE/PE rows across our 5 supported underlyings — cached once/day, shared across users. */
async function getAllOptionRows(creds) {
  return getCachedOrFetch("arrow:instruments:options", () => downloadAndFilterInstruments(creds), ONE_DAY_MS);
}

/** All CE/PE rows for one app symbol, across every expiry. */
export async function getOptionRows(creds, symbol) {
  const cfg = UNDERLYING_CONFIG[symbol];
  if (!cfg) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = await getAllOptionRows(creds);
  return rows.filter((r) => r.exchSeg === cfg.exchSeg && r.underlying === cfg.underlying);
}

/** Distinct ISO "YYYY-MM-DD" expiries, ascending. */
export function distinctExpiriesAscending(rows) {
  return Array.from(new Set(rows.map((r) => r.expiry).filter(Boolean))).sort();
}

// Arrow's documented hard caps (verified live per openalgo): /info/quotes/{mode}
// accepts at most 100 instruments per call; Market Data rate limit is 10 req/sec.
export const QUOTE_BATCH_SIZE = 100;
export const QUOTE_BATCH_DELAY_MS = 150; // ~6-7 req/sec, safely under the 10/sec cap

/** POSTs one batch of {exchange, symbol} to /info/quotes/full, indexed by tradingsymbol. */
export async function fetchQuoteBatch(creds, items) {
  const token = await getAuthToken(creds);
  const res = await fetch(`${ROOT_URL}/info/quotes/full`, {
    method: "POST",
    headers: authHeaders(creds.appId, token, true),
    body: JSON.stringify(items),
  });
  throwIfAuthRejected(creds, res, "quotes request");
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json?.status && json.status !== "success")) {
    throw new Error(`Arrow quotes request failed [${res.status}]: ${json?.message || "unknown error"}`);
  }
  const data = Array.isArray(json?.data) ? json.data : [];
  const bySymbol = new Map();
  for (const q of data) if (q?.symbol) bySymbol.set(q.symbol, q);
  return bySymbol;
}

/** Single-instrument quote via /info/quote/{mode}. */
export async function fetchSingleQuote(creds, mode, exchange, symbol) {
  const token = await getAuthToken(creds);
  const res = await fetch(`${ROOT_URL}/info/quote/${mode}`, {
    method: "POST",
    headers: authHeaders(creds.appId, token, true),
    body: JSON.stringify({ exchange, symbol }),
  });
  throwIfAuthRejected(creds, res, "quote request");
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json?.status && json.status !== "success")) {
    throw new Error(`Arrow quote request failed [${res.status}]: ${json?.message || "unknown error"}`);
  }
  return json?.data || {};
}
