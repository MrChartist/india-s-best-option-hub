/**
 * IIFL Capital — real broker integration (see registry.mjs for the shared contract).
 *
 * Auth model: one-time-per-day handshake, NOT a plain paste-a-token model.
 * IIFL's login is a browser OAuth-style redirect (docs:
 * broker-api-docs/iiflcapital-api-docs/03-user.md) — the user logs in on
 * IIFL's own site once per trading day and is redirected back with a
 * single-use `authCode` + `clientId`. Rather than making the end user
 * hand-compute the documented SHA-256 checksum themselves, this module does
 * that exchange server-side (see iiflcapitalAuth.mjs) from the pasted
 * clientId/appSecret/authCode, and caches the resulting `userSession` JWT
 * in-memory until the next IST midnight — never re-logging in on every call.
 *
 * IIFL has no native option-chain endpoint: strikes/expiries/instrumentIds
 * come from IIFL's daily public contract CSVs (iiflcapitalInstruments.mjs),
 * prices/OI/volume come from batched /marketdata/marketquotes calls plus one
 * /marketdata/openinterest call per leg (IIFL's OI endpoint is single-mode
 * only — same constraint openalgo's production adapter documents), and since
 * neither endpoint returns IV/Greeks, every leg is back-solved via
 * Black-Scholes. This is architecturally the same shape as Zerodha's and
 * 5paisa's integrations.
 *
 * NOTE FOR FUTURE BROKER WORK: nothing in IIFL Capital's endpoint paths,
 * field names, or CSV contract-file layout resembles the XTS/Omnesys
 * white-label shapes seen elsewhere — this looks like a genuinely custom
 * IIFL-built API, not a shared third-party backend.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { chunkArray } from "../lib/batch.mjs";
import { getSession, iiflFetch } from "./iiflcapitalAuth.mjs";
import {
  SYMBOL_SEGMENT,
  getOptionRows,
  distinctExpiriesAscending,
  filterRowsByExpiryIso,
  resolveIndexInfo,
} from "./iiflcapitalInstruments.mjs";

export const id = "iiflcapital";
export const credentialFields = ["clientId", "appSecret", "authCode"];

// No documented per-call instrument cap for /marketdata/marketquotes ("Single/Bulk"
// mode) — chunk conservatively so one HTTP payload/response stays small; the
// shared pacer in iiflcapitalAuth.mjs paces the resulting calls at IIFL's
// documented 10 req/sec Market Quotes cap regardless of chunk size.
const QUOTE_BATCH_SIZE = 50;

function quoteKey(exchange, instrumentId) {
  return `${String(exchange || "").toUpperCase()}:${instrumentId}`;
}

async function fetchQuotesMap(creds, instruments) {
  const map = new Map();
  if (instruments.length === 0) return map;
  for (const chunk of chunkArray(instruments, QUOTE_BATCH_SIZE)) {
    const json = await iiflFetch("/marketdata/marketquotes", creds, chunk);
    const rows = Array.isArray(json?.result) ? json.result : Array.isArray(json) ? json : [];
    for (const row of rows) {
      const exch = row.exchange ?? row.Exchange;
      const instId = row.instrumentId ?? row.InstrumentId;
      if (exch == null || instId == null) continue;
      map.set(quoteKey(exch, instId), row);
    }
  }
  return map;
}

/**
 * One HTTP call per leg — IIFL's /marketdata/openinterest is single-mode
 * only (no batch variant), same constraint openalgo's production adapter
 * documents. Fired concurrently via Promise.all: the shared pacer in
 * iiflcapitalAuth.mjs still serializes the actual outgoing requests against
 * the 10 req/sec Open Interest cap (its wait-then-stamp bookkeeping runs
 * synchronously before each call's first await, so concurrent callers queue
 * correctly instead of bursting). Best-effort — a failed leg reports OI 0
 * rather than failing the whole chain.
 */
async function fetchOpenInterestMap(creds, instruments) {
  const map = new Map();
  if (instruments.length === 0) return map;
  const entries = await Promise.all(
    instruments.map(async (inst) => {
      const key = quoteKey(inst.exchange, inst.instrumentId);
      try {
        const json = await iiflFetch("/marketdata/openinterest", creds, inst);
        const result = json?.result ?? json;
        const oi = Number(result?.openInterest ?? result?.oi) || 0;
        return [key, oi];
      } catch {
        return [key, 0];
      }
    })
  );
  for (const [key, oi] of entries) map.set(key, oi);
  return map;
}

function buildLeg(quoteRow, oi, ctx) {
  const ltp = Number(quoteRow?.ltp ?? quoteRow?.LTP) || 0;
  const greeks = computeIVAndGreeks({ ltp, spot: ctx.spot, strike: ctx.strike, daysToExpiry: ctx.daysToExpiry, type: ctx.type });
  return {
    last_price: ltp,
    oi,
    volume: Number(quoteRow?.tradedVolume ?? quoteRow?.TradedVolume) || 0,
    ...greeks,
    bid_price: Number(quoteRow?.bestBidPrice ?? quoteRow?.BestBidPrice) || 0,
    ask_price: Number(quoteRow?.bestAskPrice ?? quoteRow?.BestAskPrice) || 0,
  };
}

export async function testConnection(creds = {}) {
  try {
    await getSession(creds); // performs the checksum exchange, throws a clear message on bad creds
    await iiflFetch("/profile", creds, undefined, { method: "GET" });
    return { status: "success", message: "IIFL Capital session authenticated" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  if (!SYMBOL_SEGMENT[symbol]) throw new Error(`Unknown symbol: ${symbol}`);
  const rows = await getOptionRows(symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

export async function fetchLTP(creds, symbol) {
  const indexInfo = await resolveIndexInfo(symbol);
  // Degrade gracefully to last_price:0 rather than throwing — matches this
  // module's own fetchOptionChain (which already treats a null indexInfo as
  // spot:0) and every other broker's fetchLTP in this registry.
  if (!indexInfo) return { status: "success", data: { last_price: 0 } };
  const quotesMap = await fetchQuotesMap(creds, [indexInfo]);
  const row = quotesMap.get(quoteKey(indexInfo.exchange, indexInfo.instrumentId));
  const lastPrice = Number(row?.ltp) || 0;
  return { status: "success", data: { last_price: lastPrice } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const segment = SYMBOL_SEGMENT[symbol];
  if (!segment) throw new Error(`Unknown symbol: ${symbol}`);

  let rows = await getOptionRows(symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = filterRowsByExpiryIso(rows, targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const indexInfo = await resolveIndexInfo(symbol);
  const legInstruments = rows.map((r) => ({ exchange: segment, instrumentId: r.token }));
  const quoteInstruments = indexInfo ? [...legInstruments, indexInfo] : legInstruments;

  const [quotesMap, oiMap] = await Promise.all([
    fetchQuotesMap(creds, quoteInstruments),
    fetchOpenInterestMap(creds, legInstruments),
  ]);

  const spot = indexInfo ? Number(quotesMap.get(quoteKey(indexInfo.exchange, indexInfo.instrumentId))?.ltp) || 0 : 0;
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const oc = {};
  for (const row of rows) {
    const key = quoteKey(segment, row.token);
    const quoteRow = quotesMap.get(key);
    if (!quoteRow) continue;

    const strike = Number(row.strike) || 0;
    const strikeKey = String(strike);
    const type = row.optionType === "CE" ? "CE" : "PE";
    const oi = oiMap.get(key) || 0;

    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][type.toLowerCase()] = buildLeg(quoteRow, oi, { spot, strike, daysToExpiry, type });
  }

  return { status: "success", data: { oc, last_price: spot } };
}
