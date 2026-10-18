/**
 * Nubra instrument master and symbol mapping.
 *
 * Official docs (checked 2026-10): https://nubra.io/products/api/docs/rest-api-v3/get-instruments.html
 *  GET /refdata/refdata/{YYYY-MM-DD}?exchange=NSE|BSE|MCX (authenticated) ->
 *  { exchange, is_trading_on, refdata: [{ ref_id, strike_price (paise), option_type, token, stock_name, series,
 *    zanskar_name, lot_size, asset, expiry (YYYYMMDD), exchange, derivative_type (OPT, FUT, ...), isin,
 *    asset_type (e.g. INDEX_FO), tick_size (paise), underlying_prev_close }] }
 *  `ref_id` is the id that orders, the order book (/orderbooks/{ref_id}) and positions use; it is this app's
 *  instrument `token` for Nubra. `asset` is the underlying name the option-chain endpoint takes.
 *  Nubra labels F&O rows with exchange NSE/BSE; the contract's NFO/BFO is derived from derivative_type.
 */

import { BrokerError, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { nubraFetch } from "./nubraAuth.mjs";
import { getCachedOrFetch } from "../lib/instrumentCache.mjs";

/** App symbol -> { asset, exchange } for /optionchains/{asset}?exchange=... and /optionchains/{asset}/price. */
export function underlyingRef(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&_-]{1,30}$/.test(s)) return null;
  return { asset: s, exchange: s === "SENSEX" || s === "BANKEX" ? "BSE" : "NSE", isIndex: CANONICAL_UNDERLYINGS.includes(s) };
}

const OTHER_INDEX = new Set(["NIFTYNXT50", "SENSEX50"]);

/** 20261020 -> "2026-10-20". */
export function yyyymmddToIso(v) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Nubra exchange + derivative flag -> contract exchange. */
export function contractExchange(exchange, isDerivative) {
  const e = String(exchange || "").toUpperCase();
  if (e === "MCX") return "MCX";
  if (!isDerivative) return e;
  return e === "BSE" ? "BFO" : "NFO";
}

/** Is a Nubra row / refData a derivative? */
export function isDerivativeRow(r) {
  const d = String(r?.derivative_type ?? r?.derivativeType ?? "").toUpperCase();
  const a = String(r?.asset_type ?? r?.assetType ?? "").toUpperCase();
  return d === "OPT" || d === "FUT" || a.endsWith("_FO");
}

/** One refdata row -> contract Instrument, or null. */
export function toInstrument(r) {
  const d = String(r?.derivative_type || "").toUpperCase();
  const asset = String(r?.asset || "").toUpperCase();
  const token = r?.ref_id !== undefined ? String(r.ref_id) : "";
  if (!token || String(r?.exchange || "").toUpperCase() === "MCX") return null;
  const tickSize = Number(r.tick_size) > 0 ? Number(r.tick_size) / 100 : 0.05;
  const lotSize = Number(r.lot_size) > 0 ? Number(r.lot_size) : 1;
  const tradingSymbol = String(r.stock_name || "").trim();
  if (!tradingSymbol) return null;
  if (d === "OPT" || d === "FUT") {
    if (OTHER_INDEX.has(asset)) return null;
    const isIndex = CANONICAL_UNDERLYINGS.includes(asset) || String(r.asset_type || "").toUpperCase().startsWith("INDEX");
    if (isIndex && !CANONICAL_UNDERLYINGS.includes(asset)) return null;
    const expiry = yyyymmddToIso(r.expiry);
    if (!expiry) return null;
    const exchange = contractExchange(r.exchange, true);
    if (d === "FUT") return { token, exchange, tradingSymbol, underlying: asset, instrumentType: isIndex ? "FUTIDX" : "FUTSTK", expiry, strike: null, optionType: null, lotSize, tickSize };
    const optionType = String(r.option_type || "").toUpperCase();
    const strike = Number(r.strike_price) / 100;
    if ((optionType !== "CE" && optionType !== "PE") || !(strike > 0)) return null;
    return { token, exchange, tradingSymbol, underlying: asset, instrumentType: isIndex ? "OPTIDX" : "OPTSTK", expiry, strike, optionType, lotSize, tickSize };
  }
  if (String(r.asset_type || "").toUpperCase() === "STOCK" || d === "STOCK" || d === "EQ") {
    return { token, exchange: contractExchange(r.exchange, false), tradingSymbol, underlying: asset || tradingSymbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null, lotSize, tickSize };
  }
  return null;
}

/** Today's date in IST as YYYY-MM-DD (refdata is published per trading date). */
export function istDate(now = Date.now()) {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Raw refdata rows for NSE + BSE for today, cached per date (6 hours). The masters are the same for every
 * account, so the cache is shared; the fetch still needs a session.
 */
export async function getRefdata(creds, now = Date.now()) {
  const date = istDate(now);
  return getCachedOrFetch(`nubra:refdata:${date}`, async () => {
    const rows = [];
    for (const exchange of ["NSE", "BSE"]) {
      const json = await nubraFetch(creds, `/refdata/refdata/${date}?exchange=${exchange}`, { what: `${exchange} instruments` });
      for (const r of Array.isArray(json?.refdata) ? json.refdata : []) {
        if (!r || r.ref_id === undefined) continue;
        const { ref_id, strike_price, option_type, stock_name, lot_size, asset, expiry, derivative_type, asset_type, tick_size } = r;
        rows.push({ ref_id, strike_price, option_type, stock_name, lot_size, asset, expiry, exchange: r.exchange || exchange, derivative_type, asset_type, tick_size });
      }
    }
    if (!rows.length) throw new BrokerError("Nubra instrument master was empty");
    return rows;
  }, 6 * 60 * 60 * 1000);
}
