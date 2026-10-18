/**
 * Zerodha (Kite Connect v3) on the canonical adapter contract (server/brokers/contract.mjs).
 *
 * Official docs (checked October 2026): https://kite.trade/docs/connect/v3/ — user/ (login flow,
 * /session/token, /user/profile, /user/margins), market-quotes/, historical/, portfolio/, orders/,
 * websocket/, exceptions/. OpenAlgo was read for facts only; no code was taken from it.
 *
 * Auth: oauthRedirect. The user logs in on kite.zerodha.com/connect/login?v=3&api_key=..., Kite
 * redirects back with a short-lived request_token, and POST /session/token (api_key, request_token,
 * checksum = SHA-256(api_key + request_token + api_secret)) returns the access_token. Today the user
 * pastes the access_token in Broker Settings; exchangeRequestToken() below is the server-side half of
 * the redirect flow for when a callback route is added. The access token expires at 6 AM IST the next
 * day (regulatory). Kite answers 403 TokenException once it is dead; that surfaces as UPSTREAM_AUTH.
 *
 * Option chain: Kite has no chain endpoint. Strikes come from the daily instrument dump
 * (zerodhaInstruments.mjs) and prices from batched GET /quote (500 instruments per call, 1 call per
 * second); the index spot rides in the same /quote call. Kite quotes carry no IV, Greeks or previous
 * OI, so IV/Greeks are computed (Black-Scholes, blackScholes.mjs) and oi_chg is omitted.
 */

import { createHash } from "node:crypto";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { BrokerError, BrokerInputError, normaliseError as baseNormalise } from "./contract.mjs";
import { KITE_LOGIN_URL, kiteFetch } from "./zerodhaClient.mjs";
import { distinctExpiriesAscending, getOptionRows, optionUnderlying } from "./zerodhaInstruments.mjs";
import { quoteByKeys } from "./zerodhaData.mjs";
import { orderFeatures } from "./zerodhaOrders.mjs";

export const id = "zerodha";
export const credentialFields = ["apiKey", "apiSecret", "accessToken"];

export const capabilities = {
  auth: { kind: "oauthRedirect", loginUrl: `${KITE_LOGIN_URL}?v=3&api_key={apiKey}`, tokenExpiry: "06:00 IST next day" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
  feed: true,
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
  ...orderFeatures,
};

/** One cheap authenticated call: GET /user/profile. */
export async function testConnection(creds = {}) {
  try {
    if (!creds.apiKey || !creds.accessToken) return { status: "error", message: "Missing API key or access token." };
    const profile = await kiteFetch("/user/profile", creds);
    const fno = Array.isArray(profile?.exchanges) && profile.exchanges.includes("NFO");
    return { status: "success", message: `Zerodha (Kite Connect) connected${fno ? "" : " — note: NFO is not enabled on this account"}.` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  return { status: "success", data: distinctExpiriesAscending(await getOptionRows(creds, symbol)) };
}

export async function fetchLTP(creds, symbol) {
  const ticker = optionUnderlying(symbol)?.spotKey;
  if (!ticker) throw new Error(`Unknown symbol for Zerodha: ${symbol}`);
  const data = await kiteFetch("/quote/ltp", creds, { query: [["i", ticker]] });
  const lastPrice = Number(data?.[ticker]?.last_price);
  if (!(lastPrice > 0)) throw new BrokerError(`Zerodha returned no LTP for ${ticker}`);
  return { status: "success", data: { last_price: lastPrice } };
}

function buildLeg(quote, { spot, strike, daysToExpiry, type }) {
  const ltp = Number(quote.last_price) || 0;
  return {
    last_price: ltp,
    oi: Number(quote.oi) || 0,
    volume: Number(quote.volume) || 0,
    ...computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type }),
    bid_price: Number(quote.depth?.buy?.[0]?.price) || 0,
    ask_price: Number(quote.depth?.sell?.[0]?.price) || 0,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const all = await getOptionRows(creds, symbol);
  const targetExpiry = expiry || distinctExpiriesAscending(all)[0];
  const rows = all.filter((r) => r.expiry === targetExpiry);
  if (!targetExpiry || rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const { exchange, spotKey } = optionUnderlying(symbol);
  const quotes = await quoteByKeys(creds, [spotKey, ...rows.map((r) => `${exchange}:${r.tradingsymbol}`)]);
  const spot = Number(quotes[spotKey]?.last_price) || 0;
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const oc = {};
  for (const row of rows) {
    const quote = quotes[`${exchange}:${row.tradingsymbol}`];
    if (!quote) continue;
    const strike = Number(row.strike);
    const type = row.instrument_type === "CE" ? "CE" : "PE";
    (oc[String(strike)] ||= {})[type.toLowerCase()] = buildLeg(quote, { spot, strike, daysToExpiry, type });
  }
  return { status: "success", data: { oc, last_price: spot } };
}

/**
 * Server-side half of the Kite redirect login: swap the one-time request_token for an access token.
 * Returns only { accessToken, userId }; the api_secret never leaves this process and is not logged.
 * Not wired to a route yet (the user pastes the access token today).
 */
export async function exchangeRequestToken(creds, requestToken) {
  if (!creds?.apiKey || !creds?.apiSecret) throw new BrokerInputError("Zerodha: API key and API secret are required.");
  if (!/^[A-Za-z0-9]{6,64}$/.test(String(requestToken ?? ""))) throw new BrokerInputError("Zerodha: the request token looks malformed.");
  const checksum = createHash("sha256").update(`${creds.apiKey}${requestToken}${creds.apiSecret}`).digest("hex");
  const data = await kiteFetch("/session/token", creds, { method: "POST", auth: false, form: { api_key: creds.apiKey, request_token: requestToken, checksum } });
  if (!data?.access_token) throw new BrokerError("Zerodha did not return an access token.");
  return { accessToken: String(data.access_token), userId: data.user_id ? String(data.user_id) : null };
}

/** Kite errors already carry contract codes (KiteApiError); this adds secret redaction and the fallback. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError) return base;
  if (/TokenException|\[403/.test(base.message)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/\[429/.test(base.message)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  return base;
}

export { fetchInstruments } from "./zerodhaInstruments.mjs";
export { fetchQuotes, fetchDepth, fetchHistorical, fetchPositions, fetchHoldings, fetchFunds } from "./zerodhaData.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, getOrders, getOrderStatus, fetchOrderBook, fetchTradeBook } from "./zerodhaOrders.mjs";
export { createFeed } from "./zerodhaFeed.mjs";
