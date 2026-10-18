/**
 * Fyers API v3 adapter (contract v1, server/brokers/contract.mjs).
 *
 * Auth (contract kind "oauthRedirect"): the user creates an app (App ID + secret), logs in on Fyers'
 * own page (GET /api/v3/generate-authcode), exchanges the auth code there (POST /api/v3/validate-authcode
 * with appIdHash = SHA-256 of "app_id:app_secret") and pastes the resulting access token. Every request
 * then sends `Authorization: <appId>:<accessToken>`. Tokens die daily at 6:30 AM IST; a -8/-15/-16/-17
 * rejection becomes SessionRequiredError (422), so the user pastes a fresh token. No password, PIN or TOTP
 * ever reaches this server.
 *
 * Market data (official docs https://fyers.in/api-docs/v3/api/market-data/):
 *  - Option chain: GET /data/options-chain-v3?symbol&strikecount (max 50 per side)&greeks=1[&timestamp].
 *    One call returns CE/PE legs with LTP, bid/ask, volume, OI, OI change and broker greeks (IV in percent),
 *    plus expiryData. For a non-nearest expiry the expiry's epoch from expiryData is passed as `timestamp`
 *    and the returned tickers are checked against the requested expiry (fyersChain.checkChainExpiry);
 *    a mismatch is refused rather than shown as the wrong chain. The docs only describe `timestamp` as
 *    "Options chain data at timestamp", so this path needs live confirmation (see checklist).
 *  - Quotes: GET /data/quotes?symbols=a,b (50 per call, no OI); depth: GET /data/depth?symbol&ohlcv_flag=1
 *    (one symbol, with OI); history: GET /data/history (resolutions 1..240 minutes, 1D; 100 days per
 *    intraday request, 366 per daily request).
 *  - Rate limits (Standard plan): Data APIs 5/s, 50/min, 5,000/day. Quote batches are paced at 250 ms.
 * The streaming data socket (protobuf) is not wired in v1; `feed` is not declared.
 */

import { BrokerInputError } from "./contract.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { buildOptionsChain, checkChainExpiry, parseExpiryData } from "./fyersChain.mjs";
import { fyersRequest, num, numOrNull } from "./fyersClient.mjs";
import { getFoInstruments } from "./fyersInstruments.mjs";
import { ORDER_FEATURES } from "./fyersOrders.mjs";

export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder, fetchOrderBook, getOrderStatus, fetchTradeBook } from "./fyersOrders.mjs";
export { fetchPositions, fetchHoldings, fetchFunds } from "./fyersPortfolio.mjs";
export { normaliseError } from "./fyersClient.mjs";

export const id = "fyers";
export const credentialFields = ["appId", "secretKey", "accessToken"];

export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "oauthRedirect" },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  depth: true,
  historical: { intervals: ["1m", "3m", "5m", "15m", "30m", "60m", "1d"] },
  positions: true,
  holdings: true,
  funds: true,
  orderBook: true,
  tradeBook: true,
  placeOrder: true,
  modifyOrder: true,
  cancelOrder: true,
  normaliseError: true,
};

/** Index tickers, confirmed against Fyers' public NSE_CM.csv / BSE_CM.csv symbol masters. */
export const INDEX_SYMBOL_MAP = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX",
  MIDCPNIFTY: "NSE:MIDCPNIFTY-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
  BANKEX: "BSE:BANKEX-INDEX",
};

