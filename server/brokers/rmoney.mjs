/**
 * RMoney (via XTS Market Data API, Symphony Fintech white-label) — see registry.mjs
 * for the shared broker contract.
 *
 * RMoney's retail trading stack ("xts.rmoneyindia.co.in") is a Symphony Fintech XTS
 * deployment — the same request/response shapes (numeric ExchangeSegment codes,
 * /instruments/master pipe-dumps, /instruments/quotes with xtsMessageCode touchline
 * + a separate OpenInterest code) are shared by many other XTS-based Indian brokers.
 * Confirmed against marketcalls/openalgo's production `broker/rmoney` adapter, the
 * primary/only reference for this integration (no public RMoney API docs mirror).
 *
 * Auth: this module only needs read-only market data, so it authenticates directly
 * against the Market Data API with a paste-once (appKey, secretKey) pair rather than
 * the Interactive/trading API's browser-OAuth login flow — see rmoneyAuth.mjs for
 * the session cache + reactive re-login on "Invalid Token".
 *
 * No native option-chain endpoint: strikes/expiries/tokens come from the daily
 * instrument master (rmoneyInstruments.mjs) and prices from batched
 * /instruments/quotes calls. XTS's quote payload carries no IV/Greeks at all (only
 * OHLC/bid/ask/volume via a Touchline object, plus OI via a separate message code),
 * so every leg is back-solved via Black-Scholes.
 */

import { getSession, marketDataAuthFetch } from "./rmoneyAuth.mjs";
import {
  SEGMENT,
  getOptionRows,
  distinctExpiriesAscending,
  strikeMapForExpiry,
  resolveUnderlyingInstrument,
} from "./rmoneyInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "rmoney";
export const credentialFields = ["apiKey", "apiSecret"];

// The reference adapter documents /instruments/quotes as capped at 50 instruments
// per call ("XTS API limit"). No public per-second rate limit is documented for
// this broker, so 250ms between 50-instrument chunks is a conservative default.
const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 250;

const TOUCHLINE_CODE = 1502; // OHLC/LTP/bid-ask
const OI_CODE = 1510; // open interest (separate call — not present in the touchline payload)

function assertKnownSymbol(symbol) {
  if (!SEGMENT[symbol]) throw new Error(`Unknown symbol for RMoney: ${symbol}`);
}

function instrumentKey(inst) {
  return `${inst.exchangeSegment}_${inst.exchangeInstrumentID}`;
}

/** Batched /instruments/quotes lookup for one xtsMessageCode -> Map<"segment_id", parsed quote>. */
async function fetchQuotesMap(creds, instruments, messageCode) {
  if (instruments.length === 0) return new Map();
  const payloadInstruments = instruments.map((i) => ({
    exchangeSegment: i.exchangeSegment,
    exchangeInstrumentID: i.exchangeInstrumentID,
  }));

  const chunkResults = await batchWithDelay(payloadInstruments, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const json = await marketDataAuthFetch(creds, "/instruments/quotes", {
      method: "POST",
      body: { instruments: chunk, xtsMessageCode: messageCode, publishFormat: "JSON" },
    });
    return json?.result?.listQuotes || [];
  });

  const map = new Map();
  for (const rawList of chunkResults) {
    for (const raw of rawList) {
      let parsed;
      try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
      if (parsed?.ExchangeInstrumentID == null) continue;
      map.set(`${parsed.ExchangeSegment}_${parsed.ExchangeInstrumentID}`, parsed);
    }
  }
  return map;
}

function buildLeg(touchlineQuote, oiQuote, strike, type, spot, daysToExpiry) {
  const t = touchlineQuote?.Touchline || {};
  const ltp = Number(t.LastTradedPrice) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi: Number(oiQuote?.OpenInterest) || 0,
    volume: Number(t.TotalTradedQuantity) || 0,
    bid_price: Number(t.BidInfo?.Price) || 0,
    ask_price: Number(t.AskInfo?.Price) || 0,
    ...greeks,
  };
}

export async function testConnection(creds = {}) {
  try {
    if (!creds.apiKey || !creds.apiSecret) {
      return { status: "error", message: "Missing apiKey or apiSecret" };
    }
    await getSession(creds);
    return { status: "success", message: "RMoney (XTS Market Data API) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  const rows = await getOptionRows(symbol);
  const underlying = await resolveUnderlyingInstrument(symbol, rows);
  if (!underlying) return { status: "success", data: { last_price: 0 } };

  const quotes = await fetchQuotesMap(creds, [underlying], TOUCHLINE_CODE);
  const last_price = Number(quotes.get(instrumentKey(underlying))?.Touchline?.LastTradedPrice) || 0;
  return { status: "success", data: { last_price } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);

  const rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const expiryIso = expiry || distinctExpiriesAscending(rows)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };

  const strikes = strikeMapForExpiry(symbol, rows, expiryIso);
  if (strikes.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const underlying = await resolveUnderlyingInstrument(symbol, rows);

  const instruments = underlying ? [underlying] : [];
  for (const legs of strikes.values()) {
    if (legs.ce) instruments.push(legs.ce);
    if (legs.pe) instruments.push(legs.pe);
  }

  // Sequential (not concurrent) — matches the reference adapter's own request order
  // and keeps this well clear of any per-second cap on top of the 50/call batching.
  const touchlineMap = await fetchQuotesMap(creds, instruments, TOUCHLINE_CODE);
  const oiMap = await fetchQuotesMap(creds, instruments, OI_CODE);

  const spot = underlying ? Number(touchlineMap.get(instrumentKey(underlying))?.Touchline?.LastTradedPrice) || 0 : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const [strikeKey, legs] of strikes.entries()) {
    const entry = {};
    if (legs.ce) {
      const k = instrumentKey(legs.ce);
      entry.ce = buildLeg(touchlineMap.get(k), oiMap.get(k), Number(strikeKey), "CE", spot, daysToExpiry);
    }
    if (legs.pe) {
      const k = instrumentKey(legs.pe);
      entry.pe = buildLeg(touchlineMap.get(k), oiMap.get(k), Number(strikeKey), "PE", spot, daysToExpiry);
    }
    if (entry.ce || entry.pe) oc[strikeKey] = entry;
  }

  return { status: "success", data: { oc, last_price: spot } };
}
