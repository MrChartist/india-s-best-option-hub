/**
 * IIFL Securities — real broker integration (see registry.mjs for the shared contract).
 *
 * IIFL's API (ttblaze.iifl.com) is a white-labelled Symphony Fintech "XTS"
 * deployment — see iiflAuth.mjs for the broader note on which other brokers
 * share this same backend. Auth model: active login, not paste-a-token. The
 * user pastes their IIFL "Market Data" app's App Key + Secret Key (a
 * separate credential pair from IIFL's Interactive/trading app — this
 * integration is read-only and never touches the Interactive API), and the
 * module logs in server-side, caching the resulting feed token in memory
 * (see iiflAuth.mjs).
 *
 * IIFL's Market Data API has no native option-chain endpoint, so the chain
 * is built from the daily XTS instrument master + batched /instruments/quotes
 * calls (see iiflInstruments.mjs), with IV/Greeks filled in via Black-Scholes
 * since XTS quotes carry neither.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { getSession, xtsGet } from "./iiflAuth.mjs";
import {
  getOptionRows,
  distinctExpiriesAscending,
  getIndexToken,
  fetchTouchlineQuotes,
  fetchOpenInterestQuotes,
  instrumentKey,
} from "./iiflInstruments.mjs";

export const id = "iifl";
export const credentialFields = ["apiKey", "apiSecret"];

export async function testConnection(creds = {}) {
  try {
    if (!creds.apiKey || !creds.apiSecret) {
      return { status: "error", message: "Missing apiKey or apiSecret (IIFL Market Data App Key/Secret)" };
    }
    await getSession(creds);
    // Confirm the token actually works against a real market-data endpoint,
    // not just that login itself succeeded.
    await xtsGet(creds, "/instruments/indexlist", { exchangeSegment: "1" });
    return { status: "success", message: "IIFL Securities connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(creds, symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

/**
 * Resolves the underlying's spot LTP, or 0 if the index token/quote can't be
 * resolved — matches the graceful last_price:0 fallback every other
 * XTS-family sibling (ibulls/rmoney/jainamxts/wisdom/compositedge) uses
 * instead of failing the whole option chain over one unresolved index quote.
 */
async function fetchSpot(creds, symbol) {
  const indexToken = await getIndexToken(creds, symbol);
  if (!indexToken) return 0;
  const { segment, token } = indexToken;
  const quotes = await fetchTouchlineQuotes(creds, [{ segment, token }]);
  const quote = quotes.get(instrumentKey(segment, token));
  return Number(quote?.Touchline?.LastTradedPrice) || 0;
}

export async function fetchLTP(creds, symbol) {
  const last_price = await fetchSpot(creds, symbol);
  return { status: "success", data: { last_price } };
}

function buildLeg({ touchline, oi, spot, strike, daysToExpiry, type }) {
  const ltp = touchline?.Touchline?.LastTradedPrice || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi: oi?.OpenInterest || 0,
    volume: touchline?.Touchline?.TotalTradedQuantity || 0,
    ...greeks,
    bid_price: touchline?.Touchline?.BidInfo?.Price || 0,
    ask_price: touchline?.Touchline?.AskInfo?.Price || 0,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  let rows = await getOptionRows(creds, symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchSpot(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const instruments = rows.map((r) => ({ segment: r.segment, token: r.token }));
  const touchlineQuotes = await fetchTouchlineQuotes(creds, instruments);

  let oiQuotes = new Map();
  try {
    oiQuotes = await fetchOpenInterestQuotes(creds, instruments);
  } catch (e) {
    console.log(`[iifl] open-interest fetch failed, continuing with oi=0: ${e.message}`);
  }

  const oc = {};
  for (const row of rows) {
    const key = instrumentKey(row.segment, row.token);
    const touchline = touchlineQuotes.get(key);
    if (!touchline) continue;
    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type.toLowerCase()] = buildLeg({
      touchline,
      oi: oiQuotes.get(key),
      spot,
      strike: row.strike,
      daysToExpiry,
      type: row.type,
    });
  }

  return { status: "success", data: { oc, last_price: spot } };
}
