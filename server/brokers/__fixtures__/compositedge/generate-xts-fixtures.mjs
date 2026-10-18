/**
 * Generates the contract fixtures for the three XTS brokers (compositedge, ibulls, jainamxts).
 * Run: node server/brokers/__fixtures__/compositedge/generate-xts-fixtures.mjs
 *
 * Every payload follows the documented sample in Symphony Fintech's official XTS specs
 * (https://symphonyfintech.com/marketdata/doc/data.json and https://symphonyfintech.com/interactive/doc/data.json):
 * same envelope ({type, code, description, result}), same field names, same string-encoded listQuotes,
 * same pipe-delimited master and dataReponse layouts. The docs' sample instruments (ACC, IDEA, RELIANCE 2885)
 * were moved onto NIFTY (20 Oct 2026 weekly, 27 Oct monthly), SENSEX (22 Oct weekly), BANKEX (29 Oct monthly)
 * and RELIANCE (27 Oct monthly) contracts; every token, key and account id is a dummy value.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = [
  "https://symphonyfintech.com/marketdata/doc/ (official XTS Market Data API spec, data.json): /auth/login, /config/clientConfig, /instruments/master, /instruments/indexlist, /instruments/quotes (1502, 1510), /instruments/ohlc, Rate Limit",
  "https://symphonyfintech.com/interactive/doc/ (official XTS Interactive API spec, data.json): /user/session, /user/balance, /orders (place, modify, cancel, order book), /orders/trades, /portfolio/positions, /portfolio/holdings, enums, Rate Limit",
  "https://github.com/symphonyfintech/xts-pythonclient-api-sdk and https://github.com/symphonyfintech/xts-pythonsdk-binarymarketdata-withbroadcastmode-api-sdk (official SDK route tables)",
];

const BROKERS = {
  compositedge: {
    host: "https://xts.compositedge.com",
    md: "/apimarketdata",
    creds: { apiKey: "dummyMdAppKey01", apiSecret: "dummyMdSecret01", interactiveApiKey: "dummyIaAppKey01", interactiveApiSecret: "dummyIaSecret01", requestToken: "dummyRequestToken01" },
    sessionBody: { appKey: "dummyIaAppKey01", secretKey: "dummyIaSecret01", accessToken: "dummyRequestToken01" },
    mdLoginBody: { appKey: "dummyMdAppKey01", secretKey: "dummyMdSecret01", source: "WebAPI" },
    extraSources: ["https://xts.compositedge.com/interactive/thirdparty?appKey=...&returnURL=... (3-legged login page; flow described in the official /user/session doc)"],
  },
  ibulls: {
    host: "https://xts.ibullssecurities.com",
    md: "/apibinarymarketdata",
    creds: { marketApiKey: "dummyMdAppKey02", marketApiSecret: "dummyMdSecret02", interactiveApiKey: "dummyIaAppKey02", interactiveApiSecret: "dummyIaSecret02" },
    sessionBody: { appKey: "dummyIaAppKey02", secretKey: "dummyIaSecret02", source: "WebAPI" },
    mdLoginBody: { appKey: "dummyMdAppKey02", secretKey: "dummyMdSecret02", source: "WebAPI" },
    extraSources: [],
  },
  jainamxts: {
    host: "https://jtrade.jainam.in:5000",
    md: "/apibinarymarketdata",
    creds: { apiKey: "dummyMdAppKey03", apiSecret: "dummyMdSecret03", interactiveApiKey: "dummyIaAppKey03", interactiveApiSecret: "dummyIaSecret03" },
    sessionBody: { appKey: "dummyIaAppKey03", secretKey: "dummyIaSecret03", source: "WebAPI" },
    mdLoginBody: { appKey: "dummyMdAppKey03", secretKey: "dummyMdSecret03", source: "WebAPI" },
    extraSources: [],
  },
};

// ── market-data payloads ──

const ok = (description, result, code = "s-response-0001") => ({ type: "success", code, description, result });

const MD_LOGIN = ok("Provided Valid Credentials", { token: "dummy.md.jwt.token", userID: "DUMMY1", appVersion: "1.0", application_expiry_date: "2027-01-01" }, "s-user-0001");
const CLIENT_CONFIG = ok("Fetched configurations successfully", {
  exchangeSegments: { NSECM: 1, NSEFO: 2, NSECD: 3, BSECM: 11, BSEFO: 12, MCXFO: 51 },
  xtsMessageCode: { touchlineEvent: 1501, marketDepthEvent: 1502, indexDataEvent: 1504, candleDataEvent: 1505, openInterestEvent: 1510 },
  publishFormat: ["Binary", "JSON"],
  broadCastMode: ["Full", "Partial"],
});

// 0 ExchangeSegment|1 ExchangeInstrumentID|2 InstrumentType|3 Name|4 Description|5 Series|6 NameWithSeries|7 InstrumentID|
// 8 PriceBand.High|9 PriceBand.Low|10 FreezeQty|11 TickSize|12 LotSize|13 Multiplier|14 UnderlyingInstrumentId|
// 15 UnderlyingIndexName|16 ContractExpiration|17 StrikePrice|18 OptionType|19 displayName|20 PriceNumerator|21 PriceDenominator|22 DetailedDescription
function foLine(seg, token, name, desc, series, under, underName, expiry, strike, optType, lot, display) {
  return [seg, token, optType === "1" ? "1" : "2", name, desc, series, `${name}-${series}`, `2${token}`.padEnd(13, "0"), "999.95", "0.05", "1801", "0.05", lot, "1", under, underName, `${expiry}T14:30:00`, strike, optType, display, "1", "1", desc].join("|");
}

const NSEFO_MASTER = [
  foLine("NSEFO", "40001", "NIFTY", "NIFTY26O2024900CE", "OPTIDX", "-1", "Nifty 50", "2026-10-20", "24900", "3", "75", "NIFTY 20OCT2026 CE 24900"),
  foLine("NSEFO", "40002", "NIFTY", "NIFTY26O2024900PE", "OPTIDX", "-1", "Nifty 50", "2026-10-20", "24900", "4", "75", "NIFTY 20OCT2026 PE 24900"),
  foLine("NSEFO", "40003", "NIFTY", "NIFTY26O2025000CE", "OPTIDX", "-1", "Nifty 50", "2026-10-20", "25000", "3", "75", "NIFTY 20OCT2026 CE 25000"),
  foLine("NSEFO", "40004", "NIFTY", "NIFTY26O2025000PE", "OPTIDX", "-1", "Nifty 50", "2026-10-20", "25000", "4", "75", "NIFTY 20OCT2026 PE 25000"),
  foLine("NSEFO", "40005", "NIFTY", "NIFTY26O2025100CE", "OPTIDX", "-1", "Nifty 50", "2026-10-20", "25100", "3", "75", "NIFTY 20OCT2026 CE 25100"),
  foLine("NSEFO", "40006", "NIFTY", "NIFTY26O2025100PE", "OPTIDX", "-1", "Nifty 50", "2026-10-20", "25100", "4", "75", "NIFTY 20OCT2026 PE 25100"),
  foLine("NSEFO", "40011", "NIFTY", "NIFTY26OCT25000CE", "OPTIDX", "-1", "Nifty 50", "2026-10-27", "25000", "3", "75", "NIFTY 27OCT2026 CE 25000"),
  foLine("NSEFO", "40012", "NIFTY", "NIFTY26OCT25000PE", "OPTIDX", "-1", "Nifty 50", "2026-10-27", "25000", "4", "75", "NIFTY 27OCT2026 PE 25000"),
  foLine("NSEFO", "40021", "NIFTY", "NIFTY26OCTFUT", "FUTIDX", "-1", "Nifty 50", "2026-10-27", "-1", "1", "75", "NIFTY 27OCT2026"),
  foLine("NSEFO", "40031", "NIFTYNXT50", "NIFTYNXT5026OCT70000CE", "OPTIDX", "-1", "Nifty Next 50", "2026-10-27", "70000", "3", "25", "NIFTYNXT50 27OCT2026 CE 70000"),
  foLine("NSEFO", "50001", "RELIANCE", "RELIANCE26OCT1400CE", "OPTSTK", "1100100002885", "RELIANCE", "2026-10-27", "1400", "3", "500", "RELIANCE 27OCT2026 CE 1400"),
  foLine("NSEFO", "50002", "RELIANCE", "RELIANCE26OCT1400PE", "OPTSTK", "1100100002885", "RELIANCE", "2026-10-27", "1400", "4", "500", "RELIANCE 27OCT2026 PE 1400"),
  foLine("NSEFO", "50011", "RELIANCE", "RELIANCE26OCTFUT", "FUTSTK", "1100100002885", "RELIANCE", "2026-10-27", "-1", "1", "500", "RELIANCE 27OCT2026"),
].join("\n");

const BSEFO_MASTER = [
  foLine("BSEFO", "1140001", "SENSEX", "SENSEX26O2282000CE", "IO", "-1", "SENSEX", "2026-10-22", "82000", "3", "20", "SENSEX 22OCT2026 CE 82000"),
  foLine("BSEFO", "1140002", "SENSEX", "SENSEX26O2282000PE", "IO", "-1", "SENSEX", "2026-10-22", "82000", "4", "20", "SENSEX 22OCT2026 PE 82000"),
  foLine("BSEFO", "1140003", "SENSEX", "SENSEX26O2282100CE", "IO", "-1", "SENSEX", "2026-10-22", "82100", "3", "20", "SENSEX 22OCT2026 CE 82100"),
  foLine("BSEFO", "1140004", "SENSEX", "SENSEX26O2282100PE", "IO", "-1", "SENSEX", "2026-10-22", "82100", "4", "20", "SENSEX 22OCT2026 PE 82100"),
  foLine("BSEFO", "1150001", "BANKEX", "BANKEX26OCT63000CE", "OPTIDX", "-1", "BANKEX", "2026-10-29", "63000", "3", "30", "BANKEX 29OCT2026 CE 63000"),
  foLine("BSEFO", "1150002", "BANKEX", "BANKEX26OCT63000PE", "OPTIDX", "-1", "BANKEX", "2026-10-29", "63000", "4", "30", "BANKEX 29OCT2026 PE 63000"),
].join("\n");

const NSE_INDEX_LIST = ok("Index List successfully", {
  exchangeSegment: 1,
  indexList: ["NIFTY 50_26000", "NIFTY BANK_26001", "INDIA VIX_26002", "NIFTY IT_26003", "NIFTY 100_26004", "NIFTY FIN SERVICE_26037", "NIFTY MID SELECT_26074"],
}, "s-instrument-0007");
const BSE_INDEX_LIST = ok("Index List successfully", { exchangeSegment: 11, indexList: ["SENSEX_26065", "BANKEX_26118"] }, "s-instrument-0007");

/** Documented 1502 quote (official sample), re-pointed at another instrument. */
function q1502(seg, token, { ltp, bid, ask, vol, open, high, low, close }) {
  const lvl = (price, size, orders) => ({ Size: size, Price: price, TotalOrders: orders, BuyBackMarketMaker: 0 });
  return JSON.stringify({
    MessageCode: 1502, MessageVersion: 4, ApplicationType: 0, TokenID: 0, ExchangeSegment: seg, ExchangeInstrumentID: Number(token), ExchangeTimeStamp: 1476513284,
    Bids: [lvl(bid, 975, 3), lvl(+(bid - 0.05).toFixed(2), 450, 2), lvl(+(bid - 0.1).toFixed(2), 300, 1), lvl(+(bid - 0.15).toFixed(2), 75, 1), lvl(+(bid - 0.2).toFixed(2), 150, 2)],
    Asks: [lvl(ask, 525, 1), lvl(+(ask + 0.05).toFixed(2), 600, 4), lvl(+(ask + 0.1).toFixed(2), 75, 1), lvl(+(ask + 0.15).toFixed(2), 225, 2), lvl(+(ask + 0.2).toFixed(2), 900, 1)],
    Touchline: {
      BidInfo: lvl(bid, 975, 3), AskInfo: lvl(ask, 525, 1), LastTradedPrice: ltp, LastTradedQunatity: 75, TotalBuyQuantity: 150573, TotalSellQuantity: 356995,
      TotalTradedQuantity: vol, AverageTradedPrice: ltp, LastTradedTime: 1476513284, LastUpdateTime: 1476513284, PercentChange: 0.11,
      Open: open, High: high, Low: low, Close: close, TotalValueTraded: null, BuyBackTotalBuy: 0, BuyBackTotalSell: 0,
    },
    BookType: 1, XMarketType: 1, SequenceNumber: 555886964773282,
  });
}
const q1510 = (seg, token, oi) => JSON.stringify({ MessageCode: 1510, MessageVersion: 0, ApplicationType: 0, TokenID: 0, ExchangeSegment: seg, ExchangeInstrumentID: Number(token), ExchangeTimeStamp: 0, XTSMarketType: 0, OpenInterest: oi });
const quotesResult = (mdp, list) => ok("Get quotes successfully!", { mdp, quotesList: [], listQuotes: list }, "s-quotes-0001");

