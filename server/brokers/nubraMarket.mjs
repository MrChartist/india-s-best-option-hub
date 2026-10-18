/**
 * Nubra market data: native option chain, current price, order-book quotes/depth, historical candles, instruments.
 *
 * Official docs (checked 2026-10), https://nubra.io/products/api/docs/rest-api-v3/ :
 *  - market-data/option-chain.html: GET /optionchains/{asset}?exchange=NSE|BSE|MCX&expiry=YYYYMMDD ->
 *    { chain: { asset, exchange, expiry, ce: [...], pe: [...], atm, cp, all_expiries: ["YYYYMMDD"] } }, each leg
 *    { ref_id, inst_id, ts, sp, ls, ltp, ltpchg, iv, delta, gamma, theta, vega, oi, volume }. sp/ltp/cp/atm are
 *    paise. The docs' prose mentions top bid/ask but the documented leg has no bid/ask field; `iv` is null in the
 *    sample, so its scale is undocumented (a value <= 3 is treated as a fraction and converted to percent).
 *  - market-data/current-price.html: GET /optionchains/{instrument}/price?exchange=... -> { price, prev_close,
 *    change, exchange } in paise.
 *  - market-data/market-quotes.html: GET /orderbooks/{ref_id}?levels=N -> { orderBook: { ref_id, bid: [{ p, q, o }],
 *    ask: [...], ltp, ltq, volume } } (paise; no OHLC or OI).
 *  - market-data/historical-market-data.html: POST /charts/timeseries { query: [{ exchange, type: STOCK|INDEX|OPT|FUT,
 *    values: [symbol], fields, startDate, endDate (ISO UTC), interval: 1m|3m|5m|15m|30m|1h|1d|..., intraDay, realTime }] }
 *    -> result[].values[].{symbol}.{field}: [{ ts (ns), v }]. Intraday history covers 3 months. INDEX has been
 *    observed to reject tick_volume (not in the official docs: needs live verification), so index candles carry volume 0.
 *  - RateLimits.html: historical/REST market data 60 requests a minute.
 */

import { BrokerError, BrokerInputError } from "./contract.mjs";
import { nubraFetch, getSession } from "./nubraAuth.mjs";
import { getRefdata, isDerivativeRow, toInstrument, underlyingRef, yyyymmddToIso } from "./nubraInstruments.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";

const paise = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n / 100 : 0;
};
const paiseOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) / 100);
const numOrNull = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

function refOrThrow(symbol) {
  const ref = underlyingRef(symbol);
  if (!ref) throw new BrokerInputError(`Nubra: unknown symbol ${symbol}`);
  return ref;
}

/** GET /optionchains/{asset}?exchange=...&expiry=... (expiry optional = nearest). */
export async function fetchRawChain(creds, symbol, expiryIso) {
  const ref = refOrThrow(symbol);
  const params = new URLSearchParams({ exchange: ref.exchange });
  if (expiryIso) params.set("expiry", String(expiryIso).replaceAll("-", ""));
  const json = await nubraFetch(creds, `/optionchains/${encodeURIComponent(ref.asset)}?${params.toString()}`, { what: "option chain" });
  if (!json?.chain) throw new BrokerError(`Nubra returned no option chain for ${symbol}`);
  return json.chain;
}

export async function fetchExpiryList(creds, symbol) {
  const chain = await fetchRawChain(creds, symbol);
  const dates = [...new Set((chain.all_expiries || []).map(yyyymmddToIso).filter(Boolean))].sort();
  return { status: "success", data: dates };
}

export async function fetchLTP(creds, symbol) {
  const ref = refOrThrow(symbol);
  const json = await nubraFetch(creds, `/optionchains/${encodeURIComponent(ref.asset)}/price?exchange=${ref.exchange}`, { what: "current price" });
  const last = paise(json?.price);
  if (!(last > 0)) throw new BrokerError(`Nubra returned no price for ${symbol}`);
  return { status: "success", data: { last_price: last } };
}

/** Nubra leg -> app leg. Native Greeks are kept; IV (null in the docs' sample) is solved when missing. */
function buildLeg(row, { spot, daysToExpiry, type }) {
  const strike = paise(row.sp);
  const ltp = paise(row.ltp);
  const solved = computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
  const native = row.delta != null && row.gamma != null && row.theta != null && row.vega != null;
  let iv = row.iv != null && Number.isFinite(Number(row.iv)) && Number(row.iv) > 0 ? Number(row.iv) : null;
  if (iv !== null && iv <= 3) iv *= 100;
  return {
    last_price: ltp,
    oi: Number(row.oi) || 0,
    volume: Number(row.volume) || 0,
    iv: iv ?? solved.iv,
    delta: native ? Number(row.delta) || 0 : solved.delta,
    gamma: native ? Number(row.gamma) || 0 : solved.gamma,
    theta: native ? Number(row.theta) || 0 : solved.theta,
    vega: native ? Number(row.vega) || 0 : solved.vega,
    bid_price: 0, // the documented snapshot has no bid/ask
    ask_price: 0,
    security_id: row.ref_id !== undefined ? String(row.ref_id) : undefined,
  };
}

