/**
 * Shared engine for the three Symphony Fintech "XTS" white-label brokers owned together in this repo:
 * CompositEdge (compositedge.mjs), IndiaBulls Securities (ibulls.mjs) and Jainam (jainamxts.mjs).
 * Each broker file only supplies its host, its market-data path and how its Interactive (trading)
 * session is opened; everything else (endpoints, payloads, field names, segment codes, the instrument
 * master layout, order enums) is the same XTS product. Other XTS-based adapters in this repo (wisdom,
 * iifl, rmoney) are owned elsewhere and do not import this file.
 *
 * Facts below come from Symphony Fintech's official XTS documentation, i.e. the OpenAPI specs behind
 * https://symphonyfintech.com/interactive/doc/ and https://symphonyfintech.com/marketdata/doc/ (the
 * "XTS Trading / Market Data Front-End API" pages), and from Symphony's official SDKs
 * (github.com/symphonyfintech/xts-pythonclient-api-sdk, the binary-market-data SDK, and the npm packages
 * xts-interactive-api / xts-marketdata-api, MIT licensed). OpenAlgo (AGPL) was read for facts only;
 * no code was taken from it.
 *
 *  Market data (base = host + /apimarketdata, or /apibinarymarketdata on binary-feed deployments):
 *   POST /auth/login {appKey, secretKey, source:"WebAPI"} -> {type:"success", result:{token, userID}}
 *   GET  /config/clientConfig                       (optional, authenticated; testConnection uses it)
 *   POST /instruments/master {exchangeSegmentList:["NSEFO"]} -> result = pipe-delimited lines
 *   GET  /instruments/indexlist?exchangeSegment=1    -> result.indexList ["NIFTY 50_26000", ...]
 *   POST /instruments/quotes {instruments:[{exchangeSegment:2, exchangeInstrumentID}], xtsMessageCode, publishFormat:"JSON"}
 *        -> result.listQuotes = array of JSON STRINGS. 1502 = market data (Touchline + 5-level Bids/Asks),
 *           1510 = open interest. Touchline carries no OI, so the chain needs both.
 *   GET  /instruments/ohlc?exchangeSegment=NSECM&exchangeInstrumentID=22&startTime=Jul 13 2020 090000&endTime=...&compressionValue=60
 *        -> result.dataReponse (sic) = "epoch|o|h|l|c|v|oi|,..." where epoch encodes IST wall-clock time as if UTC.
 *   Rate limit (official table): masters, quotes, OHLC and search are 1 request/second each.
 *   Only one session may exist per appKey/secretKey pair, so sessions are cached and logins de-duplicated.
 *
 *  Interactive (base = host + /interactive):
 *   POST /user/session {appKey, secretKey, source:"WebAPI"} (or, on 3-legged deployments, with the
 *        request token from the broker's login page) -> result {token, userID, isInvestorClient, clientCodes}
 *   GET  /user/balance, /orders, /orders/trades, /portfolio/positions?dayOrNet=NetWise, /portfolio/holdings
 *   POST /orders, PUT /orders, DELETE /orders?appOrderID=&orderUniqueIdentifier=
 *   clientID is sent only for dealer logins (isInvestorClient=false), as the official SDKs do.
 *   Rate limit: order book, positions, holdings and balance 1/s; place/modify/cancel 10/s.
 *   Enums (official): productType CNC|MIS|NRML|CO; orderType Limit|Market|StopLimit|StopMarket;
 *   timeInForce DAY|IOC; order states PendingNew, New, PartiallyFilled, Filled, PendingReplace, Replaced,
 *   PendingCancel, Cancelled, Rejected.
 *  Error envelope: {type:"error", code:"e-token-0005", description:"Invalid Token"}.
 *
 * Where OpenAlgo differs from the official docs we follow the docs:
 *  - orderType: OpenAlgo sends MARKET/LIMIT/STOPLIMIT/STOPMARKET; the docs list Market/Limit/StopLimit/StopMarket.
 *  - Holdings: the docs nest them under result.RMSHoldingList.Holdings; OpenAlgo reads result.RMSHoldings.Holdings.
 *    Both are accepted.
 *  - Positions: the docs show result as the list; OpenAlgo reads result.positionList. Both are accepted.
 *  - Balance: the docs show BalanceList as one object; OpenAlgo indexes it as an array. Both are accepted.
 *
 * Nothing secret is logged. Session tokens live only in this process. Hosts are fixed per broker; no
 * host returned by a broker is ever followed.
 */

import { createHash } from "node:crypto";
import {
  BrokerError, BrokerInputError, SessionRequiredError, CANONICAL_UNDERLYINGS,
  normaliseError as baseNormalise, redactSecrets, withOrderGate,
  brokerFetch,
  ORDER_BOOK_HINT,
} from "./contract.mjs";
import { getCachedOrFetch, ONE_DAY_MS } from "../lib/instrumentCache.mjs";
import { computeIVAndGreeks, daysBetween } from "../lib/blackScholes.mjs";
import { sleep } from "../lib/batch.mjs";
import { nextIstMidnightMs } from "./sessionLogin.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";

// ── codes ──

/** XTS numeric exchange-segment ids (official clientConfig / indexlist docs). */
export const SEGMENT_ID = Object.freeze({ NSECM: 1, NSEFO: 2, NSECD: 3, BSECM: 11, BSEFO: 12, MCXFO: 51 });
const SEGMENT_OF_ID = Object.fromEntries(Object.entries(SEGMENT_ID).map(([k, v]) => [v, k]));
/** App exchange -> XTS segment name. */
export const SEGMENT_OF_EXCHANGE = Object.freeze({ NSE: "NSECM", NFO: "NSEFO", CDS: "NSECD", BSE: "BSECM", BFO: "BSEFO", MCX: "MCXFO" });
const EXCHANGE_OF_SEGMENT = Object.fromEntries(Object.entries(SEGMENT_OF_EXCHANGE).map(([k, v]) => [v, k]));

export const MSG_MARKET_DATA = 1502;
export const MSG_OPEN_INTEREST = 1510;
export const QUOTE_BATCH_SIZE = 50; // instruments per /instruments/quotes call (broker-side cap; not in the public docs)
const DEFAULT_MD_INTERVAL_MS = 1000; // official: 1 request/second for quotes, masters and OHLC
const DEFAULT_READ_INTERVAL_MS = 1000; // official: 1/s for order book, positions, holdings, balance
const DEFAULT_ORDER_INTERVAL_MS = 100; // official: 10/s for place/modify/cancel
const STRIKE_WINDOW = 25; // strikes each side of ATM quoted per chain (keeps a chain to ~7 calls at 1 call/second)
const IST_OFFSET_S = 19_800;

