/**
 * Upstox quotes, depth, candles and read-only portfolio, normalised to the contract shapes.
 * Re-exported from upstox.mjs.
 *
 * Official sources (October 2026), https://upstox.com/developer/api-documentation/:
 *  - get-full-market-quote: GET /v2/market-quote/quotes?instrument_key=a,b (max 500); data keyed by
 *    "SEGMENT:SYMBOL", each row echoing instrument_token (= instrument_key), ohlc, depth.buy/sell
 *    (5 levels of quantity, price, orders), last_price, volume, oi.
 *  - v3/get-historical-candle-data: GET /v3/historical-candle/:key/:unit/:interval/:to_date/:from_date,
 *    units minutes (1-300), hours (1-5), days/weeks/months (1); candles
 *    [timestamp ISO+05:30, open, high, low, close, volume, oi]. Minute data 1-15 min: one month per call;
 *    larger minute/hour intervals: one quarter. Today's candles come from
 *    /v3/historical-candle/intraday/:key/:unit/:interval.
 *  - get-positions: GET /v2/portfolio/short-term-positions; get-holdings: GET
 *    /v2/portfolio/long-term-holdings; product I (intraday), D (delivery / carry-forward), CO, MTF.
 *  - get-user-fund-margin: GET /v2/user/get-funds-and-margin ({ equity, commodity }: used_margin,
 *    available_margin, payin_amount, span_margin, exposure_margin, notional_cash). Not served between
 *    00:00 and 05:30 IST (UDAPI100072).
 */

import { BrokerInputError } from "./contract.mjs";
import { upstoxFetch } from "./upstoxClient.mjs";
import { exchangeOfKey } from "./upstoxInstruments.mjs";

const QUOTE_BATCH = 500;
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v) => (Number(v) > 0 ? Number(v) : null);
const KEY_RE = /^[A-Z_]+\|[A-Za-z0-9 &.\-_]+$/;

/** Upstox exchange code (positions/orders carry NSE, NFO, BSE, BFO, CDS, BCD, MCX, NSCOM). */
const EXCHANGE = { NSE: "NSE", BSE: "BSE", NFO: "NFO", BFO: "BFO", CDS: "CDS", BCD: "CDS", MCX: "MCX", NSCOM: "MCX" };
export const upstoxExchange = (exchange, key) => EXCHANGE[exchange] ?? exchangeOfKey(key) ?? "NSE";

/** Upstox product -> contract product. D is delivery for cash (CNC) and carry-forward for F&O (MARGIN). */
export function upstoxProduct(product, exchange) {
  if (product === "I") return "INTRADAY";
  if (product === "CO") return "CO";
  if (product === "MTF") return "MTF";
  if (product === "D") return exchange === "NSE" || exchange === "BSE" ? "CNC" : "MARGIN";
  return "INTRADAY";
}

function checkKey(token) {
  const key = String(token ?? "");
  if (!KEY_RE.test(key)) throw new BrokerInputError(`Upstox: ${key || "(empty)"} is not an instrument_key like NSE_FO|50978.`);
  return key;
}

/** Raw /v2/market-quote/quotes rows indexed by instrument_key. */
async function quotesByKey(creds, keys) {
  const out = new Map();
  for (let i = 0; i < keys.length; i += QUOTE_BATCH) {
    const chunk = keys.slice(i, i + QUOTE_BATCH);
    const body = await upstoxFetch("/v2/market-quote/quotes", creds, { query: { instrument_key: chunk.join(",") } });
    for (const row of Object.values(body.data ?? {})) if (row?.instrument_token) out.set(row.instrument_token, row);
  }
  return out;
}

export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || refs.length === 0) return { status: "success", data: [] };
  const keys = refs.map((r) => checkKey(r.token));
  const rows = await quotesByKey(creds, keys);
  const data = [];
  for (const ref of refs) {
    const q = rows.get(String(ref.token));
    if (!q) continue;
    data.push({
      token: String(ref.token),
      exchange: ref.exchange ?? exchangeOfKey(ref.token),
      ltp: n(q.last_price),
      open: numOrNull(q.ohlc?.open),
      high: numOrNull(q.ohlc?.high),
      low: numOrNull(q.ohlc?.low),
      close: numOrNull(q.ohlc?.close),
      volume: numOrNull(q.volume),
      oi: numOrNull(q.oi),
      bid: positive(q.depth?.buy?.[0]?.price),
      ask: positive(q.depth?.sell?.[0]?.price),
    });
  }
  return { status: "success", data };
}