const SPOTS = {
  26000: { seg: 1, ltp: 25012.35, open: 24950.1, high: 25060.4, low: 24931.05, close: 24978.6 },
  26065: { seg: 11, ltp: 82044.7, open: 81900.2, high: 82190.55, low: 81850.3, close: 81960.1 },
  26118: { seg: 11, ltp: 63120.45, open: 63000, high: 63210, low: 62950.5, close: 63010.2 },
  2885: { seg: 1, ltp: 1412.6, open: 1405, high: 1418.9, low: 1401.2, close: 1404.3 },
};
const LEGS = {
  NSEFO: [[40001, 182.4, 1250475], [40002, 64.15, 2104425], [40003, 118.9, 3389250], [40004, 98.35, 3012600], [40005, 71.2, 2245800], [40006, 150.6, 1180725],
    [40011, 236.5, 845250], [40012, 214.1, 790125], [50001, 31.45, 912500], [50002, 18.2, 645000]],
  BSEFO: [[1140001, 412.3, 182340], [1140002, 365.8, 165220], [1140003, 360.15, 140180], [1140004, 414.9, 120460], [1150001, 702.4, 22650], [1150002, 584.25, 19830]],
};
const segIdOf = { NSEFO: 2, BSEFO: 12 };

function spotQuoteResponses(md) {
  return Object.entries(SPOTS).map(([token, s]) => ({
    method: "POST", url: `${md}/instruments/quotes`,
    expectBody: { xtsMessageCode: 1502, instruments: [{ exchangeSegment: s.seg, exchangeInstrumentID: Number(token) }] },
    json: quotesResult(1502, [q1502(s.seg, token, { ltp: s.ltp, bid: s.ltp - 0.35, ask: s.ltp + 0.4, vol: 0, open: s.open, high: s.high, low: s.low, close: s.close })]),
  }));
}
function legQuoteResponses(md) {
  const out = [];
  for (const [segName, legs] of Object.entries(LEGS)) {
    const seg = segIdOf[segName];
    out.push({
      method: "POST", url: `${md}/instruments/quotes`, expectBody: { xtsMessageCode: 1502, instruments: [{ exchangeSegment: seg }] },
      json: quotesResult(1502, legs.map(([t, ltp, vol]) => q1502(seg, t, { ltp, bid: +(ltp - 0.15).toFixed(2), ask: +(ltp + 0.1).toFixed(2), vol, open: ltp, high: ltp + 5, low: ltp - 5, close: ltp - 2 }))),
    });
    out.push({
      method: "POST", url: `${md}/instruments/quotes`, expectBody: { xtsMessageCode: 1510, instruments: [{ exchangeSegment: seg }] },
      json: quotesResult(1510, legs.map(([t], i) => q1510(seg, t, 1_000_000 + i * 37_500))),
    });
  }
  return out;
}

