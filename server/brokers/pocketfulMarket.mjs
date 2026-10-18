/**
 * Pocketful market data (official docs, checked 2026-10, https://api.pocketful.in/docs/curl/):
 *  - LTP: GET /api/v1/marketdata/{exchange}/Capital?token=&key=last_trade_price -> { data: <number> } (get-last-traded-price).
 *  - Quote: GET /api/v1/marketdata/{exchange}/Capital?token= (cash) and .../FutOpt?token= (derivatives; route from the
 *    official SDK, "api.fnodata") -> data { last_trade_price, open_price, high_price, low_price, close_price,
 *    trade_volume, bid_price, ask_price, ... }. In the docs' sample, bid/ask (1285/1290) are in paise while every other
 *    price (12.9) is in rupees; a bid/ask more than 20x the LTP is therefore treated as paise and divided by 100.
 *    Data APIs allow 10 requests a second, so quotes are fetched 5 at a time with a 600 ms gap.
 *  - Option chain: GET /api/v1/optionchain/NFO returns contract tokens and close prices only (no live data), so strikes
 *    come from the contract master and prices from the feed (pocketfulWs.mjs: LTP, OI, volume, best bid/ask). IV and
 *    greeks are computed locally (Black-Scholes).
 *  - History: POST /api/data/v1/historical { symbol, product_type futures|options, type CE|PE, strike_price, expiry_date,
 *    interval "1minute", from_date, to_date } -> data[] { timestamp, open, high, low, close, volume, open_interest }.
 *    Documented for F&O contracts only, 1-minute only. The sample stamps (09:15:00Z for the market open) are IST wall
 *    clock written with a Z, so the wall-clock time is read as IST.
 */

import { BrokerError, BrokerInputError } from "./contract.mjs";
import { pfRequest } from "./pocketfulAuth.mjs";
import { distinctExpiries, findByRef, getInstruments, optionRows, resolveUnderlying, spotRow } from "./pocketfulInstruments.mjs";
import { subscribeAndCollect, tickKey } from "./pocketfulWs.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

const IST_MS = 5.5 * 3600_000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || v === "" ? null : num(v));
const segmentOf = (exchange) => (exchange === "NSE" || exchange === "BSE" ? "Capital" : "FutOpt");

export async function fetchInstruments() {
  const rows = await getInstruments();
  return { status: "success", data: rows.map(({ exchangeCode: _c, ...r }) => r) };
}

export async function fetchExpiryList(_creds, symbol) {
  return { status: "success", data: distinctExpiries(await optionRows(symbol)) };
}

async function ltpOf(creds, row) {
  const json = await pfRequest(creds, `/api/v1/marketdata/${row.exchange}/${segmentOf(row.exchange)}`, { query: { token: row.token, key: "last_trade_price" } });
  return num(json?.data);
}

export async function fetchLTP(creds, symbol) {
  const spot = await spotRow(symbol);
  const last_price = await ltpOf(creds, spot);
  if (!(last_price > 0)) throw new BrokerError(`Pocketful returned no price for ${spot.underlying}`);
  return { status: "success", data: { last_price } };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const u = resolveUnderlying(symbol);
  const rows = await optionRows(u.symbol);
  const target = expiry || distinctExpiries(rows)[0];
  const legs = rows.filter((r) => r.expiry === target);
  if (!legs.length) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = await spotRow(u.symbol);
  const spotKey = tickKey(spot.exchangeCode, spot.token);
  const ticks = await subscribeAndCollect(creds, [...legs.map((r) => tickKey(r.exchangeCode, r.token)), spotKey]);
  const spotPrice = num(ticks.get(spotKey)?.lastTradedPrice) || (await ltpOf(creds, spot).catch(() => 0));
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of legs) {
    const t = ticks.get(tickKey(r.exchangeCode, r.token));
    if (!t) continue; // no tick in the window: omit the leg rather than fake zeros
    const ltp = num(t.lastTradedPrice);
    (oc[String(r.strike)] ||= {})[r.optionType === "CE" ? "ce" : "pe"] = {
      last_price: ltp,
      oi: num(t.currentOpenInterest),
      // Missing or 0 means "not sent" on this feed; reporting 0 would show the whole OI as today's change.
      ...(num(t.initialOpenInterest) > 0 ? { previous_oi: num(t.initialOpenInterest) } : {}),
      volume: num(t.tradeVolume),
      bid_price: num(t.bestBidPrice),
      ask_price: num(t.bestAskPrice),
      security_id: r.token,
      ...computeIVAndGreeks({ ltp, spot: spotPrice, strike: r.strike, daysToExpiry: days, type: r.optionType }),
    };
  }
  return { status: "success", data: { oc, last_price: spotPrice } };
}

