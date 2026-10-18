/**
 * Groww Trading API on the broker contract (server/brokers/contract.mjs).
 *
 * Official docs: https://groww.in/trade-api/docs/curl (introduction, auth, errors, rate limits) and its
 * pages /instruments, /orders, /portfolio, /margin, /live-data, /backtesting, /user, /annexures
 * (checked 2026-10).
 *
 * Auth (apiKeyToken): either the daily Access Token pasted by the user, or the API key + secret pair that
 * growwAuth.mjs swaps for a token server-side (SHA-256 checksum, daily approval in Groww). Tokens expire at
 * 6:00 AM IST.
 * Market data (growwMarket.mjs): the native option-chain endpoint (broker Greeks, IV in percent, OI,
 * volume) in one call; LTP from /live-data/ltp; quotes and depth from /live-data/quote; candles from
 * /historical/candles. Instruments and expiries come from the public instrument CSV (growwInstruments.mjs).
 * Portfolio and books: growwPortfolio.mjs. Orders (gated): growwOrders.mjs.
 *
 * Fixed here (vs the earlier adapter): one /quote call per leg (hundreds per chain, near the 300/min cap)
 * replaced by the native chain; IV/Greeks now come from Groww instead of a local back-solve; BANKEX and
 * stock options are supported; the session cache key is a SHA-256 tag, not the raw key and secret;
 * a pasted Access Token (Groww's first documented auth path) is accepted.
 *
 * Chains use the option-chain endpoint rather than per-symbol quotes, and daily bars avoid the deprecated
 * /historical/candle/range; we follow the current official docs (option-chain endpoint,
 * /historical/candles).
 *
 * Not declared: feed. Groww's live feed is NATS with nkey auth and protobuf payloads, which needs its own
 * client and a live account to verify.
 */

import { growwRequest } from "./growwAuth.mjs";
import { getMaster, toInstrument } from "./growwInstruments.mjs";
import { ORDER_FEATURES } from "./growwOrders.mjs";

export const id = "groww";
export const credentialFields = ["accessToken", "apiKey", "apiSecret"];

export const capabilities = {
  auth: { kind: "apiKeyToken" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
  ...ORDER_FEATURES,
};

export { normaliseError } from "./growwAuth.mjs";
export { fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical } from "./growwMarket.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./growwPortfolio.mjs";
export { placeOrder, modifyOrder, cancelOrder, buildOrderBody, buildModifyBody } from "./growwOrders.mjs";

/** One cheap authenticated call (GET /v1/user/detail). Never throws. */
export async function testConnection(creds = {}) {
  try {
    const p = await growwRequest(creds, "/v1/user/detail");
    const segs = Array.isArray(p?.active_segments) ? p.active_segments.join(", ") : "";
    return { status: "success", message: segs ? `Groww connected (segments: ${segs})` : "Groww connected" };
  } catch (e) {
    return { status: "error", message: e?.message || "Groww connection failed" };
  }
}

/** Indices, NSE/BSE equities and NSE/BSE F&O from the public instrument CSV. */
export async function fetchInstruments() {
  const master = await getMaster();
  return { status: "success", data: master.map(toInstrument) };
}
