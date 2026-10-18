/**
 * Samco Trade API v3.2 — market data (official docs, checked 2026-10, https://docs-tradeapi.samco.in/):
 *  - Option chain (native): GET /option/optionChain?exchange&searchSymbolName&expiryDate(yyyy-MM-dd)
 *    -> optionChainDetails[] { tradingSymbol, symbol, strikePrice, expiryDate, optionType, spotPrice,
 *    lastTradedPrice, openInterest, openInterestChange, volume, impliedVolatility (percent, "13.1337"),
 *    delta, gamma, theta, vega, bestBids[{price}], bestAsks[{price}] }. Exchange NFO by default, BFO for
 *    SENSEX/BANKEX. If the native call returns no rows for the expiry, the chain is rebuilt from the scrip
 *    master + POST /quote/multiQuote (no greeks there, so they are computed locally).
 *  - Index spot: GET /quote/indexQuote?indexName -> indexDetails[0].spotPrice.
 *  - Equity LTP: GET /quote/getQuote?exchange&symbolName -> quoteDetails.lastTradedPrice.
 *  - Quotes: POST /quote/multiQuote { NSE: [names], NFO: [tradingSymbols], ... } -> multiQuotes[] keyed by `symbol`
 *    (the symbolCode). 25 symbols per call, paced at 250 ms: the docs give no number; this mirrors the limits
 *    other integrations use and stays well inside them.
 *  - Depth: POST /marketDepth { exchange, symbolName } -> MarketDepthDetails.marketDepth.bestFiveBid/bestFiveAsk.
 *  - History: GET /intraday/candleData (1-minute bars; interval defaults to 1 min, other values are not
 *    documented) and GET /history/candleData (daily). Indices use /intraday/indexCandleData and
 *    /history/indexCandleData with indexName. Candle times are IST wall-clock strings.
 * Numbers arrive as strings and may carry thousands separators ("1,550.00"); `num` strips them.
 */

import { BrokerInputError } from "./contract.mjs";
import { getSession, samcoRequest } from "./samcoAuth.mjs";
import { INDEX, distinctExpiries, findByToken, getInstruments, optionRows, resolveUnderlying } from "./samcoInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

const QUOTE_BATCH = 25;
const QUOTE_DELAY_MS = 250;
const IST_MS = 5.5 * 3600_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : num(v));

// ── spot / ltp ──

export async function indexSpot(creds, indexName) {
  const json = await samcoRequest(creds, "/quote/indexQuote", { query: { indexName } });
  return num(json?.indexDetails?.[0]?.spotPrice);
}

export async function equityLtp(creds, symbolName, exchange = "NSE") {
  const json = await samcoRequest(creds, "/quote/getQuote", { query: { exchange, symbolName } });
  return num(json?.quoteDetails?.lastTradedPrice);
}

export async function fetchLTP(creds, symbol) {
  const u = resolveUnderlying(symbol);
  const last_price = u.isIndex ? await indexSpot(creds, u.indexName) : await equityLtp(creds, u.symbol);
  return { status: "success", data: { last_price } };
}

// ── expiries + option chain ──

export async function fetchExpiryList(creds, symbol) {
  // Session first: a logged-out caller must not trigger the instrument-master download.
  await getSession(creds);
  return { status: "success", data: distinctExpiries(await optionRows(symbol)) };
}

/** One native optionChainDetails row -> Dhan-shaped leg. */
export function nativeLeg(r) {
  return {
    last_price: num(r.lastTradedPrice),
    oi: num(r.openInterest),
    oi_chg: num(r.openInterestChange),
    volume: num(r.volume),
    iv: num(r.impliedVolatility),
    delta: num(r.delta),
    gamma: num(r.gamma),
    theta: num(r.theta),
    vega: num(r.vega),
    bid_price: num(r.bestBids?.[0]?.price),
    ask_price: num(r.bestAsks?.[0]?.price),
    security_id: String(r.symbol ?? ""),
  };
}

export function chainFromNative(details, expiry) {
  const oc = {};
  let spot = 0;
  for (const r of Array.isArray(details) ? details : []) {
    if (expiry && r.expiryDate && String(r.expiryDate).slice(0, 10) !== expiry) continue;
    const side = r.optionType === "CE" ? "ce" : r.optionType === "PE" ? "pe" : null;
    const strike = num(r.strikePrice);
    if (!side || !(strike > 0)) continue;
    const key = String(strike);
    (oc[key] ||= {})[side] = nativeLeg(r);
    if (!spot && num(r.spotPrice) > 0) spot = num(r.spotPrice);
  }
  return { oc, spot };
}

