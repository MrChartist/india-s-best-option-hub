/**
 * Shared engine for the three Symphony Fintech "XTS" brokers in this group: RMoney (rmoney.mjs),
 * Wisdom Capital (wisdom.mjs) and IIFL Securities (iifl.mjs). It lives in an rmoney-prefixed file only
 * because file ownership in this repo goes by broker id; wisdom.mjs and iifl.mjs import it too. The
 * CompositEdge/IndiaBulls/Jainam group keeps its own engine (compositedgeXtsCore.mjs) and nothing here
 * imports it.
 *
 * Each broker file supplies its host, its market-data path and the way its trading (Interactive)
 * session is opened. Everything else (routes, payloads, field names, segment codes, master layout,
 * order enums) is the same XTS product.
 *
 * Sources (official): the XTS v2 API pages that IIFL publishes for its own deployment,
 *   https://ttblaze.iifl.com/doc/interactive/      (Interactive / trading API)
 *   https://ttblaze.iifl.com/doc/apimarketdata/    (Binary Market Data API)
 * which are the same documents Symphony publishes at https://symphonyfintech.com/xts-trading-front-end-api-v2/
 * and https://symphonyfintech.com/xts-market-data-front-end-api-v2/, plus Symphony's MIT-licensed SDKs
 * (github.com/symphonyfintech/xts-pythonclient-api-sdk). RMoney and Wisdom do not publish reachable
 * docs; their hosts and login style come from OpenAlgo (read for facts only, no code taken) and must be
 * confirmed live.
 *
 *  Market data (base = host + /apibinarymarketdata or /apimarketdata):
 *   POST /auth/login {appKey, secretKey, source:"WebAPI"} -> result {token, userID, application_expiry_date}
 *   GET  /config/clientConfig                       authenticated, cheap (testConnection)
 *   POST /instruments/master {exchangeSegmentList:["NSEFO"]} -> result = pipe-delimited lines
 *   GET  /instruments/indexlist?exchangeSegment=1    -> result.indexList ["NIFTY 50_26000", ...]
 *   POST /instruments/quotes {instruments:[{exchangeSegment, exchangeInstrumentID}], xtsMessageCode, publishFormat:"JSON"}
 *        1502 = market depth event (Touchline + Bids/Asks), 1510 = open interest. listQuotes is
 *        documented both as an array of JSON strings and as a single object; both are read.
 *   GET  /instruments/ohlc?exchangeSegment=NSECM&exchangeInstrumentID=2885&startTime=Jan 27 2025 090000&endTime=...&compressionValue=60
 *        -> result.dataReponse (sic) "epoch|o|h|l|c|v|oi|,..."; the epoch is IST wall-clock written as UTC
 *           (the official daily sample 1737331200 is 20 Jan 2025 00:00 "UTC").
 *   The v2 docs say every call except login needs the token, so masters and the index list are
 *   fetched with it (OpenAlgo fetches them anonymously). The token lasts 24 hours.
 *   Only one session may exist per appKey/secretKey pair, so sessions are cached and logins de-duplicated.
 *
 *  Interactive (trading):
 *   keyPair         POST {host}/interactive/user/session {appKey, secretKey, source:"WebAPI"} (official SDK)
 *   oauthHostLookup official v2 flow: the user signs in at {host}/interactive/thirdparty?appKey=..&returnURL=..
 *                   and copies the accessToken from the return URL; then POST {host}/hostlookup
 *                   {AccessPassword:"2021HostLookUpAccess", version:"interactive_1.0.1"} -> {UniqueKey, connectionString}
 *                   and POST {connectionString}/user/session {appKey, secretKey, accessToken, uniqueKey}.
 *                   connectionString must be https on the broker's own host; anything else is refused.
 *   pastedSession   the thirdparty login already returns the session token (RMoney, per OpenAlgo); the user
 *                   pastes it and it is used as-is.
 *   GET /user/balance, /user/profile, /orders, /orders/trades, /portfolio/positions?dayOrNet=NetWise,
 *   /portfolio/holdings; POST /orders, PUT /orders, DELETE /orders?appOrderID=&orderUniqueIdentifier=.
 *   clientID is sent only when the user saved one (dealer logins, isInvestorClient=false, need it).
 *   Rate limits (official table): balance, profile, order book, trade book, positions and holdings
 *   1 request/second; place/modify/cancel share 10/second. Market-data limits are not in the v2 pages;
 *   1 request/second is used for quotes, masters and OHLC (the limit in Symphony's earlier tables).
 *   Enums (official): productType MIS|NRML|CNC|CO|BO|MTF; orderType Market|Limit|StopMarket|StopLimit;
 *   timeInForce DAY|IOC|...; order status New, PartiallyFilled, Filled, Cancelled, Replaced,
 *   PendingCancel, Rejected, PendingNew, PendingReplace.
 *   Error envelope: {type:"error", code, description}; HTTP 400/404/429/500.
 *
 * Nothing secret is logged. Session tokens live only in this process. Hosts are fixed per broker.
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
import { createBoundedSet, createSessionCache } from "../lib/boundedCache.mjs";

// ── codes ──

/** XTS numeric exchange-segment ids (official ExchangeSegments enum). */
export const SEGMENT_ID = Object.freeze({ NSECM: 1, NSEFO: 2, NSECD: 3, BSECM: 11, BSEFO: 12, BSECD: 13, MCXFO: 51 });
const SEGMENT_NAME_BY_ID = Object.fromEntries(Object.entries(SEGMENT_ID).map(([name, n]) => [n, name]));
/** App exchange -> XTS segment name. */
export const SEGMENT_FOR_EXCHANGE = Object.freeze({ NSE: "NSECM", NFO: "NSEFO", CDS: "NSECD", BSE: "BSECM", BFO: "BSEFO", MCX: "MCXFO" });
const EXCHANGE_FOR_SEGMENT = Object.fromEntries(Object.entries(SEGMENT_FOR_EXCHANGE).map(([ex, seg]) => [seg, ex]));

export const MSG_DEPTH = 1502;
export const MSG_OI = 1510;
export const QUOTE_CHUNK = 50; // instruments per /instruments/quotes call (broker-side cap reported by integrators)
export const HOSTLOOKUP_BODY = Object.freeze({ AccessPassword: "2021HostLookUpAccess", version: "interactive_1.0.1" });
const CHAIN_HALF_WIDTH = 25; // strikes each side of ATM quoted per chain
const IST_SECONDS = 19_800;

