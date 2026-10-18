/**
 * Upstox on the canonical adapter contract (server/brokers/contract.mjs).
 *
 * Official docs (checked October 2026): https://upstox.com/developer/api-documentation/ — authentication,
 * get-profile, get-option-contracts, get-pc-option-chain, ltp-v3, get-full-market-quote,
 * v3/get-historical-candle-data, instruments, get-positions, get-holdings, get-user-fund-margin,
 * get-order-book, get-trade-history, v3/place-order, v3/modify-order, v3/cancel-order,
 * v3/get-market-data-feed, error-codes, rate-limiting.
 *
 * Auth: oauthRedirect (OAuth 2.0 authorization code). The user is sent to
 * https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=<apiKey>&redirect_uri=...,
 * Upstox redirects back with a single-use `code`, and POST /v2/login/authorization/token (form: code,
 * client_id, client_secret, redirect_uri, grant_type=authorization_code) returns the access_token.
 * Today the user pastes the access token; exchangeAuthCode() is the server half for a future callback
 * route. Tokens expire at 3:30 AM IST the next day; 401 / UDAPI100050 surface as UPSTREAM_AUTH.
 *
 * Option chain: native GET /v2/option/chain (instrument_key + expiry_date) with LTP, OI, previous OI,
 * bid/ask and broker Greeks per strike. option_greeks.iv is already a percentage (the official sample
 * shows 262.31 and 50.78), so it is passed through unchanged; the old "< 2 means fraction" rescaling
 * was wrong and is gone. Black-Scholes is only a fallback when Upstox sends no IV for a leg.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { BrokerError, BrokerInputError, normaliseError as baseNormalise } from "./contract.mjs";
import { UPSTOX_API, upstoxFetch } from "./upstoxClient.mjs";
import { INDEX_KEYS } from "./upstoxInstruments.mjs";
import { orderFeatures } from "./upstoxOrders.mjs";

export const id = "upstox";
export const credentialFields = ["apiKey", "apiSecret", "accessToken"];

export const capabilities = {
  auth: {
    kind: "oauthRedirect",
    loginUrl: `${UPSTOX_API}/v2/login/authorization/dialog?response_type=code&client_id={apiKey}&redirect_uri={redirectUri}`,
    tokenExpiry: "03:30 IST next day",
  },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
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

function indexKey(symbol) {
  const key = INDEX_KEYS[symbol];
  if (!key) throw new Error(`Unknown symbol for Upstox: ${symbol}. Supported: ${Object.keys(INDEX_KEYS).join(", ")}`);
  return key;
}

/** One cheap authenticated call: GET /v2/user/profile. */
export async function testConnection(creds = {}) {
  try {
    if (!creds.accessToken) return { status: "error", message: "Missing access token." };
    const body = await upstoxFetch("/v2/user/profile", creds);
    if (body.data?.is_active === false) return { status: "error", message: "Upstox account is not active." };
    const fno = Array.isArray(body.data?.exchanges) && body.data.exchanges.includes("NFO");
    return { status: "success", message: `Upstox API connected${fno ? "" : " — note: NFO is not enabled on this account"}.` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const body = await upstoxFetch("/v2/option/contract", creds, { query: { instrument_key: indexKey(symbol) } });
  const expiries = [...new Set((body.data ?? []).map((c) => String(c.expiry ?? "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  return { status: "success", data: expiries.sort() };
}

function buildLeg(side, ctx) {
  const md = side?.market_data ?? {};
  const g = side?.option_greeks ?? {};
  const ltp = Number(md.ltp) || 0;
  const oi = Number(md.oi) || 0;
  const iv = Number(g.iv);
  const greeks = iv > 0
    ? { iv, delta: Number(g.delta) || 0, gamma: Number(g.gamma) || 0, theta: Number(g.theta) || 0, vega: Number(g.vega) || 0 }
    : computeIVAndGreeks({ ltp, spot: ctx.spot, strike: ctx.strike, daysToExpiry: ctx.daysToExpiry, type: ctx.type });
  const leg = {
    last_price: ltp,
    oi,
    volume: Number(md.volume) || 0,
    ...greeks,
    bid_price: Number(md.bid_price) || 0,
    ask_price: Number(md.ask_price) || 0,
    security_id: side?.instrument_key,
  };
  if (Number.isFinite(Number(md.prev_oi)) && md.prev_oi !== null) leg.oi_chg = oi - Number(md.prev_oi);
  return leg;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const key = indexKey(symbol);
  let resolved = expiry;
  if (!resolved) {
    resolved = (await fetchExpiryList(creds, symbol)).data[0];
    if (!resolved) return { status: "success", data: { oc: {}, last_price: 0 } };
  }
  const body = await upstoxFetch("/v2/option/chain", creds, { query: { instrument_key: key, expiry_date: resolved } });
  const rows = Array.isArray(body.data) ? body.data : [];
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = Number(rows[0].underlying_spot_price) || 0;
  const daysToExpiry = daysBetween(new Date(), resolved);
  const oc = {};
  for (const row of rows) {
    const strike = Number(row.strike_price);
    if (!(strike > 0)) continue;
    const entry = {};
    if (row.call_options) entry.ce = buildLeg(row.call_options, { spot, strike, daysToExpiry, type: "CE" });
    if (row.put_options) entry.pe = buildLeg(row.put_options, { spot, strike, daysToExpiry, type: "PE" });
    oc[String(strike)] = entry;
  }
  return { status: "success", data: { oc, last_price: spot } };
}

/** LTP V3: data keyed "SEGMENT:SYMBOL", each row echoing instrument_token (= the key we sent). */
export async function fetchLTP(creds, symbol) {
  const key = indexKey(symbol);
  const body = await upstoxFetch("/v3/market-quote/ltp", creds, { query: { instrument_key: key } });
  const rows = Object.values(body.data ?? {});
  const match = rows.find((r) => r?.instrument_token === key) ?? (rows.length === 1 ? rows[0] : null);
  const lastPrice = Number(match?.last_price);
  if (!(lastPrice > 0)) throw new BrokerError(`Upstox returned no LTP for ${key}`);
  return { status: "success", data: { last_price: lastPrice } };
}

/**
 * Server half of the OAuth login: swap the single-use authorization code for an access token.
 * Returns only { accessToken }. Not wired to a route yet.
 */
export async function exchangeAuthCode(creds, { code, redirectUri } = {}) {
  if (!creds?.apiKey || !creds?.apiSecret) throw new BrokerInputError("Upstox: API key and API secret are required.");
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(String(code ?? ""))) throw new BrokerInputError("Upstox: the authorization code looks malformed.");
  if (!/^https?:\/\//.test(String(redirectUri ?? ""))) throw new BrokerInputError("Upstox: the redirect URI must match the one registered for the app.");
  const body = await upstoxFetch("/v2/login/authorization/token", creds, {
    method: "POST", auth: false,
    form: { code, client_id: creds.apiKey, client_secret: creds.apiSecret, redirect_uri: redirectUri, grant_type: "authorization_code" },
  });
  if (!body?.access_token) throw new BrokerError("Upstox did not return an access token.");
  return { accessToken: String(body.access_token) };
}

/** Upstox errors already carry contract codes (UpstoxApiError); this adds redaction and a fallback. */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError) return base;
  if (/UDAPI100050|\[401/.test(base.message)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/UDAPI10005\b|\[429/.test(base.message)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  return base;
}

export { resolveInstrumentKey, fetchInstruments } from "./upstoxInstruments.mjs";
export { fetchQuotes, fetchDepth, fetchHistorical, fetchPositions, fetchHoldings, fetchFunds } from "./upstoxData.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, fetchTradeBook } from "./upstoxOrders.mjs";
export { createFeed } from "./upstoxFeed.mjs";