/** Batched multiQuote over instrument rows of one exchange -> Map<symbolCode, quote>. */
async function multiQuote(creds, rows) {
  const byExchange = new Map();
  for (const r of rows) {
    const list = byExchange.get(r.exchange) || [];
    list.push(r.exchange === "NSE" || r.exchange === "BSE" ? r.name : r.tradingSymbol);
    byExchange.set(r.exchange, list);
  }
  const out = new Map();
  for (const [exchange, names] of byExchange) {
    const chunks = await batchWithDelay(names, QUOTE_BATCH, QUOTE_DELAY_MS, async (chunk) => {
      const json = await samcoRequest(creds, "/quote/multiQuote", { method: "POST", body: { [exchange]: chunk }, read: true });
      return json?.multiQuotes || [];
    });
    for (const list of chunks) for (const q of list) if (q?.symbol) out.set(String(q.symbol), q);
  }
  return out;
}

async function chainFromMaster(creds, symbol, expiry, spot) {
  const rows = (await optionRows(symbol)).filter((r) => r.expiry === expiry);
  const quotes = await multiQuote(creds, rows);
  const days = daysBetween(new Date(), expiry);
  const oc = {};
  for (const r of rows) {
    const q = quotes.get(r.symbolCode);
    if (!q) continue;
    const ltp = num(q.lastTradePrice);
    (oc[String(r.strike)] ||= {})[r.optionType === "CE" ? "ce" : "pe"] = {
      last_price: ltp,
      oi: num(q.openInterest),
      ...(q.previousOpenInterest !== undefined ? { previous_oi: num(q.previousOpenInterest) } : {}),
      volume: num(q.totalTradeVolume),
      bid_price: num(q.bidPrice),
      ask_price: num(q.askPrice),
      security_id: r.symbolCode,
      ...computeIVAndGreeks({ ltp, spot, strike: r.strike, daysToExpiry: days, type: r.optionType }),
    };
  }
  return oc;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const u = resolveUnderlying(symbol);
  const target = expiry || distinctExpiries(await optionRows(u.symbol))[0];
  if (!target) return { status: "success", data: { oc: {}, last_price: 0 } };
  if (!ISO_DATE.test(target)) throw new BrokerInputError(`Samco: expiry must be YYYY-MM-DD (got ${target})`);
  const json = await samcoRequest(creds, "/option/optionChain", {
    query: { exchange: u.exchange, searchSymbolName: u.symbol, expiryDate: target },
    emptyOk: true,
  });
  let { oc, spot } = chainFromNative(json?.optionChainDetails, target);
  if (!(spot > 0)) spot = u.isIndex ? await indexSpot(creds, u.indexName) : await equityLtp(creds, u.symbol);
  if (Object.keys(oc).length === 0) oc = await chainFromMaster(creds, u.symbol, target, spot);
  return { status: "success", data: { oc, last_price: spot } };
}

// ── quotes / depth ──

const INDEX_NAMES = new Set(Object.values(INDEX).map((v) => v.indexName));

async function resolveRef(ref) {
  const token = String(ref?.token ?? "");
  const row = await findByToken(token);
  if (!row) throw new BrokerInputError(`Samco: unknown instrument token ${token} (use the symbolCode from the scrip master)`);
  return row;
}

