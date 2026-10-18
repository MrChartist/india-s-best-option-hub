/**
 * ICICI Direct (Breeze) market data. Official docs (checked 2026-10):
 *  - OptionChain: GET /OptionChain body { stock_code, exchange_code: "NFO", expiry_date: "2025-01-25T06:00:00.000Z",
 *    product_type: "options", right: "call" | "put", strike_price: "" } -> Success [ { strike_price, right
 *    ("Call" | "Put"), ltp, best_bid_price, best_offer_price, total_quantity_traded, open_interest, chnge_oi,
 *    spot_price, ... } ]. One call per side, so a chain costs two of the 100 calls a minute. No IV/Greeks: they
 *    are back-solved here (Black-Scholes).
 *  - Quotes: GET /quotes body { stock_code, exchange_code, expiry_date, product_type, right, strike_price } (one
 *    instrument) -> Success [ { ltp, open, high, low, previous_close, best_bid_price, best_offer_price,
 *    total_quantity_traded, ... } ].
 *  - HistoricalChartsv2: GET https://breezeapi.icicidirect.com/api/v2/historicalcharts?stock_code=&exch_code=
 *    &from_date=&to_date=&interval=1minute|5minute|30minute|1day&product_type=&expiry_date=&right=&strike_price=
 *    with headers apikey + X-SessionToken -> Success [ { datetime ("2025-02-03 09:21:00", IST), open, high, low,
 *    close, volume, open_interest } ].
 * There is no depth endpoint (quotes carry only the best bid/offer), so depth is not declared.
 */

import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { BrokerInputError } from "./contract.mjs";
import { breezeRequest, breezeV2Get } from "./icicidirectAuth.mjs";
import { INDEX_CODES, breezeParams, getMaster, listExpiries, rowOf, stockCodeOf } from "./icicidirectInstruments.mjs";

export const HISTORY_URL = "https://breezeapi.icicidirect.com/api/v2/historicalcharts";
export const MAX_QUOTES = 20;
const INTERVAL = { "1m": "1minute", "5m": "5minute", "30m": "30minute", "1d": "1day" };

const n = (v) => {
  const x = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};
const nOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export async function fetchExpiryList(creds, symbol) {
  return { status: "success", data: listExpiries(await getMaster(), symbol) };
}

function pickRow(rows, exchange) {
  return rows.find((r) => String(r?.exchange_code ?? "").toUpperCase() === exchange) ?? rows[0] ?? null;
}

async function quoteRow(creds, row) {
  const rows = await breezeRequest(creds, "quotes", { params: breezeParams(row), list: true });
  return pickRow(rows, row.exchange);
}

export async function fetchLTP(creds, symbol) {
  const master = await getMaster();
  const u = String(symbol ?? "").toUpperCase();
  const row = INDEX_CODES[u] ? rowOf(master, { exchange: "NSE", token: INDEX_CODES[u].token }) : master.nse.find((m) => m.underlying === u);
  if (!row) throw new BrokerInputError(`ICICI Direct: no NSE index or stock named ${symbol} (BSE is not available on Breeze)`);
  const ltp = n((await quoteRow(creds, row))?.ltp);
  if (!(ltp > 0)) throw new BrokerInputError(`ICICI Direct returned no price for ${symbol}`);
  return { status: "success", data: { last_price: ltp } };
}