/** The docs' sample quotes bid/ask in paise beside rupee prices; scale only when that is evidently the case. */
export function fixPaise(price, ltp) {
  const p = num(price);
  return ltp > 0 && p > ltp * 20 ? p / 100 : p;
}

export function toQuote(row, d) {
  const ltp = num(d?.last_trade_price);
  return {
    token: row.token,
    exchange: row.exchange,
    ltp,
    open: numOrNull(d?.open_price),
    high: numOrNull(d?.high_price),
    low: numOrNull(d?.low_price),
    close: numOrNull(d?.close_price),
    volume: numOrNull(d?.trade_volume),
    oi: numOrNull(d?.open_interest ?? d?.oi),
    bid: d?.bid_price === undefined ? null : fixPaise(d.bid_price, ltp),
    ask: d?.ask_price === undefined ? null : fixPaise(d.ask_price, ltp),
  };
}

export async function fetchQuotes(creds, refs = []) {
  if (refs.length > 50) throw new BrokerInputError("Pocketful: at most 50 instruments per quote request");
  const rows = [];
  for (const ref of refs) {
    const row = await findByRef(ref);
    if (!row) throw new BrokerInputError(`Pocketful: unknown instrument ${ref?.exchange}:${ref?.token}`);
    rows.push(row);
  }
  const chunks = await batchWithDelay(rows, 5, 600, (chunk) =>
    Promise.all(chunk.map(async (r) => {
      const json = await pfRequest(creds, `/api/v1/marketdata/${r.exchange}/${segmentOf(r.exchange)}`, { query: { token: r.token } });
      return toQuote(r, json?.data);
    })),
  );
  return { status: "success", data: chunks.flat().filter((q) => q.ltp > 0 || q.close !== null) };
}

/** "2026-10-16T09:15:00Z" read as IST wall clock -> epoch seconds. */
export function istStampToSec(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s ?? ""));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - IST_MS) / 1000);
}

/** Request bound -> "YYYY-MM-DDTHH:mm:ss" in IST. */
export function toIstLocal(v) {
  let ms;
  if (typeof v === "number") ms = v < 1e11 ? v * 1000 : v;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) ms = Date.parse(`${v}T00:00:00+05:30`);
  else ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) throw new BrokerInputError(`Pocketful: bad date ${v}`);
  return new Date(ms + IST_MS).toISOString().slice(0, 19);
}

export async function fetchHistorical(creds, { instrument, interval = "1m", from, to } = {}) {
  if (interval !== "1m") throw new BrokerInputError("Pocketful: the historical API documents 1-minute candles only");
  const row = await findByRef(instrument);
  if (!row || (row.exchange !== "NFO")) throw new BrokerInputError("Pocketful: historical data is documented for NFO futures and options only");
  const isOpt = row.instrumentType.startsWith("OPT");
  const body = {
    symbol: row.underlying,
    product_type: isOpt ? "options" : "futures",
    ...(isOpt ? { type: row.optionType, strike_price: row.strike } : {}),
    expiry_date: row.expiry,
    interval: "1minute",
    from_date: toIstLocal(from),
    to_date: toIstLocal(to ?? Date.now()),
  };
  const json = await pfRequest(creds, "/api/data/v1/historical", { method: "POST", body });
  const bars = [];
  for (const c of Array.isArray(json?.data) ? json.data : []) {
    const time = istStampToSec(c.timestamp);
    if (!time) continue;
    bars.push({ time, open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume), ...(c.open_interest !== undefined ? { oi: num(c.open_interest) } : {}) });
  }
  bars.sort((a, b) => a.time - b.time);
  return { status: "success", data: bars.filter((c, i) => i === 0 || c.time > bars[i - 1].time) };
}