/** Index underlyings: F&O segment, index-list segment, index-list names and UnderlyingIndexName aliases. */
export const INDEX_MAP = Object.freeze({
  NIFTY: { fo: "NSEFO", cash: "NSECM", listNames: ["NIFTY 50"], aliases: ["NIFTY50", "NIFTY"] },
  BANKNIFTY: { fo: "NSEFO", cash: "NSECM", listNames: ["NIFTY BANK"], aliases: ["NIFTYBANK", "BANKNIFTY"] },
  FINNIFTY: { fo: "NSEFO", cash: "NSECM", listNames: ["NIFTY FIN SERVICE", "NIFTY FINANCIAL SERVICES"], aliases: ["NIFTYFINSERVICE", "NIFTYFINANCIALSERVICES", "FINNIFTY"] },
  MIDCPNIFTY: { fo: "NSEFO", cash: "NSECM", listNames: ["NIFTY MID SELECT", "NIFTY MIDCAP SELECT"], aliases: ["NIFTYMIDSELECT", "NIFTYMIDCAPSELECT", "MIDCPNIFTY"] },
  SENSEX: { fo: "BSEFO", cash: "BSECM", listNames: ["SENSEX", "S&P BSE SENSEX", "BSE SENSEX"], aliases: ["SENSEX", "SPBSESENSEX", "BSESENSEX"] },
  BANKEX: { fo: "BSEFO", cash: "BSECM", listNames: ["BANKEX", "S&P BSE BANKEX", "BSE BANKEX"], aliases: ["BANKEX", "SPBSEBANKEX", "BSEBANKEX"] },
});

const INDEX_SERIES = new Set(["OPTIDX", "FUTIDX"]);
const FUT_SERIES = new Set(["FUTIDX", "FUTSTK"]);
const STOCK_RE = /^[A-Z0-9&-]{1,20}$/;
const TOKEN_RE = /^\d{1,12}$/;
const ORDER_ID_RE = /^\d{1,20}$/;

