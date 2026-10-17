/**
 * CompositEdge broker module — see registry.mjs for the shared contract.
 *
 * CompositEdge runs on Symphony Fintech's "XTS" white-label backend (same
 * request/response shapes as other XTS-based brokers on this app's broker
 * list, e.g. jainamxts — confirmed via marketcalls/openalgo's production
 * adapters for both). It has no native option-chain endpoint, so this
 * module builds the chain itself: a daily F&O instrument master
 * (compositedgeInstruments.mjs) resolves strike/expiry -> token, and
 * batched /instruments/quotes calls (50 instruments/call — XTS's
 * documented cap, confirmed in openalgo's own adapter) fill in
 * price/OI/volume. XTS quotes carry no IV/Greeks, so every leg is
 * back-solved via this app's Black-Scholes helper.
 *
 * Only the market-data half of CompositEdge's API is used (see
 * compositedgeAuth.mjs for why) — apiKey/apiSecret log straight into a
 * read-only quotes session with no browser-redirect step required.
 */

import { getSession, authFetch } from "./compositedgeAuth.mjs";
import {
  getMaster, getIndexList, listExpiries, optionRowsForExpiry, indexSpotToken, SYMBOL_CONFIG,
} from "./compositedgeInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";

export const id = "compositedge";
export const credentialFields = ["apiKey", "apiSecret"];

const QUOTE_BATCH_SIZE = 50; // XTS documented cap: 50 instruments per /instruments/quotes call
const QUOTE_BATCH_DELAY_MS = 200;
const TOUCHLINE_CODE = 1502; // LTP/OHLC/volume/depth
const OI_CODE = 1510; // open interest

function assertKnownSymbol(symbol) {
  if (!SYMBOL_CONFIG[symbol]) throw new Error(`Unknown symbol for CompositEdge: ${symbol}`);
}

// Keyed by segment+token, not token alone: the appended index-spot instrument
// lives in a different exchangeSegmentId (1/11) than the option strikes
// (2/12), and XTS's numeric ExchangeInstrumentID space is not guaranteed
// unique across segments — a bare-token key could let a spot quote silently
// clobber (or be clobbered by) an option strike that happens to share the
// same numeric id. Matches the compound-key pattern used by the other
// XTS-family brokers (jainamxts.mjs, wisdom.mjs).
function quoteKey(instrument) {
  return `${instrument.exchangeSegmentId}_${instrument.token}`;
}

function parseQuoteEntry(raw) {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * One batched /instruments/quotes call for a single xtsMessageCode. Returns
 * [{ instrument, quote }] pairs, matched back to the requesting instrument
 * by ExchangeInstrumentID when the response carries it (confirmed present
 * for Touchline/1502), else by request-order position as a fallback
 * (unverified for the OI/1510 response shape specifically — openalgo's own
 * adapter only ever calls 1510 one instrument at a time, so a batched
 * response's exact fields weren't observable without live credentials).
 */
async function fetchQuoteCode(creds, instruments, messageCode) {
  if (!instruments.length) return [];
  const chunkResults = await batchWithDelay(instruments, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const result = await authFetch(creds, "/instruments/quotes", {
      body: {
        instruments: chunk.map((i) => ({ exchangeSegment: i.exchangeSegmentId, exchangeInstrumentID: i.token })),
        xtsMessageCode: messageCode,
        publishFormat: "JSON",
      },
    });
    const parsedQuotes = (result?.listQuotes || []).map(parseQuoteEntry);
    return chunk.map((instr, idx) => {
      const byId = parsedQuotes.find((q) => q && String(q.ExchangeInstrumentID) === String(instr.token));
      return { instrument: instr, quote: byId || parsedQuotes[idx] || null };
    });
  });
  return chunkResults.flat();
}

/** Batched Touchline + OI fetch -> Map<"segment_token", {ltp, volume, bid, ask, oi}>. */
async function fetchQuotesBatched(creds, instruments) {
  const map = new Map();
  if (!instruments.length) return map;

  const [touchlineRows, oiRows] = await Promise.all([
    fetchQuoteCode(creds, instruments, TOUCHLINE_CODE),
    fetchQuoteCode(creds, instruments, OI_CODE).catch((e) => {
      console.log(`[compositedge] OI (1510) batch fetch failed, defaulting OI to 0: ${e.message}`);
      return [];
    }),
  ]);

  for (const { instrument, quote } of touchlineRows) {
    const touchline = quote?.Touchline || {};
    map.set(quoteKey(instrument), {
      ltp: Number(touchline.LastTradedPrice) || 0,
      volume: Number(touchline.TotalTradedQuantity) || 0,
      bid: Number(touchline.BidInfo?.Price) || 0,
      ask: Number(touchline.AskInfo?.Price) || 0,
      oi: 0,
    });
  }
  for (const { instrument, quote } of oiRows) {
    const entry = map.get(quoteKey(instrument));
    if (entry && quote?.OpenInterest != null) entry.oi = Number(quote.OpenInterest) || 0;
  }
  return map;
}

export async function testConnection(creds = {}) {
  try {
    const session = await getSession(creds);
    if (!session?.token) throw new Error("No session token returned");
    return { status: "success", message: "CompositEdge market-data API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  const cfg = SYMBOL_CONFIG[symbol];
  const master = await getMaster(cfg.segment);
  return { status: "success", data: listExpiries(master, symbol) };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  const indexList = await getIndexList();
  const spot = indexSpotToken(indexList, symbol);
  if (!spot) return { status: "success", data: { last_price: 0 } };

  const quoteMap = await fetchQuotesBatched(creds, [spot]);
  const q = quoteMap.get(quoteKey(spot));
  return { status: "success", data: { last_price: q ? q.ltp : 0 } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);
  const cfg = SYMBOL_CONFIG[symbol];
  const master = await getMaster(cfg.segment);

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(master, symbol);
    if (!expiries.length) return { status: "success", data: { oc: {}, last_price: 0 } };
    expiryIso = expiries[0];
  }

  const optionRows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!optionRows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const indexList = await getIndexList();
  const spot = indexSpotToken(indexList, symbol);

  const quoteTargets = optionRows.map((r) => ({ token: r.token, exchangeSegmentId: cfg.exchangeSegmentId }));
  if (spot) quoteTargets.push(spot);

  const quoteMap = await fetchQuotesBatched(creds, quoteTargets);
  const lastPrice = spot ? quoteMap.get(quoteKey(spot))?.ltp || 0 : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const row of optionRows) {
    const q = quoteMap.get(quoteKey({ token: row.token, exchangeSegmentId: cfg.exchangeSegmentId }));
    if (!q) continue;

    const greeks = computeIVAndGreeks({
      ltp: q.ltp,
      spot: lastPrice,
      strike: row.strike,
      daysToExpiry,
      type: row.type === "ce" ? "CE" : "PE",
    });

    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type] = {
      last_price: q.ltp,
      oi: q.oi,
      volume: q.volume,
      ...greeks,
      bid_price: q.bid,
      ask_price: q.ask,
    };
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}
