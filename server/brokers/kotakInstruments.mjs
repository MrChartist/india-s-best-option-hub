/**
 * Kotak Securities (Neo) scrip master: per-segment daily CSVs, parsed into a compact form.
 *
 * Official source: https://github.com/Kotak-Neo/Kotak-neo-api-v2 docs/Scrip_Master.md (+ the sample
 * neo_api_client/api/nse_fo.csv shipped with the SDK), checked 2026-10.
 *   GET <baseUrl>/script-details/1.0/masterscrip/file-paths   (Authorization: <app access token>)
 *   -> { filesPaths: ["https://lapi.kotaksecurities.com/wso2-scripmaster/v1/prod/<date>/transformed/nse_fo.csv", ...] }
 *   The doc sample has `filesPaths` at the top level; some clients read `data.filesPaths`. Both are accepted, and
 *   every returned URL must be https on a kotaksecurities.com host before it is fetched.
 * Columns used (headers carry stray spaces/semicolons, e.g. "dTickSize ", "dStrikePrice;"): pSymbol (token),
 * pExchSeg, pInstType (OPTIDX/OPTSTK/FUTIDX/FUTSTK), pSymbolName (underlying), pTrdSymbol, pOptionType (CE/PE/XX),
 * dStrikePrice (paise; may be written as 1.755e+06), lLotSize, lExpiryDate, dTickSize (paise), pAssetCode (the
 * underlying's nse_cm token for stock derivatives).
 * lExpiryDate: nse_fo and cde_fo count seconds from 1980-01-01 00:00 IST, so 315513000 is added to reach Unix time
 * (the SDK sample FINNIFTY2350917550PE has 1368109800 -> 2023-05-09 14:30 IST); bse_fo/mcx_fo are Unix seconds.
 */

import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { BrokerError, brokerFetch, BrokerInputError, CANONICAL_UNDERLYINGS } from "./contract.mjs";
import { safeKotakFileUrl, throwForResponse } from "./kotakAuth.mjs";

const FILE_PATHS_ENDPOINT = "/script-details/1.0/masterscrip/file-paths";
export const NSE_FO_EPOCH_OFFSET_SECONDS = 315513000;
const OFFSET_SEGMENTS = new Set(["nse_fo", "cde_fo"]);
const CANONICAL = new Set(CANONICAL_UNDERLYINGS);
const STOCK_RE = /^[A-Z0-9&-]{1,20}$/;

/** Segment holding each index's derivatives; stocks trade on nse_fo. */
const BSE_UNDERLYINGS = new Set(["SENSEX", "BANKEX"]);
export const segmentFor = (symbol) => (BSE_UNDERLYINGS.has(symbol) ? "bse_fo" : "nse_fo");

/**
 * Index-spot query names after `nse_cm|` / `bse_cm|` (exact case matters). The SDK's docs/Quotes.md uses
 * "Nifty 50" and "Nifty Bank"; the others follow the same exchange display names. MIDCPNIFTY has been seen under
 * more than one spelling, so the candidates are tried in order.
 */
export const INDEX_SPOT_QUERY = {
  NIFTY: { exchSeg: "nse_cm", names: ["Nifty 50"] },
  BANKNIFTY: { exchSeg: "nse_cm", names: ["Nifty Bank"] },
  FINNIFTY: { exchSeg: "nse_cm", names: ["Nifty Fin Service"] },
  MIDCPNIFTY: { exchSeg: "nse_cm", names: ["NIFTY MID SELECT", "Nifty Mid Select", "Nifty Midcap Select"] },
  SENSEX: { exchSeg: "bse_cm", names: ["SENSEX"] },
  BANKEX: { exchSeg: "bse_cm", names: ["BANKEX"] },
};

export function assertSymbol(symbol) {
  const s = String(symbol ?? "").toUpperCase();
  if (!CANONICAL.has(s) && !STOCK_RE.test(s)) throw new BrokerInputError(`Unknown symbol for Kotak Neo: ${symbol}`);
  return s;
}

const normalizeHeader = (h) => h.trim().replace(/;/g, "").replace(/\s+/g, "");

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]] = (cols[c] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

function epochToIstDate(unixSeconds) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(unixSeconds * 1000));
}

/** ISO expiry for a raw lExpiryDate in `segment`, or null for the "no expiry" sentinel (<= 0). */
export function expiryIso(raw, segment) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return epochToIstDate(OFFSET_SEGMENTS.has(segment) ? n + NSE_FO_EPOCH_OFFSET_SECONDS : n);
}

