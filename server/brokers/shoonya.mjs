/**
 * Shoonya (Finvasia) — real broker integration (see registry.mjs for the
 * shared contract).
 *
 * Shoonya runs the same Noren OMS backend as Flattrade/Tradesmart/Zebu —
 * identical jData request shape, {stat,emsg} error envelope, and GetQuotes/
 * Limits field names, confirmed against openalgo's adapters for all four.
 * Worth knowing for whoever builds Tradesmart or Zebu next: this module's
 * shapes (and shoonyaAuth.mjs/shoonyaInstruments.mjs) are a solid starting
 * template there too — see shoonyaAuth.mjs's header for exactly how close.
 *
 * Auth model: OAuth handshake, not a pure paste-token. The user visits
 * Shoonya's own hosted OAuth login page, logs in with their trading
 * credentials, and is redirected back with a one-time `code` valid only a
 * few minutes. The user pastes userId (trading UID) + apiKey (OAuth app
 * client_id) + apiSecret + that code into Broker Settings; this module
 * performs the GenAcsTok token exchange itself (shoonyaAuth.mjs) and caches
 * the resulting session until the next 5 AM IST reset — never re-exchanging
 * the same code (it's single-use). See shoonyaAuth.mjs for the full flow and
 * session-lifetime caveat.
 *
 * There is no native option-chain endpoint and no bulk-quote endpoint at all
 * (confirmed against openalgo's data.py — GetQuotes takes exactly one
 * exch+token per call, batched client-side with a thread pool over there).
 * So the chain is built from the daily instrument master
 * (shoonyaInstruments.mjs) windowed to strikes near spot + batched,
 * rate-limited GetQuotes calls, with IV/Greeks filled in via Black-Scholes
 * since GetQuotes carries neither.
 */

import { postJData, OAUTH_LOGIN_BASE } from "./shoonyaAuth.mjs";
import { getOptionRows, distinctExpiriesAscending, resolveIndexToken } from "./shoonyaInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import * as omsNoren from "./oms-noren.mjs";

export const id = "shoonya";
export const credentialFields = ["userId", "apiKey", "apiSecret", "requestCode"];

// openalgo's own Shoonya adapter documents "~20 requests/second (conservative
// estimate)" as the operating assumption for GetQuotes (no official published
// rate-limit doc found). 10 concurrent requests every 1s averages 10 req/sec —
// half that budget — leaving headroom for the rest of the app's traffic on
// the same credentials.
const QUOTE_BATCH_SIZE = 10;
const QUOTE_BATCH_DELAY_MS = 1000;

// A full expiry's instrument-master rows can span hundreds of strikes deep
// into illiquid OTM territory. With no bulk-quote endpoint, fetching all of
// them would take minutes and blow past the rate-limit budget above. Instead,
// center on the strike nearest spot and take this many strikes on each side
// (~41 strikes / <=82 legs at the default).
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
  // The OAuth authorization code is single-use — once postJData reports the
  // session as dead (see shoonyaAuth.mjs's isSessionError), re-authenticating
  // for any remaining contract would just re-exchange the same
  // already-consumed code and fail again. Skip the rest of the chunks instead
  // of hammering the token-exchange endpoint with doomed retries for every
  // leg still to fetch.
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
    if (!creds.userId || !creds.apiKey || !creds.apiSecret || !creds.requestCode) {
      return { status: "error", message: "Missing userId, apiKey, apiSecret, or requestCode" };
    }
    const json = await postJData(creds, "/Limits", {});
    if (json?.stat !== "Ok") {
      return { status: "error", message: json?.emsg || "Shoonya did not return a success status" };
    }
    return { status: "success", message: `Shoonya connected (account ${creds.userId})` };
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
    throw new Error(`Shoonya GetQuotes failed for ${symbol}: ${json?.emsg || "unknown error"}`);
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

// Re-exported for a future login-flow UI (e.g. "Get authorization code" link
// in Broker Settings) — not part of the shared broker-module contract itself.
export { OAUTH_LOGIN_BASE };

// ── Order placement — shared Noren OMS glue lives in oms-noren.mjs; this
// block is just the field map (uid comes from `userId`, matches the uid/
// actid this module's own postJData() already injects above) plus the
// capability facts this repo can actually verify.
//
// No static IP required for Shoonya's order endpoints per the build spec
// (1CLIQ-TRADE-SPEC.md §8) — that requirement is Dhan-specific.

const NOREN_CONFIG = { label: "Shoonya", postJData, uidField: "userId" };

export const placeOrder = (creds, order, resolvedLotSize) =>
  omsNoren.placeOrder(NOREN_CONFIG, creds, order, resolvedLotSize);
export const getOrders = (creds) => omsNoren.getOrders(NOREN_CONFIG, creds);
export const getOrderStatus = (creds, orderId) => omsNoren.getOrderStatus(NOREN_CONFIG, creds, orderId);
export const cancelOrder = (creds, orderId) => omsNoren.cancelOrder(NOREN_CONFIG, creds, orderId);

export const capabilities = {
  // Noren's PlaceOrder documents product codes "B" (bracket) and "H" (cover),
  // but SEBI's 2021 circular led most brokers to withdraw BO/CO from retail
  // order APIs. NEEDS VERIFICATION against a live Shoonya account — nothing
  // in this repo confirms either is still live for Shoonya specifically.
  bracket: false,
  cover: false,
  // IOC is a standard `ret` validity value on the Noren OMS this broker runs
  // (exchange-level order attribute, not broker-added) — same jData shape
  // already confirmed for GetQuotes/Limits at the top of this file.
  ioc: true,
  // Margin Trade Funding isn't documented anywhere in this repo for
  // Shoonya, and PRODUCT_CODE_MAP in oms-noren.mjs has no distinct Noren
  // code for it. NEEDS VERIFICATION.
  mtf: false,
  // Whether Shoonya's own OMS exposes a configurable market-protection band
  // beyond NSE's own default operating range is unconfirmed from any doc
  // cited in this repo. NEEDS VERIFICATION.
  nativeMarketProtection: false,
  // No Shoonya-specific per-order quantity ceiling is documented in this
  // repo below NSE's own per-symbol freeze-quantity limit. NEEDS
  // VERIFICATION before treating this as anything but "exchange limit only".
  maxLegQty: null,
  products: ["CNC", "INTRADAY", "MARGIN"],
};