export async function fetchOptionChain(creds, symbol, expiry) {
  const chain = await fetchRawChain(creds, symbol, expiry);
  const expiryIso = expiry || yyyymmddToIso(chain.expiry);
  const spot = paise(chain.cp);
  const daysToExpiry = expiryIso ? daysBetween(new Date(), expiryIso) : 0;
  const oc = {};
  for (const [side, type] of [["ce", "CE"], ["pe", "PE"]]) {
    for (const row of Array.isArray(chain[side]) ? chain[side] : []) {
      const strike = paise(row?.sp);
      if (!(strike > 0)) continue;
      (oc[String(strike)] ||= {})[side] = buildLeg(row, { spot, daysToExpiry, type });
    }
  }
  return { status: "success", data: { oc, last_price: spot } };
}

// ── quotes / depth via /orderbooks/{ref_id} ──

function checkRef(ref, what) {
  if (!ref || !/^\d{1,12}$/.test(String(ref.token ?? "")) || !ref.exchange) throw new BrokerInputError(`Nubra ${what} needs { token: ref_id, exchange }`);
}

async function orderBook(creds, refId, levels) {
  const json = await nubraFetch(creds, `/orderbooks/${String(refId)}?levels=${levels}`, { what: "market quote" });
  return json?.orderBook || {};
}

export async function fetchQuotes(creds, refs = []) {
  const list = Array.isArray(refs) ? refs : [];
  list.forEach((r) => checkRef(r, "quotes"));
  const data = [];
  for (const ref of list) {
    // One call per instrument; Nubra documents no bulk REST quote (the WebSocket is the bulk path).
    const ob = await orderBook(creds, ref.token, 1);
    data.push({
      token: String(ref.token), exchange: ref.exchange, ltp: paise(ob.ltp), open: null, high: null, low: null, close: null,
      volume: numOrNull(ob.volume), oi: null, bid: paiseOrNull(ob.bid?.[0]?.p), ask: paiseOrNull(ob.ask?.[0]?.p),
    });
  }
  return { status: "success", data };
}

export async function fetchDepth(creds, ref) {
  checkRef(ref, "depth");
  const ob = await orderBook(creds, ref.token, 5);
  const level = (l) => ({ price: paise(l?.p), qty: Number(l?.q) || 0, orders: numOrNull(l?.o) });
  return { status: "success", data: { bids: (ob.bid || []).map(level), asks: (ob.ask || []).map(level) } };
}

// ── instruments ──

export async function fetchInstruments(creds) {
  getSession(creds); // not logged in -> 422 before any download
  const data = [];
  for (const r of await getRefdata(creds)) {
    const ins = toInstrument(r);
    if (ins) data.push(ins);
  }
  return { status: "success", data };
}

// ── historical ──

const INTERVALS = { "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m", "60m": "1h", "1d": "1d" };

function rangeIso(v, endOfDay) {
  const s = String(v ?? "");
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T${endOfDay ? "15:30" : "09:15"}:00+05:30`) : Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** InstrumentRef -> { exchange, type, symbol } for /charts/timeseries. A canonical index name may be the token. */
async function chartTarget(creds, instrument) {
  const name = String(instrument?.token ?? "").toUpperCase();
  const idx = underlyingRef(name);
  if (idx?.isIndex) return { exchange: idx.exchange, type: "INDEX", symbol: name };
  checkRef(instrument, "history");
  const row = (await getRefdata(creds)).find((r) => String(r.ref_id) === String(instrument.token));
  if (!row) throw new BrokerInputError(`Nubra instrument master has no ref_id ${instrument.token}`);
  const d = String(row.derivative_type || "").toUpperCase();
  const type = d === "OPT" || d === "FUT" ? d : isDerivativeRow(row) ? "OPT" : "STOCK";
  return { exchange: String(row.exchange || "NSE").toUpperCase(), type, symbol: String(row.stock_name) };
}

export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const iv = INTERVALS[interval];
  if (!iv) throw new BrokerInputError(`Nubra history does not support interval ${interval}`);
  const startDate = rangeIso(from, false);
  const endDate = rangeIso(to, true);
  if (!startDate || !endDate) throw new BrokerInputError("Nubra history needs a valid from/to range");
  const target = await chartTarget(creds, instrument);
  const fields = ["open", "high", "low", "close"];
  if (target.type !== "INDEX") fields.push("tick_volume");
  if (target.type === "OPT" || target.type === "FUT") fields.push("cumulative_oi");
  const json = await nubraFetch(creds, "/charts/timeseries", {
    method: "POST",
    body: { query: [{ exchange: target.exchange, type: target.type, values: [target.symbol], fields, startDate, endDate, interval: iv, intraDay: false, realTime: false }] },
    what: "historical candles",
  });
  const byTs = new Map();
  for (const res of Array.isArray(json?.result) ? json.result : []) {
    for (const entry of Array.isArray(res?.values) ? res.values : []) {
      const series = entry?.[target.symbol];
      if (!series) continue;
      for (const [field, points] of Object.entries(series)) {
        for (const p of Array.isArray(points) ? points : []) {
          const time = Math.floor(Number(p?.ts) / 1e9);
          if (!Number.isFinite(time) || time <= 0) continue;
          const c = byTs.get(time) || { time, open: 0, high: 0, low: 0, close: 0, volume: 0 };
          if (field === "tick_volume") c.volume = Number(p.v) || 0;
          else if (field === "cumulative_oi") c.oi = Number(p.v) || 0;
          else if (field === "open" || field === "high" || field === "low" || field === "close") c[field] = paise(p.v);
          byTs.set(time, c);
        }
      }
    }
  }
  const data = [...byTs.values()].filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
  return { status: "success", data };
}
