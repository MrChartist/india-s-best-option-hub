/**
 * Tradejini (CubePlus) adapter (contract v1, server/brokers/contract.mjs).
 *
 * Official docs: https://developer.tradejini.com/docs (checked 2026-10) plus the official streaming SDK linked there.
 * Auth (tradejiniAuth.mjs): session login. The user types the login password and the current TOTP code; only the
 * access token is kept. Every call sends `Authorization: Bearer <api_key>:<access_token>`.
 *
 * Market data: the REST API has no quote or option-chain endpoint ("Use WebSocket streaming for real-time quotes"),
 * so LTP, quotes and chain prices come from the NxtradStream feed (tradejiniStream.mjs), which also streams
 * broker-computed IV and greeks. Strikes/expiries/tokens come from the public scrip master
 * (tradejiniInstruments.mjs). History: GET /api/mkt-data/chart/interval-data (interval "1" minute only).
 * Portfolio (tradejiniPortfolio.mjs) and gated orders (tradejiniOrders.mjs) are REST.
 *
 * Not declared: depth (L5 is a stream-only packet, not wired in v1).
 * Differences from OpenAlgo (official docs followed): the login field is the account login password (OpenAlgo: PIN);
 * a stream subscription REPLACES the previous list, so the whole list is sent in one frame.
 */

import { BrokerError, BrokerInputError, normaliseError as baseNormalise } from "./contract.mjs";
import { tjRequest, getSession, LOGIN_FIELDS, SESSION_FIELDS } from "./tradejiniAuth.mjs";
import { distinctExpiries, findByToken, getInstruments, optionRows, resolveUnderlying, spotRow } from "./tradejiniInstruments.mjs";
import { addSymbols, getConnection, removeSymbols, subscribeAndCollect } from "./tradejiniStream.mjs";
import { ORDER_FEATURES } from "./tradejiniOrders.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

export { login } from "./tradejiniAuth.mjs";
export { fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook } from "./tradejiniPortfolio.mjs";
export { buildOrderBody, buildModifyBody, placeOrder, modifyOrder, cancelOrder } from "./tradejiniOrders.mjs";

export const id = "tradejini";
export const credentialFields = ["apiKey"];

/** Contract declaration. The password and TOTP code are typed per session, never stored. */
export const capabilities = {
  ...ORDER_FEATURES,
  auth: { kind: "sessionLogin", loginFields: LOGIN_FIELDS, sessionFields: SESSION_FIELDS },
  testConnection: true,
  instruments: true,
  expiries: true,
  optionChain: { greeks: "broker" },
  ltp: true,
  quotes: true,
  historical: { intervals: ["1m"] },
  feed: true,
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

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === undefined || v === null ? null : num(v));

/** One cheap authenticated call: GET /api/account/details. Never throws. */
export async function testConnection(creds = {}) {
  try {
    const d = await tjRequest(creds, "/api/account/details");
    return { status: "success", message: d?.userId ? "Tradejini session is active" : "Tradejini session is active (no profile returned)" };
  } catch (e) {
    return { status: "error", message: normaliseError(e).message };
  }
}

export async function fetchInstruments() {
  const rows = await getInstruments();
  return { status: "success", data: rows.map(({ streamKey: _k, ...r }) => r) };
}

export async function fetchExpiryList(_creds, symbol) {
  return { status: "success", data: distinctExpiries(await optionRows(symbol)) };
}

/**
 * Greeks-packet IV: the SDK passes the double through unscaled and the docs do not state the unit. A value below 1.5
 * cannot be a sensible percentage for a traded option, so it is treated as a fraction and scaled to percent.
 */
export function ivPercent(iv) {
  const v = num(iv);
  return v > 0 && v < 1.5 ? v * 100 : v;
}

