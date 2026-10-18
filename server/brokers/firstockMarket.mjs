/**
 * Firstock market data: option chain, LTP, quotes, depth and candles.
 *
 * Official docs (https://firstock.in/api/docs/, checked 2026-10):
 *  - option-chain-with-greeks/ : POST /optionChainGreeks { userId, jKey, exchange: NFO|BFO, symbol, expiry
 *    "DDMONYY", count: "ALL" | n (max 30), strikePrice (when count is not ALL) } -> data[] { exchange,
 *    token, tradingSymbol, optionType, lotSize, tickSize, strikePrice, lastTradedPrice, parentToken, delta,
 *    gamma, theta, vega, rho, iv (percent, "14.25"), oi }. Broker Greeks and IV are used as sent; a leg
 *    without IV is solved locally (Black-Scholes).
 *  - get-multi-quote/ : POST /getMultiQuotes { userId, jKey, data: [{ exchange, tradingSymbol }] } ->
 *    data[] { exchange, tradingSymbol, token, lastTradedPrice, dayOpenPrice, dayHighPrice, dayLowPrice,
 *    dayClosePrice, openInterest, bestBuyPrice1..5, bestBuyQuantity1..5, bestBuyOrder1..5, bestSell... }.
 *    Quote calls are limited to 1 req/s (exception-errors/), so one chain refresh makes exactly one quote
 *    call: the spot plus a window of legs around the money for bid/ask.
 *    (The single /getQuote page shows prices in paise in its sample while /getMultiQuotes shows rupees;
 *    only /getMultiQuotes is used.)
 *  - time-price-regular-interval/ and time-price-day-interval/ : POST /timePriceSeries { exchange,
 *    tradingSymbol, interval "1mi" | "3mi" | ... | "1d", startTime/endTime "HH:MM:SS DD-MM-YYYY" } ->
 *    data[] { time, epochTime, open, high, low, close, volume, oi }. "1mi"/"2mi"/"5mi" and "1d" are in the
 *    docs; 3mi/15mi/30mi/60mi follow the same pattern (not in the official docs: needs live verification).
 */

import { BrokerInputError } from "./contract.mjs";
import { callApi, ensureSession } from "./firstockAuth.mjs";
import { derivativesFor, getFile, getIndexMap, listExpiries, optionContracts, chainExchange, spotTarget, isoToDdMonYy } from "./firstockInstruments.mjs";
import { batchWithDelay } from "../lib/batch.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 1050; // documented quote limit: 1 request per second
const BIDASK_HALF_WIDTH = 12; // strikes each side of the money; spot + 2 * 2 * 12 legs = 49 symbols, one call

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const key = (exchange, tradingSymbol) => `${String(exchange).toUpperCase()}:${String(tradingSymbol).toUpperCase()}`;

/** Batched /getMultiQuotes -> Map keyed by "EXCH:TRADINGSYMBOL" and "EXCH#token". */
export async function multiQuotes(creds, targets) {
  const map = new Map();
  if (!targets.length) return map;
  const chunks = await batchWithDelay(targets, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    const json = await callApi(creds, "/getMultiQuotes", { data: chunk.map((t) => ({ exchange: t.exchange, tradingSymbol: t.tradingSymbol })) });
    return Array.isArray(json?.data) ? json.data : [];
  });
  for (const rows of chunks) {
    for (const q of rows) {
      if (!q?.exchange) continue;
      if (q.tradingSymbol) map.set(key(q.exchange, q.tradingSymbol), q);
      if (q.token) map.set(`${String(q.exchange).toUpperCase()}#${q.token}`, q);
    }
  }
  return map;
}

function findQuote(map, t) {
  return map.get(key(t.exchange, t.tradingSymbol)) || (t.token ? map.get(`${String(t.exchange).toUpperCase()}#${t.token}`) : undefined);
}

export function mapQuote(ref, q) {
  return {
    token: String(ref.token || q?.token || ""),
    exchange: ref.exchange,
    ltp: num(q?.lastTradedPrice),
    open: numOrNull(q?.dayOpenPrice),
    high: numOrNull(q?.dayHighPrice),
    low: numOrNull(q?.dayLowPrice),
    close: numOrNull(q?.dayClosePrice),
    volume: numOrNull(q?.volume ?? q?.totalTradedVolume),
    oi: numOrNull(q?.openInterest),
    bid: numOrNull(q?.bestBuyPrice1),
    ask: numOrNull(q?.bestSellPrice1),
  };
}

