/**
 * Groww Trading API — real broker integration (see registry.mjs for the shared contract).
 *
 * Auth model: active checksum handshake (NOT paste-a-token). The user pastes
 * their apiKey + apiSecret from Groww's developer console; this module exchanges
 * them for a bearer access token server-side (growwAuth.mjs) and caches the
 * session until Groww's documented 6:00 AM IST expiry.
 *
 * Groww has no native option-chain endpoint. Strikes/expiries/trading_symbols
 * are resolved from the daily public instrument-master CSV (growwInstruments.mjs),
 * and each leg's OI/volume/bid/ask come from Groww's `/v1/live-data/quote`
 * endpoint — which is documented as single-instrument only (no batch quote call),
 * so a full chain requires one request per strike per side. Requests are
 * throttled to stay under Groww's documented "Live Data" cap (10 req/s, 300/min).
 * IV and Greeks are not returned by the quote endpoint, so they're computed via
 * this app's Black-Scholes solver from each leg's last traded price (same
 * approach as Zerodha/5paisa/Alice Blue).
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { getSession, authGet } from "./growwAuth.mjs";
import {
  UNDERLYING_EXCHANGE,
  getOptionRows,
  distinctExpiriesAscending,
  getIndexSpotRow,
} from "./growwInstruments.mjs";

export const id = "groww";
export const credentialFields = ["apiKey", "apiSecret"];

const QUOTE_PATH = "/v1/live-data/quote";

// Groww's `/v1/live-data/quote` is single-instrument only (no batch call), and
// its documented "Live Data" cap is 10 req/s / 300 req/min. 5 concurrent calls
// per ~1.1s chunk averages ~4.5 req/s / ~270 req/min — comfortably under both.
const QUOTE_BATCH_SIZE = 5;
const QUOTE_BATCH_DELAY_MS = 1100;

export async function testConnection(creds = {}) {
  try {
    const session = await getSession(creds);
    if (!session?.token) throw new Error("No access token returned");
    return { status: "success", message: "Groww API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

async function fetchQuotePayload(creds, exchange, segment, tradingSymbol) {
  const json = await authGet(creds, QUOTE_PATH, {
    exchange,
    segment,
    trading_symbol: tradingSymbol,
  });
  return json?.payload || null;
}

export async function fetchLTP(creds, symbol) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown index: ${symbol}`);

  const spotRow = await getIndexSpotRow(symbol).catch(() => null);
  const tradingSymbol = spotRow?.trading_symbol || symbol;

  const payload = await fetchQuotePayload(creds, exchange, "CASH", tradingSymbol);
  const lastPrice = Number(payload?.last_price) || 0;
  return { status: "success", data: { last_price: lastPrice } };
}

function buildLeg({ payload, spot, strike, daysToExpiry, type }) {
  const ltp = Number(payload?.last_price) || 0;
  const oi = Number(payload?.open_interest ?? payload?.oi) || 0;
  const volume = Number(payload?.volume ?? payload?.total_volume) || 0;
  const bid = Number(payload?.bid_price ?? payload?.depth?.buy?.[0]?.price) || 0;
  const ask = Number(payload?.offer_price ?? payload?.depth?.sell?.[0]?.price) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi,
    volume,
    ...greeks,
    bid_price: bid,
    ask_price: ask,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const exchange = UNDERLYING_EXCHANGE[symbol];
  if (!exchange) throw new Error(`Unknown symbol: ${symbol}`);

  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry_date === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const { data: { last_price: spot } } = await fetchLTP(creds, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const quoteBatches = await batchWithDelay(rows, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, (chunk) =>
    Promise.all(chunk.map(async (row) => {
      try {
        const payload = await fetchQuotePayload(creds, exchange, "FNO", row.trading_symbol);
        return { row, payload };
      } catch (e) {
        console.log(`[groww] quote fetch failed for a strike: ${e.message}`);
        return { row, payload: null };
      }
    }))
  );

  const oc = {};
  for (const batch of quoteBatches) {
    for (const { row, payload } of batch) {
      if (!payload) continue;
      const strike = Number(row.strike_price);
      const type = row.instrument_type === "CE" ? "CE" : "PE";
      const strikeKey = String(strike);
      if (!oc[strikeKey]) oc[strikeKey] = {};
      oc[strikeKey][type.toLowerCase()] = buildLeg({ payload, spot, strike, daysToExpiry, type });
    }
  }

  return { status: "success", data: { oc, last_price: spot } };
}