export function buildLeg(tick, { spot, strike, daysToExpiry, type, token }) {
  const ltp = num(tick?.ltp);
  const brokerGreeks = num(tick?.iv) > 0;
  const leg = {
    last_price: ltp,
    oi: num(tick?.OI),
    volume: num(tick?.vol),
    bid_price: num(tick?.bidPrice),
    ask_price: num(tick?.askPrice),
    security_id: token,
    ...(brokerGreeks
      ? { iv: ivPercent(tick.iv), delta: num(tick.delta), gamma: num(tick.gamma), theta: num(tick.theta), vega: num(tick.vega) }
      : computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type })),
  };
  if (tick?.OI != null && tick?.prevOI != null) leg.oi_chg = num(tick.OI) - num(tick.prevOI);
  return leg;
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const u = resolveUnderlying(symbol);
  getSession(creds); // not logged in -> SessionRequiredError before any download
  const rows = await optionRows(u.symbol);
  const target = expiry || distinctExpiries(rows)[0];
  const legs = rows.filter((r) => r.expiry === target);
  if (!legs.length) return { status: "success", data: { oc: {}, last_price: 0 } };
  const spot = await spotRow(u.symbol).catch(() => null);
  const keys = legs.map((r) => r.streamKey);
  const ticks = await subscribeAndCollect(creds, spot ? [...keys, spot.streamKey] : keys);
  const spotPrice = spot ? num(ticks.get(spot.streamKey)?.ltp) || num(legs.map((r) => ticks.get(r.streamKey)?.spotPrice).find((v) => v > 0)) : 0;
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of legs) {
    const tick = ticks.get(r.streamKey);
    if (!tick || tick.ltp === undefined) continue; // no tick in the window: omit the leg rather than fake zeros
    (oc[String(r.strike)] ||= {})[r.optionType === "CE" ? "ce" : "pe"] = buildLeg(tick, { spot: spotPrice, strike: r.strike, daysToExpiry: days, type: r.optionType, token: r.token });
  }
  return { status: "success", data: { oc, last_price: spotPrice } };
}

export async function fetchLTP(creds, symbol) {
  getSession(creds);
  const spot = await spotRow(symbol);
  const ticks = await subscribeAndCollect(creds, [spot.streamKey], { withGreeks: false });
  const last_price = num(ticks.get(spot.streamKey)?.ltp);
  if (!(last_price > 0)) throw new BrokerError(`Tradejini: no live price for ${spot.underlying} yet`);
  return { status: "success", data: { last_price } };
}

function toQuote(row, tick) {
  return {
    token: row.token,
    exchange: row.exchange,
    ltp: num(tick.ltp),
    open: numOrNull(tick.open),
    high: numOrNull(tick.high),
    low: numOrNull(tick.low),
    close: numOrNull(tick.close),
    volume: numOrNull(tick.vol),
    oi: numOrNull(tick.OI),
    bid: numOrNull(tick.bidPrice),
    ask: numOrNull(tick.askPrice),
  };
}

async function rowsFor(refs) {
  const out = [];
  for (const ref of refs || []) {
    const row = await findByToken(ref?.token);
    if (!row) throw new BrokerInputError(`Tradejini: unknown instrument ${ref?.token} (use the symId from the scrip master)`);
    out.push(row);
  }
  return out;
}

export async function fetchQuotes(creds, refs = []) {
  getSession(creds);
  const rows = await rowsFor(refs);
  const ticks = await subscribeAndCollect(creds, rows.map((r) => r.streamKey), { withGreeks: false });
  const data = rows.filter((r) => ticks.get(r.streamKey)?.ltp !== undefined).map((r) => toQuote(r, ticks.get(r.streamKey)));
  return { status: "success", data };
}

/** Bars arrive as arrays [time, open, high, low, close, volume, minuteOi?] or as objects with those names. */
export function toCandle(bar) {
  const o = Array.isArray(bar) ? { time: bar[0], open: bar[1], high: bar[2], low: bar[3], close: bar[4], volume: bar[5], minuteOi: bar[6] } : bar || {};
  let time = num(o.time);
  if (time > 1e11) time = Math.round(time / 1000); // epoch ms -> s
  if (!(time > 1e9)) return null;
  const c = { time, open: num(o.open), high: num(o.high), low: num(o.low), close: num(o.close), volume: num(o.volume) };
  if (o.minuteOi !== undefined) c.oi = num(o.minuteOi);
  return c;
}

