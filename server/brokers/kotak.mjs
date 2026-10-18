/**
 * Kotak Securities (Neo Trade API v2) adapter on the broker contract (server/brokers/contract.mjs).
 *
 * Official source: Kotak's SDK and docs, https://github.com/Kotak-Neo/Kotak-neo-api-v2 (checked 2026-10), plus the
 * client migration guide on kotakneo.com. OpenAlgo (AGPL) was read for facts only.
 *
 *  - Auth: session login (MPIN + current TOTP code typed per session, never stored), kotakAuth.mjs.
 *  - Instruments: daily per-segment scrip-master CSVs (kotakInstruments.mjs).
 *  - Option chain: master + batched neosymbol quotes (kotakQuotes.mjs). Quotes carry OI and best bid/ask but no
 *    IV/Greeks, so those are solved locally with Black-Scholes.
 *  - Portfolio reads and gated orders: kotakPortfolio.mjs, kotakOrders.mjs.
 *  - Not declared: historical (no candle endpoint in Kotak's official SDK/docs), feed (HSWebSocket not wired here).
 */

import { BrokerError, normaliseError as baseNormalise } from "./contract.mjs";
import { getSession, LOGIN_FIELDS, SESSION_FIELDS } from "./kotakAuth.mjs";
import {
  assertSymbol, distinctExpiriesAscending, getOptionRows, getSegmentMaster, spotTargets, toInstrument,
} from "./kotakInstruments.mjs";
import * as quotes from "./kotakQuotes.mjs";
import * as portfolio from "./kotakPortfolio.mjs";
import { ORDER_FEATURES, gatedOrders } from "./kotakOrders.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const id = "kotak";
export const credentialFields = ["accessToken", "mobileNumber", "ucc"];

export const capabilities = {
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  depth: true,
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
  ...ORDER_FEATURES,
};

export { login } from "./kotakAuth.mjs";
export { buildOrderBody, buildModifyBody } from "./kotakOrders.mjs";

export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError) return base;
  if (/HTTP 429|too many/i.test(base.message)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  return base;
}

/** One cheap trade-session call (limits) proves the session is alive. */
export async function testConnection(creds = {}) {
  try {
    await portfolio.fetchFunds(getSession(creds));
    return { status: "success", message: "Kotak Securities (Neo) session authenticated" };
  } catch (e) {
    return { status: "error", message: normaliseError(e).message };
  }
}

export async function fetchInstruments(creds) {
  const session = getSession(creds);
  const data = [];
  for (const seg of ["nse_fo", "bse_fo"]) {
    for (const r of await getSegmentMaster(session, seg)) {
      const inst = toInstrument(r);
      if (inst) data.push(inst);
    }
  }
  return { status: "success", data };
}

export async function fetchExpiryList(creds, symbol) {
  const sym = assertSymbol(symbol);
  const session = getSession(creds);
  return { status: "success", data: distinctExpiriesAscending(await getOptionRows(session, sym)) };
}

async function spotPrice(session, symbol, rows) {
  const q = await quotes.fetchSpotQuote(session, spotTargets(symbol, rows));
  return q ? quotes.parseQuote(q).ltp : 0;
}

export async function fetchLTP(creds, symbol) {
  const sym = assertSymbol(symbol);
  const session = getSession(creds);
  const rows = spotTargets(sym).length ? [] : await getOptionRows(session, sym);
  const last_price = await spotPrice(session, sym, rows);
  if (!(last_price > 0)) throw new BrokerError(`Kotak Neo returned no last price for ${sym}.`);
  return { status: "success", data: { last_price } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const sym = assertSymbol(symbol);
  const session = getSession(creds);
  const all = await getOptionRows(session, sym);
  const target = expiry || distinctExpiriesAscending(all)[0];
  const rows = all.filter((r) => r.expiry === target);
  if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };

  const spot = await spotPrice(session, sym, all);
  const daysToExpiry = daysBetween(new Date(), target);
  const quoteMap = await quotes.fetchQuotesBatched(session, rows.map((r) => ({ exchSeg: r.exchSeg, query: r.token })));

  const oc = {};
  for (const row of [...rows].sort((a, b) => a.strike - b.strike)) {
    const q = quoteMap.get(`${row.exchSeg}|${row.token}`);
    const { ltp, oi, volume, bid, ask } = quotes.parseQuote(q);
    const greeks = computeIVAndGreeks({ ltp, spot, strike: row.strike, daysToExpiry, type: row.type === "ce" ? "CE" : "PE" });
    const key = String(row.strike);
    oc[key] = oc[key] || {};
    oc[key][row.type] = { last_price: ltp, oi, volume, bid_price: bid, ask_price: ask, ...greeks };
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export const fetchQuotes = async (creds, refs) => quotes.fetchQuotes(getSession(creds), refs);
export const fetchDepth = async (creds, ref) => quotes.fetchDepth(getSession(creds), ref);
export const fetchPositions = async (creds) => portfolio.fetchPositions(getSession(creds));
export const fetchHoldings = async (creds) => portfolio.fetchHoldings(getSession(creds));
export const fetchFunds = async (creds) => portfolio.fetchFunds(getSession(creds));
export const fetchOrderBook = async (creds) => portfolio.fetchOrderBook(getSession(creds));
export const fetchTradeBook = async (creds) => portfolio.fetchTradeBook(getSession(creds));

export const { placeOrder, modifyOrder, cancelOrder } = gatedOrders(getSession);
