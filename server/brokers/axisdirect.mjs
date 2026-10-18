/**
 * Axis Direct (Axis Securities, "RAPID APIs") adapter on the broker contract (server/brokers/contract.mjs).
 * Partial: read-only market data and portfolio.
 *
 * Official source: https://documenter.getpostman.com/view/33771924/2sA3BkasEf (RAPID APIs by Axis Direct;
 * Axis's own page simplehai.axisdirect.in/RapidAPI links to it). Session, encryption and transport live in
 * axisdirectAuth.mjs / axisdirectCrypto.mjs, the security master in axisdirectInstruments.mjs.
 *
 * What the API offers and how it is used here:
 *  - Quotes: POST invest-api /feedbroadcast/multi-touch-line { securities: [{ scriptId }] } -> ltp, buyPrice,
 *    sellPrice, open/high/low/closePrice, volume, openInterest. There is no option-chain endpoint and no
 *    previous OI, so the chain is the master windowed to STRIKE_HALF_WIDTH strikes around spot, quoted in
 *    batches, with IV/Greeks solved locally. Spot uses the scriptId in the derivatives' `underlying` column.
 *  - Positions: /trading/portfolio/get-positions for segments EQ and FO; holdings: /trading/portfolio/v2/get-holdings;
 *    funds: funds-api /funds/inquiry/get-limits (segment EQ, the only value the docs show).
 *  - testConnection: GET /markettracking/tracking/get-market-status.
 *
 * Not declared, and why (official collection, checked 18 Oct 2026):
 *  - historical, feed: no candle or streaming endpoint is published.
 *  - depth: the Best 5 sample shows only quantity and noOfOrders per level, no price field.
 *  - orderBook / tradeBook: both samples are empty (206, data []), so the row fields are unknown.
 *  - placeOrder / modifyOrder / cancelOrder: the documented bodies need order-type and product codes beyond the
 *    one example ("RL", "DELIVERY") and, for modify/cancel, fields (omsOrderSerialNumber, scriptId, productType)
 *    that only the undocumented order book would supply. No order path is offered until those are confirmed.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { BrokerError, BrokerInputError, normaliseError as baseNormalise, redactSecrets } from "./contract.mjs";
import { FUNDS_HOST, TRADING_HOST, ensureSession, initiateLogin, rapidCall } from "./axisdirectAuth.mjs";
import { loadMaster } from "./axisdirectInstruments.mjs";

export const id = "axisdirect";
export const credentialFields = ["apiClientId", "authorizationKey", "ssoId"];

const LABEL = "Axis Direct";
const STRIKE_HALF_WIDTH = 20;
// No published limit; keep each multi-touch-line call small and pause between calls.
const QUOTE_BATCH = { size: 50, delayMs: 300 };
const CONTRACT_EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]);

export const capabilities = {
  auth: { kind: "requestTokenExchange" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "computed" },
  ltp: true,
  quotes: true,
  positions: true,
  holdings: true,
  funds: true,
  normaliseError: true,
};

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === undefined || v === null ? "" : String(v));
const listOf = (inner) => (Array.isArray(inner?.data) ? inner.data : []);

// ── market data ──

/** multi-touch-line for many scriptIds -> Map(scriptId -> raw quote). */
async function quoteMany(creds, scriptIds) {
  const ids = [...new Set(scriptIds.map(str).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += QUOTE_BATCH.size) {
    if (i > 0) await new Promise((r) => setTimeout(r, QUOTE_BATCH.delayMs));
    const chunk = ids.slice(i, i + QUOTE_BATCH.size);
    const inner = await rapidCall(creds, TRADING_HOST, "/feedbroadcast/multi-touch-line", { securities: chunk.map((scriptId) => ({ scriptId })) });
    for (const q of listOf(inner)) if (q && str(q.scriptId)) out.set(str(q.scriptId), q);
  }
  return out;
}

export function mapQuote(ref, q) {
  return {
    token: str(ref.token), exchange: ref.exchange, ltp: num(q.ltp), open: numOrNull(q.openPrice), high: numOrNull(q.highPrice), low: numOrNull(q.lowPrice),
    close: numOrNull(q.closePrice), volume: numOrNull(q.volume), oi: numOrNull(q.openInterest), bid: numOrNull(q.buyPrice), ask: numOrNull(q.sellPrice),
  };
}

async function master(creds) {
  await ensureSession(creds); // refuse before the 69 MB download when not logged in
  return loadMaster();
}

async function optionRows(creds, symbol) {
  const sym = str(symbol).toUpperCase();
  if (!sym) throw new BrokerInputError(`${LABEL}: symbol is required.`);
  const { instruments, spot } = await master(creds);
  return { sym, rows: instruments.filter((r) => r.underlying === sym && r.optionType), spotId: spot[sym] };
}

const expiriesOf = (rows) => [...new Set(rows.map((r) => r.expiry))].sort();

function strikeWindow(rows, spot, halfWidth) {
  const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
  if (!strikes.length) return [];
  let atm = 0;
  strikes.forEach((s, i) => { if (Math.abs(s - spot) < Math.abs(strikes[atm] - spot)) atm = i; });
  const keep = new Set(strikes.slice(Math.max(0, atm - halfWidth), atm + halfWidth + 1));
  return rows.filter((r) => keep.has(r.strike));
}

async function spotPrice(creds, sym, spotId) {
  if (!spotId) throw new BrokerInputError(`${LABEL}: no spot instrument found for ${sym}.`);
  const q = (await quoteMany(creds, [spotId])).get(str(spotId));
  const last = num(q?.ltp);
  if (!(last > 0)) throw new BrokerError(`${LABEL}: no last price for ${sym}.`);
  return last;
}

export async function testConnection(creds = {}) {
  try {
    const inner = await rapidCall(creds, TRADING_HOST, "/markettracking/tracking/get-market-status", null);
    const nse = listOf(inner).find((r) => r?.exchangeSegment === "NSE_FO");
    return { status: "success", message: `${LABEL} connected${nse ? ` (NSE F&O ${str(nse.marketStatus).toLowerCase()})` : ""}.` };
  } catch (e) {
    return { status: "error", message: normaliseError(e).message };
  }
}

export async function fetchInstruments(creds) {
  const { instruments } = await master(creds);
  return { status: "success", data: instruments };
}

export async function fetchExpiryList(creds, symbol) {
  const { rows } = await optionRows(creds, symbol);
  return { status: "success", data: expiriesOf(rows) };
}

export async function fetchLTP(creds, symbol) {
  const { sym, spotId } = await optionRows(creds, symbol);
  return { status: "success", data: { last_price: await spotPrice(creds, sym, spotId) } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const { sym, rows: all, spotId } = await optionRows(creds, symbol);
  const target = expiry || expiriesOf(all)[0];
  const rows = all.filter((r) => r.expiry === target);
  if (!rows.length) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = await spotPrice(creds, sym, spotId);
  const windowed = strikeWindow(rows, spot, STRIKE_HALF_WIDTH);
  const quotes = await quoteMany(creds, windowed.map((r) => r.token));
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of windowed) {
    const q = quotes.get(r.token);
    if (!q) continue;
    const ltp = num(q.ltp);
    const key = String(r.strike);
    oc[key] = oc[key] || {};
    oc[key][r.optionType === "CE" ? "ce" : "pe"] = {
      last_price: ltp, oi: num(q.openInterest), volume: num(q.volume), bid_price: num(q.buyPrice), ask_price: num(q.sellPrice), security_id: r.token,
      ...computeIVAndGreeks({ ltp, spot, strike: r.strike, daysToExpiry: days, type: r.optionType }),
    };
  }
  return { status: "success", data: { oc, last_price: spot } };
}

/** Quotes by { token: scriptId, exchange }. */
export async function fetchQuotes(creds, refs = []) {
  const list = (Array.isArray(refs) ? refs : []).filter((r) => r && r.token && CONTRACT_EXCHANGES.has(r.exchange));
  if (!list.length) return { status: "success", data: [] };
  const quotes = await quoteMany(creds, list.map((r) => r.token));
  return { status: "success", data: list.filter((r) => quotes.has(str(r.token))).map((r) => mapQuote(r, quotes.get(str(r.token)))) };
}

// ── portfolio ──

const DERIVATIVE = /^(OPT|FUT)/i;

/** Axis exchange + instrument -> contract exchange. */
function exchangeOf(row) {
  const ex = str(row.exchange || row.preferredExchange).toUpperCase();
  const deriv = DERIVATIVE.test(str(row.instrument));
  if (ex === "NSE") return deriv ? "NFO" : "NSE";
  if (ex === "BSE") return deriv ? "BFO" : "BSE";
  return ex;
}

function productOf(row, exchange) {
  const p = str(row.product).toUpperCase();
  if (p === "INTRADAY" || p === "INTRA" || p === "MIS") return "INTRADAY";
  if (p === "MTF") return "MTF";
  if (p === "DELIVERY" && (exchange === "NSE" || exchange === "BSE")) return "CNC";
  return "MARGIN";
}

export function mapPosition(r) {
  const exchange = exchangeOf(r);
  const realised = numOrNull(r.realizedPL);
  const unrealised = numOrNull(r.unrealizedPL);
  const overall = numOrNull(r.overallPL);
  return {
    tradingSymbol: str(r.symbol), exchange, token: str(r.scriptId), product: productOf(r, exchange), netQty: num(r.netQty),
    avgPrice: num(r.netPrice), ltp: null, pnl: overall ?? ((realised ?? 0) + (unrealised ?? 0)), realisedPnl: realised, unrealisedPnl: unrealised,
  };
}

export function mapHolding(h) {
  const infos = Array.isArray(h.securityInfo) ? h.securityInfo : [];
  const ref = infos.find((s) => str(s?.exchange).toUpperCase() === "NSE") ?? infos[0] ?? {};
  const ltp = num(h.ltp);
  return {
    tradingSymbol: str(ref.symbol), exchange: str(ref.exchange || "NSE").toUpperCase(), token: str(ref.scriptId), isin: h.isinCode ? str(h.isinCode) : null,
    qty: num(h.holdingQty) || num(h.totalFreeQty), avgPrice: num(h.avgPrice), ltp: ltp > 0 ? ltp : null, pnl: ltp > 0 ? num(h.pnl) : null,
  };
}

export function mapFunds(d) {
  const collateral = num(d?.marginAgainstCollateral);
  return {
    availableCash: num(d?.currentMarginAvailable),
    usedMargin: num(d?.marginUtilizedToday),
    totalBalance: numOrNull(d?.ledgerBalance),
    collateral: collateral || null,
    withdrawable: null,
  };
}

export async function fetchPositions(creds) {
  const rows = [];
  for (const segment of ["EQ", "FO"]) {
    rows.push(...listOf(await rapidCall(creds, TRADING_HOST, "/trading/portfolio/get-positions", { segment, interop: true, type: "all" })));
  }
  return { status: "success", data: rows.map(mapPosition).filter((p) => p.tradingSymbol && CONTRACT_EXCHANGES.has(p.exchange)) };
}

export async function fetchHoldings(creds) {
  const inner = await rapidCall(creds, TRADING_HOST, "/trading/portfolio/v2/get-holdings", { segment: "EQ" });
  const rows = Array.isArray(inner?.data?.holdingDetails) ? inner.data.holdingDetails : [];
  return { status: "success", data: rows.map(mapHolding).filter((h) => h.tradingSymbol && CONTRACT_EXCHANGES.has(h.exchange)) };
}

export async function fetchFunds(creds) {
  const inner = await rapidCall(creds, FUNDS_HOST, "/funds/inquiry/get-limits", { segment: "EQ" });
  return { status: "success", data: mapFunds(inner?.data) };
}

// ── errors ──

export function normaliseError(err, { secrets = [] } = {}) {
  if (err instanceof BrokerError && err.code === "AXIS_CRYPTO") {
    return { statusCode: 502, code: "UPSTREAM_ERROR", message: redactSecrets(err.message, secrets).slice(0, 240) };
  }
  return baseNormalise(err, { secrets });
}

/** SSO Initiate (login microsite URL + ssoId); needs a proxy route to be reachable from the app. */
export { initiateLogin };