export async function fetchQuotes(creds, refs = []) {
  const rows = [];
  for (const ref of refs) {
    if (INDEX_NAMES.has(String(ref?.token))) continue; // index spots: use fetchLTP (indexQuote)
    rows.push(await resolveRef(ref));
  }
  const quotes = await multiQuote(creds, rows);
  const data = rows
    .map((r) => {
      const q = quotes.get(r.symbolCode);
      if (!q) return null;
      return {
        token: r.token,
        exchange: r.exchange,
        ltp: num(q.lastTradePrice),
        open: numOrNull(q.open),
        high: numOrNull(q.high),
        low: numOrNull(q.low),
        close: numOrNull(q.previousClose ?? q.close),
        volume: numOrNull(q.totalTradeVolume),
        oi: numOrNull(q.openInterest),
        bid: numOrNull(q.bidPrice),
        ask: numOrNull(q.askPrice),
      };
    })
    .filter(Boolean);
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  const r = await resolveRef(ref);
  const symbolName = r.instrumentType === "EQ" ? r.name : r.tradingSymbol;
  const json = await samcoRequest(creds, "/marketDepth", { method: "POST", body: { exchange: r.exchange, symbolName }, read: true });
  const d = json?.MarketDepthDetails?.marketDepth || {};
  const level = (price, qty, orders) => ({ price: num(price), qty: num(qty), orders: numOrNull(orders) });
  return {
    status: "success",
    data: {
      bids: (d.bestFiveBid || []).map((b) => level(b.bidPrice, b.bidSize, b.bidNumber)),
      asks: (d.bestFiveAsk || []).map((a) => level(a.askPrice, a.askSize, a.askNumber)),
    },
  };
}

// ── history ──

/** "2026-10-16 09:15:00" or "2026-10-16" (IST wall clock) -> epoch seconds. */
export function istToEpochSec(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s ?? "").trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", se = "0"] = m;
  return Math.round((Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - IST_MS) / 1000);
}

/** Request bound -> IST "yyyy-MM-dd HH:mm:ss". Accepts "YYYY-MM-DD", ISO datetimes or epoch seconds. */
export function toIstStamp(v) {
  let ms;
  if (typeof v === "number") ms = v < 1e11 ? v * 1000 : v;
  else if (ISO_DATE.test(String(v))) ms = Date.UTC(...String(v).split("-").map((x, i) => (i === 1 ? +x - 1 : +x))) - IST_MS;
  else ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) throw new BrokerInputError(`Samco: bad date ${v}`);
  const d = new Date(ms + IST_MS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function toCandles(list, timeKey) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const time = istToEpochSec(c[timeKey]);
    if (!time) continue;
    out.push({ time, open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume) });
  }
  out.sort((a, b) => a.time - b.time);
  return out.filter((c, i) => i === 0 || c.time > out[i - 1].time);
}

export async function fetchHistorical(creds, { instrument, interval = "1m", from, to } = {}) {
  if (interval !== "1m" && interval !== "1d") throw new BrokerInputError("Samco: only 1-minute and daily candles are documented");
  const token = String(instrument?.token ?? "");
  const isIndex = INDEX_NAMES.has(token);
  let symbolName = token;
  let exchange = instrument?.exchange;
  if (!isIndex) {
    const r = await resolveRef(instrument);
    symbolName = r.instrumentType === "EQ" ? r.name : r.tradingSymbol;
    exchange = r.exchange;
  }
  const fromTs = toIstStamp(from);
  const toTs = to ? toIstStamp(to) : undefined;
  if (interval === "1m") {
    const path = isIndex ? "/intraday/indexCandleData" : "/intraday/candleData";
    const query = isIndex ? { indexName: symbolName, fromDate: fromTs, toDate: toTs } : { exchange, symbolName, fromDate: fromTs, toDate: toTs };
    const json = await samcoRequest(creds, path, { query, emptyOk: true });
    return { status: "success", data: toCandles(json?.intradayCandleData ?? json?.indexIntraDayCandleData ?? json?.indexCandleData, "dateTime") };
  }
  const path = isIndex ? "/history/indexCandleData" : "/history/candleData";
  const day = (s) => s?.slice(0, 10);
  const query = isIndex ? { indexName: symbolName, fromDate: day(fromTs), toDate: day(toTs) } : { exchange, symbolName, fromDate: day(fromTs), toDate: day(toTs) };
  const json = await samcoRequest(creds, path, { query, emptyOk: true });
  return { status: "success", data: toCandles(json?.historicalCandleData ?? json?.indexCandleData, "date") };
}

// ── instruments ──

export async function fetchInstruments() {
  const rows = await getInstruments();
  const data = rows.map(({ symbolCode: _s, name: _n, ...rest }) => rest);
  for (const [underlying, v] of Object.entries(INDEX)) {
    data.push({ token: v.indexName, exchange: v.exchange === "BFO" ? "BSE" : "NSE", tradingSymbol: v.indexName, underlying, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 });
  }
  return { status: "success", data };
}
