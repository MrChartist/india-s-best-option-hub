/**
 * IndiaBulls Securities — real broker integration (see registry.mjs for the shared contract).
 *
 * IndiaBulls Securities runs on Symphony Fintech's white-label "XTS" trading
 * platform (host xts.ibullssecurities.com) — confirmed against
 * marketcalls/openalgo's broker/ibulls adapter, which shares its internal
 * helper-function names (and most of its logic) with openalgo's CompositEdge
 * adapter, another broker on the same XTS backend at a different host. See
 * ibullsAuth.mjs / ibullsInstruments.mjs for the endpoint-level detail.
 *
 * Auth model: paste the "Market Data API" appKey + secretKey issued by
 * IndiaBulls' XTS developer portal (distinct from the "Interactive API"
 * pair used for order placement, which this read-only integration never
 * needs). The server logs in on first use and caches the resulting feed
 * token in memory until the next IST midnight (ibullsAuth.mjs).
 *
 * Data model: no native option-chain endpoint. Strikes/expiries/tokens come
 * from XTS's daily F&O instrument-master dump (ibullsInstruments.mjs);
 * prices/volume come from batched /instruments/quotes calls (message code
 * 1502); open interest is a *separate* batched call at message code 1510
 * (XTS has no single call that returns both). XTS's quote payload carries
 * no IV/Greeks, so every leg is back-solved via Black-Scholes.
 */

import { ensureSession, fetchQuotesBatched, MSG_CODE_TOUCHLINE, MSG_CODE_OI } from "./ibullsAuth.mjs";
import { getOptionRows, listExpiries, getIndexSpotToken, UNDERLYING_FO } from "./ibullsInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "ibulls";
export const credentialFields = ["marketApiKey", "marketApiSecret"];

function assertKnownSymbol(symbol) {
  if (!UNDERLYING_FO[symbol]) throw new Error(`Unknown symbol for IndiaBulls: ${symbol}`);
}

function quoteKey(segmentNum, token) {
  return `${segmentNum}_${token}`;
}

/** Maps a raw XTS Touchline/OI quote object to its "segment_token" key, trying the keyed fields first and falling back to the request's positional order (documented same-length, same-order response). */
function indexQuotesByKey(rawQuotes, instruments) {
  const map = new Map();
  rawQuotes.forEach((q, i) => {
    const seg = q?.ExchangeSegment;
    const tok = q?.ExchangeInstrumentID;
    if (seg != null && tok != null) {
      map.set(quoteKey(seg, tok), q);
    } else if (instruments[i]) {
      map.set(quoteKey(instruments[i].exchangeSegment, instruments[i].exchangeInstrumentID), q);
    }
  });
  return map;
}

async function fetchTouchlineAndOI(creds, instruments) {
  if (!instruments.length) return { touchline: new Map(), oi: new Map() };
  const [touchlineRaw, oiRaw] = await Promise.all([
    fetchQuotesBatched(creds, instruments, MSG_CODE_TOUCHLINE),
    fetchQuotesBatched(creds, instruments, MSG_CODE_OI).catch((e) => {
      console.log(`[ibulls] OI quote batch failed, proceeding with oi=0: ${e.message}`);
      return [];
    }),
  ]);
  return {
    touchline: indexQuotesByKey(touchlineRaw, instruments),
    oi: indexQuotesByKey(oiRaw, instruments),
  };
}

function buildLeg(touchlineQuote, oiQuote, strike, type, spot, daysToExpiry) {
  const tl = touchlineQuote?.Touchline || {};
  const ltp = Number(tl.LastTradedPrice) || 0;
  const oi = Number(oiQuote?.OpenInterest) || 0;
  const volume = Number(tl.TotalTradedQuantity) || 0;
  const bid_price = Number(tl.BidInfo?.Price) || 0;
  const ask_price = Number(tl.AskInfo?.Price) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type: type.toUpperCase() });
  return { last_price: ltp, oi, volume, bid_price, ask_price, ...greeks };
}

export async function testConnection(creds = {}) {
  try {
    const session = await ensureSession(creds);
    if (!session?.feedToken) throw new Error("No feed token returned");
    return { status: "success", message: "IndiaBulls Securities (XTS market data) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  const rows = await getOptionRows(symbol);
  return { status: "success", data: listExpiries(rows) };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  const spot = await getIndexSpotToken(symbol);
  if (!spot) return { status: "success", data: { last_price: 0 } };

  const instruments = [{ exchangeSegment: spot.segmentNum, exchangeInstrumentID: spot.token }];
  const quotes = await fetchQuotesBatched(creds, instruments, MSG_CODE_TOUCHLINE);
  const q = indexQuotesByKey(quotes, instruments).get(quoteKey(spot.segmentNum, spot.token));
  const last_price = Number(q?.Touchline?.LastTradedPrice) || 0;
  return { status: "success", data: { last_price } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);

  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || listExpiries(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await getIndexSpotToken(symbol);
  const legInstruments = rows.map((r) => ({ exchangeSegment: r.segmentNum, exchangeInstrumentID: r.token }));
  const allInstruments = spot
    ? [...legInstruments, { exchangeSegment: spot.segmentNum, exchangeInstrumentID: spot.token }]
    : legInstruments;

  const { touchline, oi } = await fetchTouchlineAndOI(creds, allInstruments);

  const spotQuote = spot ? touchline.get(quoteKey(spot.segmentNum, spot.token)) : null;
  const lastPrice = Number(spotQuote?.Touchline?.LastTradedPrice) || 0;
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const oc = {};
  for (const row of rows) {
    const key = quoteKey(row.segmentNum, row.token);
    const tl = touchline.get(key);
    if (!tl) continue; // token not returned by the quote call — skip this leg
    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type] = buildLeg(tl, oi.get(key), row.strike, row.type, lastPrice, daysToExpiry);
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}