function marketCommon(b) {
  const md = `${b.host}${b.md}`;
  return [
    { method: "POST", url: `${md}/auth/login`, expectBody: b.mdLoginBody, json: MD_LOGIN },
    { method: "POST", url: `${md}/instruments/master`, expectBody: { exchangeSegmentList: ["NSEFO"] }, json: ok("Data found successfully", NSEFO_MASTER) },
    { method: "POST", url: `${md}/instruments/master`, expectBody: { exchangeSegmentList: ["BSEFO"] }, json: ok("Data found successfully", BSEFO_MASTER) },
    { method: "GET", url: `${md}/instruments/indexlist?exchangeSegment=1`, json: NSE_INDEX_LIST },
    { method: "GET", url: `${md}/instruments/indexlist?exchangeSegment=11`, json: BSE_INDEX_LIST },
    ...spotQuoteResponses(md),
    ...legQuoteResponses(md),
  ];
}

// ── interactive payloads ──

const IA_LOGIN = ok("Valid User", {
  enums: { socketEvent: ["joined", "error", "warning", "success", "order", "trade", "logout", "position"], orderSide: ["BUY", "SELL"] },
  clientCodes: ["DUMMY1"], exchangeSegmentArray: [{ key: "NSECM", value: "NSECM" }, { key: "NSEFO", value: "NSEFO" }],
  token: "dummy.ia.jwt.token", userID: "DUMMY1", isInvestorClient: true, isOneTouchUser: false,
}, "s-user-0001");

