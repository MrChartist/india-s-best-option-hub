/**
 * ICICI Direct (Breeze) security master. Official docs (Instruments section, checked 2026-10): the master is the
 * public ZIP https://directlink.icicidirect.com/NewSecurityMaster/SecurityMaster.zip, regenerated daily at 8:00 AM.
 * It holds quoted CSV text files; two are used here:
 *  - NSEScripMaster.txt   "Token", "ShortName", "Series", "CompanyName", "ticksize", "Lotsize", ..., "ExchangeCode"
 *    (Token = NSE exchange token; ShortName = Breeze stock_code such as RELIND; ExchangeCode = NSE symbol;
 *    tick size in rupees). Index rows carry a name, not a number, in Token ("NIFTY 50").
 *  - FONSEScripMaster.txt "Token","InstrumentName" (OPTIDX | OPTSTK | FUTIDX | FUTSTK),"ShortName","Series",
 *    "ExpiryDate" ("27-Oct-2026"),"StrikePrice","OptionType" (CE | PE | XX), ...,"LotSize","TickSize" (paise),
 *    ...,"ExchangeCode" (NSE symbol of the underlying).
 * Breeze calls name an instrument by stock_code + exchange_code + product_type + expiry_date + right +
 * strike_price, never by token, so each row keeps its Breeze fields next to the contract ones.
 * Index stock codes: NIFTY, CNXBAN (BANKNIFTY), NIFFIN (FINNIFTY), NIFSEL (MIDCPNIFTY). BSE is not on Breeze.
 */

import { BrokerError, BrokerInputError, brokerFetch } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { listZipEntries, readBodyCapped, readZipEntry } from "../lib/safeArchive.mjs";

export const MASTER_URL = "https://directlink.icicidirect.com/NewSecurityMaster/SecurityMaster.zip";

/** Breeze index stock_code <-> canonical underlying, with the NSE exchange token used as the contract token. */
export const INDEX_CODES = Object.freeze({
  NIFTY: { code: "NIFTY", token: "26000", name: "NIFTY 50" },
  BANKNIFTY: { code: "CNXBAN", token: "26009", name: "NIFTY BANK" },
  FINNIFTY: { code: "NIFFIN", token: "26037", name: "NIFTY FIN SERVICE" },
  MIDCPNIFTY: { code: "NIFSEL", token: "26074", name: "NIFTY MID SELECT" },
});
const CANONICAL_OF_CODE = Object.fromEntries(Object.entries(INDEX_CODES).map(([u, v]) => [v.code, u]));
const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** Quote-aware split of one CSV line (fields may be quoted, with spaces after the commas in the header). */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur.trim()); cur = ""; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const head = splitCsvLine(lines.shift() ?? "");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = splitCsvLine(line);
    const row = {};
    head.forEach((h, i) => { row[h] = cols[i] ?? ""; });
    rows.push(row);
  }
  return rows;
}

/** "27-Oct-2026" / "06-FEB-25" -> "2026-10-27"; null otherwise. */
export function expiryIso(raw) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(String(raw ?? "").trim());
  if (!m || !MONTHS[m[2].toUpperCase()]) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;
}

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function displaySymbol(u, expiry, strike, optionType) {
  const [y, m, d] = expiry.split("-");
  const date = `${d}${MON[Number(m) - 1]}${y.slice(2)}`;
  return optionType ? `${u}-${date}-${strike}-${optionType}` : `${u}-${date}-FUT`;
}

export function toEquity(r) {
  const token = String(r.Token ?? "");
  if (!/^\d+$/.test(token) || token === "0" || !["EQ", "BE"].includes(r.Series)) return null;
  const symbol = String(r.ExchangeCode || r.ShortName || "").toUpperCase();
  if (!symbol || !r.ShortName) return null;
  const tick = Number(r.ticksize);
  return {
    token, exchange: "NSE", tradingSymbol: symbol, underlying: symbol, instrumentType: "EQ", expiry: null, strike: null, optionType: null,
    lotSize: Math.max(1, Number(r.Lotsize) || 1), tickSize: tick > 0 ? tick : 0.05, breezeCode: r.ShortName,
  };
}

