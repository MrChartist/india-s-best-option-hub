/**
 * Firstock broker module — see registry.mjs for the shared contract.
 *
 * Firstock has no native option-chain endpoint. This module joins:
 *   1. the daily NFO/BFO symbol-master CSVs (firstockInstruments.mjs) to
 *      resolve strike/expiry -> tradingSymbol (Firstock's quote API takes
 *      {exchange, tradingSymbol} directly — no numeric token needed),
 *   2. the authenticated /indexList endpoint (also cached daily) to resolve
 *      each index's own tradingSymbol for its spot LTP,
 *   3. batched /getMultiQuotes calls (50 symbols/call, 1 req/sec — both
 *      documented in Firstock's production adapter) for LTP/OI/volume/depth.
 * Firstock's quote response carries no IV/Greeks, so every leg is back-solved
 * via this app's own Black-Scholes solver (same approach as Zerodha/5paisa).
 *
 * Auth is a TOTP login (userId/password/TOTP/vendorCode/apiKey -> susertoken),
 * cached in-memory per firstockAuth.mjs until IST end-of-day.
 */

import { ensureSession, callApi } from "./firstockAuth.mjs";
import { getOptionMaster, listExpiries, optionRowsForExpiry, getIndexMap } from "./firstockInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "firstock";
export const credentialFields = ["userId", "password", "totpSecret", "vendorCode", "apiKey"];

// Documented in Firstock's /getMultiQuotes usage: 50 symbols per call, 1 request/second.
const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 1050;

const KNOWN_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]);

function assertKnownSymbol(symbol) {
  if (!KNOWN_SYMBOLS.has(symbol)) throw new Error(`Unknown symbol for Firstock: ${symbol}`);
}

/** Batched /getMultiQuotes lookup -> Map<"exchange:tradingSymbol", raw quote item>. */
async function fetchQuotesMap(creds, targets) {
  const map = new Map();
  if (!targets.length) return map;

  const chunkResults = await batchWithDelay(targets, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const data = chunk.map((t) => ({ exchange: t.exchange, tradingSymbol: t.tradingSymbol }));
    const json = await callApi(creds, "/getMultiQuotes", { data });
    return json?.data || [];
  });

  for (const rows of chunkResults) {
    for (const q of rows) {
      if (q?.exchange && q?.tradingSymbol) map.set(`${q.exchange}:${q.tradingSymbol}`, q);
    }
  }
  return map;
}

function buildLeg(quote, strike, type, spot, daysToExpiry) {
  const ltp = Number(quote?.lastTradedPrice) || 0;
  const oi = Number(quote?.openInterest) || 0;
  const volume = Number(quote?.volume) || 0;
  const bid_price = Number(quote?.bestBuyPrice1) || 0;
  const ask_price = Number(quote?.bestSellPrice1) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot, strike: Number(strike), daysToExpiry, type });
  return { last_price: ltp, oi, volume, bid_price, ask_price, ...greeks };
}

export async function testConnection(creds = {}) {
  try {
    await ensureSession(creds);
    return { status: "success", message: "Firstock session authenticated" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  assertKnownSymbol(symbol);
  // The NFO/BFO symbol master is a public download — no login required just to list expiries.
  const master = await getOptionMaster();
  return { status: "success", data: listExpiries(master, symbol) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  assertKnownSymbol(symbol);

  await ensureSession(creds); // throws on bad/expired credentials
  const master = await getOptionMaster();

  let expiryIso = expiry;
  if (!expiryIso) {
    const expiries = listExpiries(master, symbol);
    expiryIso = expiries[0];
  }
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };

  const optionRows = optionRowsForExpiry(master, symbol, expiryIso);
  if (!optionRows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const indexMap = await getIndexMap(creds);
  const spotInfo = indexMap[symbol];

  const quoteTargets = optionRows.map((r) => ({ exchange: r.exchange, tradingSymbol: r.tradingSymbol }));
  if (spotInfo) quoteTargets.push(spotInfo);

  const quoteMap = await fetchQuotesMap(creds, quoteTargets);
  const spotQuote = spotInfo ? quoteMap.get(`${spotInfo.exchange}:${spotInfo.tradingSymbol}`) : null;
  const lastPrice = spotQuote ? Number(spotQuote.lastTradedPrice) || 0 : 0;

  const daysToExpiry = daysBetween(new Date(), expiryIso);
  const oc = {};

  for (const row of optionRows) {
    const q = quoteMap.get(`${row.exchange}:${row.tradingSymbol}`);
    if (!q) continue; // symbol not returned by the quote call — skip this leg

    if (!oc[row.strike]) oc[row.strike] = {};
    oc[row.strike][row.type] = buildLeg(q, row.strike, row.type === "ce" ? "CE" : "PE", lastPrice, daysToExpiry);
  }

  return { status: "success", data: { oc, last_price: lastPrice } };
}

export async function fetchLTP(creds, symbol) {
  assertKnownSymbol(symbol);
  await ensureSession(creds);
  const indexMap = await getIndexMap(creds);
  const spotInfo = indexMap[symbol];
  if (!spotInfo) return { status: "success", data: { last_price: 0 } };

  const quoteMap = await fetchQuotesMap(creds, [spotInfo]);
  const q = quoteMap.get(`${spotInfo.exchange}:${spotInfo.tradingSymbol}`);
  return { status: "success", data: { last_price: q ? Number(q.lastTradedPrice) || 0 : 0 } };
}
