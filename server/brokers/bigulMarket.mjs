/**
 * Bigul market data. The REST API has no quote, chain or candle endpoint (https://connect.bigul.co/docs, checked
 * 2026-10), so every price comes from the market-data feed (bigulFeed.mjs) over master contracts
 * (bigulInstruments.mjs):
 *  - LTP: index keys ("if|nse_cm|Nifty 50", "if|bse_cm|SENSEX") or the NSE equity scrip key.
 *  - Quotes: scrip keys (LTP, OHLC, volume, OI, best bid/ask).
 *  - Depth: "dp|" keys, five levels a side.
 *  - Option chain: strikes and tokens from the master, prices from scrip keys. A chain is capped at the
 *    MAX_CHAIN_STRIKES strikes nearest the spot so one request stays within the SDK's 100-keys-per-frame batching and
 *    the per-socket subscription cap. IV and greeks are computed locally (Black-Scholes); OI change uses the master's
 *    previous-day OI.
 * Not available: historical candles (no endpoint documented).
 */

import { BrokerError, BrokerInputError } from "./contract.mjs";
import { getSession } from "./bigulAuth.mjs";
import { feedKey, getConnection, subscribe, subscribeAndCollect, unsubscribe } from "./bigulFeed.mjs";
import { distinctExpiries, findByRef, getInstruments, optionRows, resolveUnderlying, spotRow, toContractInstrument } from "./bigulInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export const MAX_CHAIN_STRIKES = 60;
const MAX_QUOTES = 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));

export async function fetchInstruments() {
  return { status: "success", data: (await getInstruments()).map(toContractInstrument) };
}

export async function fetchExpiryList(_creds, symbol) {
  return { status: "success", data: distinctExpiries(await optionRows(symbol)) };
}

export async function fetchLTP(creds, symbol) {
  getSession(creds); // not logged in -> SessionRequiredError before any download
  const spot = await spotRow(symbol);
  const key = feedKey(spot);
  const last_price = num((await subscribeAndCollect(creds, [key])).get(key)?.ltp);
  if (!(last_price > 0)) throw new BrokerError(`Bigul: no live price for ${spot.underlying} yet`);
  return { status: "success", data: { last_price } };
}

/** The `max` strikes nearest `spot` (or the middle ones when there is no spot yet). */
export function nearestStrikes(strikes, spot, max = MAX_CHAIN_STRIKES) {
  const sorted = [...new Set(strikes)].sort((a, b) => a - b);
  if (sorted.length <= max) return sorted;
  const centre = spot > 0 ? sorted.reduce((best, s, i) => (Math.abs(s - spot) < Math.abs(sorted[best] - spot) ? i : best), 0) : Math.floor(sorted.length / 2);
  const from = Math.min(Math.max(centre - Math.floor(max / 2), 0), sorted.length - max);
  return sorted.slice(from, from + max);
}

export function buildLeg(tick, row, spot, daysToExpiry) {
  const ltp = num(tick.ltp);
  const oi = num(tick.oi);
  return {
    last_price: ltp,
    oi,
    ...(row.prevOi > 0 ? { previous_oi: row.prevOi } : {}),
    volume: num(tick.volume),
    bid_price: num(tick.bid),
    ask_price: num(tick.ask),
    security_id: row.token,
    ...computeIVAndGreeks({ ltp, spot, strike: row.strike, daysToExpiry, type: row.optionType }),
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const u = resolveUnderlying(symbol);
  getSession(creds);
  const rows = await optionRows(u.symbol);
  const target = expiry || distinctExpiries(rows)[0];
  let legs = rows.filter((r) => r.expiry === target);
  if (!legs.length) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = await spotRow(u.symbol);
  const spotKey = feedKey(spot);
  let spotPrice = 0;
  if (new Set(legs.map((r) => r.strike)).size > MAX_CHAIN_STRIKES) {
    spotPrice = num((await subscribeAndCollect(creds, [spotKey], 2000)).get(spotKey)?.ltp);
    const keep = new Set(nearestStrikes(legs.map((r) => r.strike), spotPrice));
    legs = legs.filter((r) => keep.has(r.strike));
  }
  const ticks = await subscribeAndCollect(creds, [spotKey, ...legs.map((r) => feedKey(r))]);
  spotPrice = num(ticks.get(spotKey)?.ltp) || spotPrice;
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of legs) {
    const tick = ticks.get(feedKey(r));
    if (!tick || tick.ltp === undefined) continue; // no tick in the window: omit the leg rather than fake zeros
    (oc[String(r.strike)] ||= {})[r.optionType === "CE" ? "ce" : "pe"] = buildLeg(tick, r, spotPrice, days);
  }
  return { status: "success", data: { oc, last_price: spotPrice } };
}