export function toDerivative(r) {
  const token = String(r.Token ?? "");
  const type = String(r.InstrumentName ?? "").toUpperCase();
  if (!/^\d+$/.test(token) || !["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(type)) return null;
  const code = String(r.ShortName ?? "");
  const underlying = type.endsWith("IDX") ? CANONICAL_OF_CODE[code] : String(r.ExchangeCode ?? "").toUpperCase();
  if (!underlying || !code) return null; // NIFNEX, NIF150, ... are not canonical
  const expiry = expiryIso(r.ExpiryDate);
  const lotSize = Number(r.LotSize);
  if (!expiry || !(lotSize > 0)) return null;
  const isOpt = type.startsWith("OPT");
  const optionType = isOpt ? String(r.OptionType).toUpperCase() : null;
  const strike = isOpt ? Number(r.StrikePrice) : null;
  if (isOpt && ((optionType !== "CE" && optionType !== "PE") || !(strike > 0))) return null;
  const tick = Number(r.TickSize) / 100;
  return {
    token, exchange: "NFO", tradingSymbol: displaySymbol(underlying, expiry, strike, optionType), underlying, instrumentType: type, expiry, strike, optionType,
    lotSize, tickSize: tick > 0 ? tick : 0.05, breezeCode: code,
  };
}

export function indexInstruments() {
  return Object.entries(INDEX_CODES).map(([underlying, v]) => ({
    token: v.token, exchange: "NSE", tradingSymbol: v.name, underlying, instrumentType: "INDEX", expiry: null, strike: null, optionType: null,
    lotSize: 1, tickSize: 0.05, breezeCode: v.code,
  }));
}

function entryText(buf, name) {
  const entry = listZipEntries(buf, { label: "ICICI Direct security master" }).find((e) => e.name.split("/").pop().toLowerCase() === name.toLowerCase());
  if (!entry) throw new BrokerError(`ICICI Direct security master: ${name} is missing from the ZIP`);
  return readZipEntry(buf, entry, { label: "ICICI Direct security master" }).toString("latin1");
}

async function download() {
  const res = await brokerFetch(MASTER_URL, { redirect: "follow" }, { kind: "master", label: "ICICI Direct" });
  if (!res.ok) throw new BrokerError(`ICICI Direct security master download failed (HTTP ${res.status})`);
  const buf = await readBodyCapped(res, { label: "ICICI Direct security master" });
  return {
    nse: parseCsv(entryText(buf, "NSEScripMaster.txt")).map(toEquity).filter(Boolean),
    fno: parseCsv(entryText(buf, "FONSEScripMaster.txt")).map(toDerivative).filter(Boolean),
  };
}

/** Daily-cached { nse, fno } rows (public reference data shared by every user). */
export function getMaster() {
  return getCachedOrFetch("icicidirect:master:v1", download, ONE_DAY_MS);
}

export function optionRows(master, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  return master.fno.filter((m) => m.underlying === u && m.optionType);
}

export function listExpiries(master, symbol) {
  return [...new Set(optionRows(master, symbol).map((m) => m.expiry))].sort();
}

/** Breeze stock_code for an underlying (index or NSE stock), or a BrokerInputError. */
export function stockCodeOf(master, symbol) {
  const u = String(symbol ?? "").toUpperCase();
  if (INDEX_CODES[u]) return INDEX_CODES[u].code;
  const eq = master.nse.find((m) => m.underlying === u);
  if (eq) return eq.breezeCode;
  const fo = master.fno.find((m) => m.underlying === u);
  if (fo) return fo.breezeCode;
  throw new BrokerInputError(`ICICI Direct: no NSE index or stock named ${symbol} (BSE is not available on Breeze)`);
}

/** Master row for a contract ref, or null. Index refs resolve to the synthetic index rows. */
export function rowOf(master, ref) {
  const token = String(ref?.token ?? "");
  if (ref?.exchange === "NFO") return master.fno.find((m) => m.token === token) ?? null;
  if (ref?.exchange === "NSE") return indexInstruments().find((m) => m.token === token) ?? master.nse.find((m) => m.token === token) ?? null;
  return null;
}

/** Breeze instrument parameters for a master row. */
export function breezeParams(row) {
  if (row.exchange === "NFO") {
    return {
      stock_code: row.breezeCode, exchange_code: "NFO", product_type: row.optionType ? "options" : "futures", expiry_date: `${row.expiry}T06:00:00.000Z`,
      right: row.optionType === "CE" ? "call" : row.optionType === "PE" ? "put" : "others", strike_price: row.optionType ? String(row.strike) : "0",
    };
  }
  return { stock_code: row.breezeCode, exchange_code: "NSE", product_type: "cash", expiry_date: "", right: "", strike_price: "" };
}

/** Find the F&O row for Breeze fields (stock_code, expiry "27-Feb-2025", right "Call"/"Put"/"Others", strike). */
export function findDerivative(master, { stock_code, expiry_date, right, strike_price }) {
  const expiry = expiryIso(expiry_date);
  const r = String(right ?? "").toLowerCase();
  const optionType = r.startsWith("c") ? "CE" : r.startsWith("p") ? "PE" : null;
  const strike = Number(strike_price);
  return master.fno.find((m) => m.breezeCode === String(stock_code ?? "").trim() && m.expiry === expiry && m.optionType === optionType && (optionType ? m.strike === strike : true)) ?? null;
}
