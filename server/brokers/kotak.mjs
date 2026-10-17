/**
 * Kotak Securities (Neo) broker module — see registry.mjs for the shared contract.
 *
 * Auth model: active TOTP+MPIN login (like Angel One/5paisa/Alice Blue), not a
 * paste-a-token model — see kotakAuth.mjs. The resulting session is cached
 * in-memory per-user and only re-established when missing/expired.
 *
 * No native option-chain endpoint: strikes/expiries/tokens come from Kotak's
 * daily scrip-master CSVs (kotakInstruments.mjs, cached once/day like
 * zerodhaInstruments.mjs) joined with batched neosymbol quote calls
 * (kotakQuotes.mjs). Kotak's quotes don't carry IV/Greeks, so those are
 * filled in via this app's own Black-Scholes solver (same approach as
 * Zerodha/5paisa).
 *
 * Sources: broker-api-docs/kotak-api-docs (official docs mirror) +
 * marketcalls/openalgo's broker/kotak/* (production reference implementation).
 * Kotak's Neo API is a custom in-house backend, not a white-label XTS/NEST
 * clone — endpoint shapes here are broker-specific, not shared with any other
 * integration in this registry.
 */

import { getSession } from "./kotakAuth.mjs";
import { getOptionRows, distinctExpiriesAscending, INDEX_SPOT_QUERY } from "./kotakInstruments.mjs";
import { fetchQuotesBatched, parseQuote } from "./kotakQuotes.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "kotak";
export const credentialFields = ["accessToken", "mobileNumber", "ucc", "totpSecret", "mpin"];

/**
 * Capabilities descriptor — informational only. placeOrder is intentionally
 * NOT implemented for Kotak Neo in this pass; it stays read-only (market
 * data/quotes) until order code is written and held to the same
 * verification bar as fyersOrders.mjs/zerodhaOrders.mjs.
 *
 * Sourced from web search only — a direct fetch of the GitHub issue this
 * came from 404'd this session, so NOTHING below was independently
 * re-confirmed against a live page. Treat this as the LEAST verified of the
 * five capability descriptors added in this pass. Secondary sources describe
 * Kotak Neo's own SDK docs as listing product codes CNC/NRML/MIS/CO/BO/MTF
 * and validity values DAY/IOC/GTC/EOS/GTD, while separately noting that
 * BO/CO/GTC/EOS/GTD are "no longer supported by the exchange but still
 * silently accepted" by the API — exactly the false-promise trap this
 * descriptor exists to prevent, which is why they're marked false here
 * despite appearing in the product/validity enums.
 */
export const capabilities = {
  bracket: false, // Reported (not independently re-fetched) as accepted by the API but no longer honoured by the exchange.
  cover: false, // Same caveat as bracket.
  ioc: false, // NEEDS VERIFICATION — reported as a currently-supported validity value, but not independently fetched this session; default false until confirmed directly against Kotak's own docs.
  mtf: false, // NEEDS VERIFICATION — reported as a currently-supported product code, but not independently fetched this session.
  nativeMarketProtection: false, // NEEDS VERIFICATION — no equivalent field found in what was reviewed.
  maxLegQty: null, // NEEDS VERIFICATION — no broker-specific per-order qty cap found; the NSE exchange-wide freeze quantity (spec §8 slicing) is the only confirmed ceiling. Do not read null as "unlimited".
  products: ["CNC", "NRML", "MIS"], // Universal Indian-broker vocabulary; MTF was reported (see above) but excluded here pending independent verification.
};

export async function testConnection(creds = {}) {
  try {
    const session = await getSession(creds);
    const spotCfg = INDEX_SPOT_QUERY.NIFTY;
    const quoteMap = await fetchQuotesBatched(session, [{ exchSeg: spotCfg.exchSeg, query: spotCfg.name }]);
    const q = quoteMap.get(`${spotCfg.exchSeg}|${spotCfg.name}`);
    if (!q) {
      return { status: "error", message: "Kotak Neo login succeeded but the NIFTY spot quote check failed — check credentials/session." };
    }
    return { status: "success", message: "Kotak Securities (Neo) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const session = await getSession(creds);
  const rows = await getOptionRows(session, symbol);
  return { status: "success", data: distinctExpiriesAscending(rows) };
}

async function fetchSpot(session, symbol) {
  const cfg = INDEX_SPOT_QUERY[symbol];
  if (!cfg) throw new Error(`Unknown index: ${symbol}`);
  const quoteMap = await fetchQuotesBatched(session, [{ exchSeg: cfg.exchSeg, query: cfg.name }]);
  const q = quoteMap.get(`${cfg.exchSeg}|${cfg.name}`);
  return parseQuote(q).ltp;
}

export async function fetchLTP(creds, symbol) {
  const session = await getSession(creds);
  const lastPrice = await fetchSpot(session, symbol);
  return { status: "success", data: { last_price: lastPrice } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const session = await getSession(creds);

  let rows = await getOptionRows(session, symbol);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const targetExpiry = expiry || distinctExpiriesAscending(rows)[0];
  if (!targetExpiry) return { status: "success", data: { oc: {}, last_price: 0 } };

  rows = rows.filter((r) => r.expiry === targetExpiry);
  if (rows.length === 0) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await fetchSpot(session, symbol);
  const daysToExpiry = daysBetween(new Date(), targetExpiry);

  const quoteTargets = rows.map((r) => ({ exchSeg: r.exchSeg, query: r.token }));
  const quoteMap = await fetchQuotesBatched(session, quoteTargets);

  const oc = {};
  for (const row of rows) {
    const q = quoteMap.get(`${row.exchSeg}|${row.token}`);
    if (!q) continue; // token not returned by the quote call — skip this leg

    const { ltp, oi, volume, bid, ask } = parseQuote(q);
    const type = row.type === "ce" ? "CE" : "PE";
    const greeks = computeIVAndGreeks({ ltp, spot, strike: row.strike, daysToExpiry, type });

    const strikeKey = String(row.strike);
    if (!oc[strikeKey]) oc[strikeKey] = {};
    oc[strikeKey][row.type] = {
      last_price: ltp,
      oi,
      volume,
      ...greeks,
      bid_price: bid,
      ask_price: ask,
    };
  }

  return { status: "success", data: { oc, last_price: spot } };
}
