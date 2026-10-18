/**
 * Dhan v2 market data beyond the option chain: instrument master, full quotes, depth and candles.
 * Re-exported from dhan.mjs.
 *
 * Official sources (October 2026):
 *  - Instrument list: https://dhanhq.co/docs/v2/instruments/ — detailed CSV at
 *    https://images.dhan.co/api-data/api-scrip-master-detailed.csv (public, no auth). Columns used:
 *    EXCH_ID, SEGMENT (I/E/D/C/M), SECURITY_ID, INSTRUMENT, UNDERLYING_SYMBOL, SYMBOL_NAME, DISPLAY_NAME,
 *    INSTRUMENT_TYPE, LOT_SIZE, SM_EXPIRY_DATE, STRIKE_PRICE, OPTION_TYPE, TICK_SIZE.
 *    TICK_SIZE is in paise on every tradeable row (NIFTY options read 5.0000 = Rs 0.05); index rows
 *    already carry rupees (0.0500). We convert to rupees.
 *  - Market quote: https://dhanhq.co/docs/v2/market-quote/ — POST /marketfeed/quote, body
 *    { "<SEGMENT>": [securityId, ...] }, up to 1000 instruments per call, 1 request per second.
 *  - Historical: https://dhanhq.co/docs/v2/historical-data/ — POST /charts/historical (daily,
 *    "YYYY-MM-DD", toDate non-inclusive) and /charts/intraday (interval 1/5/15/25/60, "YYYY-MM-DD HH:MM:SS",
 *    at most 90 days per call). Both return parallel arrays open/high/low/close/volume/timestamp
 *    (epoch seconds) and open_interest.
 *
 * Instrument tokens: Dhan's SECURITY_ID is only unique inside an exchange segment, and an index shares
 * the NSE/BSE exchange code with that exchange's equities. Index rows therefore carry the token
 * "IDX_I:<id>" (e.g. "IDX_I:13" for NIFTY); every other row carries the bare SECURITY_ID and the
 * segment is derived from the contract exchange (NSE -> NSE_EQ, NFO -> NSE_FNO, BSE -> BSE_EQ, ...).
 */

import { brokerFetch, BrokerInputError, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { dhanFetch } from "./dhan.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { sleep } from "../lib/batch.mjs";

export const DHAN_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";
const QUOTE_BATCH = 1000;
const QUOTE_GAP_MS = 1000;
const INTRADAY_MAX_DAYS = 90;

/** Contract exchange -> Dhan exchange segment for a non-index token. */
export const SEGMENT_OF_EXCHANGE = { NSE: "NSE_EQ", BSE: "BSE_EQ", NFO: "NSE_FNO", BFO: "BSE_FNO", MCX: "MCX_COMM", CDS: "NSE_CURRENCY" };
const EXCHANGE_OF_SEGMENT = { NSE_EQ: "NSE", BSE_EQ: "BSE", NSE_FNO: "NFO", BSE_FNO: "BFO", MCX_COMM: "MCX", NSE_CURRENCY: "CDS", BSE_CURRENCY: "CDS" };
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);

// ── daily cache (memory only under vitest so fixture data never reaches the shared disk cache) ──

const memCache = new Map();
async function dailyCache(key, fn) {
  if (!process.env.VITEST) return getCachedOrFetch(key, fn, ONE_DAY_MS);
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ONE_DAY_MS) return hit.value;
  const value = await fn();
  memCache.set(key, { value, at: Date.now() });
  return value;
}

/** Test hook: forget the cached instrument master. */
export function resetDhanMarketCache() {
  memCache.clear();
}

// ── CSV ──

