/**
 * Kotak Securities (Neo) broker module — see registry.mjs for the shared contract.
 *
 * Auth model: active TOTP+MPIN login (like Angel One/5paisa/Alice Blue), not a
 * paste-a-token model — see kotakAuth.mjs. The resulting session is cached
 * in-memory per-user and only re-established when missing/expired.
 *
 * No native option-chain endpoint: strikes/expiries/tokens come from Kotak's
 * daily scrip-master CSVs (kotakInstruments.mjs, cached once/day like
 * zerodhaInstruments.mjs) joined with batched neosymbol quote calls
 * (kotakQuotes.mjs). Kotak's quotes don't carry IV/Greeks, so those are
 * filled in via this app's own Black-Scholes solver (same approach as
 * Zerodha/5paisa).
 *
 * Sources: broker-api-docs/kotak-api-docs (official docs mirror) +
 * marketcalls/openalgo's broker/kotak/* (production reference implementation).
 * Kotak's Neo API is a custom in-house backend, not a white-label XTS/NEST
 * clone — endpoint shapes here are broker-specific, not shared with any other
 * integration in this registry.
 */

import { getSession } from "./kotakAuth.mjs";
import { getOptionRows, distinctExpiriesAscending, INDEX_SPOT_QUERY } from "./kotakInstruments.mjs";
import { fetchQuotesBatched, parseQuote } from "./kotakQuotes.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "kotak";
export const credentialFields = ["accessToken", "mobileNumber", "ucc", "totpSecret", "mpin"];

export async function testConnection(creds = {}) {
  try {
    const session = await getSession(creds);
    const spotCfg = INDEX_SPOT_QUERY.NIFTY;
    const quoteMap = await fetchQuotesBatched(session, [{ exchSeg: spotCfg.exchSeg, query: spotCfg.name }]);
    const q = quoteMap.get(`${spotCfg.exchSeg}|${spotCfg.name}`);
    if (!q) {
      return { status: "error", message: "Kotak Neo login succeeded but the NIFTY spot quote check failed — check credentials/session." };
    }
    return { status: "success", message: "Kotak Securities (Neo) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const session = await getSession(creds);
  const rows = await getOptionRows(session, symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

async function fetchSpot(session, symbol) {
  const cfg = INDEX_SPOT_QUERY[symbol];
  if (!cfg) throw new Error(`Unknown index: ${symbol}`);
  const quoteMap = await fetchQuotesBatched(session, [{ exchSeg: cfg.exchSeg, query: cfg.name }]);
  const q = quoteMap.get(`${cfg.exchSeg}|${cfg.name}`);
  return parseQuote(q).ltp;
}

export async function fetchLTP(creds, symbol) {
  const session = await getSession(creds);
  const lastPrice = await fetchSpot(session, symbol);
  return { status: "success", data: { last_price: lastPrice } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const session = await getSession(creds);

  let rows = await getOptionRows(session, symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchSpot(session, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const quoteTargets = rows.map((r) => ({ exchSeg: r.exchSeg, query: r.token }));
  const quoteMap = await fetchQuotesBatched(session, quoteTargets);

  const oc = {};
  for (const row of rows) {
    const q = quoteMap.get(`${row.exchSeg}|${row.token}`);
    if (!q) continue; // token not returned by the quote call — skip this leg

    const { ltp, oi, volume, bid, ask } = parseQuote(q);
    const type = row.type === "ce" ? "CE" : "PE";
    const greeks = computeIVAndGreeks({ ltp, spot, strike: row.strike, daysToExpiry, type });

    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type] = {
      last_price: ltp,
      oi,
      volume,
      ...greeks,
      bid_price: bid,
      ask_price: ask,
    };
  }

  return { status: "success", data: { oc, last_price: spot } };
}
