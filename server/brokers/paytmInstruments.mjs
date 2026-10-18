/**
 * Paytm Money security masters, symbol mapping and the live-quote call.
 *
 * Official docs:
 *  - security-master: public CSVs under https://developer.paytmmoney.com/data/v1/scrips/:
 *    security_master.csv (all), index_security_master.csv, option_security_master.csv, and NSE / BSE /
 *    FUTURE / EQUITY / ETF variants. Columns (header of the live files, October 2026; every field quoted):
 *      security_id, symbol, name, series, tick_size, lot_size, instrument_type, segment, exchange,
 *      upper_limit, lower_limit, expiry_date, strike_price, freeze_quantity
 *    instrument_type: I (index), ES (equity), ETF, OPTIDX, OPTSTK, FUTIDX, FUTSTK; segment E|D; exchange
 *    NSE|BSE (derivatives too). tick_size is in paise ("5.0000" = 0.05). Option rows: symbol
 *    "NIFTY-Oct2026-25000-CE", name "NIFTY 27 OCT 25000 CALL", expiry_date "2026-10-27 14:00:00".
 *    Index ids (index master): NIFTY 13, BANKNIFTY 25, FINNIFTY 27, NIFTY MID SELECT 442 (MIDCPNIFTY),
 *    SENSEX 51, BANKEX 69. The previous version used SENSEX = 1 (wrong) and could not quote BANKEX.
 *    Paytm reuses ids across scrip types (index 13 = NIFTY, equity 13 = ABB), so index instruments
 *    carry the token "IDX-<id>" in this adapter to keep tokens unique per exchange.
 *  - live-market-data-api: GET /data/v1/price/live?mode=LTP|QUOTE|FULL&pref={Exchange}:{ScripId}:{ScripType}
 *    (comma-separated, ScripType INDEX|EQUITY|ETF|FUTURE|OPTION). Response rows carry security_id but
 *    no exchange; "found": false marks a miss. FULL adds ohlc, volume_traded, oi, change_oi and 5-level
 *    depth (buy/sell: quantity, price, orders). No batch size is documented; we send 50 per call.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { sleep } from "../lib/batch.mjs";
import { PAYTM_BASE, paytmGet, toIsoDate } from "./paytmClient.mjs";
import { brokerFetch } from "./contract.mjs";

export const MASTER_URLS = Object.freeze({
  all: `${PAYTM_BASE}/data/v1/scrips/security_master.csv`,
  index: `${PAYTM_BASE}/data/v1/scrips/index_security_master.csv`,
  option: `${PAYTM_BASE}/data/v1/scrips/option_security_master.csv`,
});
export const QUOTE_BATCH_SIZE = 50;
const QUOTE_BATCH_DELAY_MS = 150;

/** App index symbol -> index-master names and the exchange its options trade on. */
export const INDEX_CONFIG = Object.freeze({
  NIFTY: { exchange: "NSE", names: ["NIFTY", "NIFTY 50"] },
  BANKNIFTY: { exchange: "NSE", names: ["BANKNIFTY", "NIFTY BANK"] },
  FINNIFTY: { exchange: "NSE", names: ["FINNIFTY", "NIFTY FIN SERVICE"] },
  MIDCPNIFTY: { exchange: "NSE", names: ["NIFTY MID SELECT", "MIDCPNIFTY"] },
  SENSEX: { exchange: "BSE", names: ["SENSEX"] },
  BANKEX: { exchange: "BSE", names: ["BANKEX"] },
});
const norm = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const CANONICAL_BY_NAME = new Map(Object.entries(INDEX_CONFIG).flatMap(([sym, c]) => c.names.map((n) => [`${c.exchange}:${norm(n)}`, sym])));

// ── CSV + cache ──

export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (cols[i] ?? "").trim()]));
  });
}

let memoryOnly = false;
const mem = new Map();
const inflight = new Map();

/** Tests: drop cached masters and stop using the shared disk cache. */
export function resetPaytmInstrumentCache({ diskCache = false } = {}) {
  memoryOnly = !diskCache;
  mem.clear();
  inflight.clear();
}