const toNum = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const toNumOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v) => (v === null || v === undefined ? "" : String(v));
const squash = (v) => text(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashKey = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

// ── instrument master (pure) ──

const MONTH_NUM = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** ContractExpiration -> "YYYY-MM-DD". Official samples are ISO ("2026-02-17T14:30:00"); DD-Mon-YYYY is accepted too. */
export function isoExpiry(raw) {
  const s = text(raw).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[- ]?([A-Za-z]{3})[- ]?(\d{4})/.exec(s);
  if (dmy && MONTH_NUM[dmy[2].toUpperCase()]) return `${dmy[3]}-${MONTH_NUM[dmy[2].toUpperCase()]}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/** "Nifty 50" / "NIFTY" -> canonical index name, or null. */
export function canonicalIndex(name, underlyingIndexName) {
  const n = text(name).trim().toUpperCase();
  if (INDEX_MAP[n]) return n;
  const alias = squash(underlyingIndexName);
  if (!alias) return null;
  for (const [canon, cfg] of Object.entries(INDEX_MAP)) if (cfg.aliases.includes(alias)) return canon;
  return null;
}

/**
 * Parse one F&O segment of /instruments/master (official layouts):
 *  Options: 0 ExchangeSegment|1 ExchangeInstrumentID|2 InstrumentType|3 Name|4 Description|5 Series|
 *           6 NameWithSeries|7 InstrumentID|8 PriceBand.High|9 PriceBand.Low|10 FreezeQty|11 TickSize|
 *           12 LotSize|13 Multiplier|14 UnderlyingInstrumentId|15 UnderlyingIndexName|16 ContractExpiration|
 *           17 StrikePrice|18 OptionType (3 = CE, 4 = PE)|19 DisplayName|20 PriceNumerator|21 PriceDenominator|22 DetailedDescription
 *  Futures: same up to 16 ContractExpiration, then 17 DisplayName|... (no strike / option type).
 * InstrumentType 1 = Futures, 2 = Options. Returns compact option and future rows.
 */
export function parseMasterFo(body) {
  const out = [];
  for (const line of text(body).split("\n")) {
    if (!line.trim()) continue;
    const c = line.split("|");
    if (c.length < 17) continue;
    const instType = text(c[2]).trim();
    const series = text(c[5]).trim().toUpperCase();
    const optCode = instType === "2" ? text(c[18]).trim() : "";
    const isOpt = optCode === "3" || optCode === "4";
    const isFut = !isOpt && (instType === "1" || FUT_SERIES.has(series));
    if (!isOpt && !isFut) continue;
    const expiry = isoExpiry(c[16]);
    if (!expiry) continue;
    const strike = isOpt ? toNum(c[17]) : null;
    if (isOpt && !(strike > 0)) continue;
    const isIndex = INDEX_SERIES.has(series) || canonicalIndex(c[3], c[15]) !== null;
    const name = text(c[3]).trim().toUpperCase();
    out.push({
      seg: text(c[0]).trim(),
      token: text(c[1]).trim(),
      name: isIndex ? canonicalIndex(name, c[15]) ?? name : name,
      symbol: text(c[4]).trim(),
      series,
      index: isIndex,
      tick: toNum(c[11]) || 0.05,
      lot: toNum(c[12]),
      underlyingId: text(c[14]).trim(),
      expiry,
      strike,
      opt: isOpt ? (optCode === "3" ? "CE" : "PE") : null,
    });
  }
  return out;
}

/** ["NIFTY 50_26000", ...] -> [{ name: "NIFTY 50", token: "26000" }] (split on the last underscore). */
export function parseIndexEntries(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const s = text(entry);
    const cut = s.lastIndexOf("_");
    if (cut <= 0) continue;
    out.push({ name: s.slice(0, cut).trim().toUpperCase().replace(/\s+/g, " "), token: s.slice(cut + 1).trim() });
  }
  return out;
}

/** UnderlyingInstrumentId "1100100002885" -> NSE cash token "2885" (InstrumentID = 11001 + 8-digit token in the official samples). */
export function cashTokenFromUnderlying(id) {
  const m = /^11001(\d{8})$/.exec(text(id));
  return m ? String(Number(m[1])) : null;
}

/** Master row -> contract Instrument; null for index derivatives outside CANONICAL_UNDERLYINGS. */
export function rowToInstrument(r) {
  if (r.index && !CANONICAL_UNDERLYINGS.includes(r.name)) return null;
  const exchange = EXCHANGE_FOR_SEGMENT[r.seg];
  if (!exchange || !(r.lot > 0)) return null;
  return {
    token: r.token,
    exchange,
    tradingSymbol: r.symbol || r.token,
    underlying: r.name,
    instrumentType: r.opt ? (r.index ? "OPTIDX" : "OPTSTK") : r.index ? "FUTIDX" : "FUTSTK",
    expiry: r.expiry,
    strike: r.opt ? r.strike : null,
    optionType: r.opt,
    lotSize: r.lot,
    tickSize: r.tick > 0 ? r.tick : 0.05,
  };
}

// ── quotes (pure) ──

/** listQuotes as documented: array of JSON strings, array of objects, one object, or one JSON string. */
export function readListQuotes(result) {
  const raw = result?.listQuotes;
  const items = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const out = [];
  for (const item of items) {
    if (item && typeof item === "object") { out.push(item); continue; }
    try {
      const parsed = JSON.parse(item);
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch { /* one unreadable row does not sink the batch */ }
  }
  return out;
}

/** The touchline block of a 1502 (nested Touchline) or 1501 (flat) quote. */
export function touchlineOf(q) {
  if (!q || typeof q !== "object") return {};
  return q.Touchline && typeof q.Touchline === "object" ? q.Touchline : q;
}

const levels = (side) => (Array.isArray(side) ? side : side && typeof side === "object" ? [side] : []);
const keyOf = (segmentId, token) => `${Number(segmentId)}_${text(token)}`;

// ── orders (pure) ──

const PRODUCT_OUT = { CNC: "CNC", INTRADAY: "MIS", MARGIN: "NRML", MIS: "MIS", NRML: "NRML" };
const PRODUCT_IN = { CNC: "CNC", MIS: "INTRADAY", NRML: "MARGIN", CO: "CO", BO: "BO", MTF: "MTF" };
const ORDER_TYPE_OUT = { MARKET: "Market", LIMIT: "Limit", SL: "StopLimit", "SL-M": "StopMarket" };
const TIME_IN_FORCE = new Set(["DAY", "IOC"]);

function uniqueTag(tag) {
  return text(tag).replace(/[^A-Za-z0-9]/g, "").slice(0, 20) || "mrchub";
}

function priceRules(orderType, price, triggerPrice) {
  const needsPrice = orderType === "LIMIT" || orderType === "SL";
  const needsTrigger = orderType === "SL" || orderType === "SL-M";
  if (needsPrice && !(Number.isFinite(price) && price > 0)) throw new BrokerInputError(`price required for ${orderType}`);
  if (needsTrigger && !(Number.isFinite(triggerPrice) && triggerPrice > 0)) throw new BrokerInputError(`triggerPrice required for ${orderType}`);
  return { limitPrice: needsPrice ? price : 0, stopPrice: needsTrigger ? triggerPrice : 0 };
}

/** POST /orders body. resolvedLotSize must come from the exchange instrument master, never from the client. */
export function buildPlaceBody(order, resolvedLotSize) {
  const { exchange, token, transactionType, orderType, product = "MARGIN", validity = "DAY", lots, price, triggerPrice, tag } = order || {};
  const segment = SEGMENT_FOR_EXCHANGE[exchange];
  if (!segment) throw new BrokerInputError(`Invalid exchange: ${exchange}`);
  if (!TOKEN_RE.test(text(token))) throw new BrokerInputError("Missing or invalid instrument token");
  if (transactionType !== "BUY" && transactionType !== "SELL") throw new BrokerInputError(`Invalid transactionType: ${transactionType}`);
  if (!ORDER_TYPE_OUT[orderType]) throw new BrokerInputError(`Invalid orderType: ${orderType}`);
  if (!PRODUCT_OUT[product]) throw new BrokerInputError(`Unsupported product: ${product} (CNC, MIS/INTRADAY and NRML/MARGIN only)`);
  if (!TIME_IN_FORCE.has(validity)) throw new BrokerInputError(`Invalid validity: ${validity}`);
  if (!Number.isFinite(resolvedLotSize) || resolvedLotSize <= 0) {
    throw new BrokerInputError("Missing resolved lot size: it must come from the exchange instrument master, not from the client");
  }
  if (!Number.isInteger(lots) || lots <= 0) throw new BrokerInputError("Invalid lots");
  const { limitPrice, stopPrice } = priceRules(orderType, price, triggerPrice);
  return {
    exchangeSegment: segment,
    exchangeInstrumentID: Number(token),
    productType: PRODUCT_OUT[product],
    orderType: ORDER_TYPE_OUT[orderType],
    orderSide: transactionType,
    timeInForce: validity,
    disclosedQuantity: 0,
    orderQuantity: lots * resolvedLotSize,
    limitPrice,
    stopPrice,
    orderUniqueIdentifier: uniqueTag(tag),
  };
}

function cleanOrderId(orderId) {
  const id = text(orderId).trim();
  if (!ORDER_ID_RE.test(id)) throw new BrokerInputError("Invalid order id");
  return id;
}

/** appOrderID as a JSON number when it is exactly representable, else as the string the docs also show. */
const appOrderIdValue = (id) => (Number.isSafeInteger(Number(id)) ? Number(id) : id);

/**
 * PUT /orders body. XTS needs every modified* field, so the caller passes the order's product, type and
 * total quantity, read fresh from the order book.
 */
export function buildModifyBody(orderId, changes) {
  const { orderType, product, quantity, price, triggerPrice, validity = "DAY", tag } = changes || {};
  const id = cleanOrderId(orderId);
  if (!ORDER_TYPE_OUT[orderType]) throw new BrokerInputError(`Invalid orderType: ${orderType}`);
  if (!PRODUCT_OUT[product]) throw new BrokerInputError(`Unsupported product: ${product}`);
  if (!TIME_IN_FORCE.has(validity)) throw new BrokerInputError(`Invalid validity: ${validity}`);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new BrokerInputError("quantity (total order quantity) is required");
  const { limitPrice, stopPrice } = priceRules(orderType, price, triggerPrice);
  return {
    appOrderID: appOrderIdValue(id),
    modifiedProductType: PRODUCT_OUT[product],
    modifiedOrderType: ORDER_TYPE_OUT[orderType],
    modifiedOrderQuantity: quantity,
    modifiedDisclosedQuantity: 0,
    modifiedLimitPrice: limitPrice,
    modifiedStopPrice: stopPrice,
    modifiedTimeInForce: validity,
    orderUniqueIdentifier: uniqueTag(tag),
  };
}

/** Official order status (+ order type) -> contract OrderStatus. */
export function orderStatusOf(status, orderType) {
  const s = text(status).replace(/\s+/g, "").toLowerCase();
  const stop = /^stop/i.test(text(orderType));
  if (["new", "open", "pendingnew", "replaced", "pendingreplace", "pendingcancel"].includes(s)) return stop ? "TRIGGER_PENDING" : "OPEN";
  if (s === "partiallyfilled") return "PARTIALLY_FILLED";
  if (s === "filled") return "COMPLETE";
  if (s === "cancelled" || s === "canceled") return "CANCELLED";
  if (s === "rejected") return "REJECTED";
  if (s === "expired") return "EXPIRED";
  return "UNKNOWN";
}

const exchangeOf = (seg) => EXCHANGE_FOR_SEGMENT[text(seg)] ?? EXCHANGE_FOR_SEGMENT[SEGMENT_NAME_BY_ID[Number(seg)]] ?? "NSE";
const productOf = (p) => PRODUCT_IN[text(p).toUpperCase()] ?? "INTRADAY";
const sideOf = (s) => (text(s).toUpperCase() === "SELL" ? "SELL" : "BUY");

/** "14-05-2021 11:17:29" (IST) -> "2021-05-14T11:17:29+05:30"; the "01-01-1980" placeholder -> null. */
export function istStamp(raw) {
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text(raw).trim());
  if (!m || m[3] === "1980") return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
}

export function toOrder(o) {
  const qty = toNum(o.OrderQuantity);
  const filled = toNum(o.CumulativeQuantity);
  const leaves = toNumOrNull(o.LeavesQuantity);
  return {
    orderId: text(o.AppOrderID),
    tradingSymbol: text(o.TradingSymbol),
    exchange: exchangeOf(o.ExchangeSegment),
    token: text(o.ExchangeInstrumentID),
    side: sideOf(o.OrderSide),
    qty,
    filledQty: filled,
    pendingQty: leaves ?? Math.max(qty - filled, 0),
    price: toNum(o.OrderPrice),
    triggerPrice: toNum(o.OrderStopPrice),
    avgPrice: toNum(o.OrderAverageTradedPrice),
    orderType: text(o.OrderType) || "Limit",
    product: productOf(o.ProductType),
    status: orderStatusOf(o.OrderStatus, o.OrderType),
    statusMessage: text(o.CancelRejectReason) || null,
    placedAt: istStamp(o.OrderGeneratedDateTime),
  };
}

export function toTrade(t) {
  return {
    tradeId: text(t.ExecutionID || t.ExchangeOrderID || t.AppOrderID),
    orderId: text(t.AppOrderID),
    tradingSymbol: text(t.TradingSymbol),
    exchange: exchangeOf(t.ExchangeSegment),
    token: text(t.ExchangeInstrumentID),
    side: sideOf(t.OrderSide),
    qty: toNum(t.LastTradedQuantity ?? t.CumulativeQuantity),
    price: toNum(t.LastTradedPrice ?? t.OrderAverageTradedPrice),
    tradedAt: istStamp(t.LastExecutionTransactTime ?? t.ExchangeTransactTime),
  };
}

export function toPosition(p) {
  const netQty = toNum(p.Quantity ?? p.NetQty);
  const realised = toNumOrNull(p.RealizedMTM);
  const unrealised = toNumOrNull(p.UnrealizedMTM);
  const mtm = toNumOrNull(p.MTM);
  return {
    tradingSymbol: text(p.TradingSymbol),
    exchange: exchangeOf(p.ExchangeSegment),
    token: text(p.ExchangeInstrumentID),
    product: productOf(p.ProductType),
    netQty,
    avgPrice: netQty > 0 ? toNum(p.BuyAveragePrice) : netQty < 0 ? toNum(p.SellAveragePrice) : 0,
    ltp: null,
    pnl: mtm ?? toNum(realised) + toNum(unrealised),
    realisedPnl: realised,
    unrealisedPnl: unrealised,
  };
}

/** Holdings map keyed by ISIN: documented result.RMSHoldingList[0].Holdings (object form accepted too). */
function holdingsByIsin(result) {
  const box = result?.RMSHoldingList ?? result?.RMSHoldings ?? {};
  const first = Array.isArray(box) ? box[0] : box;
  return first?.Holdings && typeof first.Holdings === "object" ? first.Holdings : {};
}

export function toHolding(h) {
  const nse = text(h.ExchangeNSEInstrumentId);
  const onNse = nse !== "" && nse !== "0";
  return {
    tradingSymbol: text(h.TradingSymbol || h.ISIN), // XTS holdings carry no trading symbol; ISIN is the stable id
    exchange: onNse ? "NSE" : "BSE",
    token: onNse ? nse : text(h.ExchangeBSEInstrumentId),
    isin: h.ISIN ? text(h.ISIN) : null,
    qty: toNum(h.HoldingQuantity),
    avgPrice: toNum(h.BuyAvgPrice),
    ltp: null,
    pnl: null,
  };
}

export function toFunds(result) {
  const raw = result?.BalanceList;
  const entry = Array.isArray(raw) ? raw[0] : raw;
  const rms = entry?.limitObject?.RMSSubLimits ?? {};
  return {
    availableCash: toNum(rms.netMarginAvailable),
    usedMargin: toNum(rms.marginUtilized),
    totalBalance: toNumOrNull(rms.cashAvailable),
    collateral: toNumOrNull(rms.collateral),
    withdrawable: null,
  };
}

// ── historical (pure) ──

export const COMPRESSION = Object.freeze({ "1m": "60", "3m": "180", "5m": "300", "15m": "900", "30m": "1800", "60m": "3600", "1d": "D" });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function whenMs(value, endOfDay) {
  const s = text(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T${endOfDay ? "15:30:00" : "09:15:00"}+05:30`);
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new BrokerInputError(`Invalid date: ${s}`);
  return t;
}

