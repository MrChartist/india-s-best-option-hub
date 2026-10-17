/**
 * Wisdom Capital (XTS) broker integration. See registry.mjs for the shared contract.
 *
 * Wisdom Capital runs on Symphony Fintech's white-label "XTS" trading backend
 * (see wisdomAuth.mjs for the shared-backend note — this registry's
 * jainamxts.mjs already implements the same vendor stack under a different
 * brand/host, and openalgo's `broker/compositedge` / `broker/iifl` adapters
 * share the same endpoint paths and field names too, based on their source).
 *
 * Auth model: server-side handshake, no TOTP — a direct appKey + secretKey
 * exchange against XTS's market-data login (wisdomAuth.mjs), cached
 * in-memory for the documented 24h session lifetime.
 *
 * No native option-chain endpoint: strikes/expiries/tokens are resolved from
 * XTS's daily instrument-master dump + a separate index-token list
 * (wisdomInstruments.mjs), and price/OI are filled in via batched
 * /instruments/quotes calls (two xtsMessageCodes — 1502 for touchline,
 * 1510 for open interest — matching openalgo's production adapter, which
 * documents a hard cap of 50 instruments per /instruments/quotes call). XTS
 * returns neither IV nor Greeks, so both are back-solved via Black-Scholes.
 */

import { xtsRequest, ensureSession } from "./wisdomAuth.mjs";
import {
  SYMBOL_CONFIG,
  assertKnownSymbol,
  getSegmentMaster,
  listExpiries,
  strikeMapForExpiry,
  getIndexTokenMap,
} from "./wisdomInstruments.mjs";
import { chunkArray, sleep } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "wisdom";
export const credentialFields = ["apiKey", "apiSecret"];

// openalgo's production adapter documents "XTS API limit: only 50 instruments
// allowed per request" with a 0.1s delay between batches — mirrored exactly here.
const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 100;

function quoteKey(exchangeSegment, token) {
  return `${exchangeSegment}_${token}`;
}

function parseListQuotes(result) {
  const rows = [];
  for (const raw of result?.listQuotes || []) {
    try {
      rows.push(typeof raw === "string" ? JSON.parse(raw) : raw);
    } catch {
      // skip an unparseable row rather than failing the whole batch
    }
  }
  return rows;
}

/** Batched touchline (1502) + open-interest (1510) quotes for a list of {token, exchangeSegment}. */
async function fetchQuotesAndOI(creds, instruments) {
  const priceMap = new Map();
  const oiMap = new Map();
  const chunks = chunkArray(instruments, QUOTE_BATCH_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const payloadInstruments = chunks[i].map((it) => ({ exchangeSegment: it.exchangeSegment, exchangeInstrumentID: Number(it.token) }));

    const priceResult = await xtsRequest(creds, "/instruments/quotes", {
      method: "POST",
      body: { instruments: payloadInstruments, xtsMessageCode: 1502, publishFormat: "JSON" },
    });
    for (const row of parseListQuotes(priceResult)) {
      priceMap.set(quoteKey(row.ExchangeSegment, row.ExchangeInstrumentID), row);
    }

    try {
      const oiResult = await xtsRequest(creds, "/instruments/quotes", {
        method: "POST",
        body: { instruments: payloadInstruments, xtsMessageCode: 1510, publishFormat: "JSON" },
      });
      for (const row of parseListQuotes(oiResult)) {
        if (row?.OpenInterest != null) oiMap.set(quoteKey(row.ExchangeSegment, row.ExchangeInstrumentID), Number(row.OpenInterest));
      }
    } catch {
      // OI is best-effort — openalgo's own adapter treats a 1510 failure as non-fatal
    }

    if (i < chunks.length - 1) await sleep(QUOTE_BATCH_DELAY_MS);
  }

  return { priceMap, oiMap };
}

async function resolveIndexInstrument(creds, symbol) {
  const tokenMap = await getIndexTokenMap(creds); // plain object, not a Map — see wisdomInstruments.mjs
  return tokenMap[symbol] || null;
}

function buildLeg(row, oi, strike, type, spot, daysToExpiry) {
  const touchline = row?.Touchline || {};
  const ltp = Number(touchline.LastTradedPrice) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi: oi || 0,
    volume: Number(touchline.TotalTradedQuantity) || 0,
    bid_price: Number(touchline.BidInfo?.Price) || 0,
    ask_price: Number(touchline.AskInfo?.Price) || 0,
    ...greeks,
  };
}

export async function testConnection(creds = {}) {
  try {
    const session = await ensureSession(creds);
    return { status: "success", message: `Wisdom Capital (XTS) market-data session authenticated${session.userID ? ` (user ${session.userID})` : ""}` };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  const { masterSegment } = SYMBOL_CONFIG[symbol];
  const rows = await getSegmentMaster(creds, masterSegment);
  return { status: "success", data: listExpiries(rows, symbol) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);
  const { masterSegment, quoteSegment } = SYMBOL_CONFIG[symbol];

  const rows = await getSegmentMaster(creds, masterSegment);
  const expiryIso = expiry || listExpiries(rows, symbol)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };

  const strikes = strikeMapForExpiry(rows, symbol, expiryIso, quoteSegment);
  if (strikes.size === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const indexInstrument = await resolveIndexInstrument(creds, symbol);

  const instruments = [];
  if (indexInstrument) instruments.push(indexInstrument);
  for (const legs of strikes.values()) {
    if (legs.ce) instruments.push(legs.ce);
    if (legs.pe) instruments.push(legs.pe);
  }

  const { priceMap, oiMap } = await fetchQuotesAndOI(creds, instruments);

  const spot = indexInstrument ? Number(priceMap.get(quoteKey(indexInstrument.exchangeSegment, indexInstrument.token))?.Touchline?.LastTradedPrice) || 0 : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const [strikeStr, legs] of strikes.entries()) {
    const strike = Number(strikeStr);
    const entry = {};
    if (legs.ce) {
      const key = quoteKey(legs.ce.exchangeSegment, legs.ce.token);
      entry.ce = buildLeg(priceMap.get(key), oiMap.get(key), strike, "CE", spot, daysToExpiry);
    }
    if (legs.pe) {
      const key = quoteKey(legs.pe.exchangeSegment, legs.pe.token);
      entry.pe = buildLeg(priceMap.get(key), oiMap.get(key), strike, "PE", spot, daysToExpiry);
    }
    if (entry.ce || entry.pe) oc[strikeStr] = entry;
  }

  return { status: "success", data: { oc, last_price: spot } };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  const indexInstrument = await resolveIndexInstrument(creds, symbol);
  if (!indexInstrument) return { status: "success", data: { last_price: 0 } };

  const { priceMap } = await fetchQuotesAndOI(creds, [indexInstrument]);
  const last_price = Number(priceMap.get(quoteKey(indexInstrument.exchangeSegment, indexInstrument.token))?.Touchline?.LastTradedPrice) || 0;
  return { status: "success", data: { last_price } };
}