/** Compact F&O rows for one segment CSV. */
export function compactSegment(csvRows, segment) {
  const out = [];
  for (const r of csvRows) {
    const instType = String(r.pInstType || "").toUpperCase();
    if (!["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"].includes(instType)) continue;
    const opt = instType.startsWith("OPT");
    const optType = String(r.pOptionType || "").toUpperCase();
    if (opt && optType !== "CE" && optType !== "PE") continue;
    const expiry = expiryIso(r.lExpiryDate, segment);
    const token = String(r.pSymbol || "").trim();
    const root = String(r.pSymbolName || "").trim().toUpperCase();
    if (!expiry || !token || !root) continue;
    const strike = opt ? Number(r.dStrikePrice) / 100 : null;
    if (opt && !(strike > 0)) continue;
    out.push({
      token, root, instType, expiry, strike,
      optType: opt ? optType : null,
      trdSym: String(r.pTrdSymbol || ""),
      exchSeg: String(r.pExchSeg || segment),
      lotSize: Number(r.lLotSize) || 1,
      tickSize: (Number(r.dTickSize) || 5) / 100,
      assetCode: String(r.pAssetCode || ""),
    });
  }
  return out;
}

async function fetchFilePaths(session) {
  const res = await brokerFetch(`${session.baseUrl}${FILE_PATHS_ENDPOINT}`, {
    headers: { Authorization: session.accessToken, accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (!res.ok || !json) throwForResponse(res, json, text, "scrip-master paths", { sessionCall: false });
  const paths = json?.filesPaths ?? json?.data?.filesPaths;
  if (!Array.isArray(paths)) throw new BrokerError("Kotak Neo scrip-master paths: no filesPaths in the response");
  return paths;
}

async function downloadSegment(session, segment) {
  const paths = await fetchFilePaths(session);
  const raw = paths.find((u) => new RegExp(`/${segment}(-v\\d+)?\\.csv$`, "i").test(String(u)));
  const url = safeKotakFileUrl(raw);
  if (!url) throw new BrokerError(`Kotak Neo scrip master has no usable ${segment} CSV (only https kotaksecurities.com links are fetched)`);
  const res = await brokerFetch(url, { redirect: "follow" }, { kind: "master" });
  if (!res.ok) throw new BrokerError(`Kotak Neo scrip-master CSV download failed for ${segment} [HTTP ${res.status}]`);
  return compactSegment(parseCsv(await res.text()), segment);
}

/** Cached once a day per segment ("nse_fo"/"bse_fo"), shared across users (the CSVs are public links). */
export async function getSegmentMaster(session, segment) {
  return getCachedOrFetch(`kotak:instruments:v2:${segment}`, () => downloadSegment(session, segment), ONE_DAY_MS);
}

/** All option rows for `symbol` across expiries: { token, strike, type: "ce"|"pe", expiry, exchSeg, trdSym, lotSize }. */
export async function getOptionRows(session, symbol) {
  const rows = await getSegmentMaster(session, segmentFor(symbol));
  return rows
    .filter((r) => r.root === symbol && r.optType)
    .map((r) => ({ token: r.token, strike: r.strike, type: r.optType === "CE" ? "ce" : "pe", expiry: r.expiry, exchSeg: r.exchSeg, trdSym: r.trdSym, lotSize: r.lotSize, assetCode: r.assetCode }));
}

export function distinctExpiriesAscending(rows) {
  return [...new Set(rows.map((r) => r.expiry).filter(Boolean))].sort();
}

/** Quote targets for a symbol's spot: index name candidates, or the stock's nse_cm token (pAssetCode). */
export function spotTargets(symbol, optionRows = []) {
  const idx = INDEX_SPOT_QUERY[symbol];
  if (idx) return idx.names.map((name) => ({ exchSeg: idx.exchSeg, query: name }));
  const code = optionRows.find((r) => /^\d+$/.test(r.assetCode || ""))?.assetCode;
  return code ? [{ exchSeg: "nse_cm", query: code }] : [];
}

const EXCHANGE_OF_SEG = { nse_cm: "NSE", bse_cm: "BSE", nse_fo: "NFO", bse_fo: "BFO", cde_fo: "CDS", mcx_fo: "MCX", "bcs-fo": "CDS" };
const SEG_OF_EXCHANGE = { NSE: "nse_cm", BSE: "bse_cm", NFO: "nse_fo", BFO: "bse_fo", CDS: "cde_fo", MCX: "mcx_fo" };
export const contractExchange = (seg) => EXCHANGE_OF_SEG[String(seg || "").toLowerCase()] ?? "NSE";
export function kotakSegment(exchange) {
  const seg = SEG_OF_EXCHANGE[exchange];
  if (!seg) throw new BrokerInputError(`Unsupported exchange for Kotak Neo: ${exchange}`);
  return seg;
}

/** Contract Instrument for a compact row, or null for a non-canonical index derivative. */
export function toInstrument(r) {
  const index = r.instType.endsWith("IDX");
  if (index && !CANONICAL.has(r.root)) return null;
  const opt = r.instType.startsWith("OPT");
  return {
    token: r.token,
    exchange: contractExchange(r.exchSeg),
    tradingSymbol: r.trdSym || r.token,
    underlying: r.root,
    instrumentType: r.instType,
    expiry: r.expiry,
    strike: opt ? r.strike : null,
    optionType: opt ? r.optType : null,
    lotSize: r.lotSize,
    tickSize: r.tickSize,
  };
}
