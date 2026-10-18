/**
 * Upstox instrument keys and the BOD instrument master.
 *
 * Official source: https://upstox.com/developer/api-documentation/instruments (October 2026)
 *  - BOD JSON (gzip): https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz
 *    (also NSE/BSE/MCX files). Public, no auth. JSON is the recommended format.
 *  - Fields: segment (NSE_EQ, NSE_INDEX, NSE_FO, BSE_EQ, BSE_INDEX, BSE_FO, NCD_FO, BCD_FO, MCX_FO,
 *    NSE_COM), instrument_type (EQ, INDEX, FUT, CE, PE, and BSE group letters for BSE_EQ),
 *    instrument_key ("NSE_FO|50978"), trading_symbol, name, lot_size, tick_size (in paise: options
 *    read 5.0 = Rs 0.05), expiry (epoch ms at 23:59:59 IST), strike_price, underlying_symbol,
 *    underlying_type, weekly. instrument_key is the stable identifier; exchange_token may be reused.
 *
 * Index keys below were checked against the live BOD file (October 2026); NSE_INDEX|Nifty 50 is also
 * the literal used throughout Upstox's own docs. They are fixed so that no data call needs the
 * multi-MB master just to find an index key (the previous version downloaded it on every cache miss).
 */

import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { gunzipCapped, readBodyCapped } from "../lib/safeArchive.mjs";

export const UPSTOX_MASTER_URL = "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz";

export const INDEX_KEYS = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
  SENSEX: "BSE_INDEX|SENSEX",
  BANKEX: "BSE_INDEX|BANKEX",
};

/** Resolve an app index symbol to its Upstox instrument_key (kept async for older callers). */
export async function resolveInstrumentKey(symbol) {
  const key = INDEX_KEYS[symbol];
  if (!key) throw new Error(`Unknown symbol for Upstox: ${symbol}. Supported: ${Object.keys(INDEX_KEYS).join(", ")}`);
  return key;
}

/** Upstox segment -> contract exchange. */
export const EXCHANGE_OF_SEGMENT = {
  NSE_EQ: "NSE", NSE_INDEX: "NSE", NSE_FO: "NFO", BSE_EQ: "BSE", BSE_INDEX: "BSE", BSE_FO: "BFO",
  MCX_FO: "MCX", NCD_FO: "CDS", BCD_FO: "CDS",
};
export const exchangeOfKey = (key) => EXCHANGE_OF_SEGMENT[String(key ?? "").split("|")[0]] ?? null;

const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const BSE_SHARE_GROUPS = new Set(["A", "B", "T", "X", "XT", "Z", "ZP", "M", "MT", "MS", "P", "TS", "R"]);
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** Epoch ms (or an ISO string) -> "YYYY-MM-DD" in IST. */
export function istDate(expiry) {
  if (typeof expiry === "string" && /^\d{4}-\d{2}-\d{2}/.test(expiry)) return expiry.slice(0, 10);
  const ms = Number(expiry);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** One BOD row -> contract Instrument, or null (MCX/currency/commodity, bonds, non-canonical index F&O). */
export function mapUpstoxRow(r) {
  const seg = r?.segment;
  const exchange = EXCHANGE_OF_SEGMENT[seg];
  if (!exchange || !r.instrument_key || !r.trading_symbol) return null;
  const tick = Number(r.tick_size);
  const lot = Number(r.lot_size);
  const base = { token: r.instrument_key, exchange, tradingSymbol: r.trading_symbol, lotSize: lot > 0 ? lot : 1 };
  if (seg === "NSE_INDEX" || seg === "BSE_INDEX") {
    return { ...base, tickSize: 0.05, underlying: r.trading_symbol, instrumentType: "INDEX", expiry: null, strike: null, optionType: null };
  }
  const tickSize = tick > 0 ? tick / 100 : 0.05;
  if (seg === "NSE_EQ" || seg === "BSE_EQ") {
    // NSE_EQ marks shares "EQ"; BSE_EQ uses the BSE scrip group (A, B, T, X, XT, Z, M, MT, ...).
    // Debt groups F (bonds/NCDs) and G (government securities) and NSE debt types are skipped.
    const isShare = seg === "NSE_EQ" ? r.instrument_type === "EQ" : BSE_SHARE_GROUPS.has(String(r.instrument_type));
    if (!isShare) return null;
    return { ...base, tickSize, underlying: r.trading_symbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null };
  }
  if (seg !== "NSE_FO" && seg !== "BSE_FO") return null;
  const underlying = r.underlying_symbol || r.name;
  const isIndex = r.underlying_type === "INDEX";
  if (isIndex && !CANONICAL.has(underlying)) return null;
  const expiry = istDate(r.expiry);
  if (!expiry) return null;
  if (r.instrument_type === "FUT") {
    return { ...base, tickSize, underlying, instrumentType: isIndex ? "FUTIDX" : "FUTSTK", expiry, strike: null, optionType: null };
  }
  if (r.instrument_type === "CE" || r.instrument_type === "PE") {
    const strike = Number(r.strike_price);
    if (!(strike > 0)) return null;
    return { ...base, tickSize, underlying, instrumentType: isIndex ? "OPTIDX" : "OPTSTK", expiry, strike, optionType: r.instrument_type };
  }
  return null;
}

// ── cache ──

const memCache = new Map();
async function dailyCache(key, fn) {
  if (!process.env.VITEST) return getCachedOrFetch(key, fn, ONE_DAY_MS);
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ONE_DAY_MS) return hit.value;
  const value = await fn();
  memCache.set(key, { value, at: Date.now() });
  return value;
}

export function resetUpstoxInstrumentCache() {
  memCache.clear();
}

// complete.json is the largest master the app reads; this keeps the inflated text under V8's ~512 MB string limit.
const UPSTOX_MAX_INFLATED_BYTES = 500 * 1024 * 1024;

/** Body bytes -> JSON, gunzipping (under a size cap) when the bytes carry the gzip magic number. */
export function decodeMaster(bytes) {
  const buf = Buffer.from(bytes);
  const gz = buf[0] === 0x1f && buf[1] === 0x8b;
  const text = (gz ? gunzipCapped(buf, { maxBytes: UPSTOX_MAX_INFLATED_BYTES, label: "Upstox instrument master" }) : buf).toString("utf-8");
  return JSON.parse(text);
}

async function loadMaster() {
  return dailyCache("upstox:instruments:complete-v1", async () => {
    const res = await brokerFetch(UPSTOX_MASTER_URL, { redirect: "follow" }, { kind: "master" });
    if (!res.ok) throw new Error(`Upstox instrument master download failed [${res.status}]`);
    const rows = decodeMaster(await readBodyCapped(res, { label: "Upstox instrument master" }));
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      const inst = mapUpstoxRow(r);
      if (inst) out.push(inst);
    }
    return out;
  });
}

/** Instrument[] for NSE/BSE indices, cash shares and F&O (public BOD file, cached daily). */
export async function fetchInstruments() {
  return { status: "success", data: await loadMaster() };
}