export function mapDepth(q) {
  const side = (p) => [1, 2, 3, 4, 5]
    .map((n) => ({ price: num(q?.[`best${p}Price${n}`]), qty: num(q?.[`best${p}Quantity${n}`]), orders: numOrNull(q?.[`best${p}Order${n}`]) }))
    .filter((l) => l.price > 0 || l.qty > 0);
  return { bids: side("Buy"), asks: side("Sell") };
}

const EXCHANGES = new Set(["NSE", "BSE", "NFO", "BFO"]);

/** Resolve { token, exchange, tradingSymbol? } refs to quote targets via the published masters. */
async function resolveRefs(creds, refs) {
  if (!Array.isArray(refs) || refs.length === 0) throw new BrokerInputError("Firstock: pass at least one { token, exchange }.");
  const out = [];
  let indexMap = null;
  for (const r of refs) {
    const exchange = String(r?.exchange ?? "").toUpperCase();
    const token = String(r?.token ?? "").trim();
    if (!EXCHANGES.has(exchange) || !token) throw new BrokerInputError(`Firstock: bad instrument ${JSON.stringify(r)}`);
    if (r.tradingSymbol) { out.push({ exchange, token, tradingSymbol: String(r.tradingSymbol) }); continue; }
    if (exchange === "NSE" || exchange === "BSE") {
      indexMap ||= Object.values(await getIndexMap(creds));
      const idx = indexMap.find((i) => i.exchange === exchange && i.token === token);
      if (idx) { out.push({ exchange, token, tradingSymbol: idx.tradingSymbol }); continue; }
    }
    const files = exchange === "NFO" ? ["Indices", "NFO"] : exchange === "BFO" ? ["Indices", "BFO"] : [exchange];
    let hit = null;
    for (const f of files) {
      hit = (await getFile(f)).find((i) => i.exchange === exchange && i.token === token);
      if (hit) break;
    }
    if (!hit) throw new BrokerInputError(`Firstock: token ${token} is not in the ${exchange} symbol master`);
    out.push({ exchange, token, tradingSymbol: hit.tradingSymbol });
  }
  return out;
}

export async function fetchQuotes(creds, refs) {
  ensureSession(creds);
  const targets = await resolveRefs(creds, refs);
  const map = await multiQuotes(creds, targets);
  return { status: "success", data: targets.filter((t) => findQuote(map, t)).map((t) => mapQuote(t, findQuote(map, t))) };
}

export async function fetchDepth(creds, ref) {
  ensureSession(creds);
  const [target] = await resolveRefs(creds, [ref]);
  const q = findQuote(await multiQuotes(creds, [target]), target);
  if (!q) throw new Error(`Firstock returned no quote for ${target.tradingSymbol}`);
  return { status: "success", data: mapDepth(q) };
}

export async function fetchLTP(creds, symbol) {
  ensureSession(creds);
  const target = await spotTarget(creds, symbol);
  if (!target) throw new BrokerInputError(`Firstock: no spot instrument for ${symbol}`);
  const q = findQuote(await multiQuotes(creds, [target]), target);
  const ltp = num(q?.lastTradedPrice);
  if (!(ltp > 0)) throw new Error(`Firstock returned no last price for ${symbol}`);
  return { status: "success", data: { last_price: ltp } };
}

/** Expiries come from the public masters, so they list before login. */
export async function fetchExpiryList(creds, symbol) {
  return { status: "success", data: listExpiries(await derivativesFor(symbol), symbol) };
}

