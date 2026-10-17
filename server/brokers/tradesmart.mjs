/**
 * TradeSmart (Noren v2) — real broker integration (see registry.mjs for the
 * shared contract).
 *
 * TradeSmart runs the same Noren OMS family as Flattrade/Shoonya (order
 * vocabulary, product codes, jData request shape) but on its own v2 REST host
 * with an OAuth-code auth transport, not the classic jKey-in-body one — see
 * tradesmartAuth.mjs for the full handshake. Auth model: hybrid handshake,
 * not a pure paste-token. The user completes TradeSmart's own hosted login
 * page externally (OAuthlogin/authorize/oauth?client_id=<apiKey>), which
 * redirects back with a one-time `code`; the user pastes clientId + apiKey +
 * apiSecret + that code (as requestCode) into Broker Settings, and this
 * module exchanges it for an access_token itself, caching the session until
 * TradeSmart's documented `expires_in` (or a same-family daily reset
 * fallback) — never re-exchanging the same code twice, since it's single-use.
 *
 * No native option-chain endpoint, and no bulk-quote endpoint either
 * (`/GetQuotes` takes exactly one exch+token per call) — confirmed against
 * openalgo's production adapter, which works around this with a persistent
 * WebSocket depth feed. This module stays REST-only (no new dependency) like
 * the app's other single-quote-endpoint Noren brokers: the chain is built
 * from the daily instrument master (tradesmartInstruments.mjs), windowed to
 * strikes near spot, + batched/rate-limited GetQuotes calls, with IV/Greeks
 * filled in via Black-Scholes since GetQuotes carries neither.
 */

import { postJData } from "./tradesmartAuth.mjs";
import { getOptionRows, distinctExpiriesAscending, resolveIndexSpot } from "./tradesmartInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import * as omsNoren from "./oms-noren.mjs";

export const id = "tradesmart";
export const credentialFields = ["clientId", "apiKey", "apiSecret", "requestCode"];

// TradeSmart's documented budget (per openalgo's production rate limiter, run
// with margin under the broker's real ceiling): general calls 10 req/sec +
// 120 req/min per user; GetQuotes is metered separately, far more generously
// (~90-100 req/sec, no per-minute cap) since it carries no order-placement
// risk. There is no bulk-quote endpoint though, so an N-strike chain still
// costs 2N individual GetQuotes round trips. 20 concurrent calls every 300ms
// averages ~66 req/sec — safely under the quote budget with margin for other
// concurrent users of this proxy.
const QUOTE_BATCH_SIZE = 20;
const QUOTE_BATCH_DELAY_MS = 300;

// A full expiry's master rows can run to hundreds of illiquid OTM strikes.
// With no bulk-quote endpoint, fetching all of them would cost minutes and
// blow the rate budget. Center on the strike nearest spot and take this many
// strikes on each side (~41 strikes / up to 82 legs at the default).
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
  // requestCode is single-use — once postJData reports the session as dead
  // (see tradesmartAuth.mjs's isSessionError), re-authenticating for any
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
    const json = await postJData(creds, "/Limits", {});
    if (json?.stat !== "Ok") {
      return { status: "error", message: json?.emsg || "TradeSmart did not return a success status" };
    }
    return { status: "success", message: `TradeSmart connected (account ${creds.clientId})` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const { exch, token } = await resolveIndexSpot(symbol);
  const json = await postJData(creds, "/GetQuotes", { exch, token });
  if (json?.stat !== "Ok") {
    throw new Error(`TradeSmart GetQuotes failed for ${symbol}: ${json?.emsg || "unknown error"}`);
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

// ── Order placement — shared Noren OMS glue lives in oms-noren.mjs; this
// block is just the field map (uid comes from `clientId`, matches the uid/
// actid this module's own postJData() already injects above) plus the
// capability facts this repo can actually verify.
//
// No static IP required for TradeSmart's order endpoints per the build spec
// (1CLIQ-TRADE-SPEC.md §8) — that requirement is Dhan-specific.

const NOREN_CONFIG = { label: "TradeSmart", postJData, uidField: "clientId" };

export const placeOrder = (creds, order, resolvedLotSize) =>
  omsNoren.placeOrder(NOREN_CONFIG, creds, order, resolvedLotSize);
export const getOrders = (creds) => omsNoren.getOrders(NOREN_CONFIG, creds);
export const getOrderStatus = (creds, orderId) => omsNoren.getOrderStatus(NOREN_CONFIG, creds, orderId);
export const cancelOrder = (creds, orderId) => omsNoren.cancelOrder(NOREN_CONFIG, creds, orderId);

export const capabilities = {
  // Noren's PlaceOrder documents product codes "B" (bracket) and "H" (cover),
  // but SEBI's 2021 circular led most brokers to withdraw BO/CO from retail
  // order APIs. NEEDS VERIFICATION against a live TradeSmart account —
  // nothing in this repo confirms either is still live for TradeSmart
  // specifically.
  bracket: false,
  cover: false,
  // IOC is a standard `ret` validity value on the Noren OMS this broker runs
  // (exchange-level order attribute, not broker-added) — same jData shape
  // already confirmed for GetQuotes/Limits at the top of this file.
  ioc: true,
  // Margin Trade Funding isn't documented anywhere in this repo for
  // TradeSmart, and PRODUCT_CODE_MAP in oms-noren.mjs has no distinct Noren
  // code for it. NEEDS VERIFICATION.
  mtf: false,
  // Whether TradeSmart's own OMS exposes a configurable market-protection
  // band beyond NSE's own default operating range is unconfirmed from any
  // doc cited in this repo. NEEDS VERIFICATION.
  nativeMarketProtection: false,
  // No TradeSmart-specific per-order quantity ceiling is documented in this
  // repo below NSE's own per-symbol freeze-quantity limit. NEEDS
  // VERIFICATION before treating this as anything but "exchange limit only".
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};
