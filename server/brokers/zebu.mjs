/**
 * Zebu (Mynt) — real broker integration (see registry.mjs for the shared
 * contract).
 *
 * Zebu runs the same Noren OMS that powers Flattrade/Shoonya/Tradesmart — the
 * `jData=<json>` POST envelope, `stat`/`emsg` response shape, and GetQuotes
 * field names (lp/oi/v/bp1/sp1/...) all match that family, confirmed against
 * openalgo's zebu adapter. Worth knowing for whoever builds Shoonya/Tradesmart
 * next: this module's request/response shapes (zebuAuth.mjs, zebuInstruments.mjs)
 * are a close starting template there too — the one real difference is Zebu
 * fronts its Noren layer with an actual OAuth authorize/token exchange
 * (zebuAuth.mjs) instead of Flattrade's bare request_code.
 *
 * Auth model: hybrid handshake, not a pure paste-token. The user completes a
 * one-time OAuth login on Zebu's own hosted pages (see zebuAuth.mjs for the
 * exact URLs) and pastes userId + clientId + apiSecret + the resulting
 * one-time authCode into Broker Settings; this module exchanges that code for
 * an access_token and caches the session per Zebu's own documented
 * `expires_in` — never re-exchanging the same authCode (it's single-use).
 *
 * No native option-chain endpoint returns live prices, and GetQuotes takes
 * exactly one contract per call (no bulk endpoint) — same shape as Flattrade.
 * So the chain is built from the daily instrument master
 * (zebuInstruments.mjs) windowed to strikes near spot + batched,
 * rate-limited GetQuotes calls, with IV/Greeks filled in via Black-Scholes
 * since GetQuotes carries neither.
 */

import { postJData } from "./zebuAuth.mjs";
import { getOptionRows, distinctExpiriesAscending, resolveIndexToken } from "./zebuInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "zebu";
export const credentialFields = ["userId", "clientId", "apiSecret", "authCode"];

// Zebu's documented rate limit is 10 requests/second/user (confirmed in
// openalgo's broker/zebu/api/data.py: "Zebu API Rate Limit: 10 requests per
// second per user", batching 10 symbols/sec). GetQuotes has no bulk endpoint,
// so 10 contracts every 1.1s stays comfortably under that cap.
const QUOTE_BATCH_SIZE = 10;
const QUOTE_BATCH_DELAY_MS = 1100;

// A full expiry's master-file rows can span hundreds of strikes deep into
// illiquid OTM territory. With no bulk-quote endpoint, fetching all of them
// would blow well past the rate-limit budget. Instead, center on the strike
// nearest spot and take this many strikes on each side (~41 strikes total).
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
  // authCode is single-use — once postJData reports the session as dead (see
  // zebuAuth.mjs's isSessionError), re-authenticating for any remaining
  // contract would just re-exchange the same already-consumed code and fail
  // again. Skip the rest of the chunks instead of hammering the
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
    if (!creds.userId || !creds.clientId || !creds.apiSecret || !creds.authCode) {
      return { status: "error", message: "Missing userId, clientId, apiSecret, or authCode" };
    }
    const json = await postJData(creds, "/Limits", {});
    if (json?.stat !== "Ok") {
      return { status: "error", message: json?.emsg || "Zebu did not return a success status" };
    }
    return { status: "success", message: `Zebu connected (account ${creds.userId})` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const { exch, token } = await resolveIndexToken(symbol);
  const json = await postJData(creds, "/GetQuotes", { exch, token });
  if (json?.stat !== "Ok") {
    throw new Error(`Zebu GetQuotes failed for ${symbol}: ${json?.emsg || "unknown error"}`);
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
