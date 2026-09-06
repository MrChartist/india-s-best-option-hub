/**
 * HDFC Securities (InvestRight) — see registry.mjs for the shared broker contract.
 *
 * Auth: paste-token (apiKey + accessToken) — see hdfcsecuritiesAuth.mjs for why
 * (InvestRight's real login is a browser-redirect OAuth exchange this app has
 * no callback host to complete, so the user does that once externally and
 * pastes the resulting accessToken, same UX as this app's Zerodha/Fyers modules).
 *
 * Data: InvestRight has NO native option-chain endpoint and its only REST
 * quote endpoint (/fetch-ltp) returns just {ltp, prev_close} — no OI, volume,
 * depth or Greeks over REST at all. So this module, like Zerodha/5paisa/Alice
 * Blue:
 *   - resolves strikes/expiries/tokens from the daily public Security Master
 *     CSV (hdfcsecuritiesInstruments.mjs)
 *   - takes LTP from batched /fetch-ltp REST calls (hdfcsecuritiesAuth.mjs)
 *   - takes OI/volume/bid/ask from a persistent authenticated WebSocket feed
 *     (hdfcsecuritiesFeed.mjs + hdfcsecuritiesProtobuf.mjs, since InvestRight
 *     ships binary protobuf frames and no npm protobuf lib is allowed here)
 *   - fills in IV/Greeks via Black-Scholes, since neither REST nor the parsed
 *     WS fields carry them (InvestRight's feed DOES emit a separate per-leg
 *     Greeks packet type — NSE_FO_GREEK/BSE_FO_GREEK — but wiring a second,
 *     independently-timed packet stream into the same short collection window
 *     added meaningfully more failure surface for uncertain benefit, so v1
 *     sticks to the same battle-tested BS fallback the other batched-quote
 *     brokers use; a follow-up could decode+merge those packets too).
 *
 * NOTE for whoever builds the HDFC Sky module next: HDFC Sky and HDFC
 * Securities are two different products from the same parent company that
 * share this exact GenericDTO protobuf schema and gateway design (per
 * InvestRight's own docs comments) — but they are separate hosts/apps/
 * credentials, so nothing here is reusable as-is beyond the wire format.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { testConnection as authTestConnection, fetchLtpBatch } from "./hdfcsecuritiesAuth.mjs";
import {
  SYMBOL_CONFIG,
  getOptionRows,
  distinctExpiriesAscending,
  resolveIndexSpotRow,
  legScripId,
  indexScripId,
  legLtpInstrument,
  indexLtpInstrument,
} from "./hdfcsecuritiesInstruments.mjs";
import { subscribeAndCollect } from "./hdfcsecuritiesFeed.mjs";

export const id = "hdfcsecurities";
export const credentialFields = ["apiKey", "accessToken"];

// /fetch-ltp has no documented per-call cap; openalgo's production adapter
// found sibling InvestRight/Sky gateways reject batches above 10 outright, so
// this stays conservative even though InvestRight itself is silent on it.
const LTP_BATCH_SIZE = 10;
const LTP_BATCH_DELAY_MS = 200;

export async function testConnection(creds = {}) {
  return authTestConnection(creds);
}

export async function fetchExpiryList(creds, symbol) {
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

async function fetchLtpMap(creds, instruments) {
  if (!instruments.length) return new Map();
  const batches = await batchWithDelay(instruments, LTP_BATCH_SIZE, LTP_BATCH_DELAY_MS, (chunk) =>
    fetchLtpBatch(creds, chunk)
  );
  const merged = new Map();
  for (const batch of batches) for (const [k, v] of batch) merged.set(k, v);
  return merged;
}

function ltpKey(instrument) {
  return `${String(instrument.exchange).toUpperCase()}|${String(instrument.token)}`;
}

export async function fetchLTP(creds, symbol) {
  if (!SYMBOL_CONFIG[symbol]) throw new Error(`HDFC Securities: unknown symbol ${symbol}`);
  const spotRow = await resolveIndexSpotRow(symbol);
  if (!spotRow) {
    throw new Error(
      `HDFC Securities: could not resolve the ${symbol} index spot row in the security master — the master's display-name spelling may differ from the alias list this module checks (see hdfcsecuritiesInstruments.mjs).`
    );
  }

  const instrument = indexLtpInstrument(symbol, spotRow);
  const restMap = await fetchLtpMap(creds, [instrument]);
  let lastPrice = restMap.get(ltpKey(instrument))?.ltp || 0;

  if (!lastPrice) {
    // REST gave nothing usable (token band guess may be off, or a quiet feed) — fall back to a quick WS snapshot.
    const scripId = indexScripId(symbol, spotRow);
    const ticks = await subscribeAndCollect(creds, [scripId], 2500);
    lastPrice = ticks.get(spotRow.token)?.ltp || 0;
  }

  return { status: "success", data: { last_price: lastPrice } };
}

function buildLeg({ ltp, wsTick, spot, strike, daysToExpiry, type }) {
  const greeks = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  return {
    last_price: ltp,
    oi: wsTick?.oi || 0,
    volume: wsTick?.volume || 0,
    ...greeks,
    bid_price: wsTick?.depth?.buy?.[0]?.price || 0,
    ask_price: wsTick?.depth?.sell?.[0]?.price || 0,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const cfg = SYMBOL_CONFIG[symbol];
  if (!cfg) throw new Error(`HDFC Securities: unknown symbol ${symbol}`);

  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  rows = rows.filter((r) => r.expiry_date === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spotRow = await resolveIndexSpotRow(symbol);

  // WS feed: OI / volume / depth for every leg (+ the index for a live spot fallback).
  const legScripIds = rows.map((r) => legScripId(symbol, r));
  const allScripIds = spotRow ? [...legScripIds, indexScripId(symbol, spotRow)] : legScripIds;
  const ticksByToken = await subscribeAndCollect(creds, allScripIds);

  // REST: authoritative LTP for every leg + the index.
  const legInstruments = rows.map((r) => legLtpInstrument(symbol, r));
  const allInstruments = spotRow ? [...legInstruments, indexLtpInstrument(symbol, spotRow)] : legInstruments;
  const ltpMap = await fetchLtpMap(creds, allInstruments);

  let spot = spotRow ? ltpMap.get(ltpKey(indexLtpInstrument(symbol, spotRow)))?.ltp || 0 : 0;
  if (!spot && spotRow) spot = ticksByToken.get(spotRow.token)?.ltp || 0;

  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const oc = {};
  for (const row of rows) {
    const token = String(row.exch_security_id);
    const wsTick = ticksByToken.get(token);
    const restEntry = ltpMap.get(`${cfg.csvExchange}|${token}`);
    const ltp = restEntry?.ltp || wsTick?.ltp || 0;
    const type = String(row.option_type || "").toUpperCase() === "PE" ? "PE" : "CE";
    const strike = Number(row.strike_price) || 0;
    const strikeKey = String(strike);

    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][type.toLowerCase()] = buildLeg({ ltp, wsTick, spot, strike, daysToExpiry, type });
  }

  return { status: "success", data: { oc, last_price: spot } };
}
