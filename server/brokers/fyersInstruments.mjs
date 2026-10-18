/**
 * Fyers symbol master (F&O) -> contract Instrument rows.
 *
 * Official docs: https://fyers.in/api-docs/v3/api/market-information/symbol-master/symbol-master-file/
 *  - Public CSVs, no auth: https://public.fyers.in/sym_details/NSE_FO.csv and BSE_FO.csv (no header row).
 *  - Column order: Fytoken, Symbol Details, Exchange Instrument type, Minimum lot size, Tick size, ISIN,
 *    Trading Session, Last update date, Expiry date (epoch seconds), Symbol ticker, Exchange, Segment,
 *    Scrip code, Underlying symbol, Underlying scrip code, Strike price, Option type, Underlying FyToken,
 *    then three reserved columns.
 *  - Instrument types (Appendix): 11 FUTIDX, 13 FUTSTK, 14 OPTIDX, 15 OPTSTK (12 FUTIVX is skipped).
 * The contract `token` for Fyers is the Symbol ticker (e.g. "NSE:NIFTY26OCT25000CE"), because every Fyers
 * quote, depth, history and order API takes the ticker, not the numeric Fytoken.
 */

import { brokerFetch, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { contractExchange, epochToIstDate } from "./fyersClient.mjs";

export const FO_MASTER_URLS = {
  NSE_FO: "https://public.fyers.in/sym_details/NSE_FO.csv",
  BSE_FO: "https://public.fyers.in/sym_details/BSE_FO.csv",
};

const TYPE_BY_CODE = { 11: "FUTIDX", 13: "FUTSTK", 14: "OPTIDX", 15: "OPTSTK" };

/** Parse one master CSV body into Instrument rows (pure). */
export function parseFoMaster(text) {
  const rows = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const c = line.split(",");
    if (c.length < 17) continue;
    const instrumentType = TYPE_BY_CODE[Number(c[2])];
    if (!instrumentType) continue;
    const ticker = c[9];
    const underlying = String(c[13] || "").toUpperCase();
    const isIndex = instrumentType === "OPTIDX" || instrumentType === "FUTIDX";
    if (isIndex && !CANONICAL_UNDERLYINGS.includes(underlying)) continue; // e.g. NIFTYNXT50 is outside the contract set
    const isOption = instrumentType.startsWith("OPT");
    const lotSize = Number(c[3]);
    const tickSize = Number(c[4]);
    const expiry = epochToIstDate(c[8]);
    if (!ticker || !underlying || !(lotSize > 0) || !(tickSize > 0) || !expiry) continue;
    const strike = isOption ? Number(c[15]) : null;
    const optionType = isOption ? String(c[16]).toUpperCase() : null;
    if (isOption && (!(strike > 0) || (optionType !== "CE" && optionType !== "PE"))) continue;
    rows.push({
      token: ticker,
      exchange: contractExchange(ticker, c[11]),
      tradingSymbol: ticker.split(":")[1] || ticker,
      underlying,
      instrumentType,
      expiry,
      strike,
      optionType,
      lotSize,
      tickSize,
    });
  }
  return rows;
}

async function downloadMaster(url) {
  const res = await brokerFetch(url, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new Error(`Fyers symbol master download failed [${res.status}] for ${url.split("/").pop()}`);
  return parseFoMaster(await res.text());
}

/** Every NSE + BSE F&O instrument, cached for a day (shared disk/memory cache). */
export async function getFoInstruments() {
  return getCachedOrFetch("fyers:fo-master:v2", async () => {
    const [nse, bse] = await Promise.all([downloadMaster(FO_MASTER_URLS.NSE_FO), downloadMaster(FO_MASTER_URLS.BSE_FO)]);
    return [...nse, ...bse];
  }, ONE_DAY_MS);
}