async function download(kind) {
  const res = await brokerFetch(MASTER_URLS[kind], { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Paytm Money ${kind} security master download failed [${res.status}]`);
  return parseCsv(await res.text());
}

/** kind: "all" | "index" | "option"; cached for a day. */
export async function getMaster(kind) {
  if (!memoryOnly) return getCachedOrFetch(`paytm:security-master:${kind}:v2`, () => download(kind), ONE_DAY_MS);
  const hit = mem.get(kind);
  if (hit && Date.now() - hit.at < ONE_DAY_MS) return hit.rows;
  if (!inflight.has(kind)) {
    inflight.set(kind, download(kind).then((rows) => { mem.set(kind, { rows, at: Date.now() }); return rows; }).finally(() => inflight.delete(kind)));
  }
  return inflight.get(kind);
}

// ── mapping ──

export const tickSizeOf = (raw) => {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v / 100 : 0.05;
};

export function indexNameOf(row) {
  return CANONICAL_BY_NAME.get(`${String(row.exchange).toUpperCase()}:${norm(row.name)}`) ?? norm(row.name).replace(/\s+/g, "");
}

export function optionTypeOf(row) {
  const sym = String(row.symbol ?? "").toUpperCase();
  if (sym.endsWith("-CE")) return "CE";
  if (sym.endsWith("-PE")) return "PE";
  const name = String(row.name ?? "").toUpperCase();
  return /\bCALL$/.test(name) ? "CE" : /\bPUT$/.test(name) ? "PE" : null;
}

/** Master row -> contract Instrument (or null when out of scope). */
export function toInstrument(row) {
  const ex = String(row.exchange).toUpperCase();
  const type = String(row.instrument_type).toUpperCase();
  const id = String(row.security_id ?? "");
  if ((ex !== "NSE" && ex !== "BSE") || !/^\d+$/.test(id)) return null;
  const lot = Number(row.lot_size);
  const lotSize = Number.isFinite(lot) && lot > 0 ? lot : 1;
  if (type === "I") {
    const name = indexNameOf(row);
    return { token: `IDX-${id}`, exchange: ex, tradingSymbol: name, underlying: name, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 };
  }
  if (type === "ES" || type === "ETF") {
    const sym = String(row.symbol || row.name);
    return { token: id, exchange: ex, tradingSymbol: sym, underlying: sym, instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize, tickSize: tickSizeOf(row.tick_size) };
  }
  if (!["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(type)) return null;
  const expiry = toIsoDate(row.expiry_date);
  const underlying = String(row.name ?? "").trim().split(/\s+/)[0];
  if (!expiry || !underlying) return null;
  const isOpt = type.startsWith("OPT");
  const optionType = isOpt ? optionTypeOf(row) : null;
  const strike = Number(row.strike_price);
  if (isOpt && (!optionType || !(strike > 0))) return null;
  return {
    token: id, exchange: ex === "NSE" ? "NFO" : "BFO", tradingSymbol: String(row.symbol), underlying, instrumentType: type, expiry,
    strike: isOpt ? strike : null, optionType, lotSize, tickSize: tickSizeOf(row.tick_size),
  };
}

/** Index security_id for an app symbol from the index master. */
export async function indexIdFor(symbol) {
  const cfg = INDEX_CONFIG[symbol];
  if (!cfg) return null;
  const names = new Set(cfg.names.map(norm));
  const row = (await getMaster("index")).find((r) => String(r.exchange).toUpperCase() === cfg.exchange && String(r.instrument_type).toUpperCase() === "I" && names.has(norm(r.name)));
  return row ? String(row.security_id) : null;
}

/** OPTIDX rows of an index from the option master. */
export async function optionRowsFor(symbol) {
  const cfg = INDEX_CONFIG[symbol];
  if (!cfg) throw new Error(`Paytm Money: unknown symbol ${symbol}`);
  return (await getMaster("option")).filter(
    (r) => String(r.instrument_type).toUpperCase() === "OPTIDX" && String(r.exchange).toUpperCase() === cfg.exchange && String(r.name).toUpperCase().split(/\s+/)[0] === symbol,
  );
}

// ── live quotes ──

/**
 * GET /data/v1/price/live for prefs [{ exchange: NSE|BSE, id, scripType }] in chunks.
 * Returns Map<"EXCH:id:TYPE", row> for rows with found !== false (rows are matched back by
 * security_id within each chunk, since the response carries no exchange).
 */
export async function fetchLive(creds, mode, prefs) {
  const out = new Map();
  for (let i = 0; i < prefs.length; i += QUOTE_BATCH_SIZE) {
    if (i > 0) await sleep(QUOTE_BATCH_DELAY_MS);
    const chunk = prefs.slice(i, i + QUOTE_BATCH_SIZE);
    const pref = chunk.map((p) => `${p.exchange}:${p.id}:${p.scripType}`).join(",");
    const json = await paytmGet(`/data/v1/price/live?mode=${mode}&pref=${encodeURIComponent(pref)}`, creds);
    const byId = new Map();
    for (const row of Array.isArray(json?.data) ? json.data : []) {
      if (row?.found === false) continue;
      const list = byId.get(String(row.security_id)) ?? [];
      list.push(row);
      byId.set(String(row.security_id), list);
    }
    for (const p of chunk) {
      const rows = byId.get(String(p.id));
      if (rows?.length) out.set(`${p.exchange}:${p.id}:${p.scripType}`, rows.shift());
    }
  }
  return out;
}