/** Strike nearest the money from leg prices (put-call parity: |CE - PE| is smallest at the money). */
export function parityStrike(rows) {
  const byStrike = new Map();
  for (const r of rows) {
    const k = num(r.strikePrice);
    const e = byStrike.get(k) || {};
    e[r.optionType] = num(r.lastTradedPrice);
    byStrike.set(k, e);
  }
  let best = null;
  for (const [k, e] of byStrike) {
    if (!(e.CE > 0 && e.PE > 0)) continue;
    const d = Math.abs(e.CE - e.PE);
    if (!best || d < best.d) best = { k, d };
  }
  return best ? best.k : null;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  ensureSession(creds);
  const want = String(symbol ?? "").toUpperCase();
  const instruments = await derivativesFor(want);
  const expiryIso = expiry || listExpiries(instruments, want)[0];
  if (!expiryIso) return { status: "success", data: { oc: {}, last_price: 0 } };
  const contracts = optionContracts(instruments, want, expiryIso);
  const exchange = chainExchange(want, contracts);

  const chain = await callApi(creds, "/optionChainGreeks", { exchange, symbol: want, expiry: isoToDdMonYy(expiryIso), count: "ALL" });
  const rows = (Array.isArray(chain?.data) ? chain.data : []).filter((r) => (r?.optionType === "CE" || r?.optionType === "PE") && num(r?.strikePrice) > 0);

  // One quote call: the spot plus the legs nearest the money (for bid/ask, which the chain lacks).
  const spot = await spotTarget(creds, want);
  const strikes = [...new Set(rows.map((r) => num(r.strikePrice)))].sort((a, b) => a - b);
  const mid = parityStrike(rows);
  const midIdx = mid === null ? Math.floor(strikes.length / 2) : strikes.indexOf(mid);
  const inWindow = new Set(strikes.slice(Math.max(0, midIdx - BIDASK_HALF_WIDTH), midIdx + BIDASK_HALF_WIDTH + 1));
  const targets = rows.filter((r) => inWindow.has(num(r.strikePrice))).map((r) => ({ exchange: r.exchange || exchange, tradingSymbol: r.tradingSymbol, token: r.token }));
  if (spot) targets.unshift(spot);
  const quotes = await multiQuotes(creds, targets);
  const lastPrice = spot ? num(findQuote(quotes, spot)?.lastTradedPrice) : 0;
  const daysToExpiry = daysBetween(new Date(), expiryIso);

  const oc = {};
  for (const r of rows) {
    const strike = num(r.strikePrice);
    const q = findQuote(quotes, { exchange: r.exchange || exchange, tradingSymbol: r.tradingSymbol, token: r.token });
    const ltp = num(r.lastTradedPrice) || num(q?.lastTradedPrice);
    let iv = num(r.iv);
    let greeks = { delta: num(r.delta), gamma: num(r.gamma), theta: num(r.theta), vega: num(r.vega) };
    if (!(iv > 0) && ltp > 0 && lastPrice > 0) {
      const solved = computeIVAndGreeks({ ltp, spot: lastPrice, strike, daysToExpiry, type: r.optionType });
      iv = solved.iv;
      greeks = { delta: solved.delta, gamma: solved.gamma, theta: solved.theta, vega: solved.vega };
    }
    (oc[String(strike)] ||= {})[r.optionType === "CE" ? "ce" : "pe"] = {
      last_price: ltp,
      oi: num(r.oi ?? q?.openInterest),
      // optionChainGreeks carries no volume, and the documented /getMultiQuotes sample has no traded-volume
      // field either (checked 2026-10), so volume is known only when a quote for this leg (one of the
      // ±BIDASK_HALF_WIDTH strikes) actually carries one. Otherwise it is null ("unknown"), not 0 ("no trades").
      volume: numOrNull(q?.volume ?? q?.totalTradedVolume),
      iv,
      ...greeks,
      bid_price: num(q?.bestBuyPrice1),
      ask_price: num(q?.bestSellPrice1),
      security_id: String(r.token ?? ""),
    };
  }
  return { status: "success", data: { oc, last_price: lastPrice } };
}

// ── candles ──

const INTERVALS = { "1m": "1mi", "3m": "3mi", "5m": "5mi", "15m": "15mi", "30m": "30mi", "60m": "60mi", "1d": "1d" };

/** "2026-10-16" | "2026-10-16T09:15" -> "HH:MM:SS DD-MM-YYYY" (IST wall time). */
export function toFirstockTime(value, fallback) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(value ?? "").trim());
  if (!m) throw new BrokerInputError(`Firstock historical: bad date ${value}`);
  const t = m[4] ? `${m[4]}:${m[5]}:${m[6] || "00"}` : fallback;
  return `${t} ${m[3]}-${m[2]}-${m[1]}`;
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  ensureSession(creds);
  const iv = INTERVALS[interval];
  if (!iv) throw new BrokerInputError(`Firstock historical: unsupported interval ${interval}`);
  const [target] = await resolveRefs(creds, [instrument]);
  const json = await callApi(creds, "/timePriceSeries", {
    exchange: target.exchange,
    tradingSymbol: target.tradingSymbol,
    interval: iv,
    startTime: toFirstockTime(from, "09:15:00"),
    endTime: toFirstockTime(to, "15:30:00"),
  });
  const byTime = new Map();
  for (const c of Array.isArray(json?.data) ? json.data : []) {
    const time = Math.floor(num(c?.epochTime));
    if (!(time > 1e9)) continue;
    const candle = { time, open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close), volume: num(c.volume) };
    if (c.oi !== undefined) candle.oi = num(c.oi);
    byTime.set(time, candle);
  }
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}