/**
 * Index underlyings: F&O master segment, index-list segment and the index-list names. NSE names are
 * the exchange's official index names as XTS lists them ("NIFTY 50_26000" in the official sample).
 */
export const INDEX_UNDERLYINGS = Object.freeze({
  NIFTY: { foSegment: "NSEFO", indexSegment: "NSECM", spotNames: ["NIFTY 50"] },
  BANKNIFTY: { foSegment: "NSEFO", indexSegment: "NSECM", spotNames: ["NIFTY BANK"] },
  FINNIFTY: { foSegment: "NSEFO", indexSegment: "NSECM", spotNames: ["NIFTY FIN SERVICE", "NIFTY FINANCIAL SERVICES"] },
  MIDCPNIFTY: { foSegment: "NSEFO", indexSegment: "NSECM", spotNames: ["NIFTY MID SELECT", "NIFTY MIDCAP SELECT"] },
  SENSEX: { foSegment: "BSEFO", indexSegment: "BSECM", spotNames: ["SENSEX"] },
  BANKEX: { foSegment: "BSEFO", indexSegment: "BSECM", spotNames: ["BANKEX"] },
});

const INDEX_SERIES = new Set(["OPTIDX", "FUTIDX", "IO", "IF"]);
const FUTURE_SERIES = new Set(["FUTIDX", "FUTSTK", "IF", "SF"]);
const STOCK_SYMBOL_RE = /^[A-Z0-9&-]{1,20}$/;

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v === null || v === undefined ? "" : String(v));
const sha = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

// ── master parsing (pure) ──

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/**
 * ContractExpiration -> "YYYY-MM-DD". The official master sample uses ISO ("2021-05-27T14:30:00", the
 * exchange-local expiry time); DD-MON-YYYY and DDMONYYYY are accepted defensively.
 */