export function toQuote(row, tick) {
  return {
    token: row.token,
    exchange: row.exchange,
    ltp: num(tick.ltp),
    open: numOrNull(tick.open),
    high: numOrNull(tick.high),
    low: numOrNull(tick.low),
    close: numOrNull(tick.close),
    volume: numOrNull(tick.volume),
    oi: numOrNull(tick.oi),
    bid: numOrNull(tick.bid),
    ask: numOrNull(tick.ask),
  };
}

async function rowsFor(refs) {
  const out = [];
  for (const ref of refs || []) {
    const row = await findByRef(ref);
    if (!row) throw new BrokerInputError(`Bigul: unknown instrument ${ref?.exchange}:${ref?.token}`);
    out.push(row);
  }
  return out;
}

export async function fetchQuotes(creds, refs = []) {
  getSession(creds);
  if (refs.length > MAX_QUOTES) throw new BrokerInputError(`Bigul: at most ${MAX_QUOTES} instruments per quote request`);
  const rows = await rowsFor(refs);
  const ticks = await subscribeAndCollect(creds, rows.map((r) => feedKey(r)));
  const data = rows.filter((r) => ticks.get(feedKey(r))?.ltp !== undefined).map((r) => toQuote(r, ticks.get(feedKey(r))));
  return { status: "success", data };
}

/** Depth tick -> contract Depth (levels with no price are dropped). */
export function toDepth(tick) {
  const side = (p, q, o) => [1, 2, 3, 4, 5]
    .map((i) => ({ price: num(tick[`${p}${i}`]), qty: num(tick[`${q}${i}`]), orders: numOrNull(tick[`${o}${i}`]) }))
    .filter((l) => l.price > 0);
  return { bids: side("bidPrice", "bidQty", "bidOrders"), asks: side("askPrice", "askQty", "askOrders") };
}

export async function fetchDepth(creds, ref) {
  getSession(creds);
  const [row] = await rowsFor([ref]);
  if (row.instrumentType === "INDEX") throw new BrokerInputError("Bigul: an index has no market depth");
  const key = feedKey(row, "dp");
  const tick = (await subscribeAndCollect(creds, [key])).get(key);
  if (!tick) throw new BrokerError(`Bigul: no depth received for ${row.tradingSymbol}`);
  return { status: "success", data: toDepth(tick) };
}

/** Live feed: subscribe(refs) takes contract { token, exchange } refs; ticks arrive as contract Quotes. */
export function createFeed(creds, { onTick, onStatus } = {}) {
  getSession(creds);
  const mine = new Map(); // feed key -> master row
  let entry = null;
  let closed = false;
  const tickFn = (key, tick) => { const row = mine.get(key); if (row && tick.ltp !== undefined) onTick?.(toQuote(row, tick)); };
  const statusFn = (s) => onStatus?.(s);
  const ready = getConnection(creds).then((e) => {
    entry = e;
    if (!closed) { e.tickListeners.add(tickFn); e.statusListeners.add(statusFn); onStatus?.({ connected: true }); }
    return e;
  });
  ready.catch((e) => onStatus?.({ connected: false, reason: e.message }));
  return {
    subscribe(refs) {
      rowsFor(refs).then(async (rows) => {
        const e = await ready;
        rows.forEach((r) => mine.set(feedKey(r), r));
        if (!closed) subscribe(e, rows.map((r) => feedKey(r)));
      }).catch((err) => onStatus?.({ connected: Boolean(entry?.connected), reason: err.message }));
    },
    unsubscribe(refs) {
      rowsFor(refs).then(async (rows) => {
        const e = await ready;
        const keys = rows.map((r) => feedKey(r));
        keys.forEach((k) => mine.delete(k));
        unsubscribe(e, keys);
      }).catch(() => {});
    },
    close() {
      closed = true;
      if (entry) { entry.tickListeners.delete(tickFn); entry.statusListeners.delete(statusFn); unsubscribe(entry, [...mine.keys()]); }
      mine.clear();
    },
  };
}