const ORDER_ROW = {
  LoginID: "DUMMY1", ClientID: "DUMMY1", AppOrderID: 648468730, OrderReferenceID: "", GeneratedBy: "TWSAPI", ExchangeOrderID: "1005239196374108",
  OrderCategoryType: "NORMAL", ExchangeSegment: "NSEFO", ExchangeInstrumentID: 40003, TradingSymbol: "NIFTY26O2025000CE", OrderSide: "BUY", OrderType: "Limit",
  ProductType: "NRML", TimeInForce: "DAY", OrderPrice: 118.5, OrderQuantity: 75, OrderStopPrice: 0, OrderStatus: "New", OrderAverageTradedPrice: 0,
  LeavesQuantity: 75, CumulativeQuantity: 0, OrderDisclosedQuantity: 0, OrderGeneratedDateTime: "16-10-2026 11:17:29", ExchangeTransactTime: "16-10-2026 11:17:30",
  LastUpdateDateTime: "16-10-2026 11:17:29", OrderExpiryDate: "01-01-1980 00:00:00", CancelRejectReason: "", OrderUniqueIdentifier: "123abc",
  OrderLegStatus: "SingleOrderLeg", BoLegDetails: 0, IsSpread: false, BoEntryOrderId: "", MessageCode: 9004, MessageVersion: 4, TokenID: 0, ApplicationType: 0, SequenceNumber: 0,
};
const ORDER_BOOK = ok("Success order book", [
  ORDER_ROW,
  { ...ORDER_ROW, AppOrderID: 648468731, ExchangeInstrumentID: 40004, TradingSymbol: "NIFTY26O2025000PE", OrderSide: "SELL", OrderType: "StopLimit", OrderPrice: 90, OrderStopPrice: 92 },
  { ...ORDER_ROW, AppOrderID: 648468732, OrderStatus: "Filled", OrderAverageTradedPrice: 118.45, LeavesQuantity: 0, CumulativeQuantity: 75 },
  { ...ORDER_ROW, AppOrderID: 648468733, OrderStatus: "Rejected", LeavesQuantity: 0, CancelRejectReason: "RMS:Margin Exceeds" },
], "s-orders-0001");
const TRADE_BOOK = ok("Success trade book", [{
  LoginID: "DUMMY1", ClientID: "DUMMY1", AppOrderID: 648468732, OrderReferenceID: "", GeneratedBy: "TWSAPI", ExchangeOrderID: "1005239196374109",
  OrderCategoryType: "NORMAL", ExchangeSegment: "NSEFO", ExchangeInstrumentID: "40003", TradingSymbol: "NIFTY26O2025000CE", OrderSide: "BUY", OrderType: "Limit",
  ProductType: "NRML", TimeInForce: "DAY", OrderPrice: 118.5, OrderQuantity: 75, OrderStopPrice: 0, OrderStatus: "Filled", OrderAverageTradedPrice: 118.45,
  LeavesQuantity: 0, CumulativeQuantity: 75, OrderDisclosedQuantity: 0, OrderGeneratedDateTime: "16-10-2026 11:17:29", ExchangeTransactTime: "16-10-2026 11:17:30",
  LastUpdateDateTime: "16-10-2026 11:17:29", OrderUniqueIdentifier: "123abc", OrderLegStatus: "SingleOrderLeg", LastTradedPrice: 118.45, LastTradedQuantity: 75,
  LastExecutionTransactTime: "16-10-2026 11:17:29", ExecutionID: "3308927", ExecutionReportIndex: 3, IsSpread: false, MessageCode: 9005, MessageVersion: 4,
  TokenID: 0, ApplicationType: 0, SequenceNumber: 0,
}], "s-trades-0001");
const POSITIONS = ok("Success position", { positionList: [
  {
    AccountID: "DUMMY1", TradingSymbol: "NIFTY26O2025000CE", ExchangeSegment: "NSEFO", ExchangeInstrumentID: "40003", ProductType: "NRML", Marketlot: "75", Multiplier: "1",
    BuyAveragePrice: "118.45", SellAveragePrice: "0", OpenBuyQuantity: "75", OpenSellQuantity: "0", Quantity: "75", BuyAmount: "8883.75", SellAmount: "0",
    NetAmount: "-8883.75", UnrealizedMTM: "33.75", RealizedMTM: "0", MTM: "33.75", BEP: "118.45", SumOfTradedQuantityAndPriceBuy: "8883.75",
    SumOfTradedQuantityAndPriceSell: "0", statisticsLevel: "ParentLevel", isInterOpPosition: "true",
  },
  {
    AccountID: "DUMMY1", TradingSymbol: "SENSEX26O2282000PE", ExchangeSegment: "BSEFO", ExchangeInstrumentID: "1140002", ProductType: "MIS", Marketlot: "20", Multiplier: "1",
    BuyAveragePrice: "0", SellAveragePrice: "370.1", OpenBuyQuantity: "0", OpenSellQuantity: "20", Quantity: "-20", BuyAmount: "0", SellAmount: "7402",
    NetAmount: "7402", UnrealizedMTM: "86", RealizedMTM: "0", MTM: "86", BEP: "370.1", SumOfTradedQuantityAndPriceBuy: "0",
    SumOfTradedQuantityAndPriceSell: "7402", statisticsLevel: "ParentLevel", isInterOpPosition: "true",
  },
] }, "s-portfolio-0001");
const HOLDING = (isin, nse, bse, qty, avg) => ({
  ISIN: isin, RMSHoldingId: 21885, ClientId: "DUMMY1", ExchangeNSEInstrumentId: nse, ExchangeBSEInstrumentId: bse, ExchangeMSEIInstrumentId: 0, HoldingType: 2,
  HoldingQuantity: qty, CollateralValuationType: 1, Haircut: 15, CollateralQuantity: 0, CreatedBy: "ADMIN2", LastUpdatedBy: "ADMIN2",
  CreatedOn: "2026-07-06T12:18:21", LastUpdatedOn: "2026-07-06T11:39:29", UsedQuantity: 0, IsCollateralHolding: false, BuyAvgPrice: avg,
  IsBuyAvgPriceProvided: true, AuthorizeQuantity: 0, IsNeedToDelete: false,
});
const HOLDINGS = ok("Success holding", {
  ClientId: "DUMMY1",
  RMSHoldingList: { Holdings: { INE002A01018: HOLDING("INE002A01018", 2885, 500325, 10, 1290.5), INE012A01025: HOLDING("INE012A01025", 22, 500410, 4, 1920) } },
  CollateralHoldingList: {},
}, "s-holding-0001");
const BALANCE = ok("OK", { BalanceList: [{
  limitHeader: "ALL|ALL|ALL",
  limitObject: {
    RMSSubLimits: { cashAvailable: 250000, collateral: 12500, marginUtilized: 52955.278, netMarginAvailable: 209544.72, MTM: 0, UnrealizedMTM: 119.75, RealizedMTM: 0 },
    marginAvailable: { CashMarginAvailable: 250000, AdhocMargin: 0, NotinalCash: 0, PayInAmount: 0, PayOutAmount: 0, CNCSellBenifit: 0, DirectCollateral: 0, HoldingCollateral: 12500 },
    marginUtilized: { GrossExposureMarginPresent: 0, VarELMarginPresent: 0, CNCAmountUsed: 1671, MarginUsed: 52955.2789, TotalSpanMargin: 0, ExposureMarginPresent: 0 },
    AccountID: "DUMMY1",
  },
}] }, "s-user-0001");
const PLACED = ok("Request sent", { AppOrderID: 648468734, OrderUniqueIdentifier: "mrchub", ClientID: "DUMMY1" }, "s-orders-0001");
const MODIFIED = ok("Request sent", { AppOrderID: 648468730, OrderUniqueIdentifier: "mrchub", ClientID: "DUMMY1" }, "s-orders-0001");
const CANCELLED = ok("Request sent", { AppOrderID: 648468730, ClientID: "DUMMY1" }, "s-orders-0001");

