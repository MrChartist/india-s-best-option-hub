/**
 * Samco Securities (StockNote Trade API v3.2) — real broker integration.
 * See registry.mjs for the shared contract.
 *
 * Auth model: paste an OAuth app's apiKey + apiSecret, issued in the Samco
 * Web Dashboard (https://tradeapi.samco.in/app/login). Unlike Dhan/Zerodha/
 * Upstox/Fyers (where the user pastes a broker-generated token directly),
 * the server exchanges these two values for a session token itself and
 * caches it in memory — see samcoAuth.mjs. No TOTP/password handshake is
 * required (v3.2 dropped the legacy 4-step OTP login).
 *
 * Samco has no native option-chain endpoint, so the chain is built the same
 * way as Zerodha/5paisa: a public daily scrip-master CSV (samcoInstruments.mjs)
 * resolves strikes/expiries/symbolCodes, batched /quote/multiQuote calls fill
 * in price/OI/volume/bid/ask, and IV + Greeks (absent from multiQuote) are
 * back-solved via Black-Scholes.
 */

import { samcoRequest } from "./samcoAuth.mjs";
import { UNDERLYING, getOptionRows, distinctExpiriesAscending } from "./samcoInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "samco";
export const credentialFields = ["apiKey", "apiSecret"];

// Samco's documented /quote/multiQuote limits: 25 instruments per call,
// ~5 requests/second (matches openalgo's production Samco adapter).
const QUOTE_BATCH_SIZE = 25;
const QUOTE_BATCH_DELAY_MS = 250;

function assertKnownSymbol(symbol) {
  if (!UNDERLYING[symbol]) throw new Error(`Unknown symbol for Samco: ${symbol}`);
}

async function fetchIndexSpot(creds, symbol) {
  const { indexName } = UNDERLYING[symbol];
  const json = await samcoRequest(creds, `/quote/indexQuote?indexName=${encodeURIComponent(indexName)}`);
  const spot = json?.indexDetails?.[0]?.spotPrice;
  return Number(spot) || 0;
}

/** Batched /quote/multiQuote lookup -> Map<symbolCode, raw quote item>. All `rows` share one exchange. */
async function fetchQuotesMap(creds, rows) {
  if (rows.length === 0) return new Map();
  const exchange = rows[0].exchange;
  const tradingSymbols = rows.map((r) => r.tradingSymbol);

  const chunkResults = await batchWithDelay(tradingSymbols, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const json = await samcoRequest(creds, "/quote/multiQuote", {
      method: "POST",
      body: { [exchange]: chunk },
    });
    return json?.multiQuotes || [];
  });

  const map = new Map();
  for (const quotes of chunkResults) {
    for (const q of quotes) {
      if (q?.symbol) map.set(String(q.symbol), q);
    }
  }
  return map;
}

/** multiQuote carries no IV/Greeks, so every leg is back-solved via Black-Scholes from the traded LTP. */
function buildLeg(quote, { spot, strike, daysToExpiry, type }) {
  const ltp = Number(quote?.lastTradePrice) || 0;
  const oi = Number(quote?.openInterest) || 0;
  const volume = Number(quote?.totalTradeVolume) || 0;
  const bid_price = Number(quote?.bidPrice) || 0;
  const ask_price = Number(quote?.askPrice) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return { last_price: ltp, oi, volume, bid_price, ask_price, ...greeks };
}

export async function testConnection(creds = {}) {
  try {
    if (!creds.apiKey || !creds.apiSecret) {
      return { status: "error", message: "Missing apiKey or apiSecret" };
    }
    const spot = await fetchIndexSpot(creds, "NIFTY");
    if (!(spot > 0)) {
      return { status: "error", message: "Samco connected but returned no NIFTY spot price" };
    }
    return { status: "success", message: "Samco (StockNote) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  // The scrip master CSV is public (no auth) — no need to log in just to list expiries.
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  const last_price = await fetchIndexSpot(creds, symbol);
  return { status: "success", data: { last_price } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);

  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchIndexSpot(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);
  const quotes = await fetchQuotesMap(creds, rows);

  const oc = {};
  for (const row of rows) {
    const quote = quotes.get(row.symbolCode);
    if (!quote) continue;
    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.side] = buildLeg(quote, {
      spot,
      strike: row.strike,
      daysToExpiry,
      type: row.side === "ce" ? "CE" : "PE",
    });
  }

  return { status: "success", data: { oc, last_price: spot } };
}
