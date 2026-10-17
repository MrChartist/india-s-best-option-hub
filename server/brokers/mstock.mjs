/**
 * mStock (Mirae Asset) broker module — see registry.mjs for the shared contract.
 *
 * mStock has no native option-chain endpoint (per marketcalls/openalgo's
 * broker/mstock/api/data.py — only /instruments/quote, /historical,
 * /intraday and WebSocket depth exist), so this module joins:
 *   1. the daily instrument master (mstockInstruments.mjs) to resolve
 *      strike/expiry -> token,
 *   2. batched /instruments/quote calls for LTP/OI/volume/depth,
 *   3. this app's own Black-Scholes solver for IV/Greeks, since mStock's
 *      Type B API has no documented Greeks endpoint (unlike Angel One's
 *      optionGreek call).
 *
 * mStock's Type B API is a near-clone of Angel One SmartAPI (same
 * OpenAPIScripMaster master-contract shape, same index-spot token numbering,
 * same X-PrivateKey/Bearer-JWT auth headers) — see mstockAuth.mjs and
 * mstockInstruments.mjs for the specifics and the evidence for that claim.
 */

import { getSession, authRequest } from "./mstockAuth.mjs";
import {
  getInstrumentMaster,
  listExpiries,
  optionRowsForExpiry,
  INDEX_SPOT_TOKENS,
} from "./mstockInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";

const QUOTE_PATH = "/instruments/quote";
// mStock's Quote API is documented at 20 req/s (unlimited/min/hr) but the batch size
// per call isn't documented — 500 tokens/call with a 1s gap between chunks mirrors the
// marketcalls/openalgo reference implementation's own (conservative, proven-working) choice.
const QUOTE_BATCH_SIZE = 500;
const QUOTE_BATCH_DELAY_MS = 1000;

export const id = "mstock";
export const credentialFields = ["clientId", "apiKey", "password", "totpSecret"];

export async function testConnection(creds = {}) {
  try {
    const session = await getSession(creds);
    if (!session?.jwtToken) throw new Error("No session token returned");
    return { status: "success", message: "mStock (Mirae Asset) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const master = await getInstrumentMaster(creds);
  const expiries = listExpiries(master, symbol);
  return { status: "success", data: expiries };
}

export async function fetchLTP(creds, symbol) {
  const spot = INDEX_SPOT_TOKENS[symbol];
  if (!spot) throw new Error(`mStock has no index-spot token mapping for ${symbol}`);
  const quoteMap = await fetchQuotesBatched(creds, [{ exch: spot.exch, token: spot.token }]);
  const q = quoteMap.get(spot.token);
  return { status: "success", data: { last_price: q ? Number(q.ltp) || 0 : 0 } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const master = await getInstrumentMaster(creds);

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(master, symbol);
    if (!expiries.length) return { status: "success", data: { oc: {}, last_price: 0 } };
    expiryIso = expiries[0];
  }

  const optionRows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!optionRows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = INDEX_SPOT_TOKENS[symbol];
  const quoteTargets = optionRows.map((r) => ({ exch: r.exch, token: r.token }));
  if (spot) quoteTargets.push({ exch: spot.exch, token: spot.token });

  const quoteMap = await fetchQuotesBatched(creds, quoteTargets);
  const spotQuote = spot ? quoteMap.get(spot.token) : null;
  const lastPrice = spotQuote ? Number(spotQuote.ltp) || 0 : 0;

  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};

  for (const row of optionRows) {
    const q = quoteMap.get(row.token);
    if (!q) continue; // token not returned by the quote call — skip this leg

    const ltp = Number(q.ltp) || 0;
    const depth = q.depth || {};
    const bid = depth.buy?.[0]?.price != null ? Number(depth.buy[0].price) : 0;
    const ask = depth.sell?.[0]?.price != null ? Number(depth.sell[0].price) : 0;

    const greeks = computeIVAndGreeks({
      ltp,
      spot: lastPrice,
      strike: row.strike,
      daysToExpiry,
      type: row.type === "ce" ? "CE" : "PE",
    });

    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type] = {
      last_price: ltp,
      oi: Number(q.opnInterest) || 0,
      volume: Number(q.tradeVolume) || 0,
      ...greeks,
      bid_price: bid,
      ask_price: ask,
    };
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}

// ── internals ──────────────────────────────────────────────────────────────

/**
 * Batched /instruments/quote fetch, grouping tokens by exchange in each call
 * body ({ mode, exchangeTokens: { NFO: [...], BFO: [...] } }) and chunking
 * across calls at QUOTE_BATCH_SIZE. Returns Map<token, quoteRow>.
 *
 * mode:"FULL" is used (rather than the "OHLC" mode the openalgo reference
 * uses for its own quote needs) so oi/volume/depth come back — the OHLC mode
 * is confirmed in the reference to omit them entirely. FULL-mode field names
 * (opnInterest/tradeVolume/depth.buy|sell) are carried over from Angel One's
 * identically-shaped quote endpoint and are NOT independently confirmed
 * against a live mStock response — verify against a real account before
 * relying on OI/volume/depth numbers in production.
 */
async function fetchQuotesBatched(creds, targets) {
  const map = new Map();
  if (!targets.length) return map;

  const chunkResults = await batchWithDelay(targets, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const exchangeTokens = {};
    for (const t of chunk) {
      (exchangeTokens[t.exch] ||= []).push(String(t.token));
    }
    const json = await authRequest(creds, QUOTE_PATH, {
      method: "GET",
      payload: { mode: "FULL", exchangeTokens },
    });
    return json?.data?.fetched || [];
  });

  for (const fetched of chunkResults) {
    for (const q of fetched) {
      const token = q?.symbolToken != null ? String(q.symbolToken) : null;
      if (token) map.set(token, q);
    }
  }
  return map;
}
