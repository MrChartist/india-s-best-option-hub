/**
 * Fyers `/data/options-chain-v3` parsing and expiry checks (pure functions, no I/O).
 *
 * Official docs (https://fyers.in/api-docs/v3/api/market-data/option-chain/):
 *  - the first optionsChain row is the underlying itself (strike_price -1, option_type "");
 *  - with greeks=1 each strike carries `greeks: { delta, gamma, theta, vega, iv }`, and the documented
 *    sample shows iv in PERCENT (23.42), which is this app's convention, so it is passed through;
 *  - expiryData[] lists { date: "DD-MM-YYYY", expiry: "<epoch seconds>" };
 *  - per strike: ltp, bid, ask, volume, oi, oich (OI change), prev_oi.
 *
 * Symbol format (Appendix -> Symbology format): monthly options are {Ex}:{Underlying}{YY}{MMM}{Strike}{CE|PE}
 * and weekly options {Ex}:{Underlying}{YY}{M}{dd}{Strike}{CE|PE}, where M is 1-9 for Jan-Sep and O/N/D for
 * Oct/Nov/Dec. checkChainExpiry() uses that to prove the chain Fyers returned is the expiry we asked for.
 */

import { ddmmyyyyToIso, epochToIstDate, num } from "./fyersClient.mjs";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKLY_MONTH = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, O: 10, N: 11, D: 12 };

/** Backwards-compatible name used by older callers. */
export const parseExpiryDate = ddmmyyyyToIso;

/** expiryData[] -> [{ iso, epoch }] ascending. Uses the epoch when present (IST date), else the DD-MM-YYYY date. */
export function parseExpiryData(expiryData) {
  const out = [];
  for (const e of Array.isArray(expiryData) ? expiryData : []) {
    const iso = epochToIstDate(e?.expiry) || ddmmyyyyToIso(e?.date);
    if (iso) out.push({ iso, epoch: e?.expiry != null ? String(e.expiry) : null });
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}

/**
 * Parse a Fyers option ticker. Returns { yy, month, day|null, monthly, strike, optionType } or null.
 * `underlying` is the exchange symbol (NIFTY, SENSEX, RELIANCE ...) so names containing digits are safe.
 */
export function parseOptionTicker(ticker, underlying) {
  const body = String(ticker ?? "").replace(/^[A-Z]+:/, "");
  if (!underlying || !body.startsWith(underlying)) return null;
  const rest = body.slice(underlying.length);
  const monthly = /^(\d{2})([A-Z]{3})(\d+(?:\.\d+)?)(CE|PE)$/.exec(rest);
  if (monthly && MONTHS.includes(monthly[2])) {
    return { yy: monthly[1], month: MONTHS.indexOf(monthly[2]) + 1, day: null, monthly: true, strike: Number(monthly[3]), optionType: monthly[4] };
  }
  const weekly = /^(\d{2})([1-9OND])(\d{2})(\d+(?:\.\d+)?)(CE|PE)$/.exec(rest);
  if (weekly) {
    return { yy: weekly[1], month: WEEKLY_MONTH[weekly[2]], day: Number(weekly[3]), monthly: false, strike: Number(weekly[4]), optionType: weekly[5] };
  }
  return null;
}

/**
 * True when every CE/PE row of `optionsChain` belongs to `expiryIso`. A monthly ticker carries no day,
 * so it only matches when `expiryIso` is the last listed expiry of its month.
 */
export function checkChainExpiry(optionsChain, { underlying, expiryIso, expiries }) {
  const [y, m, d] = expiryIso.split("-").map(Number);
  const lastOfMonth = !expiries.some((e) => e.iso > expiryIso && e.iso.slice(0, 7) === expiryIso.slice(0, 7));
  let checked = 0;
  for (const row of optionsChain) {
    if (row?.option_type !== "CE" && row?.option_type !== "PE") continue;
    const t = parseOptionTicker(row.symbol, underlying);
    if (!t) return false;
    if (Number(t.yy) !== y % 100 || t.month !== m) return false;
    if (t.monthly ? !lastOfMonth : t.day !== d) return false;
    checked += 1;
  }
  return checked > 0;
}

function findSpot(optionsChain) {
  const underlyingRow = optionsChain.find((item) => !item?.option_type || Number(item.strike_price) === -1);
  return num(underlyingRow?.ltp);
}

function brokerGreeks(item) {
  const g = item?.greeks;
  if (!g || !(Number(g.iv) > 0)) return null; // absent or zero -> fall back to Black-Scholes
  return { iv: num(g.iv), delta: num(g.delta), gamma: num(g.gamma), theta: num(g.theta), vega: num(g.vega) };
}

/**
 * Raw optionsChain -> { oc, last_price } (Dhan-shaped legs). `computeIVAndGreeks` is injected so this
 * stays a pure transform.
 */
export function buildOptionsChain(optionsChain, { daysToExpiry, computeIVAndGreeks }) {
  const spot = findSpot(optionsChain);
  const oc = {};
  for (const item of optionsChain) {
    const type = item?.option_type;
    if (type !== "CE" && type !== "PE") continue;
    const strike = Number(item.strike_price);
    if (!(strike > 0)) continue;
    const ltp = num(item.ltp);
    const oi = num(item.oi);
    const greeks = brokerGreeks(item) || computeIVAndGreeks({ ltp, spot, strike, daysToExpiry, type });
    const leg = {
      last_price: ltp,
      oi,
      volume: num(item.volume),
      iv: greeks.iv,
      delta: greeks.delta,
      gamma: greeks.gamma,
      theta: greeks.theta,
      vega: greeks.vega,
      bid_price: num(item.bid),
      ask_price: num(item.ask),
    };
    if (item.oich != null) leg.oi_chg = num(item.oich);
    else if (item.prev_oi != null) leg.previous_oi = num(item.prev_oi);
    if (item.symbol) leg.security_id = String(item.symbol);
    (oc[String(strike)] ||= {})[type.toLowerCase()] = leg;
  }
  return { oc, last_price: spot };
}
