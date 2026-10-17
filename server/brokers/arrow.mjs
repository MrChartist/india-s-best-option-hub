/**
 * Arrow (https://arrow.trade) — real broker integration (see registry.mjs for the
 * shared contract).
 *
 * Auth model: external browser login + one-time checksum handshake (see
 * arrowAuth.mjs) — the user visits Arrow's hosted login page once, pastes the
 * resulting `requestToken` (plus `appId`/`appSecret`) into Broker Settings,
 * and this module exchanges it server-side for a 24h JWT that's cached
 * in-memory and reused across calls.
 *
 * Arrow has no native option-chain endpoint, so the chain is built from the
 * daily instrument master (arrowInstruments.mjs) + batched /info/quotes/full
 * calls, with IV and Greeks filled in via Black-Scholes since Arrow's quotes
 * carry neither.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { getAuthToken } from "./arrowAuth.mjs";
import {
  UNDERLYING_CONFIG,
  INDEX_QUOTE_SYMBOL,
  scalePrice,
  getOptionRows,
  distinctExpiriesAscending,
  fetchQuoteBatch,
  fetchSingleQuote,
  QUOTE_BATCH_SIZE,
  QUOTE_BATCH_DELAY_MS,
} from "./arrowInstruments.mjs";

export const id = "arrow";
export const credentialFields = ["appId", "appSecret", "requestToken"];

export async function testConnection(creds = {}) {
  try {
    if (!creds.appId || !creds.appSecret || !creds.requestToken) {
      return { status: "error", message: "Missing appId, appSecret, or requestToken" };
    }
    await getAuthToken(creds); // performs (or reuses) the checksum handshake
    const q = await fetchSingleQuote(creds, "ltp", "INDEX", INDEX_QUOTE_SYMBOL.NIFTY);
    if (typeof q?.ltp !== "number") {
      return { status: "error", message: "Arrow connected but returned no NIFTY quote" };
    }
    return { status: "success", message: "Arrow connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(creds, symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const quoteSymbol = INDEX_QUOTE_SYMBOL[symbol];
  if (!quoteSymbol) throw new Error(`Unknown index: ${symbol}`);
  const q = await fetchSingleQuote(creds, "ltp", "INDEX", quoteSymbol);
  const lastPrice = scalePrice(q?.ltp);
  if (!(lastPrice > 0)) throw new Error(`Arrow returned no LTP for ${quoteSymbol}`);
  return { status: "success", data: { last_price: lastPrice } };
}

async function fetchSpot(creds, symbol) {
  const { data } = await fetchLTP(creds, symbol);
  return data.last_price;
}

/** Fetches FULL quotes for `items` ({exchange, symbol}), batched + rate-limited, indexed by symbol. */
async function fetchQuotes(creds, items) {
  const batches = await batchWithDelay(items, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, (chunk) =>
    fetchQuoteBatch(creds, chunk)
  );
  const merged = new Map();
  for (const batch of batches) for (const [sym, q] of batch) merged.set(sym, q);
  return merged;
}

function buildLeg({ quote, spot, strike, daysToExpiry, type }) {
  const ltp = scalePrice(quote.ltp);
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  const bids = quote.bids || [];
  const asks = quote.asks || [];
  return {
    last_price: ltp,
    oi: quote.oi || 0,
    volume: quote.volume || 0,
    ...greeks,
    bid_price: scalePrice(bids[0]?.price),
    ask_price: scalePrice(asks[0]?.price),
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const cfg = UNDERLYING_CONFIG[symbol];
  if (!cfg) throw new Error(`Unknown symbol: ${symbol}`);

  let rows = await getOptionRows(creds, symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchSpot(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const items = rows.map((r) => ({ exchange: cfg.quoteExchange, symbol: r.tradingsymbol }));
  const quotes = await fetchQuotes(creds, items);

  const oc = {};
  for (const row of rows) {
    const quote = quotes.get(row.tradingsymbol);
    if (!quote) continue;
    const strike = row.strike;
    const type = row.optionType === "CE" ? "CE" : "PE";
    const strikeKey = String(strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][type.toLowerCase()] = buildLeg({ quote, spot, strike, daysToExpiry, type });
  }

  return { status: "success", data: { oc, last_price: spot } };
}