const level = (l) => ({ price: n(l?.price), qty: n(l?.quantity), orders: numOrNull(l?.orders) });

export async function fetchDepth(creds, ref) {
  const key = checkKey(ref?.token);
  const q = (await quotesByKey(creds, [key])).get(key);
  return { status: "success", data: { bids: (q?.depth?.buy ?? []).map(level), asks: (q?.depth?.sell ?? []).map(level) } };
}

// ── historical ──

const UNIT = { "1m": ["minutes", "1"], "3m": ["minutes", "3"], "5m": ["minutes", "5"], "15m": ["minutes", "15"], "30m": ["minutes", "30"], "60m": ["hours", "1"], "1d": ["days", "1"] };

const isoDay = (v, label) => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "").trim());
  if (!m) throw new BrokerInputError(`Upstox historical: ${label} must start with YYYY-MM-DD`);
  return m[1];
};
const istToday = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function addCandles(byTime, candles) {
  for (const c of candles ?? []) {
    const ms = Date.parse(String(c[0]));
    if (!Number.isFinite(ms)) continue;
    const time = Math.floor(ms / 1000);
    const candle = { time, open: n(c[1]), high: n(c[2]), low: n(c[3]), close: n(c[4]), volume: n(c[5]) };
    if (c.length > 6 && Number(c[6]) > 0) candle.oi = Number(c[6]);
    byTime.set(time, candle);
  }
}

/** Candle[] ascending (Upstox returns newest first). Adds today's intraday candles when `to` is today. */
export async function fetchHistorical(creds, { instrument, interval, from, to } = {}, { now = Date.now() } = {}) {
  const spec = UNIT[interval];
  if (!spec) throw new BrokerInputError(`Upstox historical: unsupported interval ${interval}.`);
  const key = encodeURIComponent(checkKey(instrument?.token));
  const [unit, step] = spec;
  const fromDay = isoDay(from, "from");
  const toDay = isoDay(to, "to");
  const byTime = new Map();
  const hist = await upstoxFetch(`/v3/historical-candle/${key}/${unit}/${step}/${toDay}/${fromDay}`, creds);
  addCandles(byTime, hist.data?.candles);
  if (toDay >= istToday(now) && unit !== "days") {
    const intra = await upstoxFetch(`/v3/historical-candle/intraday/${key}/${unit}/${step}`, creds);
    addCandles(byTime, intra.data?.candles);
  }
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}

// ── portfolio (read-only) ──

const list = (body) => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []);

export function mapUpstoxPosition(p) {
  const exchange = upstoxExchange(p.exchange, p.instrument_token);
  return {
    tradingSymbol: String(p.trading_symbol ?? p.tradingsymbol ?? ""),
    exchange,
    token: String(p.instrument_token ?? ""),
    product: upstoxProduct(p.product, exchange),
    netQty: n(p.quantity),
    avgPrice: n(p.average_price),
    ltp: numOrNull(p.last_price),
    pnl: n(p.pnl),
    realisedPnl: numOrNull(p.realised),
    unrealisedPnl: numOrNull(p.unrealised),
  };
}

export function mapUpstoxHolding(h) {
  return {
    tradingSymbol: String(h.trading_symbol ?? h.tradingsymbol ?? ""),
    exchange: upstoxExchange(h.exchange, h.instrument_token),
    token: String(h.instrument_token ?? ""),
    isin: h.isin ? String(h.isin) : null,
    qty: n(h.quantity),
    avgPrice: n(h.average_price),
    ltp: numOrNull(h.last_price),
    pnl: numOrNull(h.pnl),
  };
}

export async function fetchPositions(creds) {
  return { status: "success", data: list(await upstoxFetch("/v2/portfolio/short-term-positions", creds)).map(mapUpstoxPosition) };
}

export async function fetchHoldings(creds) {
  return { status: "success", data: list(await upstoxFetch("/v2/portfolio/long-term-holdings", creds)).map(mapUpstoxHolding) };
}

/** Equity segment: available_margin is what can be used now, used_margin what is blocked. */
export function mapUpstoxFunds(data) {
  const eq = data?.equity ?? {};
  return {
    availableCash: n(eq.available_margin),
    usedMargin: n(eq.used_margin),
    totalBalance: eq.available_margin != null && eq.used_margin != null ? n(eq.available_margin) + n(eq.used_margin) : null,
    collateral: null,
    withdrawable: null,
  };
}

export async function fetchFunds(creds) {
  const body = await upstoxFetch("/v2/user/get-funds-and-margin", creds);
  return { status: "success", data: mapUpstoxFunds(body.data) };
}
