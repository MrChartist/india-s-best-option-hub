/**
 * Angel One (SmartAPI) broker module — see registry.mjs for the shared contract.
 *
 * Unlike Dhan, Angel has no native option-chain endpoint — this module joins
 * three separate calls per chain refresh:
 *   1. the daily instrument master (angeloneInstruments.mjs) to resolve
 *      strike/expiry -> token,
 *   2. batched market/v1/quote calls (50 tokens/call) for LTP/OI/volume/depth,
 *   3. one marketData/v1/optionGreek call per underlying+expiry for Greeks/IV,
 *      falling back to this app's own Black-Scholes solver if that call fails
 *      or a particular strike is missing from its response.
 */

import { authFetch, getSession } from "./angeloneAuth.mjs";
import {
  getInstrumentMaster,
  listExpiries,
  optionRowsForExpiry,
  indexSpotToken,
  OPTIDX_NAME_ALIASES,
  isoToDDMMMYYYY,
} from "./angeloneInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";

const QUOTE_PATH = "/rest/secure/angelbroking/market/v1/quote/";
const GREEK_PATH = "/rest/secure/angelbroking/marketData/v1/optionGreek";
const QUOTE_BATCH_SIZE = 50; // Angel hard cap: 50 tokens per quote call
// Angel's own Nov 2023 SmartAPI announcement that introduced the 50-symbol bulk
// fetch also CUT the /quote rate limit from 10 req/s to 1 req/s at the same time
// ("Enhanced with 50-Symbol Bulk Fetch and 1 Request Per Second Rate Limit") — the
// previous 200ms delay here (~5 req/s) was based on the old, superseded 10 req/s
// figure and would blow through the current limit by 5x on any chain with >50
// strikes, risking a real account getting rate-limited or suspended.
const QUOTE_BATCH_DELAY_MS = 1000; // 1 req/s per Angel's documented /quote cap

export const id = "angelone";
export const credentialFields = ["apiKey", "clientId", "password", "totpSecret"];

export async function testConnection(creds = {}) {
  try {
    const session = await getSession(creds);
    if (!session?.jwtToken) throw new Error("No session token returned");
    return { status: "success", message: "Angel One SmartAPI connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const master = await getInstrumentMaster();
  const expiries = listExpiries(master, symbol);
  return { status: "success", data: expiries };
}

export async function fetchLTP(creds, symbol) {
  const master = await getInstrumentMaster();
  const spot = indexSpotToken(master, symbol);
  if (!spot) {
    throw new Error(`Angel One instrument master has no index-spot token for ${symbol}`);
  }
  const quoteMap = await fetchQuotesBatched(creds, [{ exch: spot.exch_seg, token: spot.token }]);
  const q = quoteMap.get(`${spot.exch_seg}:${spot.token}`);
  return { status: "success", data: { last_price: q ? Number(q.ltp) || 0 : 0 } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const master = await getInstrumentMaster();

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(master, symbol);
    if (!expiries.length) return { status: "success", data: { oc: {}, last_price: 0 } };
    expiryIso = expiries[0];
  }

  const optionRows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!optionRows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = indexSpotToken(master, symbol);
  const quoteTargets = optionRows.map((r) => ({ exch: r.exch_seg, token: r.token }));
  if (spot) quoteTargets.push({ exch: spot.exch_seg, token: spot.token });

  const quoteMap = await fetchQuotesBatched(creds, quoteTargets);
  const spotQuote = spot ? quoteMap.get(`${spot.exch_seg}:${spot.token}`) : null;
  const lastPrice = spotQuote ? Number(spotQuote.ltp) || 0 : 0;

  const greeksMap = await fetchGreeksMap(creds, symbol, expiryIso).catch((e) => {
    console.log(`[angelone] optionGreek unavailable for ${symbol} ${expiryIso}, using BS fallback: ${e.message}`);
    return new Map();
  });

  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};

  for (const row of optionRows) {
    const q = quoteMap.get(`${row.exch_seg}:${row.token}`);
    if (!q) continue; // token not returned by the quote call — skip this leg

    const ltp = Number(q.ltp) || 0;
    const depth = q.depth || {};
    const bid = depth.buy?.[0]?.price != null ? Number(depth.buy[0].price) : 0;
    const ask = depth.sell?.[0]?.price != null ? Number(depth.sell[0].price) : 0;

    const g = greeksMap.get(`${greekStrikeKey(row.strike)}_${row.type.toUpperCase()}`);
    const legGreeks = g
      ? {
          iv: Number(g.impliedVolatility) || 0,
          delta: Number(g.delta) || 0,
          gamma: Number(g.gamma) || 0,
          theta: Number(g.theta) || 0,
          vega: Number(g.vega) || 0,
        }
      : computeIVAndGreeks({
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
      ...legGreeks,
      bid_price: bid,
      ask_price: ask,
    };
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}

// ── internals ──────────────────────────────────────────────────────────────

/** Batched market/v1/quote fetch, respecting the 50-tokens-per-call cap. Returns Map<"exch:token", quote>. */
async function fetchQuotesBatched(creds, targets) {
  const map = new Map();
  if (!targets.length) return map;

  const chunkResults = await batchWithDelay(targets, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const exchangeTokens = {};
    for (const t of chunk) {
      (exchangeTokens[t.exch] ||= []).push(String(t.token));
    }
    const json = await authFetch(creds, QUOTE_PATH, { mode: "FULL", exchangeTokens });
    return json?.data?.fetched || [];
  });

  for (const fetched of chunkResults) {
    for (const q of fetched) {
      if (q?.exchange && q?.symbolToken) map.set(`${q.exchange}:${q.symbolToken}`, q);
    }
  }
  return map;
}

/** One optionGreek call per underlying+expiry (capped at 1 req/sec broker-side). Returns Map<"strike_TYPE", greekRow>. */
async function fetchGreeksMap(creds, symbol, expiryIso) {
  const name = (OPTIDX_NAME_ALIASES[symbol] || [symbol])[0];
  const expirydate = isoToDDMMMYYYY(expiryIso).toUpperCase();
  const json = await authFetch(creds, GREEK_PATH, { name, expirydate });
  const map = new Map();
  for (const g of json?.data || []) {
    map.set(`${greekStrikeKey(Number(g.strikePrice))}_${(g.optionType || "").toUpperCase()}`, g);
  }
  return map;
}

// optionGreek's strikePrice is assumed to already be in rupees, not paise
// (unverified against a live response) — round to the nearest rupee so it
// matches the instrument-master strike (which IS confirmed to be paise/100).
function greekStrikeKey(strike) {
  return Math.round(strike);
}