const toEpochSec = (v) => {
  if (typeof v === "number") return v > 1e11 ? Math.round(v / 1000) : v;
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(`${v}T00:00:00+05:30`) : Date.parse(String(v));
  if (!Number.isFinite(ms)) throw new BrokerInputError(`Tradejini: bad date ${v}`);
  return Math.round(ms / 1000);
};

export async function fetchHistorical(creds, { instrument, interval = "1m", from, to } = {}) {
  if (interval !== "1m") throw new BrokerInputError("Tradejini: the chart API documents 1-minute candles only");
  getSession(creds);
  const [row] = await rowsFor([instrument]);
  const d = await tjRequest(creds, "/api/mkt-data/chart/interval-data", {
    query: { from: toEpochSec(from), to: toEpochSec(to ?? Date.now()), interval: "1", id: row.token },
  });
  const bars = (Array.isArray(d?.bars) ? d.bars : []).map(toCandle).filter(Boolean).sort((a, b) => a.time - b.time);
  return { status: "success", data: bars.filter((c, i) => i === 0 || c.time > bars[i - 1].time) };
}

/**
 * Live feed. subscribe(refs) takes { token: symId, exchange } refs; ticks arrive as contract Quotes. Closing the feed
 * removes only this feed's symbols from the shared connection.
 */
export function createFeed(creds, { onTick, onStatus } = {}) {
  getSession(creds);
  const mine = new Map(); // streamKey -> row
  let entry = null;
  let closed = false;
  const tickFn = (tick) => {
    const row = mine.get(tick.symbol);
    if (row && tick.ltp !== undefined) onTick?.(toQuote(row, tick));
  };
  const statusFn = (s) => onStatus?.(s);
  const ready = getConnection(creds).then((e) => {
    entry = e;
    if (closed) return e;
    e.tickListeners.add(tickFn);
    e.statusListeners.add(statusFn);
    onStatus?.({ connected: true });
    return e;
  });
  ready.catch((e) => onStatus?.({ connected: false, reason: e.message }));
  return {
    subscribe(refs) {
      rowsFor(refs).then(async (rows) => {
        const e = await ready;
        for (const r of rows) mine.set(r.streamKey, r);
        if (!closed) addSymbols(e, "L1", rows.map((r) => r.streamKey));
      }).catch((err) => onStatus?.({ connected: Boolean(entry?.connected), reason: err.message }));
    },
    unsubscribe(refs) {
      rowsFor(refs).then(async (rows) => {
        const e = await ready;
        const keys = rows.map((r) => r.streamKey);
        keys.forEach((k) => mine.delete(k));
        removeSymbols(e, "L1", keys);
      }).catch(() => {});
    },
    close() {
      closed = true;
      if (entry) {
        entry.tickListeners.delete(tickFn);
        entry.statusListeners.delete(statusFn);
        removeSymbols(entry, "L1", [...mine.keys()]);
      }
      mine.clear();
    },
  };
}

/**
 * Error codes: our refusals (SessionRequiredError on a 401 or stream code 4001, BrokerInputError, OrderGateError) keep
 * 422. Upstream "Tradejini error [<http>]: <msg>" stays 502, with HTTP 429 -> UPSTREAM_RATE_LIMIT and 400 -> UPSTREAM_INPUT.
 */
export function normaliseError(err, opts = {}) {
  const base = baseNormalise(err, opts);
  if (err instanceof BrokerError && (err.statusCode === 422 || err.code !== "UPSTREAM_ERROR")) return base;
  const m = base.message;
  if (/\[429\]|too many requests/i.test(m)) return { ...base, code: "UPSTREAM_RATE_LIMIT" };
  if (/\[400\]|input validation failed/i.test(m)) return { ...base, code: "UPSTREAM_INPUT" };
  return base;
}