function iaLogin(b) {
  return { method: "POST", url: `${b.host}/interactive/user/session`, expectBody: b.sessionBody, json: IA_LOGIN };
}

// ── historical ──
// dataReponse epochs encode IST wall-clock time as if it were UTC (official sample: 1633598158 = 09:15:58 on 7 Oct 2021).
const IST_WALL = (iso) => Math.floor(Date.parse(`${iso}Z`) / 1000);
const OHLC = ok("Data found", {
  exchangeSegment: "NSEFO", exchangeInstrumentID: "40003",
  dataReponse: [
    `${IST_WALL("2026-10-16T09:15:00")}|121.5|124|118.25|119.9|112500|3221625|`,
    `${IST_WALL("2026-10-16T09:16:00")}|119.9|122.35|119.1|121.05|88275|3241875|`,
    `${IST_WALL("2026-10-16T09:17:00")}|121.05|121.4|117.6|118.2|97650|3259500|`,
  ].join(","),
}, "s-instrument-0002");

// ── assemble ──

function write(id, name, obj) {
  const dir = join(ROOT, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(obj, null, 2)}\n`);
}

for (const [id, b] of Object.entries(BROKERS)) {
  const md = `${b.host}${b.md}`;
  const ia = `${b.host}/interactive`;
  const market = marketCommon(b);
  write(id, "manifest", {
    brokerId: id,
    creds: b.creds,
    symbol: "NIFTY",
    expiry: "2026-10-20",
    sources: [...SOURCES, ...b.extraSources],
    notes: "Generated by __fixtures__/compositedge/generate-xts-fixtures.mjs from the official XTS doc samples (field names and envelopes unchanged; instruments moved onto NIFTY/SENSEX/BANKEX/RELIANCE contracts; dummy ids). Every capability file also answers the logins and masters, because sessions and masters are cached by the first call that needs them.",
  });
  write(id, "testConnection", {
    responses: [market[0], { method: "GET", url: `${md}/config/clientConfig`, json: CLIENT_CONFIG }, iaLogin(b)],
    expect: { status: "success" },
  });
  write(id, "instruments", { responses: market, expect: { minRows: 20, underlyings: ["NIFTY", "SENSEX", "BANKEX", "RELIANCE"] } });
  write(id, "expiries", { responses: market, expect: { minRows: 2 } });
  write(id, "optionChain", { responses: market, expect: { minStrikes: 3 } });
  write(id, "optionChainSensex", { args: ["SENSEX", "2026-10-22"], responses: market, expect: { minStrikes: 2 } });
  write(id, "optionChainStock", { args: ["RELIANCE", "2026-10-27"], responses: market, expect: { minStrikes: 1 } });
  write(id, "ltp", { responses: market });
  write(id, "quotes", { args: [[{ token: "40003", exchange: "NFO" }, { token: "40004", exchange: "NFO" }]], responses: market, expect: { minRows: 2 } });
  write(id, "depth", { args: [{ token: "40003", exchange: "NFO" }], responses: market });
  write(id, "historical", {
    args: [{ instrument: { token: "40003", exchange: "NFO" }, interval: "1m", from: "2026-10-16", to: "2026-10-16" }],
    responses: [market[0], {
      method: "GET",
      urlPattern: `^${md.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/instruments/ohlc\\?exchangeSegment=NSEFO&exchangeInstrumentID=40003&startTime=Oct%2016%202026%20000000&endTime=Oct%2016%202026%20235959&compressionValue=60$`,
      json: OHLC,
    }],
    expect: { minRows: 3 },
  });
  write(id, "positions", { responses: [iaLogin(b), { method: "GET", url: `${ia}/portfolio/positions?dayOrNet=NetWise`, json: POSITIONS }], expect: { minRows: 2 } });
  write(id, "holdings", { responses: [iaLogin(b), { method: "GET", url: `${ia}/portfolio/holdings`, json: HOLDINGS }], expect: { minRows: 2 } });
  write(id, "funds", { responses: [iaLogin(b), { method: "GET", url: `${ia}/user/balance`, json: BALANCE }] });
  write(id, "orderBook", { responses: [iaLogin(b), { method: "GET", url: `${ia}/orders`, json: ORDER_BOOK }], expect: { minRows: 4 } });
  write(id, "tradeBook", { responses: [iaLogin(b), { method: "GET", url: `${ia}/orders/trades`, json: TRADE_BOOK }], expect: { minRows: 1 } });
  write(id, "placeOrder", {
    args: [{ exchange: "NFO", token: "40003", transactionType: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 2, price: 118.5 }, 75],
    responses: [iaLogin(b), {
      method: "POST", url: `${ia}/orders`,
      expectBody: { exchangeSegment: "NSEFO", exchangeInstrumentID: 40003, productType: "NRML", orderType: "Limit", orderSide: "BUY", timeInForce: "DAY", disclosedQuantity: 0, orderQuantity: 150, limitPrice: 118.5, stopPrice: 0, orderUniqueIdentifier: "mrchub" },
      json: PLACED,
    }],
  });
  write(id, "modifyOrder", {
    args: ["648468730", { orderType: "LIMIT", product: "MARGIN", quantity: 75, price: 117.9 }],
    responses: [iaLogin(b), {
      method: "PUT", url: `${ia}/orders`,
      expectBody: { appOrderID: 648468730, modifiedProductType: "NRML", modifiedOrderType: "Limit", modifiedOrderQuantity: 75, modifiedDisclosedQuantity: 0, modifiedLimitPrice: 117.9, modifiedStopPrice: 0, modifiedTimeInForce: "DAY" },
      json: MODIFIED,
    }],
  });
  write(id, "cancelOrder", {
    args: ["648468730"],
    responses: [iaLogin(b), { method: "DELETE", url: `${ia}/orders?appOrderID=648468730&orderUniqueIdentifier=mrchub`, json: CANCELLED }],
  });
}

console.log("XTS fixtures written for", Object.keys(BROKERS).join(", "));
