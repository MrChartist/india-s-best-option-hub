/**
 * Flattrade ("Pi" / PiConnect API) — real broker integration (see registry.mjs
 * for the shared contract).
 *
 * Flattrade runs the same Noren OMS that powers several other Indian discount
 * brokers (Shoonya/Finvasia, Tradesmart) — the order-status vocabulary,
 * product codes (C/M/I), and jData/jKey request shape all match that family,
 * confirmed against openalgo's flattrade adapter. Worth knowing for whoever
 * builds Shoonya/Tradesmart next: this module's request/response shapes are
 * a solid starting template there too.
 *
 * Auth model: hybrid handshake, not a pure paste-token. Flattrade's login is
 * a real browser OAuth flow (Client ID + trading password + PAN/DOB on
 * Flattrade's own hosted page) that hands back a one-time `request_code`
 * valid for only a few minutes. The user pastes clientId + apiKey + apiSecret
 * + that request_code into Broker Settings; this module performs the token
 * exchange itself (flattradeAuth.mjs) and caches the resulting session
 * ("jKey") until Flattrade's documented daily 5-6 AM IST wipe — never
 * re-exchanging the same request_code (it's single-use).
 *
 * No native option-chain endpoint returns live prices (GetOptionChain only
 * returns contract identity, no LTP/OI/greeks), and there is no bulk-quote
 * endpoint at all — every quote is one GetQuotes call per contract. So the
 * chain is built from the daily instrument master (flattradeInstruments.mjs)
 * windowed to strikes near spot + batched, rate-limited GetQuotes calls, with
 * IV/Greeks filled in via Black-Scholes since GetQuotes carries neither.
 */

import { postJData } from "./flattradeAuth.mjs";
import { getOptionRows, distinctExpiriesAscending, resolveIndexToken } from "./flattradeInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "flattrade";
export const credentialFields = ["clientId", "apiKey", "apiSecret", "requestCode"];

// Flattrade's documented non-order rate limit is 40 req/sec, 200 req/min, and
// GetQuotes takes exactly one contract per call (no bulk endpoint). 8
// concurrent requests every 2.5s averages ~192 req/min (under the 200/min
// cap with margin) while staying far under the 40/sec burst cap.
const QUOTE_BATCH_SIZE = 8;
const QUOTE_BATCH_DELAY_MS = 2500;

// A full expiry's master-CSV rows can span hundreds of strikes deep into
// illiquid OTM territory (confirmed on a live download — e.g. ~250 NIFTY
// strikes for a single weekly expiry). With no bulk-quote endpoint, fetching
// all of them would take minutes and blow well past the rate limit budget.
// Instead, center on the strike nearest spot and take this many strikes on
// each side (~41 strikes / ≤82 legs at the default) — the same "cnt strikes
// per side of a mid price" shape Flattrade's own native GetOptionChain
// endpoint uses. Increase only if you also widen the rate-limit budget above.
const STRIKE_HALF_WIDTH = 20;

function selectStrikeWindow(rows, spot, halfWidth) {
  const strikes = Array.from(new Set(rows.map((r) => r.strike))).sort((a, b) => a - b);
  if (strikes.length === 0) return [];

  let atmIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const diff = Math.abs(strikes[i] - spot);
    if (diff < minDiff) {
      minDiff = diff;
      atmIdx = i;
    }
  }

  const lo = Math.max(0, atmIdx - halfWidth);
  const hi = Math.min(strikes.length - 1, atmIdx + halfWidth);
  const keep = new Set(strikes.slice(lo, hi + 1));
  return rows.filter((r) => keep.has(r.strike));
}

async function fetchQuotesForContracts(creds, contracts) {
  const map = new Map();
  // request_code is single-use — once postJData reports the session as dead
  // (see flattradeAuth.mjs's isSessionError), re-authenticating for any
  // remaining contract would just re-exchange the same already-consumed code
  // and fail again. Skip the rest of the chunks instead of hammering the
  // token-exchange endpoint with doomed retries for every leg still to fetch.
  let sessionDead = false;
  await batchWithDelay(contracts, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    if (sessionDead) return [];
    const results = await Promise.all(
      chunk.map(async (c) => {
        try {
          const json = await postJData(creds, "/GetQuotes", { exch: c.exch, token: c.token });
          return json?.stat === "Ok" ? { token: c.token, quote: json } : null;
        } catch (e) {
          if (e?.isSessionError) sessionDead = true;
          return null; // one bad contract shouldn't fail the whole chain
        }
      })
    );
    for (const r of results) {
      if (r) map.set(r.token, r.quote);
    }
  });
  return map;
}

function buildLeg(quote, spot, strike, daysToExpiry, type) {
  const ltp = Number(quote?.lp) || 0;
  const oi = Number(quote?.oi) || 0;
  const volume = Number(quote?.v) || 0;
  const bid_price = Number(quote?.bp1) || 0;
  const ask_price = Number(quote?.sp1) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return { last_price: ltp, oi, volume, bid_price, ask_price, ...greeks };
}

export async function testConnection(creds = {}) {
  try {
    if (!creds.clientId || !creds.apiKey || !creds.apiSecret || !creds.requestCode) {
      return { status: "error", message: "Missing clientId, apiKey, apiSecret, or requestCode" };
    }
    const json = await postJData(creds, "/UserDetails", {});
    if (json?.stat !== "Ok") {
      return { status: "error", message: json?.emsg || "Flattrade did not return a success status" };
    }
    return { status: "success", message: `Flattrade connected (account ${json.actid || creds.clientId})` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const { exch, token } = await resolveIndexToken(creds, symbol);
  const json = await postJData(creds, "/GetQuotes", { exch, token });
  if (json?.stat !== "Ok") {
    throw new Error(`Flattrade GetQuotes failed for ${symbol}: ${json?.emsg || "unknown error"}`);
  }
  return { status: "success", data: { last_price: Number(json.lp) || 0 } };
}

async function fetchSpot(creds, symbol) {
  const { data } = await fetchLTP(creds, symbol);
  return data.last_price;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const expiries = distinctExpiriesAscending(rows);
  const targetExpiry = expiry || expiries[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiryIso === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchSpot(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const windowedRows = selectStrikeWindow(rows, spot, STRIKE_HALF_WIDTH);
  const contracts = windowedRows.map((r) => ({ token: r.token, exch: r.exch, strike: r.strike, optionType: r.optionType }));
  const quotes = await fetchQuotesForContracts(creds, contracts);

  const oc = {};
  for (const c of contracts) {
    const quote = quotes.get(c.token);
    if (!quote) continue;
    const strikeKey = String(c.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    const side = c.optionType === "CE" ? "ce" : "pe";
    oc[strikeKey][side] = buildLeg(quote, spot, c.strike, daysToExpiry, c.optionType);
  }

  return { status: "success", data: { oc, last_price: spot } };
}