export function expiryToIso(raw) {
  const s = str(raw).trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[- ]?([A-Za-z]{3})[- ]?(\d{4})/.exec(s);
  if (dmy && MONTHS[dmy[2].toUpperCase()]) return `${dmy[3]}-${MONTHS[dmy[2].toUpperCase()]}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/**
 * Parse one F&O segment of /instruments/master. Official column order for Futures/Options/Spread rows:
 * 0 ExchangeSegment | 1 ExchangeInstrumentID | 2 InstrumentType | 3 Name | 4 Description | 5 Series |
 * 6 NameWithSeries | 7 InstrumentID | 8 PriceBand.High | 9 PriceBand.Low | 10 FreezeQty | 11 TickSize |
 * 12 LotSize | 13 Multiplier | 14 UnderlyingInstrumentId | 15 UnderlyingIndexName | 16 ContractExpiration |
 * 17 StrikePrice | 18 OptionType (3 = CE, 4 = PE) | 19 displayName | 20 PriceNumerator | 21 PriceDenominator
 * (live files append DetailedDescription). Returns compact rows for options and futures only.
 */
export function parseFoMaster(text) {
  const rows = [];
  for (const line of str(text).split("\n")) {
    if (!line.trim()) continue;
    const f = line.split("|");
    if (f.length < 17) continue;
    const series = str(f[5]).trim().toUpperCase();
    const optCode = str(f[18]).trim();
    const isOption = optCode === "3" || optCode === "4";
    const isFuture = !isOption && FUTURE_SERIES.has(series);
    if (!isOption && !isFuture) continue;
    const expiry = expiryToIso(f[16]);
    if (!expiry) continue;
    const strike = isOption ? num(f[17]) : null;
    if (isOption && !(strike > 0)) continue;
    rows.push({
      seg: str(f[0]).trim(),
      token: str(f[1]).trim(),
      name: str(f[3]).trim().toUpperCase(),
      sym: str(f[4]).trim(),
      series,
      tick: num(f[11]) || 0.05,
      lot: num(f[12]),
      und: str(f[14]).trim(),
      expiry,
      strike,
      opt: isOption ? (optCode === "3" ? "CE" : "PE") : null,
    });
  }
  return rows;
}

/** "NIFTY 50_26000" entries -> [{ name, token }]. Split on the LAST underscore. */
export function parseIndexList(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const s = str(entry);
    const i = s.lastIndexOf("_");
    if (i <= 0) continue;
    out.push({ name: s.slice(0, i).trim().toUpperCase().replace(/\s+/g, " "), token: s.slice(i + 1).trim() });
  }
  return out;
}

/** InstrumentID "1100100014366" -> NSE cash token "14366" (prefix 11001 + 8-digit token, per the official samples). */
export function underlyingCashToken(instrumentId) {
  const m = /^11001(\d{8})$/.exec(str(instrumentId));
  return m ? String(Number(m[1])) : null;
}

const isIndexRow = (r) => INDEX_SERIES.has(r.series) || Boolean(INDEX_UNDERLYINGS[r.name]);

/** Master row -> contract Instrument, or null for index derivatives outside CANONICAL_UNDERLYINGS. */
export function toInstrument(r) {
  const index = isIndexRow(r);
  if (index && !CANONICAL_UNDERLYINGS.includes(r.name)) return null;
  const exchange = EXCHANGE_OF_SEGMENT[r.seg];
  if (!exchange || !(r.lot > 0)) return null;
  return {
    token: r.token,
    exchange,
    tradingSymbol: r.sym || r.token,
    underlying: r.name,
    instrumentType: r.opt ? (index ? "OPTIDX" : "OPTSTK") : index ? "FUTIDX" : "FUTSTK",
    expiry: r.expiry,
    strike: r.opt ? r.strike : null,
    optionType: r.opt,
    lotSize: r.lot,
    tickSize: r.tick > 0 ? r.tick : 0.05,
  };
}

// ── quote parsing (pure) ──

export function parseListQuotes(result) {
  const out = [];
  for (const raw of result?.listQuotes || []) {
    if (raw && typeof raw === "object") { out.push(raw); continue; }
    try { const q = JSON.parse(raw); if (q && typeof q === "object") out.push(q); } catch { /* skip one bad row */ }
  }
  return out;
}

const quoteKey = (segmentId, token) => `${Number(segmentId)}_${str(token)}`;

// ── order mapping (pure) ──

const PRODUCT_TO_XTS = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML", MIS: "MIS", NRML: "NRML" };
const PRODUCT_FROM_XTS = { CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN", CO: "CO", BO: "BO" };
const ORDER_TYPE_TO_XTS = { MARKET: "Market", LIMIT: "Limit", SL: "StopLimit", "SL-M": "StopMarket" };
const VALIDITY = new Set(["DAY", "IOC"]);
const SIDES = new Set(["BUY", "SELL"]);

function uniqueIdentifier(tag) {
  const cleaned = str(tag).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
  return cleaned || "mrchub";
}

/** Pure body builder for POST /interactive/orders. resolvedLotSize must come from the instrument master. */
export function buildOrderBody(order, resolvedLotSize) {
  const { exchange, token, transactionType, orderType, product = "MARGIN", validity = "DAY", lots, price, triggerPrice, tag } = order || {};
  const segment = SEGMENT_OF_EXCHANGE[exchange];
  if (!segment) throw new BrokerInputError(`Invalid exchange: ${exchange}`);
  if (!/^\d{1,12}$/.test(str(token))) throw new BrokerInputError("Missing or invalid instrument token");
  if (!SIDES.has(transactionType)) throw new BrokerInputError(`Invalid transactionType: ${transactionType}`);
  if (!ORDER_TYPE_TO_XTS[orderType]) throw new BrokerInputError(`Invalid orderType: ${orderType}`);
  if (!PRODUCT_TO_XTS[product]) throw new BrokerInputError(`Unsupported product: ${product} (XTS offers CNC, MIS and NRML here)`);
  if (!VALIDITY.has(validity)) throw new BrokerInputError(`Invalid validity: ${validity}`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new BrokerInputError("Missing resolved lot size: it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isFinite(lots) || lots <= 0 || !Number.isInteger(lots)) throw new BrokerInputError("Invalid lots");
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsPrice && !(Number.isFinite(price) && price > 0)) throw new BrokerInputError(`price required for ${orderType}`);
  if (needsTrigger && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw new BrokerInputError(`triggerPrice required for ${orderType}`);
  return {
    exchangeSegment: segment,
    exchangeInstrumentID: Number(token),
    productType: PRODUCT_TO_XTS[product],
    orderType: ORDER_TYPE_TO_XTS[orderType],
    orderSide: transactionType,
    timeInForce: validity,
    disclosedQuantity: 0,
    orderQuantity: Math.round(lots * resolvedLotSize),
    limitPrice: needsPrice ? price : 0,
    stopPrice: needsTrigger ? triggerPrice : 0,
    orderUniqueIdentifier: uniqueIdentifier(tag),
  };
}

function checkOrderId(orderId) {
  const id = str(orderId);
  if (!/^\d{1,20}$/.test(id)) throw new BrokerInputError("Invalid order id");
  return id;
}

/**
 * Pure body builder for PUT /interactive/orders. XTS requires every modified* field, so the caller
 * must send the order's product, type and full quantity (from a fresh order-book read).
 */
export function buildModifyBody(orderId, changes) {
  const { orderType, product, quantity, price, triggerPrice, validity = "DAY", tag } = changes || {};
  if (!ORDER_TYPE_TO_XTS[orderType]) throw new BrokerInputError(`Invalid orderType: ${orderType}`);
  if (!PRODUCT_TO_XTS[product]) throw new BrokerInputError(`Unsupported product: ${product}`);
  if (!VALIDITY.has(validity)) throw new BrokerInputError(`Invalid validity: ${validity}`);
  if (!(Number.isInteger(quantity) && quantity > 0)) throw new BrokerInputError("quantity (total order quantity) is required");
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsPrice && !(Number.isFinite(price) && price > 0)) throw new BrokerInputError(`price required for ${orderType}`);
  if (needsTrigger && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw new BrokerInputError(`triggerPrice required for ${orderType}`);
  return {
    appOrderID: Number(checkOrderId(orderId)),
    modifiedProductType: PRODUCT_TO_XTS[product],
    modifiedOrderType: ORDER_TYPE_TO_XTS[orderType],
    modifiedOrderQuantity: quantity,
    modifiedDisclosedQuantity: 0,
    modifiedLimitPrice: needsPrice ? price : 0,
    modifiedStopPrice: needsTrigger ? triggerPrice : 0,
    modifiedTimeInForce: validity,
    orderUniqueIdentifier: uniqueIdentifier(tag),
  };
}

/** XTS order state (+ order type) -> contract OrderStatus. */
export function mapOrderStatus(status, orderType) {
  const s = str(status).replace(/\s+/g, "").toLowerCase();
  const stop = /^stop/i.test(str(orderType));
  switch (s) {
    case "pendingnew": case "new": case "open": case "pendingreplace": case "replaced": case "pendingcancel":
      return stop ? "TRIGGER_PENDING" : "OPEN";
    case "partiallyfilled": return "PARTIALLY_FILLED";
    case "filled": return "COMPLETE";
    case "cancelled": case "canceled": return "CANCELLED";
    case "rejected": return "REJECTED";
    case "expired": return "EXPIRED";
    default: return "UNKNOWN";
  }
}

const exchangeOfAny = (seg) => EXCHANGE_OF_SEGMENT[str(seg)] ?? EXCHANGE_OF_SEGMENT[SEGMENT_OF_ID[Number(seg)]] ?? "NSE";
const productOf = (p) => PRODUCT_FROM_XTS[str(p).toUpperCase()] ?? "INTRADAY";

/** "14-05-2021 11:17:29" (IST) -> "2021-05-14T11:17:29+05:30"; anything else -> null. */
export function xtsTimeToIso(raw) {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(str(raw).trim());
  if (!m || m[3] === "1980") return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

export function mapOrder(o) {
  const qty = num(o.OrderQuantity);
  const filled = num(o.CumulativeQuantity);
  const leaves = numOrNull(o.LeavesQuantity);
  return {
    orderId: str(o.AppOrderID),
    tradingSymbol: str(o.TradingSymbol),
    exchange: exchangeOfAny(o.ExchangeSegment),
    token: str(o.ExchangeInstrumentID),
    side: str(o.OrderSide).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty,
    filledQty: filled,
    pendingQty: leaves ?? Math.max(qty - filled, 0),
    price: num(o.OrderPrice),
    triggerPrice: num(o.OrderStopPrice),
    avgPrice: num(o.OrderAverageTradedPrice),
    orderType: str(o.OrderType) || "Limit",
    product: productOf(o.ProductType),
    status: mapOrderStatus(o.OrderStatus, o.OrderType),
    statusMessage: str(o.CancelRejectReason) || null,
    placedAt: xtsTimeToIso(o.OrderGeneratedDateTime),
  };
}

export function mapTrade(t) {
  return {
    tradeId: str(t.ExecutionID || t.ExchangeOrderID || t.AppOrderID),
    orderId: str(t.AppOrderID),
    tradingSymbol: str(t.TradingSymbol),
    exchange: exchangeOfAny(t.ExchangeSegment),
    token: str(t.ExchangeInstrumentID),
    side: str(t.OrderSide).toUpperCase() === "SELL" ? "SELL" : "BUY",
    qty: num(t.LastTradedQuantity ?? t.CumulativeQuantity),
    price: num(t.LastTradedPrice ?? t.OrderAverageTradedPrice),
    tradedAt: xtsTimeToIso(t.LastExecutionTransactTime ?? t.ExchangeTransactTime),
  };
}

export function mapPosition(p) {
  const netQty = num(p.Quantity ?? p.NetQty);
  const realised = numOrNull(p.RealizedMTM);
  const unrealised = numOrNull(p.UnrealizedMTM);
  const mtm = numOrNull(p.MTM);
  return {
    tradingSymbol: str(p.TradingSymbol),
    exchange: exchangeOfAny(p.ExchangeSegment),
    token: str(p.ExchangeInstrumentID),
    product: productOf(p.ProductType),
    netQty,
    avgPrice: netQty > 0 ? num(p.BuyAveragePrice) : netQty < 0 ? num(p.SellAveragePrice) : 0,
    ltp: null,
    pnl: mtm ?? num(realised) + num(unrealised),
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

/** The holdings map (keyed by ISIN) in either documented or observed nesting. */
function holdingsMap(result) {
  const box = result?.RMSHoldingList ?? result?.RMSHoldings ?? {};
  const list = Array.isArray(box) ? box[0] : box;
  return list?.Holdings && typeof list.Holdings === "object" ? list.Holdings : {};
}

export function mapHolding(h) {
  const nse = str(h.ExchangeNSEInstrumentId);
  const useNse = nse && nse !== "0";
  return {
    // XTS holdings carry no trading symbol; the ISIN is the stable identifier.
    tradingSymbol: str(h.TradingSymbol || h.ISIN),
    exchange: useNse ? "NSE" : "BSE",
    token: useNse ? nse : str(h.ExchangeBSEInstrumentId),
    isin: h.ISIN ? str(h.ISIN) : null,
    qty: num(h.HoldingQuantity),
    avgPrice: num(h.BuyAvgPrice),
    ltp: null,
    pnl: null,
  };
}

export function mapFunds(result) {
  const raw = result?.BalanceList;
  const entry = Array.isArray(raw) ? raw[0] : raw;
  const rms = entry?.limitObject?.RMSSubLimits ?? {};
  return {
    availableCash: num(rms.netMarginAvailable),
    usedMargin: num(rms.marginUtilized),
    totalBalance: numOrNull(rms.cashAvailable),
    collateral: numOrNull(rms.collateral),
    withdrawable: null,
  };
}

// ── historical (pure) ──

const INTERVAL_TO_COMPRESSION = { "1m": "60", "3m": "180", "5m": "300", "15m": "900", "30m": "1800", "60m": "3600", "1d": "D" };
const MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Parse "YYYY-MM-DD" (as IST) or any ISO datetime into epoch ms. */
function parseWhen(value, endOfDay) {
  const s = str(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}+05:30`);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new BrokerInputError(`Invalid date: ${s}`);
  return t;
}