/** Split one CSV line, honouring double quotes (Dhan names can contain commas inside quotes). */
export function splitCsvLine(line) {
  if (!line.includes('"')) return line.split(",");
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const DERIVATIVES = { OPTIDX: "OPTIDX", OPTSTK: "OPTSTK", FUTIDX: "FUTIDX", FUTSTK: "FUTSTK" };
const EQUITY_TYPES = new Set(["ES", "ETF"]);

/** One detailed-master row -> contract Instrument, or null for rows outside NSE/BSE cash, indices and F&O. */
export function mapDhanMasterRow(get) {
  const exch = get("EXCH_ID");
  if (exch !== "NSE" && exch !== "BSE") return null;
  const seg = get("SEGMENT");
  const id = get("SECURITY_ID");
  if (!id) return null;
  const rawTick = parseFloat(get("TICK_SIZE"));
  const lot = parseFloat(get("LOT_SIZE"));
  const base = { lotSize: lot > 0 ? lot : 1 };

  if (seg === "I") {
    const sym = get("UNDERLYING_SYMBOL") || get("SYMBOL_NAME");
    return { token: `IDX_I:${id}`, exchange: exch, tradingSymbol: sym, underlying: sym, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, ...base, tickSize: rawTick > 0 ? rawTick : 0.05 };
  }
  const tickSize = rawTick > 0 ? rawTick / 100 : 0.05;
  if (seg === "E") {
    if (get("INSTRUMENT") !== "EQUITY" || !EQUITY_TYPES.has(get("INSTRUMENT_TYPE"))) return null;
    const sym = get("UNDERLYING_SYMBOL") || get("SYMBOL_NAME");
    return { token: id, exchange: exch, tradingSymbol: sym, underlying: sym, instrumentType: "EQ", expiry: null, strike: null, optionType: null, ...base, tickSize };
  }
  if (seg !== "D") return null;
  const instrumentType = DERIVATIVES[get("INSTRUMENT")];
  if (!instrumentType) return null;
  const underlying = get("UNDERLYING_SYMBOL");
  // Index derivatives on non-canonical underlyings (NIFTYNXT50, SENSEX50, FOCIT, NIFTYFPI) are left out:
  // the app's index list is CANONICAL_UNDERLYINGS.
  if ((instrumentType === "OPTIDX" || instrumentType === "FUTIDX") && !CANONICAL.has(underlying)) return null;
  const expiry = String(get("SM_EXPIRY_DATE")).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const isOpt = instrumentType.startsWith("OPT");
  const optionType = isOpt ? get("OPTION_TYPE") : null;
  const strike = isOpt ? parseFloat(get("STRIKE_PRICE")) : null;
  if (isOpt && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) return null;
  // NSE rows carry a unique SYMBOL_NAME ("NIFTY-Nov2026-17350-CE"); BSE rows repeat a series code
  // ("BSXOPT"), so their unique DISPLAY_NAME is used instead.
  const tradingSymbol = exch === "NSE" ? get("SYMBOL_NAME") : get("DISPLAY_NAME");
  return { token: id, exchange: exch === "NSE" ? "NFO" : "BFO", tradingSymbol, underlying, instrumentType, expiry, strike, optionType, ...base, tickSize };
}

export function parseDhanMaster(text) {
  const lines = String(text).split(/\r?\n/);
  const header = splitCsvLine(lines[0] || "").map((h) => h.trim());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  for (const need of ["EXCH_ID", "SEGMENT", "SECURITY_ID", "INSTRUMENT", "LOT_SIZE", "TICK_SIZE"]) {
    if (col[need] === undefined) throw new Error(`Dhan instrument master is missing column ${need}`);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitCsvLine(lines[i]);
    const get = (name) => (col[name] === undefined ? "" : String(cells[col[name]] ?? "").trim());
    const row = mapDhanMasterRow(get);
    if (row) rows.push(row);
  }
  return rows;
}

async function loadMaster() {
  return dailyCache("dhan:instruments:detailed-v1", async () => {
    const res = await brokerFetch(DHAN_MASTER_URL, { redirect: "follow" }, { kind: "master" });
    if (!res.ok) throw new Error(`Dhan instrument master download failed [${res.status}]`);
    return parseDhanMaster(await res.text());
  });
}

/** Instrument[] for NSE/BSE indices, cash equities and F&O (canonical index underlyings + all stocks). */
export async function fetchInstruments() {
  return { status: "success", data: await loadMaster() };
}

// ── refs ──

/** InstrumentRef -> { segment, securityId }. Accepts "IDX_I:13" style tokens for indices. */
export function dhanRef(ref) {
  const token = String(ref?.token ?? "");
  const m = /^([A-Z_]+):(\d+)$/.exec(token);
  if (m) return { segment: m[1], securityId: m[2] };
  const segment = SEGMENT_OF_EXCHANGE[ref?.exchange];
  if (!segment || !/^\d+$/.test(token)) throw new BrokerInputError(`Dhan: unsupported instrument ${ref?.exchange}:${token}`);
  return { segment, securityId: token };
}

const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const firstPositive = (levels) => {
  const p = Number(levels?.[0]?.price);
  return Number.isFinite(p) && p > 0 ? p : null;
};

function toQuote(ref, q) {
  return {
    token: String(ref.token),
    exchange: ref.exchange,
    ltp: Number(q?.last_price) || 0,
    open: numOrNull(q?.ohlc?.open),
    high: numOrNull(q?.ohlc?.high),
    low: numOrNull(q?.ohlc?.low),
    close: numOrNull(q?.ohlc?.close),
    volume: numOrNull(q?.volume),
    oi: numOrNull(q?.oi),
    bid: firstPositive(q?.depth?.buy),
    ask: firstPositive(q?.depth?.sell),
  };
}

async function quoteRaw(creds, refs) {
  const parsed = refs.map((r) => ({ ref: r, ...dhanRef(r) }));
  const out = new Map();
  for (let i = 0; i < parsed.length; i += QUOTE_BATCH) {
    if (i > 0) await sleep(QUOTE_GAP_MS);
    const chunk = parsed.slice(i, i + QUOTE_BATCH);
    const body = {};
    for (const p of chunk) (body[p.segment] ||= []).push(Number(p.securityId));
    const json = await dhanFetch("/marketfeed/quote", body, "POST", creds?.clientId, creds?.accessToken);
    for (const p of chunk) {
      const q = json?.data?.[p.segment]?.[p.securityId];
      if (q) out.set(`${p.segment}:${p.securityId}`, { ref: p.ref, q });
    }
  }
  return out;
}

/** Quote[] for up to any number of refs (1000 per call, 1 call per second). Missing instruments are skipped. */
export async function fetchQuotes(creds, refs = []) {
  if (!Array.isArray(refs) || refs.length === 0) return { status: "success", data: [] };
  const raw = await quoteRaw(creds, refs);
  return { status: "success", data: [...raw.values()].map(({ ref, q }) => toQuote(ref, q)) };
}

const level = (l) => ({ price: Number(l?.price) || 0, qty: Number(l?.quantity) || 0, orders: numOrNull(l?.orders) });

/** Five-level depth from /marketfeed/quote. */
export async function fetchDepth(creds, ref) {
  const raw = await quoteRaw(creds, [ref]);
  const hit = [...raw.values()][0];
  const depth = hit?.q?.depth ?? {};
  return { status: "success", data: { bids: (depth.buy ?? []).map(level), asks: (depth.sell ?? []).map(level) } };
}

// ── historical ──

const INTRADAY_INTERVAL = { "1m": "1", "5m": "5", "15m": "15", "60m": "60" };
const INSTRUMENT_OF_SEGMENT = { IDX_I: "INDEX", NSE_EQ: "EQUITY", BSE_EQ: "EQUITY" };

function parseWhen(v, label) {
  const s = String(v ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) throw new BrokerInputError(`Dhan historical: ${label} must be YYYY-MM-DD or YYYY-MM-DD HH:MM`);
  return { date: m[1], time: m[2] ? `${m[2]}:${m[3] ?? "00"}` : null };
}

async function instrumentEnum(ref, segment, securityId) {
  if (ref?.instrumentType) return ref.instrumentType === "EQ" ? "EQUITY" : ref.instrumentType;
  if (INSTRUMENT_OF_SEGMENT[segment]) return INSTRUMENT_OF_SEGMENT[segment];
  const exchange = EXCHANGE_OF_SEGMENT[segment];
  const row = (await loadMaster()).find((r) => r.token === securityId && r.exchange === exchange);
  if (!row) throw new BrokerInputError(`Dhan historical: ${segment} ${securityId} is not in the instrument master`);
  return row.instrumentType;
}

/** Candle[] (epoch seconds, ascending). Intervals: 1m, 5m, 15m, 60m (intraday, max 90 days) and 1d. */
export async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
  const { segment, securityId } = dhanRef(instrument);
  const isDaily = interval === "1d";
  if (!isDaily && !INTRADAY_INTERVAL[interval]) {
    throw new BrokerInputError(`Dhan historical: interval ${interval} is not offered (use 1m, 5m, 15m, 60m or 1d).`);
  }
  const f = parseWhen(from, "from");
  const t = parseWhen(to, "to");
  const body = { securityId, exchangeSegment: segment, instrument: await instrumentEnum(instrument, segment, securityId) };
  if (segment.endsWith("FNO") || segment === "MCX_COMM") body.oi = true;
  let path;
  if (isDaily) {
    path = "/charts/historical";
    body.fromDate = f.date;
    // toDate is documented as non-inclusive; ask for the day after so `to` itself is included.
    body.toDate = new Date(Date.parse(`${t.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  } else {
    const days = (Date.parse(`${t.date}T00:00:00Z`) - Date.parse(`${f.date}T00:00:00Z`)) / 86_400_000;
    if (days > INTRADAY_MAX_DAYS) throw new BrokerInputError("Dhan historical: intraday requests are limited to 90 days.");
    path = "/charts/intraday";
    body.interval = INTRADAY_INTERVAL[interval];
    body.fromDate = `${f.date} ${f.time ?? "09:15:00"}`;
    body.toDate = `${t.date} ${t.time ?? "15:30:00"}`;
  }
  const json = await dhanFetch(path, body, "POST", creds?.clientId, creds?.accessToken);
  const src = json?.data && Array.isArray(json.data.timestamp) ? json.data : json;
  const ts = Array.isArray(src?.timestamp) ? src.timestamp : [];
  const byTime = new Map();
  ts.forEach((raw, i) => {
    const time = Math.floor(Number(raw));
    if (!Number.isFinite(time) || time <= 0) return;
    const candle = { time, open: Number(src.open?.[i]), high: Number(src.high?.[i]), low: Number(src.low?.[i]), close: Number(src.close?.[i]), volume: Number(src.volume?.[i]) || 0 };
    const oi = Number(src.open_interest?.[i]);
    if (Number.isFinite(oi) && oi > 0) candle.oi = oi;
    if ([candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) byTime.set(time, candle);
  });
  return { status: "success", data: [...byTime.values()].sort((a, b) => a.time - b.time) };
}