/** Underlying name used inside option tickers (NSE:NIFTY26OCT25000CE -> "NIFTY"). */
const OPTION_ROOT = { NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY", MIDCPNIFTY: "MIDCPNIFTY", SENSEX: "SENSEX", BANKEX: "BANKEX" };

/**
 * App symbol -> { ticker, root }. Indices use INDEX_SYMBOL_MAP; any other plain NSE symbol is treated as
 * a stock underlying ("RELIANCE" -> "NSE:RELIANCE-EQ"), which options-chain-v3 accepts (docs example NSE:TCS-EQ).
 */
export function resolveUnderlying(symbol) {
  const s = String(symbol ?? "").trim().toUpperCase();
  if (INDEX_SYMBOL_MAP[s]) return { ticker: INDEX_SYMBOL_MAP[s], root: OPTION_ROOT[s] };
  if (/^[A-Z0-9&-]{1,20}$/.test(s)) return { ticker: `NSE:${s}-EQ`, root: s };
  throw new BrokerInputError(`Fyers: unknown symbol ${symbol}`);
}

async function rawChain(creds, symbol, { strikecount = 50, timestamp } = {}) {
  const { ticker, root } = resolveUnderlying(symbol);
  const query = { symbol: ticker, strikecount: String(Math.max(1, Math.min(strikecount, 50))), greeks: "1" };
  if (timestamp) query.timestamp = String(timestamp);
  const json = await fyersRequest(creds, "/data/options-chain-v3", { query });
  return { data: json.data || {}, root };
}

export async function testConnection(creds = {}) {
  try {
    // GET /api/v3/profile: the docs' own "check that your access token works" call.
    await fyersRequest(creds, "/api/v3/profile");
    return { status: "success", message: "Fyers API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const { data } = await rawChain(creds, symbol, { strikecount: 1 });
  return { status: "success", data: parseExpiryData(data.expiryData).map((e) => e.iso) };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  let { data, root } = await rawChain(creds, symbol, { strikecount: 50 });
  const expiries = parseExpiryData(data.expiryData);
  const nearest = expiries[0]?.iso;
  const target = expiry || nearest;
  if (!target) return { status: "success", data: { oc: {}, last_price: 0 } };
  if (target !== nearest) {
    const match = expiries.find((e) => e.iso === target);
    if (!match?.epoch) throw new BrokerInputError(`Fyers does not list expiry ${target} for ${symbol}.`);
    ({ data } = await rawChain(creds, symbol, { strikecount: 50, timestamp: match.epoch }));
  }
  const rows = Array.isArray(data.optionsChain) ? data.optionsChain : [];
  if (!rows.some((r) => r?.option_type === "CE" || r?.option_type === "PE")) {
    return { status: "success", data: { oc: {}, last_price: 0 } };
  }
  if (!checkChainExpiry(rows, { underlying: root, expiryIso: target, expiries })) {
    throw new BrokerInputError(`Fyers returned a chain for a different expiry than ${target}; refusing to show it.`);
  }
  const daysToExpiry = daysBetween(new Date(), target);
  return { status: "success", data: buildOptionsChain(rows, { daysToExpiry, computeIVAndGreeks }) };
}

/** Quotes for Fyers tickers. Returns Map<ticker, v>. 50 symbols per call (Standard plan), paced for 5 req/s. */
async function quoteMap(creds, tickers) {
  const map = new Map();
  const chunks = await batchWithDelay(tickers, 50, 250, async (chunk) => {
    const json = await fyersRequest(creds, "/data/quotes", { query: { symbols: chunk.join(",") } });
    return json.d || [];
  });
  for (const rows of chunks) for (const r of rows) if (r?.s === "ok" && r.n) map.set(r.n, r.v || {});
  return map;
}

export async function fetchLTP(creds, symbol) {
  const { ticker } = resolveUnderlying(symbol);
  const json = await fyersRequest(creds, "/data/quotes", { query: { symbols: ticker } });
  const row = (json.d || []).find((r) => r?.n === ticker) || (json.d || [])[0];
  const lp = num(row?.v?.lp);
  if (!(lp > 0)) throw new Error(`Fyers quotes returned no LTP for ${symbol} (${ticker})`);
  return { status: "success", data: { last_price: lp } };
}

/** refs: [{ token: "<Fyers ticker>", exchange }]. OI is not part of /data/quotes (use fetchDepth). */
export async function fetchQuotes(creds, refs = []) {
  const list = (Array.isArray(refs) ? refs : []).filter((r) => r && typeof r.token === "string" && r.token.includes(":"));
  if (!list.length) return { status: "success", data: [] };
  const map = await quoteMap(creds, [...new Set(list.map((r) => r.token))]);
  const data = [];
  for (const ref of list) {
    const v = map.get(ref.token);
    if (!v) continue;
    data.push({
      token: ref.token,
      exchange: ref.exchange,
      ltp: num(v.lp),
      open: numOrNull(v.open_price),
      high: numOrNull(v.high_price),
      low: numOrNull(v.low_price),
      close: numOrNull(v.prev_close_price),
      volume: numOrNull(v.volume),
      oi: null,
      bid: numOrNull(v.bid),
      ask: numOrNull(v.ask),
    });
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  const ticker = String(ref?.token ?? "");
  if (!ticker.includes(":")) throw new BrokerInputError("Fyers depth needs a ticker token like NSE:SBIN-EQ");
  const json = await fyersRequest(creds, "/data/depth", { query: { symbol: ticker, ohlcv_flag: "1" } });
  const d = json.d?.[ticker] || Object.values(json.d || {})[0] || {};
  const level = (l) => ({ price: num(l?.price), qty: num(l?.volume), orders: numOrNull(l?.ord) });
  return { status: "success", data: { bids: (d.bids || []).map(level), asks: (d.ask || []).map(level) } };
}

const RESOLUTION = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "60m": "60", "1d": "1D" };

function toEpochSec(v) {
  const s = String(v ?? "");
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00+05:30`) : Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const ticker = String(instrument?.token ?? "");
  const resolution = RESOLUTION[interval];
  if (!ticker.includes(":")) throw new BrokerInputError("Fyers history needs a ticker token like NSE:SBIN-EQ");
  if (!resolution) throw new BrokerInputError(`Fyers history does not support interval ${interval}`);
  const fromSec = toEpochSec(from);
  const toSec = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? toEpochSec(to) + 86399 : toEpochSec(to);
  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || toSec <= fromSec) throw new BrokerInputError("Fyers history needs a valid from/to range");
  const maxDays = resolution === "1D" ? 366 : 100;
  if ((toSec - fromSec) / 86400 > maxDays) throw new BrokerInputError(`Fyers allows at most ${maxDays} days per ${interval} history request`);
  const query = { symbol: ticker, resolution, date_format: "0", range_from: String(fromSec), range_to: String(toSec), cont_flag: "1" };
  const json = await fyersRequest(creds, "/data/history", { query });
  const seen = new Set();
  const data = [];
  for (const c of json.candles || []) {
    const time = Math.floor(Number(c?.[0]));
    if (!Number.isFinite(time) || seen.has(time)) continue;
    seen.add(time);
    const candle = { time, open: num(c[1]), high: num(c[2]), low: num(c[3]), close: num(c[4]), volume: num(c[5]) };
    if (c.length > 6) candle.oi = num(c[6]);
    data.push(candle);
  }
  data.sort((a, b) => a.time - b.time);
  return { status: "success", data };
}

/** NSE + BSE F&O instruments from the public symbol master (no auth needed, cached daily). */
export async function fetchInstruments() {
  return { status: "success", data: await getFoInstruments() };
}