/** Epoch ms -> "Jul 13 2020 090000" in IST (the official OHLC time format). */
export function toXtsTime(ms) {
  const d = new Date(ms + IST_OFFSET_S * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${MON_ABBR[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** dataReponse -> Candle[] (epoch seconds, ascending, de-duplicated). */
export function parseOhlc(dataResponse, interval) {
  const out = new Map();
  const daily = interval === "1d";
  const step = daily ? 0 : Number(INTERVAL_TO_COMPRESSION[interval]) || 60;
  for (const row of str(dataResponse).split(",")) {
    const f = row.split("|");
    if (f.length < 6) continue;
    const raw = Number(f[0]);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    let time;
    if (daily) {
      const d = new Date(raw * 1000); // the epoch encodes IST wall-clock time
      time = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000) - IST_OFFSET_S;
    } else {
      time = raw - IST_OFFSET_S;
      time -= time % step;
    }
    const candle = { time, open: num(f[1]), high: num(f[2]), low: num(f[3]), close: num(f[4]), volume: num(f[5]) };
    const oi = numOrNull(f[6]);
    if (oi !== null) candle.oi = oi;
    out.set(time, candle);
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

// ── errors ──

const TOKEN_REJECTED = /invalid token|token expired|token is not valid|session expired|e-token-/i;

function isTokenRejection(status, json) {
  return status === 401 || TOKEN_REJECTED.test(`${str(json?.code)} ${str(json?.description)}`);
}

// ── throttle ──

function createThrottle(intervalRef) {
  let chain = Promise.resolve();
  let next = 0;
  return function take() {
    const p = chain.then(async () => {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait);
      next = Date.now() + intervalRef();
    });
    chain = p.catch(() => {});
    return p;
  };
}

// ── factory ──

/**
 * @param {object} cfg
 * @param {string} cfg.id              broker id
 * @param {string} cfg.label           user-facing name
 * @param {string} cfg.host            https origin, fixed
 * @param {string} cfg.marketDataPath  "/apimarketdata" or "/apibinarymarketdata"
 * @param {{key: string, secret: string}} cfg.marketFields      creds keys of the Market Data app
 * @param {"keyPair"|"requestToken"} cfg.interactiveMode
 * @param {string} [cfg.requestTokenField]  creds key of the one-time request token (requestToken mode)
 * @param {string} [cfg.loginHint]          user-facing hint on how to get a new request token
 */
export function createXtsBroker(cfg) {
  const { id, label, host, marketDataPath, marketFields, interactiveMode, requestTokenField = "requestToken", loginHint = "" } = cfg;
  const MD = `${host}${marketDataPath}`;
  const IA = `${host}/interactive`;
  const intervals = { md: DEFAULT_MD_INTERVAL_MS, read: DEFAULT_READ_INTERVAL_MS, order: DEFAULT_ORDER_INTERVAL_MS };
  const mdThrottle = createThrottle(() => intervals.md);
  const readThrottle = createThrottle(() => intervals.read);
  const orderThrottle = createThrottle(() => intervals.order);

  const mdSessions = createSessionCache(); // sha(key, secret) -> { token, userId, expiresAt }
  const iaSessions = createSessionCache(); // sha(...) -> { token, userId, isInvestorClient, expiresAt }
  const inflight = new Map();
  const deadRequestTokens = new Set();

  // ── transport ──

  async function rawFetch(url, { method = "GET", body, token } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.authorization = token; // XTS takes the bare token, no "Bearer"
    let res;
    try {
      res = await brokerFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new BrokerError(`${label}: network error (${e?.message || e})`);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, ok: res.ok, json };
  }

  function upstreamError(status, json, what) {
    const desc = str(json?.description || json?.message) || `HTTP ${status}`;
    if (status === 429 || /rate limit|too many/i.test(desc)) {
      return new BrokerError(`${label}: rate limit hit on ${what} (${desc}).`, { code: "UPSTREAM_RATE_LIMIT" });
    }
    if (isTokenRejection(status, json)) return new BrokerError(`${label}: the broker rejected the session on ${what} (${desc}).`, { code: "UPSTREAM_AUTH" });
    return new BrokerError(`${label}: ${what} failed (${desc}).`);
  }

  const withQuery = (url, query) => {
    if (!query) return url;
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    return qs ? `${url}?${qs}` : url;
  };

  function dedupe(key, fn) {
    let p = inflight.get(key);
    if (!p) {
      p = (async () => { try { return await fn(); } finally { inflight.delete(key); } })();
      inflight.set(key, p);
    }
    return p;
  }

  // ── market-data session ──

  function marketKeys(creds) {
    const appKey = str(creds?.[marketFields.key]).trim();
    const secretKey = str(creds?.[marketFields.secret]).trim();
    if (!appKey || !secretKey) throw new BrokerInputError(`${label}: missing ${[!appKey && marketFields.key, !secretKey && marketFields.secret].filter(Boolean).join(", ")} (Market Data app keys).`);
    return { appKey, secretKey, cacheKey: sha([id, "md", appKey, secretKey]) };
  }

  async function marketSession(creds) {
    const { appKey, secretKey, cacheKey } = marketKeys(creds);
    const hit = mdSessions.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return { ...hit, cacheKey };
    return dedupe(cacheKey, async () => {
      const r = await rawFetch(`${MD}/auth/login`, { method: "POST", body: { appKey, secretKey, source: "WebAPI" } });
      if (r.json?.type !== "success" || !r.json?.result?.token) {
        const desc = str(r.json?.description) || `HTTP ${r.status}`;
        throw new BrokerError(`${label}: market-data login failed (${desc}). Check the Market Data App Key and Secret Key.`, { code: "UPSTREAM_AUTH" });
      }
      const s = { token: str(r.json.result.token), userId: str(r.json.result.userID) || null, expiresAt: nextIstMidnightMs() };
      mdSessions.set(cacheKey, s);
      return { ...s, cacheKey };
    });
  }

  /** Authenticated market-data call; one silent re-login on a token rejection (no human secret involved). */
  async function md(creds, path, { method = "GET", body, query, what = path } = {}) {
    let session = await marketSession(creds);
    await mdThrottle();
    let r = await rawFetch(withQuery(`${MD}${path}`, query), { method, body, token: session.token });
    if (r.json?.type !== "success" && isTokenRejection(r.status, r.json)) {
      mdSessions.delete(session.cacheKey);
      session = await marketSession(creds);
      await mdThrottle();
      r = await rawFetch(withQuery(`${MD}${path}`, query), { method, body, token: session.token });
    }
    if (r.json?.type !== "success") throw upstreamError(r.status, r.json, what);
    return r.json.result;
  }

  /** Masters and the index list: anonymous first (as the brokers serve them), authenticated retry. */
  async function mdPublic(creds, path, opts) {
    marketKeys(creds); // refuse incomplete settings before any download
    await mdThrottle();
    const r = await rawFetch(withQuery(`${MD}${path}`, opts.query), { method: opts.method || "GET", body: opts.body });
    if (r.json?.type === "success") return r.json.result;
    return md(creds, path, opts);
  }

  // ── interactive session ──

  function interactiveKeys(creds) {
    const appKey = str(creds?.interactiveApiKey).trim();
    const secretKey = str(creds?.interactiveApiSecret).trim();
    const missing = [!appKey && "interactiveApiKey", !secretKey && "interactiveApiSecret"].filter(Boolean);
    let requestToken = "";
    if (interactiveMode === "requestToken") {
      requestToken = str(creds?.[requestTokenField]).trim();
      if (!requestToken) missing.push(requestTokenField);
    }
    if (missing.length) throw new BrokerInputError(`${label}: trading (Interactive API) needs ${missing.join(", ")} in Broker Settings.`);
    return { appKey, secretKey, requestToken, cacheKey: sha([id, "ia", appKey, secretKey, requestToken]) };
  }

  async function interactiveSession(creds) {
    const keys = interactiveKeys(creds);
    const hit = iaSessions.get(keys.cacheKey);
    if (hit && hit.expiresAt > Date.now()) return { ...hit, cacheKey: keys.cacheKey };
    if (interactiveMode === "requestToken" && deadRequestTokens.has(keys.cacheKey)) {
      throw new SessionRequiredError(`${label}: this login token has already been used or has expired. ${loginHint}`);
    }
    return dedupe(keys.cacheKey, async () => {
      const body = interactiveMode === "requestToken"
        ? { appKey: keys.appKey, secretKey: keys.secretKey, accessToken: keys.requestToken }
        : { appKey: keys.appKey, secretKey: keys.secretKey, source: "WebAPI" };
      const r = await rawFetch(`${IA}/user/session`, { method: "POST", body });
      const result = r.json?.result;
      if (r.json?.type !== "success" || !result?.token) {
        const desc = str(r.json?.description || r.json?.message) || `HTTP ${r.status}`;
        if (interactiveMode === "requestToken" && r.status < 500 && r.json) {
          deadRequestTokens.add(keys.cacheKey);
          throw new SessionRequiredError(`${label}: the broker did not accept the login token (${desc}). ${loginHint}`);
        }
        throw new BrokerError(`${label}: trading login failed (${desc}). Check the Interactive App Key and Secret Key.`, { code: "UPSTREAM_AUTH" });
      }
      const s = {
        token: str(result.token),
        userId: str(result.userID) || null,
        isInvestorClient: result.isInvestorClient !== false,
        expiresAt: nextIstMidnightMs(),
      };
      iaSessions.set(keys.cacheKey, s);
      return { ...s, cacheKey: keys.cacheKey };
    });
  }

  /** Dealer logins (isInvestorClient=false) must name the client: in the body for POST/PUT, else in the query. */
  function withDealerClient(creds, session, query, body) {
    if (session.isInvestorClient) return { query, body };
    const clientId = str(creds?.clientId).trim();
    if (!clientId) throw new BrokerInputError(`${label}: this is a dealer login; add the client code as clientId in Broker Settings.`);
    return body ? { query, body: { ...body, clientID: clientId } } : { query: { ...(query || {}), clientID: clientId }, body };
  }

  /**
   * Interactive call. Reads re-login once on a token rejection (key-pair mode only). Order calls never
   * retry: a rejected token means nothing was sent, and the user simply tries again.
   */
  async function ia(creds, path, { method = "GET", body, query, kind = "read", what = path } = {}) {
    let session = await interactiveSession(creds);
    const send = async (s) => {
      await (kind === "order" ? orderThrottle() : readThrottle());
      const d = withDealerClient(creds, s, query, body);
      return rawFetch(withQuery(`${IA}${path}`, d.query), { method, body: d.body, token: s.token });
    };
    let r = await send(session);
    if (r.json?.type !== "success" && isTokenRejection(r.status, r.json)) {
      iaSessions.delete(session.cacheKey);
      if (interactiveMode === "requestToken") {
        deadRequestTokens.add(session.cacheKey);
        throw new SessionRequiredError(`${label}: your trading session has expired. ${loginHint}`);
      }
      if (kind === "order") throw upstreamError(r.status, r.json, what);
      session = await interactiveSession(creds);
      r = await send(session);
    }
    if (r.json?.type !== "success") throw upstreamError(r.status, r.json, what);
    return r.json.result;
  }

  // ── instruments ──

  async function foMaster(creds, segment) {
    return getCachedOrFetch(`${id}:xts-master:${segment}`, async () => {
      const result = await mdPublic(creds, "/instruments/master", { method: "POST", body: { exchangeSegmentList: [segment] }, what: `instrument master ${segment}` });
      if (typeof result !== "string") throw new BrokerError(`${label}: instrument master ${segment} had an unexpected shape.`);
      return parseFoMaster(result);
    }, ONE_DAY_MS);
  }

  async function indexList(creds, segment) {
    return getCachedOrFetch(`${id}:xts-indexlist:${segment}`, async () => {
      const result = await mdPublic(creds, "/instruments/indexlist", { query: { exchangeSegment: SEGMENT_ID[segment] }, what: `index list ${segment}` });
      return parseIndexList(result?.indexList);
    }, ONE_DAY_MS);
  }

  function resolveSymbol(symbol) {
    const s = str(symbol).trim().toUpperCase();
    if (INDEX_UNDERLYINGS[s]) return { symbol: s, index: true, ...INDEX_UNDERLYINGS[s] };
    if (!STOCK_SYMBOL_RE.test(s)) throw new BrokerInputError(`${label}: unknown symbol ${symbol}`);
    return { symbol: s, index: false, foSegment: "NSEFO", indexSegment: null, spotNames: [] };
  }

  async function optionRows(creds, sym) {
    const rows = await foMaster(creds, sym.foSegment);
    const out = rows.filter((r) => r.opt && r.name === sym.symbol && (sym.index ? isIndexRow(r) : !isIndexRow(r)));
    if (!out.length && !sym.index) throw new BrokerInputError(`${label}: no options listed for ${sym.symbol}`);
    return out;
  }

  /** {segmentId, token} of the underlying's spot quote, or null. */
  async function spotRef(creds, sym, rows) {
    if (sym.index) {
      const list = await indexList(creds, sym.indexSegment);
      const hit = list.find((e) => sym.spotNames.includes(e.name));
      return hit ? { segmentId: SEGMENT_ID[sym.indexSegment], token: hit.token } : null;
    }
    const token = rows.map((r) => underlyingCashToken(r.und)).find(Boolean);
    return token ? { segmentId: SEGMENT_ID.NSECM, token } : null;
  }

  // ── quotes ──

  /** Batched 1502 (+ optional 1510) quotes -> Map<"seg_token", { md, oi }>. Serialised at the official 1 call/second. */
  async function quoteMap(creds, refs, { withOi = true } = {}) {
    const map = new Map();
    for (const r of refs) map.set(quoteKey(r.segmentId, r.token), { md: null, oi: null });
    for (let i = 0; i < refs.length; i += QUOTE_BATCH_SIZE) {
      const chunk = refs.slice(i, i + QUOTE_BATCH_SIZE);
      const instruments = chunk.map((r) => ({ exchangeSegment: Number(r.segmentId), exchangeInstrumentID: Number(r.token) }));
      const mdResult = await md(creds, "/instruments/quotes", { method: "POST", body: { instruments, xtsMessageCode: MSG_MARKET_DATA, publishFormat: "JSON" }, what: "quotes" });
      parseListQuotes(mdResult).forEach((q, idx) => {
        const key = q.ExchangeInstrumentID != null ? quoteKey(q.ExchangeSegment ?? chunk[idx]?.segmentId, q.ExchangeInstrumentID) : chunk[idx] && quoteKey(chunk[idx].segmentId, chunk[idx].token);
        if (key && map.has(key)) map.get(key).md = q;
      });
      if (!withOi) continue;
      try {
        const oiResult = await md(creds, "/instruments/quotes", { method: "POST", body: { instruments, xtsMessageCode: MSG_OPEN_INTEREST, publishFormat: "JSON" }, what: "open interest" });
        parseListQuotes(oiResult).forEach((q, idx) => {
          const key = q.ExchangeInstrumentID != null ? quoteKey(q.ExchangeSegment ?? chunk[idx]?.segmentId, q.ExchangeInstrumentID) : chunk[idx] && quoteKey(chunk[idx].segmentId, chunk[idx].token);
          if (key && map.has(key) && q.OpenInterest != null) map.get(key).oi = num(q.OpenInterest);
        });
      } catch (e) {
        if (e instanceof BrokerError && e.code === "UPSTREAM_AUTH") throw e;
        // OI is best-effort: a failed 1510 call leaves oi null rather than failing the chain.
      }
    }
    return map;
  }

  function refOf(instrument) {
    const segment = SEGMENT_OF_EXCHANGE[instrument?.exchange];
    if (!segment) throw new BrokerInputError(`Invalid exchange: ${instrument?.exchange}`);
    if (!/^\d{1,12}$/.test(str(instrument?.token))) throw new BrokerInputError(`Invalid token: ${instrument?.token}`);
    return { segmentId: SEGMENT_ID[segment], token: str(instrument.token), exchange: instrument.exchange, segment };
  }

  // ── capabilities ──

  async function testConnection(creds = {}) {
    try {
      await md(creds, "/config/clientConfig", { what: "client config" });
      let trading = "trading API not configured";
      if (str(creds.interactiveApiKey)) {
        await interactiveSession(creds);
        trading = "trading API connected";
      }
      return { status: "success", message: `${label} market data connected; ${trading}.` };
    } catch (e) {
      return { status: "error", message: normalise(e, { secrets: secretValues(creds) }).message };
    }
  }

  async function fetchInstruments(creds) {
    const out = [];
    for (const segment of ["NSEFO", "BSEFO"]) {
      for (const r of await foMaster(creds, segment)) {
        const inst = toInstrument(r);
        if (inst) out.push(inst);
      }
    }
    for (const [name, u] of Object.entries(INDEX_UNDERLYINGS)) {
      const list = await indexList(creds, u.indexSegment);
      const hit = list.find((e) => u.spotNames.includes(e.name));
      if (!hit) continue;
      out.push({ token: hit.token, exchange: EXCHANGE_OF_SEGMENT[u.indexSegment], tradingSymbol: hit.name, underlying: name, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 });
    }
    return { status: "success", data: out };
  }

  async function fetchExpiryList(creds, symbol) {
    const sym = resolveSymbol(symbol);
    const rows = await optionRows(creds, sym);
    return { status: "success", data: [...new Set(rows.map((r) => r.expiry))].sort() };
  }

  async function fetchLTP(creds, symbol) {
    const sym = resolveSymbol(symbol);
    const rows = sym.index ? [] : await optionRows(creds, sym);
    const spot = await spotRef(creds, sym, rows);
    if (!spot) throw new BrokerError(`${label}: could not find the spot instrument for ${sym.symbol}.`);
    const q = (await quoteMap(creds, [spot], { withOi: false })).get(quoteKey(spot.segmentId, spot.token));
    return { status: "success", data: { last_price: num(q?.md?.Touchline?.LastTradedPrice) } };
  }

  async function fetchOptionChain(creds, symbol, expiry) {
    const sym = resolveSymbol(symbol);
    const rows = await optionRows(creds, sym);
    const target = expiry || [...new Set(rows.map((r) => r.expiry))].sort()[0];
    const legs = rows.filter((r) => r.expiry === target);
    if (!legs.length) return { status: "success", data: { oc: {}, last_price: 0 } };

    const spot = await spotRef(creds, sym, rows);
    let lastPrice = 0;
    if (spot) {
      const q = (await quoteMap(creds, [spot], { withOi: false })).get(quoteKey(spot.segmentId, spot.token));
      lastPrice = num(q?.md?.Touchline?.LastTradedPrice);
    }

    const strikes = [...new Set(legs.map((r) => r.strike))].sort((a, b) => a - b);
    let atm = Math.floor(strikes.length / 2);
    if (lastPrice > 0) {
      atm = strikes.reduce((best, s, i) => (Math.abs(s - lastPrice) < Math.abs(strikes[best] - lastPrice) ? i : best), 0);
    }
    const keep = new Set(strikes.slice(Math.max(0, atm - STRIKE_WINDOW), atm + STRIKE_WINDOW + 1));
    const chosen = legs.filter((r) => keep.has(r.strike));
    const segId = SEGMENT_ID[sym.foSegment];
    const quotes = await quoteMap(creds, chosen.map((r) => ({ segmentId: segId, token: r.token })));
    const dte = daysBetween(new Date(), target);

    const oc = {};
    for (const r of chosen) {
      const q = quotes.get(quoteKey(segId, r.token));
      if (!q?.md) continue;
      const tl = q.md.Touchline || {};
      const ltp = num(tl.LastTradedPrice);
      const greeks = computeIVAndGreeks({ ltp, spot: lastPrice, strike: r.strike, daysToExpiry: dte, type: r.opt });
      const key = String(r.strike);
      oc[key] = oc[key] || {};
      oc[key][r.opt.toLowerCase()] = {
        last_price: ltp,
        oi: num(q.oi),
        volume: num(tl.TotalTradedQuantity),
        ...greeks,
        bid_price: num(tl.BidInfo?.Price),
        ask_price: num(tl.AskInfo?.Price),
        security_id: r.token,
      };
    }
    return { status: "success", data: { oc, last_price: lastPrice } };
  }

  async function fetchQuotes(creds, refs = []) {
    const parsed = (Array.isArray(refs) ? refs : []).map(refOf);
    const map = await quoteMap(creds, parsed);
    const data = [];
    for (const r of parsed) {
      const q = map.get(quoteKey(r.segmentId, r.token));
      if (!q?.md) continue;
      const tl = q.md.Touchline || {};
      data.push({
        token: r.token, exchange: r.exchange, ltp: num(tl.LastTradedPrice),
        open: numOrNull(tl.Open), high: numOrNull(tl.High), low: numOrNull(tl.Low), close: numOrNull(tl.Close),
        volume: numOrNull(tl.TotalTradedQuantity), oi: q.oi, bid: numOrNull(tl.BidInfo?.Price), ask: numOrNull(tl.AskInfo?.Price),
      });
    }
    return { status: "success", data };
  }

  async function fetchDepth(creds, ref) {
    const r = refOf(ref);
    const q = (await quoteMap(creds, [r], { withOi: false })).get(quoteKey(r.segmentId, r.token));
    const level = (l) => ({ price: num(l?.Price), qty: num(l?.Size), orders: numOrNull(l?.TotalOrders) });
    return {
      status: "success",
      data: { bids: (q?.md?.Bids || []).slice(0, 5).map(level), asks: (q?.md?.Asks || []).slice(0, 5).map(level) },
    };
  }

  async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
    const r = refOf(instrument);
    const compression = INTERVAL_TO_COMPRESSION[interval];
    if (!compression) throw new BrokerInputError(`${label}: unsupported interval ${interval} (use ${Object.keys(INTERVAL_TO_COMPRESSION).join(", ")})`);
    const start = parseWhen(from, false);
    const end = parseWhen(to, true);
    if (!(end >= start)) throw new BrokerInputError(`${label}: 'to' must not be before 'from'`);
    const windowMs = (interval === "1d" ? 365 : 6) * 86_400_000;
    const candles = new Map();
    for (let s = start; s <= end; s += windowMs + 1000) {
      const e = Math.min(s + windowMs, end);
      const result = await md(creds, "/instruments/ohlc", {
        query: { exchangeSegment: r.segment, exchangeInstrumentID: r.token, startTime: toXtsTime(s), endTime: toXtsTime(e), compressionValue: compression },
        what: "historical candles",
      });
      for (const c of parseOhlc(result?.dataReponse ?? result?.dataResponse, interval)) candles.set(c.time, c);
    }
    return { status: "success", data: [...candles.values()].sort((a, b) => a.time - b.time) };
  }

  const listOf = (result, key) => (Array.isArray(result) ? result : Array.isArray(result?.[key]) ? result[key] : []);

  async function fetchPositions(creds) {
    const result = await ia(creds, "/portfolio/positions", { query: { dayOrNet: "NetWise" }, what: "positions" });
    return { status: "success", data: listOf(result, "positionList").map(mapPosition) };
  }

  async function fetchHoldings(creds) {
    const result = await ia(creds, "/portfolio/holdings", { what: "holdings" });
    return { status: "success", data: Object.values(holdingsMap(result)).map(mapHolding) };
  }

  async function fetchFunds(creds) {
    const result = await ia(creds, "/user/balance", { what: "balance" });
    return { status: "success", data: mapFunds(result) };
  }

  async function fetchOrderBook(creds) {
    const result = await ia(creds, "/orders", { what: "order book" });
    return { status: "success", data: listOf(result, "orderList").map(mapOrder) };
  }

  async function fetchTradeBook(creds) {
    const result = await ia(creds, "/orders/trades", { what: "trade book" });
    return { status: "success", data: listOf(result, "tradeList").map(mapTrade) };
  }

  const placeOrder = withOrderGate("placeOrder", async (creds, order, resolvedLotSize) => {
    const body = buildOrderBody(order, resolvedLotSize);
    const result = await ia(creds, "/orders", { method: "POST", body, kind: "order", what: "place order" });
    const orderId = str(result?.AppOrderID);
    if (!orderId) throw new BrokerError(`${label}: the broker did not return an order id. ${ORDER_BOOK_HINT}`);
    return { orderId, orderStatus: "UNKNOWN" }; // XTS placement is asynchronous; confirm via the order book
  }, { brokerId: id });

  const modifyOrder = withOrderGate("modifyOrder", async (creds, orderId, changes) => {
    const body = buildModifyBody(orderId, changes);
    const result = await ia(creds, "/orders", { method: "PUT", body, kind: "order", what: "modify order" });
    return { orderId: str(result?.AppOrderID || orderId), orderStatus: "UNKNOWN" };
  }, { brokerId: id });

  const cancelOrder = withOrderGate("cancelOrder", async (creds, orderId) => {
    const appOrderID = checkOrderId(orderId);
    const result = await ia(creds, "/orders", { method: "DELETE", query: { appOrderID, orderUniqueIdentifier: "mrchub" }, kind: "order", what: "cancel order" });
    return { orderId: str(result?.AppOrderID || appOrderID), orderStatus: "UNKNOWN" };
  }, { brokerId: id });

  function secretValues(creds = {}) {
    return [marketFields.key, marketFields.secret, "interactiveApiKey", "interactiveApiSecret", requestTokenField]
      .map((k) => str(creds?.[k]))
      .filter((v) => v.length >= 4);
  }

  function normalise(err, { secrets = [] } = {}) {
    const out = baseNormalise(err, { secrets });
    if (!(err instanceof BrokerError) && TOKEN_REJECTED.test(str(err?.message))) out.code = "UPSTREAM_AUTH";
    out.message = redactSecrets(out.message, secrets);
    return out;
  }

  /** Test-only: forget every cached session and set the throttle spacing (ms). */
  function resetForTests({ intervalMs = 0 } = {}) {
    mdSessions.clear();
    iaSessions.clear();
    inflight.clear();
    deadRequestTokens.clear();
    intervals.md = intervalMs;
    intervals.read = intervalMs;
    intervals.order = intervalMs;
  }

  return {
    urls: { MD, IA },
    testConnection, fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical,
    fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, placeOrder, modifyOrder, cancelOrder,
    normaliseError: normalise, resetForTests,
  };
}

/** The capability descriptor shared by the three XTS adapters (auth kind differs per broker). */
export function xtsCapabilities(authKind) {
  return Object.freeze({
    auth: { kind: authKind },
    testConnection: true,
    instruments: true,
    expiries: true,
    optionChain: { greeks: "computed", native: false },
    ltp: true,
    quotes: true,
    depth: true,
    historical: { intervals: Object.keys(INTERVAL_TO_COMPRESSION) },
    positions: true,
    holdings: true,
    funds: true,
    orderBook: true,
    tradeBook: true,
    placeOrder: true,
    modifyOrder: true,
    cancelOrder: true,
    normaliseError: true,
    // Legacy order-feature descriptor, from the official enums: cover orders use a separate endpoint and
    // bracket orders are dealer/broker dependent, so neither is used here. timeInForce IOC is documented.
    bracket: false,
    cover: false,
    ioc: true,
    mtf: false,
    nativeMarketProtection: false,
    maxLegQty: null,
    products: ["CNC", "MIS", "NRML"],
  });
}