export function buildLeg(q, ctx) {
  const ltp = n(q?.ltp);
  const g = computeIVAndGreeks({ ltp, spot: ctx.spot, strike: ctx.strike, daysToExpiry: ctx.days, type: ctx.type });
  return {
    last_price: ltp, oi: n(q?.open_interest), oi_chg: n(q?.chnge_oi), volume: n(q?.total_quantity_traded),
    bid_price: n(q?.best_bid_price), ask_price: n(q?.best_offer_price),
    iv: g.iv, delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega, ...(ctx.token ? { security_id: ctx.token } : {}),
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const master = await getMaster();
  const u = String(symbol ?? "").toUpperCase();
  const expiries = listExpiries(master, u);
  if (!expiries.length) throw new BrokerInputError(`ICICI Direct: no NSE options listed for ${symbol} (BSE is not available on Breeze)`);
  const target = expiry || expiries[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new BrokerInputError("ICICI Direct option chain: expiry must be YYYY-MM-DD");
  const code = stockCodeOf(master, u);
  const tokenOf = new Map(master.fno.filter((m) => m.underlying === u && m.expiry === target && m.optionType).map((m) => [`${m.strike}|${m.optionType}`, m.token]));
  const sides = [];
  for (const right of ["call", "put"]) {
    sides.push(await breezeRequest(creds, "OptionChain", {
      params: { stock_code: code, exchange_code: "NFO", expiry_date: `${target}T06:00:00.000Z`, product_type: "options", right, strike_price: "" },
      list: true,
    }));
  }
  const all = sides.flat();
  const spot = n(all.find((r) => n(r?.spot_price) > 0)?.spot_price);
  const days = daysBetween(new Date(), target);
  const oc = {};
  for (const r of all) {
    const strike = n(r?.strike_price);
    const type = String(r?.right ?? "").toLowerCase().startsWith("c") ? "CE" : String(r?.right ?? "").toLowerCase().startsWith("p") ? "PE" : null;
    if (!(strike > 0) || !type) continue;
    const key = String(strike);
    oc[key] = oc[key] || {};
    oc[key][type.toLowerCase()] = buildLeg(r, { spot, strike, days, type, token: tokenOf.get(`${strike}|${type}`) });
  }
  return { status: "success", data: { oc, last_price: spot } };
}

export function mapQuote(ref, q) {
  return {
    token: String(ref.token), exchange: ref.exchange, ltp: n(q?.ltp), open: nOrNull(q?.open), high: nOrNull(q?.high), low: nOrNull(q?.low),
    close: nOrNull(q?.previous_close), volume: nOrNull(q?.total_quantity_traded), oi: nOrNull(q?.open_interest),
    bid: nOrNull(q?.best_bid_price), ask: nOrNull(q?.best_offer_price),
  };
}

export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || !refs.length) return { status: "success", data: [] };
  if (refs.length > MAX_QUOTES) throw new BrokerInputError(`ICICI Direct quotes cost one call each (100 a minute); ask for at most ${MAX_QUOTES} at a time.`);
  const master = await getMaster();
  const rows = refs.map((r) => {
    const row = rowOf(master, r);
    if (!row) throw new BrokerInputError(`ICICI Direct: unsupported instrument ${r?.exchange}:${r?.token} (NSE and NFO only)`);
    return row;
  });
  const data = [];
  for (let i = 0; i < refs.length; i++) {
    const q = await quoteRow(creds, rows[i]);
    if (q) data.push(mapQuote(refs[i], q));
  }
  return { status: "success", data };
}

/** "2025-02-03 09:21:00" (IST) -> epoch seconds. */
export function candleTime(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(raw ?? "").trim());
  if (!m) return NaN;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000) - 19800;
}

export function mapCandles(rows) {
  const out = rows.map((c) => ({ time: candleTime(c?.datetime), open: n(c?.open), high: n(c?.high), low: n(c?.low), close: n(c?.close), volume: n(c?.volume), oi: n(c?.open_interest) }))
    .filter((c) => Number.isInteger(c.time) && c.time > 0);
  out.sort((a, b) => a.time - b.time);
  return out.filter((c, i) => i === 0 || c.time > out[i - 1].time);
}

export async function fetchHistorical(creds, { instrument, interval = "1d", from, to } = {}) {
  const iv = INTERVAL[interval];
  if (!iv) throw new BrokerInputError(`ICICI Direct historical: unsupported interval ${interval} (1m, 5m, 30m, 1d)`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from ?? "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to ?? "")) || from > to) {
    throw new BrokerInputError("ICICI Direct historical: from/to must be YYYY-MM-DD with from on or before to");
  }
  const row = rowOf(await getMaster(), instrument);
  if (!row) throw new BrokerInputError(`ICICI Direct historical: unsupported instrument ${instrument?.exchange}:${instrument?.token}`);
  const p = breezeParams(row);
  const qs = new URLSearchParams({
    stock_code: p.stock_code, exch_code: p.exchange_code, from_date: `${from}T00:00:00.000Z`, to_date: `${to}T23:59:59.000Z`, interval: iv, product_type: p.product_type,
  });
  if (row.exchange === "NFO") {
    qs.set("expiry_date", row.expiry);
    qs.set("right", p.right);
    qs.set("strike_price", p.strike_price);
  }
  return { status: "success", data: mapCandles(await breezeV2Get(creds, `${HISTORY_URL}?${qs}`)) };
}
