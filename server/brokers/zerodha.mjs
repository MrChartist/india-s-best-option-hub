/**
 * Zerodha (Kite Connect) — real broker integration (see registry.mjs for the shared contract).
 *
 * Auth model: paste-token, same UX as Dhan. The user completes Kite's browser
 * OAuth (password + TOTP) externally once per trading day and pastes the
 * resulting accessToken into Broker Settings. This module never performs a
 * login itself — every call just builds `Authorization: token <apiKey>:<accessToken>`
 * + `X-Kite-Version: 3` directly from creds. accessToken expires ~6:00 AM IST
 * the next calendar day; a 403 is treated as "token expired" and surfaced as such.
 *
 * Kite has no native option-chain endpoint, so the chain is built from the daily
 * instrument master (zerodhaInstruments.mjs) + batched /quote calls, with IV and
 * Greeks filled in via Black-Scholes since Kite's quotes carry neither.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import {
  KITE_BASE,
  UNDERLYING_EXCHANGE,
  SPOT_TICKER,
  authHeaders,
  getOptionRows,
  distinctExpiriesAscending,
} from "./zerodhaInstruments.mjs";

export const id = "zerodha";
export const credentialFields = ["apiKey", "apiSecret", "accessToken"];

// Kite's documented /quote rate limit: 1 request/second, max 500 instruments per call.
const QUOTE_BATCH_SIZE = 500;
const QUOTE_BATCH_DELAY_MS = 1000;

async function kiteGet(path, creds, params) {
  const url = new URL(`${KITE_BASE}${path}`);
  if (params) {
    for (const [key, value] of params) url.searchParams.append(key, value);
  }
  const res = await fetch(url, { headers: authHeaders(creds) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      throw new Error("Zerodha access token expired or invalid — generate a fresh token and paste it in Broker Settings.");
    }
    throw new Error(`Zerodha API error [${res.status}]: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function testConnection(creds = {}) {
  try {
    if (!creds.apiKey || !creds.accessToken) {
      return { status: "error", message: "Missing apiKey or accessToken" };
    }
    const json = await kiteGet("/quote/ltp", creds, [["i", SPOT_TICKER.NIFTY]]);
    if (json?.status !== "success") {
      return { status: "error", message: json?.message || "Zerodha did not return a success status" };
    }
    return { status: "success", message: "Zerodha (Kite Connect) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(creds, symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const ticker = SPOT_TICKER[symbol];
  if (!ticker) throw new Error(`Unknown index: ${symbol}`);
  const json = await kiteGet("/quote/ltp", creds, [["i", ticker]]);
  const lastPrice = json?.data?.[ticker]?.last_price;
  if (typeof lastPrice !== "number") {
    throw new Error(`Zerodha returned no LTP for ${ticker}`);
  }
  return { status: "success", data: { last_price: lastPrice } };
}

async function fetchSpot(creds, symbol) {
  const { data } = await fetchLTP(creds, symbol);
  return data.last_price;
}

/** Fetches quotes for `tradingsymbols` (already "EXCHANGE:TRADINGSYMBOL"), batched + rate-limited. */
async function fetchQuotes(creds, tradingsymbols) {
  const batches = await batchWithDelay(tradingsymbols, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const json = await kiteGet("/quote", creds, chunk.map((sym) => ["i", sym]));
    return json?.data || {};
  });
  return Object.assign({}, ...batches);
}

function buildLeg({ quote, spot, strike, daysToExpiry, type }) {
  const ltp = quote.last_price || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi: quote.oi || 0,
    volume: quote.volume || 0,
    ...greeks,
    bid_price: quote.depth?.buy?.[0]?.price || 0,
    ask_price: quote.depth?.sell?.[0]?.price || 0,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  let rows = await getOptionRows(creds, symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const exchange = UNDERLYING_EXCHANGE[symbol];
  const spot = await fetchSpot(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const tradingsymbols = rows.map((r) => `${exchange}:${r.tradingsymbol}`);
  const quotes = await fetchQuotes(creds, tradingsymbols);

  const oc = {};
  for (const row of rows) {
    const quote = quotes[`${exchange}:${row.tradingsymbol}`];
    if (!quote) continue;
    const strike = Number(row.strike);
    const type = row.instrument_type === "CE" ? "CE" : "PE";
    const strikeKey = String(strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][type.toLowerCase()] = buildLeg({ quote, spot, strike, daysToExpiry, type });
  }

  return { status: "success", data: { oc, last_price: spot } };
}