/** Epoch ms -> "Jan 27 2025 090000" in IST (the official OHLC time format). */
export function xtsTime(ms) {
  const d = new Date(ms + IST_SECONDS * 1000);
  const two = (n) => String(n).padStart(2, "0");
  return `${MON[d.getUTCMonth()]} ${two(d.getUTCDate())} ${d.getUTCFullYear()} ${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;
}

/** dataReponse -> Candle[] (true epoch seconds, ascending, de-duplicated). */
export function parseCandles(dataResponse, interval) {
  const byTime = new Map();
  const daily = interval === "1d";
  const step = daily ? 0 : Number(COMPRESSION[interval]) || 60;
  for (const row of text(dataResponse).split(",")) {
    const f = row.split("|");
    if (f.length < 6) continue;
    const stamp = Number(f[0]);
    if (!Number.isFinite(stamp) || stamp <= 0) continue;
    let time;
    if (daily) {
      const d = new Date(stamp * 1000); // IST calendar date written as UTC
      time = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000 - IST_SECONDS;
    } else {
      time = stamp - IST_SECONDS;
      time -= time % step;
    }
    const candle = { time, open: toNum(f[1]), high: toNum(f[2]), low: toNum(f[3]), close: toNum(f[4]), volume: toNum(f[5]) };
    const oi = toNumOrNull(f[6]);
    if (oi !== null) candle.oi = oi;
    byTime.set(time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// ── errors ──

const TOKEN_REJECTED = /invalid token|token expired|token is not valid|session expired|not logged in|e-token-|e-session-/i;
const isTokenRejection = (status, json) => status === 401 || TOKEN_REJECTED.test(`${text(json?.code)} ${text(json?.description)}`);

// ── throttle ──

function spacer(intervalOf) {
  let queue = Promise.resolve();
  let nextAt = 0;
  return () => {
    const turn = queue.then(async () => {
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextAt = Date.now() + intervalOf();
    });
    queue = turn.catch(() => {});
    return turn;
  };
}

/** Accept a broker-returned connectionString only on the broker's own https host. */
export function pinnedConnectionString(raw, host) {
  let url;
  try { url = new URL(text(raw)); } catch { return null; }
  const fixed = new URL(host);
  if (url.protocol !== "https:" || url.hostname !== fixed.hostname || url.username || url.password || url.search || url.hash) return null;
  if (!/^\/[A-Za-z0-9]*interactive\/?$/.test(url.pathname)) return null;
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

// ── factory ──

/**
 * @param {object} cfg
 * @param {string} cfg.id
 * @param {string} cfg.label                 user-facing name
 * @param {string} cfg.host                  https origin (with port when the broker uses one), fixed
 * @param {string} cfg.marketDataPath        "/apibinarymarketdata" or "/apimarketdata"
 * @param {"keyPair"|"oauthHostLookup"|"pastedSession"} cfg.interactiveMode
 * @param {string} [cfg.hostLookupUrl]       oauthHostLookup only
 * @param {string} [cfg.loginHint]           how the user gets a fresh token
 */
export function createXtsFamilyBroker(cfg) {
  const { id, label, host, marketDataPath, interactiveMode, hostLookupUrl = `${host}/hostlookup`, loginHint = "" } = cfg;
  const MD = `${host}${marketDataPath}`;
  const IA = `${host}/interactive`;
  const gaps = { md: 1000, read: 1000, order: 100 };
  const mdTurn = spacer(() => gaps.md);
  const readTurn = spacer(() => gaps.read);
  const orderTurn = spacer(() => gaps.order);

  const mdSessions = createSessionCache();
  const iaSessions = createSessionCache();
  const pending = new Map();
  const deadTokens = createBoundedSet();

  async function send(url, { method = "GET", body, token } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.authorization = token; // bare token, no "Bearer"
    let res;
    try {
      res = await brokerFetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new BrokerError(`${label}: network error (${e?.message || e})`);
    }
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* non-JSON body */ }
    if (Array.isArray(json) && json.length === 1 && json[0]?.type) json = json[0]; // some doc samples wrap the envelope
    return { status: res.status, json };
  }

  function failure(status, json, what) {
    const desc = text(json?.description || json?.message) || `HTTP ${status}`;
    if (status === 429 || /rate limit|too many/i.test(desc)) return new BrokerError(`${label}: rate limit hit on ${what} (${desc}).`, { code: "UPSTREAM_RATE_LIMIT" });
    if (isTokenRejection(status, json)) return new BrokerError(`${label}: the broker rejected the session on ${what} (${desc}).`, { code: "UPSTREAM_AUTH" });
    return new BrokerError(`${label}: ${what} failed (${desc}).`);
  }

  const withQuery = (url, query) => {
    if (!query) return url;
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    return qs ? `${url}?${qs}` : url;
  };

  function once(key, fn) {
    if (!pending.has(key)) pending.set(key, (async () => { try { return await fn(); } finally { pending.delete(key); } })());
    return pending.get(key);
  }

  // ── market-data session ──

  function mdKeys(creds) {
    const appKey = text(creds?.apiKey).trim();
    const secretKey = text(creds?.apiSecret).trim();
    if (!appKey || !secretKey) {
      throw new BrokerInputError(`${label}: add the Market Data App Key and Secret Key (${[!appKey && "apiKey", !secretKey && "apiSecret"].filter(Boolean).join(", ")}) in Broker Settings.`);
    }
    return { appKey, secretKey, cacheKey: hashKey([id, "md", appKey, secretKey]) };
  }

  async function mdSession(creds) {
    const keys = mdKeys(creds);
    const hit = mdSessions.get(keys.cacheKey);
    if (hit && hit.expiresAt > Date.now()) return { ...hit, cacheKey: keys.cacheKey };
    return once(keys.cacheKey, async () => {
      const r = await send(`${MD}/auth/login`, { method: "POST", body: { appKey: keys.appKey, secretKey: keys.secretKey, source: "WebAPI" } });
      if (r.json?.type !== "success" || !r.json?.result?.token) {
        throw new BrokerError(`${label}: market-data login failed (${text(r.json?.description) || `HTTP ${r.status}`}). Check the Market Data App Key and Secret Key.`, { code: "UPSTREAM_AUTH" });
      }
      const s = { token: text(r.json.result.token), expiresAt: Math.min(Date.now() + ONE_DAY_MS, nextIstMidnightMs()) };
      mdSessions.set(keys.cacheKey, s);
      return { ...s, cacheKey: keys.cacheKey };
    });
  }

  /** Authenticated market-data call; one silent re-login on a token rejection (keys only, no human secret). */
  async function md(creds, path, { method = "GET", body, query, what = path } = {}) {
    let session = await mdSession(creds);
    await mdTurn();
    let r = await send(withQuery(`${MD}${path}`, query), { method, body, token: session.token });
    if (r.json?.type !== "success" && isTokenRejection(r.status, r.json)) {
      mdSessions.delete(session.cacheKey);
      session = await mdSession(creds);
      await mdTurn();
      r = await send(withQuery(`${MD}${path}`, query), { method, body, token: session.token });
    }
    if (r.json?.type !== "success") throw failure(r.status, r.json, what);
    return r.json.result;
  }

  // ── interactive session ──

  function iaKeys(creds) {
    if (interactiveMode === "pastedSession") {
      const token = text(creds?.interactiveSessionToken).trim();
      if (!token) throw new SessionRequiredError(`${label}: trading needs today's session token (interactiveSessionToken) in Broker Settings. ${loginHint}`.trim());
      return { mode: "pastedSession", token, cacheKey: hashKey([id, "ia", "pasted", token]) };
    }
    const appKey = text(creds?.interactiveApiKey).trim();
    const secretKey = text(creds?.interactiveApiSecret).trim();
    const missing = [!appKey && "interactiveApiKey", !secretKey && "interactiveApiSecret"].filter(Boolean);
    if (missing.length) throw new BrokerInputError(`${label}: trading (Interactive API) needs ${missing.join(", ")} in Broker Settings.`);
    const accessToken = interactiveMode === "oauthHostLookup" ? text(creds?.requestToken).trim() : "";
    // Without a pasted accessToken the plain key-pair login (official SDK route) is tried instead.
    const mode = accessToken ? "oauthHostLookup" : "keyPair";
    return { mode, appKey, secretKey, accessToken, cacheKey: hashKey([id, "ia", mode, appKey, secretKey, accessToken]) };
  }

  async function openOauthSession(keys) {
    const lookup = await send(hostLookupUrl, { method: "POST", body: { ...HOSTLOOKUP_BODY } });
    const result = lookup.json?.result;
    const uniqueKey = text(result?.UniqueKey ?? result?.uniqueKey);
    if (lookup.json?.type !== "success" || !uniqueKey) throw failure(lookup.status, lookup.json, "host lookup");
    const base = pinnedConnectionString(result?.connectionString ?? result?.ConnectionString, host);
    if (!base) throw new BrokerError(`${label}: host lookup returned a server outside ${new URL(host).hostname}; refusing to use it.`);
    const r = await send(`${base}/user/session`, { method: "POST", body: { appKey: keys.appKey, secretKey: keys.secretKey, accessToken: keys.accessToken, uniqueKey } });
    return { r, base };
  }

  async function iaSession(creds) {
    const keys = iaKeys(creds);
    const hit = iaSessions.get(keys.cacheKey);
    if (hit && hit.expiresAt > Date.now()) return { ...hit, cacheKey: keys.cacheKey };
    if (deadTokens.has(keys.cacheKey)) {
      throw new SessionRequiredError(`${label}: this login token has already been used or has expired. ${loginHint}`.trim());
    }
    if (keys.mode === "pastedSession") {
      const s = { token: keys.token, base: IA, isInvestorClient: true, expiresAt: nextIstMidnightMs() };
      iaSessions.set(keys.cacheKey, s);
      return { ...s, cacheKey: keys.cacheKey };
    }
    return once(keys.cacheKey, async () => {
      let r;
      let base = IA;
      if (keys.mode === "oauthHostLookup") ({ r, base } = await openOauthSession(keys));
      else r = await send(`${IA}/user/session`, { method: "POST", body: { appKey: keys.appKey, secretKey: keys.secretKey, source: "WebAPI" } });
      const result = r.json?.result;
      if (r.json?.type !== "success" || !result?.token) {
        const desc = text(r.json?.description || r.json?.message) || `HTTP ${r.status}`;
        if (keys.mode === "oauthHostLookup" && r.status < 500 && r.json) {
          deadTokens.add(keys.cacheKey);
          throw new SessionRequiredError(`${label}: the broker did not accept the login token (${desc}). ${loginHint}`.trim());
        }
        throw new BrokerError(`${label}: trading login failed (${desc}). Check the Interactive App Key and Secret Key.`, { code: "UPSTREAM_AUTH" });
      }
      const s = { token: text(result.token), base, isInvestorClient: result.isInvestorClient !== false, expiresAt: Math.min(Date.now() + ONE_DAY_MS, nextIstMidnightMs()) };
      iaSessions.set(keys.cacheKey, s);
      return { ...s, cacheKey: keys.cacheKey };
    });
  }

  /** clientID: required for dealer logins, sent whenever the user saved one. */
  function addClient(creds, session, query, body) {
    const clientId = text(creds?.clientId).trim();
    if (!clientId) {
      if (!session.isInvestorClient) throw new BrokerInputError(`${label}: this is a dealer login; add the client code as clientId in Broker Settings.`);
      return { query, body };
    }
    return body ? { query, body: { ...body, clientID: clientId } } : { query: { ...(query || {}), clientID: clientId }, body };
  }

  /**
   * Interactive call. Reads re-login once after a token rejection (key-pair only). Order calls never retry;
   * pasted or one-time tokens cannot be renewed here, so a rejection asks the user to log in again.
   */
  async function ia(creds, path, { method = "GET", body, query, kind = "read", what = path } = {}) {
    let session = await iaSession(creds);
    const call = async (s) => {
      await (kind === "order" ? orderTurn() : readTurn());
      const d = addClient(creds, s, query, body);
      return send(withQuery(`${s.base}${path}`, d.query), { method, body: d.body, token: s.token });
    };
    let r = await call(session);
    if (r.json?.type !== "success" && isTokenRejection(r.status, r.json)) {
      iaSessions.delete(session.cacheKey);
      const renewable = iaKeys(creds).mode === "keyPair";
      if (!renewable) {
        deadTokens.add(session.cacheKey);
        throw new SessionRequiredError(`${label}: your trading session has expired. ${loginHint}`.trim());
      }
      if (kind === "order") throw failure(r.status, r.json, what);
      session = await iaSession(creds);
      r = await call(session);
    }
    if (r.json?.type !== "success") throw failure(r.status, r.json, what);
    return r.json.result;
  }

  // ── instruments ──

  async function master(creds, segment) {
    return getCachedOrFetch(`${id}:xtsfam-master:${segment}`, async () => {
      const result = await md(creds, "/instruments/master", { method: "POST", body: { exchangeSegmentList: [segment] }, what: `instrument master ${segment}` });
      if (typeof result !== "string") throw new BrokerError(`${label}: instrument master ${segment} had an unexpected shape.`);
      return parseMasterFo(result);
    }, ONE_DAY_MS);
  }

  async function indexEntries(creds, segment) {
    return getCachedOrFetch(`${id}:xtsfam-indexlist:${segment}`, async () => {
      const result = await md(creds, "/instruments/indexlist", { query: { exchangeSegment: SEGMENT_ID[segment] }, what: `index list ${segment}` });
      return parseIndexEntries(result?.indexList);
    }, ONE_DAY_MS);
  }

  function resolve(symbol) {
    const s = text(symbol).trim().toUpperCase();
    if (INDEX_MAP[s]) return { symbol: s, index: true, ...INDEX_MAP[s] };
    if (!STOCK_RE.test(s)) throw new BrokerInputError(`${label}: unknown symbol ${symbol}`);
    return { symbol: s, index: false, fo: "NSEFO", cash: "NSECM", listNames: [], aliases: [] };
  }

  async function optionRows(creds, sym) {
    const rows = await master(creds, sym.fo);
    const out = rows.filter((r) => r.opt && r.name === sym.symbol && r.index === sym.index);
    if (!out.length && !sym.index) throw new BrokerInputError(`${label}: no options listed for ${sym.symbol}`);
    return out;
  }

  async function spotRef(creds, sym, rows) {
    if (sym.index) {
      const hit = (await indexEntries(creds, sym.cash)).find((e) => sym.listNames.includes(e.name));
      return hit ? { segmentId: SEGMENT_ID[sym.cash], token: hit.token } : null;
    }
    const token = rows.map((r) => cashTokenFromUnderlying(r.underlyingId)).find(Boolean);
    return token ? { segmentId: SEGMENT_ID.NSECM, token } : null;
  }

  // ── quotes ──

  async function quotesFor(creds, refs, { withOi = true } = {}) {
    const map = new Map(refs.map((r) => [keyOf(r.segmentId, r.token), { md: null, oi: null }]));
    const place = (list, chunk, apply) => list.forEach((q, i) => {
      const k = q.ExchangeInstrumentID != null ? keyOf(q.ExchangeSegment ?? chunk[i]?.segmentId, q.ExchangeInstrumentID) : chunk[i] && keyOf(chunk[i].segmentId, chunk[i].token);
      if (k && map.has(k)) apply(map.get(k), q);
    });
    for (let i = 0; i < refs.length; i += QUOTE_CHUNK) {
      const chunk = refs.slice(i, i + QUOTE_CHUNK);
      const instruments = chunk.map((r) => ({ exchangeSegment: Number(r.segmentId), exchangeInstrumentID: Number(r.token) }));
      const depth = await md(creds, "/instruments/quotes", { method: "POST", body: { instruments, xtsMessageCode: MSG_DEPTH, publishFormat: "JSON" }, what: "quotes" });
      place(readListQuotes(depth), chunk, (slot, q) => { slot.md = q; });
      if (!withOi) continue;
      try {
        const oi = await md(creds, "/instruments/quotes", { method: "POST", body: { instruments, xtsMessageCode: MSG_OI, publishFormat: "JSON" }, what: "open interest" });
        place(readListQuotes(oi), chunk, (slot, q) => { if (q.OpenInterest != null) slot.oi = toNum(q.OpenInterest); });
      } catch (e) {
        if (e instanceof BrokerError && e.code === "UPSTREAM_AUTH") throw e;
        // Open interest is best-effort: a failed 1510 call leaves oi null instead of failing the chain.
      }
    }
    return map;
  }

  function refOf(instrument) {
    const segment = SEGMENT_FOR_EXCHANGE[instrument?.exchange];
    if (!segment) throw new BrokerInputError(`Invalid exchange: ${instrument?.exchange}`);
    if (!TOKEN_RE.test(text(instrument?.token))) throw new BrokerInputError(`Invalid token: ${instrument?.token}`);
    return { segmentId: SEGMENT_ID[segment], token: text(instrument.token), exchange: instrument.exchange, segment };
  }

  async function spotPrice(creds, ref) {
    const q = (await quotesFor(creds, [ref], { withOi: false })).get(keyOf(ref.segmentId, ref.token));
    return toNum(touchlineOf(q?.md).LastTradedPrice);
  }

  // ── capabilities ──

  function secretsIn(creds = {}) {
    return ["apiKey", "apiSecret", "interactiveApiKey", "interactiveApiSecret", "requestToken", "interactiveSessionToken"]
      .map((k) => text(creds?.[k]))
      .filter((v) => v.length >= 4);
  }

  function normaliseError(err, { secrets = [] } = {}) {
    const out = baseNormalise(err, { secrets });
    if (!(err instanceof BrokerError) && TOKEN_REJECTED.test(text(err?.message))) out.code = "UPSTREAM_AUTH";
    out.message = redactSecrets(out.message, secrets);
    return out;
  }

  async function testConnection(creds = {}) {
    try {
      await md(creds, "/config/clientConfig", { what: "client config" });
      let trading = "trading API not set up";
      const hasTrading = interactiveMode === "pastedSession" ? text(creds.interactiveSessionToken) : text(creds.interactiveApiKey);
      if (hasTrading) {
        if (interactiveMode === "pastedSession") await ia(creds, "/user/profile", { what: "profile" });
        else await iaSession(creds);
        trading = "trading API connected";
      }
      return { status: "success", message: `${label}: market data connected; ${trading}.` };
    } catch (e) {
      return { status: "error", message: normaliseError(e, { secrets: secretsIn(creds) }).message };
    }
  }

  async function fetchInstruments(creds) {
    const data = [];
    for (const segment of ["NSEFO", "BSEFO"]) {
      for (const row of await master(creds, segment)) {
        const inst = rowToInstrument(row);
        if (inst) data.push(inst);
      }
    }
    for (const [name, u] of Object.entries(INDEX_MAP)) {
      const hit = (await indexEntries(creds, u.cash)).find((e) => u.listNames.includes(e.name));
      if (hit) data.push({ token: hit.token, exchange: EXCHANGE_FOR_SEGMENT[u.cash], tradingSymbol: hit.name, underlying: name, instrumentType: "INDEX", expiry: null, strike: null, optionType: null, lotSize: 1, tickSize: 0.05 });
    }
    return { status: "success", data };
  }

  async function fetchExpiryList(creds, symbol) {
    const sym = resolve(symbol);
    const rows = await optionRows(creds, sym);
    return { status: "success", data: [...new Set(rows.map((r) => r.expiry))].sort() };
  }

  async function fetchLTP(creds, symbol) {
    const sym = resolve(symbol);
    const rows = sym.index ? [] : await optionRows(creds, sym);
    const ref = await spotRef(creds, sym, rows);
    if (!ref) throw new BrokerError(`${label}: could not find the spot instrument for ${sym.symbol}.`);
    const last_price = await spotPrice(creds, ref);
    if (!(last_price > 0)) throw new BrokerError(`${label}: no last traded price for ${sym.symbol}.`);
    return { status: "success", data: { last_price } };
  }

  async function fetchOptionChain(creds, symbol, expiry) {
    const sym = resolve(symbol);
    const rows = await optionRows(creds, sym);
    const target = expiry || [...new Set(rows.map((r) => r.expiry))].sort()[0];
    const legs = rows.filter((r) => r.expiry === target);
    if (!legs.length) return { status: "success", data: { oc: {}, last_price: 0 } };

    const ref = await spotRef(creds, sym, rows);
    const spot = ref ? await spotPrice(creds, ref) : 0;

    const strikes = [...new Set(legs.map((r) => r.strike))].sort((a, b) => a - b);
    let atm = Math.floor(strikes.length / 2);
    if (spot > 0) atm = strikes.reduce((best, s, i) => (Math.abs(s - spot) < Math.abs(strikes[best] - spot) ? i : best), 0);
    const keep = new Set(strikes.slice(Math.max(0, atm - CHAIN_HALF_WIDTH), atm + CHAIN_HALF_WIDTH + 1));
    const chosen = legs.filter((r) => keep.has(r.strike));
    const segId = SEGMENT_ID[sym.fo];
    const quotes = await quotesFor(creds, chosen.map((r) => ({ segmentId: segId, token: r.token })));
    const dte = daysBetween(new Date(), target);

    const oc = {};
    for (const r of chosen) {
      const q = quotes.get(keyOf(segId, r.token));
      if (!q?.md) continue;
      const tl = touchlineOf(q.md);
      const ltp = toNum(tl.LastTradedPrice);
      const key = String(r.strike);
      oc[key] = oc[key] || {};
      oc[key][r.opt.toLowerCase()] = {
        last_price: ltp,
        oi: toNum(q.oi),
        volume: toNum(tl.TotalTradedQuantity),
        ...computeIVAndGreeks({ ltp, spot, strike: r.strike, daysToExpiry: dte, type: r.opt }),
        bid_price: toNum(tl.BidInfo?.Price),
        ask_price: toNum(tl.AskInfo?.Price),
        security_id: r.token,
      };
    }
    return { status: "success", data: { oc, last_price: spot } };
  }

  async function fetchQuotes(creds, refs = []) {
    const parsed = (Array.isArray(refs) ? refs : []).map(refOf);
    const map = await quotesFor(creds, parsed);
    const data = [];
    for (const r of parsed) {
      const q = map.get(keyOf(r.segmentId, r.token));
      if (!q?.md) continue;
      const tl = touchlineOf(q.md);
      data.push({
        token: r.token, exchange: r.exchange, ltp: toNum(tl.LastTradedPrice),
        open: toNumOrNull(tl.Open), high: toNumOrNull(tl.High), low: toNumOrNull(tl.Low), close: toNumOrNull(tl.Close),
        volume: toNumOrNull(tl.TotalTradedQuantity), oi: q.oi, bid: toNumOrNull(tl.BidInfo?.Price), ask: toNumOrNull(tl.AskInfo?.Price),
      });
    }
    return { status: "success", data };
  }

  async function fetchDepth(creds, instrument) {
    const r = refOf(instrument);
    const q = (await quotesFor(creds, [r], { withOi: false })).get(keyOf(r.segmentId, r.token));
    const level = (l) => ({ price: toNum(l?.Price), qty: toNum(l?.Size), orders: toNumOrNull(l?.TotalOrders) });
    return { status: "success", data: { bids: levels(q?.md?.Bids).slice(0, 5).map(level), asks: levels(q?.md?.Asks).slice(0, 5).map(level) } };
  }

  async function fetchHistorical(creds, { instrument, interval, from, to } = {}) {
    const r = refOf(instrument);
    const compressionValue = COMPRESSION[interval];
    if (!compressionValue) throw new BrokerInputError(`${label}: unsupported interval ${interval} (use ${Object.keys(COMPRESSION).join(", ")})`);
    const start = whenMs(from, false);
    const end = whenMs(to, true);
    if (!(end >= start)) throw new BrokerInputError(`${label}: 'to' must not be before 'from'`);
    const windowMs = (interval === "1d" ? 365 : 5) * ONE_DAY_MS;
    const candles = new Map();
    for (let s = start; s <= end; s += windowMs + 1000) {
      const e = Math.min(s + windowMs, end);
      const result = await md(creds, "/instruments/ohlc", {
        query: { exchangeSegment: r.segment, exchangeInstrumentID: r.token, startTime: xtsTime(s), endTime: xtsTime(e), compressionValue },
        what: "historical candles",
      });
      for (const c of parseCandles(result?.dataReponse ?? result?.dataResponse, interval)) candles.set(c.time, c);
    }
    return { status: "success", data: [...candles.values()].sort((a, b) => a.time - b.time) };
  }

  const listIn = (result, key) => (Array.isArray(result) ? result : Array.isArray(result?.[key]) ? result[key] : []);

  async function fetchPositions(creds) {
    const result = await ia(creds, "/portfolio/positions", { query: { dayOrNet: "NetWise" }, what: "positions" });
    return { status: "success", data: listIn(result, "positionList").map(toPosition) };
  }

  async function fetchHoldings(creds) {
    const result = await ia(creds, "/portfolio/holdings", { what: "holdings" });
    return { status: "success", data: Object.values(holdingsByIsin(result)).map(toHolding) };
  }

  async function fetchFunds(creds) {
    return { status: "success", data: toFunds(await ia(creds, "/user/balance", { what: "balance" })) };
  }

  async function fetchOrderBook(creds) {
    const result = await ia(creds, "/orders", { what: "order book" });
    return { status: "success", data: listIn(result, "orderList").map(toOrder) };
  }

  async function fetchTradeBook(creds) {
    const result = await ia(creds, "/orders/trades", { what: "trade book" });
    return { status: "success", data: listIn(result, "tradeList").map(toTrade) };
  }

  const ackId = (result, fallback) => text((Array.isArray(result) ? result[0] : result)?.AppOrderID || fallback);

  const placeOrder = withOrderGate("placeOrder", async (creds, order, resolvedLotSize) => {
    const body = buildPlaceBody(order, resolvedLotSize);
    const result = await ia(creds, "/orders", { method: "POST", body, kind: "order", what: "place order" });
    const orderId = ackId(result, "");
    if (!orderId) throw new BrokerError(`${label}: the broker did not return an order id. ${ORDER_BOOK_HINT}`);
    return { orderId, orderStatus: "UNKNOWN" }; // placement is asynchronous; the order book is authoritative
  }, { brokerId: id });

  const modifyOrder = withOrderGate("modifyOrder", async (creds, orderId, changes) => {
    const body = buildModifyBody(orderId, changes);
    const result = await ia(creds, "/orders", { method: "PUT", body, kind: "order", what: "modify order" });
    return { orderId: ackId(result, orderId), orderStatus: "UNKNOWN" };
  }, { brokerId: id });

  const cancelOrder = withOrderGate("cancelOrder", async (creds, orderId) => {
    const appOrderID = cleanOrderId(orderId);
    const result = await ia(creds, "/orders", { method: "DELETE", query: { appOrderID, orderUniqueIdentifier: "mrchub" }, kind: "order", what: "cancel order" });
    return { orderId: ackId(result, appOrderID), orderStatus: "UNKNOWN" };
  }, { brokerId: id });

  /** Test-only: forget cached sessions and set the throttle spacing (ms). */
  function resetForTests({ intervalMs = 0 } = {}) {
    mdSessions.clear();
    iaSessions.clear();
    pending.clear();
    deadTokens.clear();
    gaps.md = intervalMs;
    gaps.read = intervalMs;
    gaps.order = intervalMs;
  }

  return {
    urls: { MD, IA, HOSTLOOKUP: hostLookupUrl },
    testConnection, fetchInstruments, fetchExpiryList, fetchOptionChain, fetchLTP, fetchQuotes, fetchDepth, fetchHistorical,
    fetchPositions, fetchHoldings, fetchFunds, fetchOrderBook, fetchTradeBook, placeOrder, modifyOrder, cancelOrder,
    normaliseError, resetForTests,
  };
}

/** Capability descriptor shared by the three adapters (only the auth kind differs). */
export function xtsFamilyCapabilities(authKind) {
  return Object.freeze({
    auth: { kind: authKind },
    testConnection: true,
    instruments: true,
    expiries: true,
    optionChain: { greeks: "computed", native: false },
    ltp: true,
    quotes: true,
    depth: true,
    historical: { intervals: Object.keys(COMPRESSION) },
    positions: true,
    holdings: true,
    funds: true,
    orderBook: true,
    tradeBook: true,
    placeOrder: true,
    modifyOrder: true,
    cancelOrder: true,
    normaliseError: true,
    // Legacy order-feature descriptor (official enums). Cover and bracket orders have their own
    // endpoints that this engine does not call; IOC is a documented timeInForce. MTF exists as a
    // product enum but is not mapped here.
    bracket: false,
    cover: false,
    ioc: true,
    mtf: false,
    nativeMarketProtection: false,
    maxLegQty: null,
    products: ["CNC", "MIS", "NRML"],
  });
}
