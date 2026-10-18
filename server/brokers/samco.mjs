/**
 * Samco Securities — Trade API v3.2 adapter (contract v1, server/brokers/contract.mjs).
 *
 * Official docs: https://docs-tradeapi.samco.in/ (checked 2026-10; v3.2.0 released 08 June 2026).
 * Auth (samcoAuth.mjs): the user saves the OAuth app's API key + API secret; the server swaps them for a session
 * token (POST /session/token) that is valid until the next 08:00 IST. No password, PIN or TOTP is involved.
 *
 * Market data (samcoMarket.mjs): native option chain with broker greeks/IV, index and equity quotes, multi-quote,
 * five-level depth, 1-minute and daily history. Instruments come from the public scrip master
 * (samcoInstruments.mjs), which also serves the expiry list.
 * Portfolio (samcoPortfolio.mjs) and gated orders (samcoOrders.mjs).
 * Not declared: feed. The Broadcast API (wss://stream.samco.in) authenticates with an x-session-token request
 * header, which Node's built-in WebSocket cannot send; the REST endpoints cover the app's needs.
 *
 * Differences from OpenAlgo's Samco plugin (official docs followed): MARKET / SL-M orders are not sent (the docs
 * document only L and SL for placeOrder); cancel uses `orderNumber` (Postman: `OrderNUmber`); the session expires at
 * the NEXT 08:00 IST, which is the same day for a login before 08:00.
 */

import { BrokerError, normaliseError as baseNormalise } from "./contract.mjs";
import { indexSpot } from "./samcoMarket.mjs";
import { ORDER_FEATURES } from "./samcoOrders.mjs";

export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical, fetchInstruments } from "./samcoMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./samcoPortfolio.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder } from "./samcoOrders.mjs";

export const id = "samco";
export const credentialFields = ["apiKey", "apiSecret"];

export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "apiKeyToken" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "1d"] },
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
};

/** One cheap authenticated call: session login + the NIFTY 50 index quote. Never throws. */
export async function testConnection(creds = {}) {
  try {
    const spot = await indexSpot(creds, "NIFTY 50");
    if (!(spot > 0)) return { status: "error", message: "Samco session opened but returned no NIFTY 50 quote." };
    return { status: "success", message: "Samco connected" };
  } catch (e) {
    return { status: "error", message: normaliseError(e, { secrets: [creds.apiKey, creds.apiSecret] }).message };
  }
}

/**
 * Samco errors arrive as "Samco error [<http>] <errorCode?>: <statusMessage>". EOAUTH001/008, HTTP 401 and session
 * messages = auth; EOAUTH009 or "registered static IP" = IP not whitelisted; HTTP 429 = rate limit. All stay 502
 * (the upstream refused); our own refusals keep 422.
 */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && err.statusCode === 422) return base;
  const m = base.message;
  if (/EOAUTH009|registered static IP/i.test(m)) return { ...base, code: "UPSTREAM_IP_NOT_ALLOWED" };
  if (/EOAUTH00[18]|\[401\]|session (token )?(expired|invalid)|invalid session|not subscribed/i.test(m)) return { ...base, code: "UPSTREAM_AUTH" };
  if (/\[429\]|too many requests|rate limit/i.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  return base;
}
