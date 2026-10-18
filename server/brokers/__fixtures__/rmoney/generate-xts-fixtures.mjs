/**
 * Writes the contract fixtures for the rmoney / wisdom / iifl XTS adapters (engine: rmoneyXtsFamily.mjs).
 * Run: node server/brokers/__fixtures__/rmoney/generate-xts-fixtures.mjs
 *
 * Payload shapes are the documented samples in IIFL's official XTS v2 pages
 * (https://ttblaze.iifl.com/doc/apimarketdata/ and https://ttblaze.iifl.com/doc/interactive/, identical to
 * Symphony's https://symphonyfintech.com/xts-market-data-front-end-api-v2/ and
 * https://symphonyfintech.com/xts-trading-front-end-api-v2/): the same {type, code, description, result}
 * envelope, field names, pipe-delimited master rows, listQuotes forms (JSON-string array and single
 * object), dataReponse layout, host-lookup and session bodies. The docs' sample instruments were moved onto
 * NIFTY (20 Oct 2026 weekly, 27 Oct 2026 monthly), BANKNIFTY (27 Oct monthly), SENSEX (22 Oct weekly),
 * BANKEX (29 Oct monthly) and RELIANCE (27 Oct monthly) contracts. Every key, token, id and name is a dummy.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOCS = [
  "https://ttblaze.iifl.com/doc/apimarketdata/ (official XTS v2 Binary Market Data API, IIFL deployment): Login, ClientConfig, Master, Quote, GetIndexList, Intraday Candle OHLC",
  "https://ttblaze.iifl.com/doc/interactive/ (official XTS v2 Interactive API, IIFL deployment): OAuth Login Flow, HostLookup, Login, Balance, Place/Modify/Cancel Order, OrderBook, TradeBook, Holding, Position, Rate Limit, Enums",
  "https://symphonyfintech.com/xts-market-data-front-end-api-v2/ and https://symphonyfintech.com/xts-trading-front-end-api-v2/ (the same documents, Symphony Fintech)",
];

const BROKERS = {
  rmoney: {
    md: "https://xts.rmoneyindia.co.in:3000/apibinarymarketdata",
    ia: "https://xts.rmoneyindia.co.in:3000/interactive",
    creds: { apiKey: "dummyRmMdKey01", apiSecret: "dummyRmMdSecret01", interactiveSessionToken: "dummy.rmoney.session.token" },
    iaAuth: [],
    extraSources: ["OpenAlgo broker/rmoney (facts only): host https://xts.rmoneyindia.co.in:3000, /apibinarymarketdata, /interactive, third-party login session already carrying the token. No RMoney doc page was reachable."],
  },
  wisdom: {
    md: "https://trade.wisdomcapital.in/apimarketdata",
    ia: "https://trade.wisdomcapital.in/interactive",
    creds: { apiKey: "dummyWcMdKey01", apiSecret: "dummyWcMdSecret01", interactiveApiKey: "dummyWcIaKey01", interactiveApiSecret: "dummyWcIaSecret01" },
    iaAuth: [{ method: "POST", url: "https://trade.wisdomcapital.in/interactive/user/session", expectBody: { appKey: "dummyWcIaKey01", secretKey: "dummyWcIaSecret01", source: "WebAPI" } }],
    extraSources: ["OpenAlgo broker/wisdom (facts only): host https://trade.wisdomcapital.in, /apimarketdata, /interactive, key-pair /user/session. No Wisdom doc page was reachable."],
  },
  iifl: {
    md: "https://ttblaze.iifl.com/apibinarymarketdata",
    ia: "https://ttblaze.iifl.com/1interactive",
    creds: { apiKey: "dummyIiMdKey01", apiSecret: "dummyIiMdSecret01", interactiveApiKey: "dummyIiIaKey01", interactiveApiSecret: "dummyIiIaSecret01", requestToken: "dummyAccessToken01" },
    iaAuth: [
      { method: "POST", url: "https://ttblaze.iifl.com/hostlookup", expectBody: { AccessPassword: "2021HostLookUpAccess", version: "interactive_1.0.1" }, hostLookup: true },
      { method: "POST", url: "https://ttblaze.iifl.com/1interactive/user/session", expectBody: { appKey: "dummyIiIaKey01", secretKey: "dummyIiIaSecret01", accessToken: "dummyAccessToken01", uniqueKey: "dummyUniqueKey01" } },
    ],
    extraSources: [],
  },
};

const ok = (description, result, code = "s-response-0001") => ({ type: "success", code, description, result });

// ── market data ──

const MD_LOGIN = ok("Provided Valid Credentials", { token: "dummy.md.token", userID: "DUMMY1", appVersion: "5.0.15", application_expiry_date: "29-09-2027" });
const CLIENT_CONFIG = ok("Fetched configurations successfully", {
  exchangeSegments: { NSECM: 1, NSEFO: 2, NSECD: 3, BSECM: 11, BSEFO: 12 },
  xtsMessageCode: { touchlineEvent: 1501, marketDepthEvent: 1502, candleDataEvent: 1505, OIDataEvent: 1510 },
  publishFormat: ["Binary", "JSON"],
  broadCastMode: ["Full", "Partial"],
});

const opt = (seg, tok, name, sym, series, lot, und, undName, exp, strike, code, disp) =>
  `${seg}|${tok}|2|${name}|${sym}|${series}|${name}-${series}|${seg === "NSEFO" ? 26 : 12}0${tok}|999.95|0.05|1801|0.05|${lot}|1|${und}|${undName}|${exp}T14:30:00|${strike}|${code}|${disp}|1|1|${sym}`;
const fut = (seg, tok, name, sym, series, lot, und, undName, exp, disp) =>
  `${seg}|${tok}|1|${name}|${sym}|${series}|${name}-${series}|${seg === "NSEFO" ? 26 : 12}0${tok}|28369.8|23211.8|1801|0.1|${lot}|1|${und}|${undName}|${exp}T14:30:00|${disp}|1|1|${sym}`;

const NSEFO_ROWS = [
  ...[24900, 25000, 25100].flatMap((k, i) => [
    opt("NSEFO", 40001 + i * 2, "NIFTY", `NIFTY26O20${k}CE`, "OPTIDX", 75, -1, "Nifty 50", "2026-10-20", k, 3, `NIFTY 20OCT2026 CE ${k}`),
    opt("NSEFO", 40002 + i * 2, "NIFTY", `NIFTY26O20${k}PE`, "OPTIDX", 75, -1, "Nifty 50", "2026-10-20", k, 4, `NIFTY 20OCT2026 PE ${k}`),
  ]),
  opt("NSEFO", 40101, "NIFTY", "NIFTY26OCT25000CE", "OPTIDX", 75, -1, "Nifty 50", "2026-10-27", 25000, 3, "NIFTY 27OCT2026 CE 25000"),
  opt("NSEFO", 40102, "NIFTY", "NIFTY26OCT25000PE", "OPTIDX", 75, -1, "Nifty 50", "2026-10-27", 25000, 4, "NIFTY 27OCT2026 PE 25000"),
  fut("NSEFO", 40201, "NIFTY", "NIFTY26OCTFUT", "FUTIDX", 75, -1, "Nifty 50", "2026-10-27", "NIFTY 27OCT2026"),
  opt("NSEFO", 40301, "BANKNIFTY", "BANKNIFTY26OCT56000CE", "OPTIDX", 35, -1, "Nifty Bank", "2026-10-27", 56000, 3, "BANKNIFTY 27OCT2026 CE 56000"),
  opt("NSEFO", 40302, "BANKNIFTY", "BANKNIFTY26OCT56000PE", "OPTIDX", 35, -1, "Nifty Bank", "2026-10-27", 56000, 4, "BANKNIFTY 27OCT2026 PE 56000"),
  opt("NSEFO", 40401, "RELIANCE", "RELIANCE26OCT2800CE", "OPTSTK", 500, 1100100002885, "", "2026-10-27", 2800, 3, "RELIANCE 27OCT2026 CE 2800"),
  opt("NSEFO", 40402, "RELIANCE", "RELIANCE26OCT2800PE", "OPTSTK", 500, 1100100002885, "", "2026-10-27", 2800, 4, "RELIANCE 27OCT2026 PE 2800"),
  opt("NSEFO", 40403, "RELIANCE", "RELIANCE26OCT2900CE", "OPTSTK", 500, 1100100002885, "", "2026-10-27", 2900, 3, "RELIANCE 27OCT2026 CE 2900"),
  opt("NSEFO", 40404, "RELIANCE", "RELIANCE26OCT2900PE", "OPTSTK", 500, 1100100002885, "", "2026-10-27", 2900, 4, "RELIANCE 27OCT2026 PE 2900"),
  fut("NSEFO", 40501, "RELIANCE", "RELIANCE26OCTFUT", "FUTSTK", 500, 1100100002885, "", "2026-10-27", "RELIANCE 27OCT2026"),
];
const BSEFO_ROWS = [
  ...[81900, 82000, 82100].flatMap((k, i) => [
    opt("BSEFO", 850001 + i * 2, "SENSEX", `SENSEX26O22${k}CE`, "IO", 20, -1, "SENSEX", "2026-10-22", k, 3, `SENSEX 22OCT2026 CE ${k}`),
    opt("BSEFO", 850002 + i * 2, "SENSEX", `SENSEX26O22${k}PE`, "IO", 20, -1, "SENSEX", "2026-10-22", k, 4, `SENSEX 22OCT2026 PE ${k}`),
  ]),
  opt("BSEFO", 851001, "BANKEX", "BANKEX26OCT62000CE", "IO", 30, -1, "BANKEX", "2026-10-29", 62000, 3, "BANKEX 29OCT2026 CE 62000"),
  opt("BSEFO", 851002, "BANKEX", "BANKEX26OCT62000PE", "IO", 30, -1, "BANKEX", "2026-10-29", 62000, 4, "BANKEX 29OCT2026 PE 62000"),
];

const MASTER = { NSEFO: ok("Data found successfully", NSEFO_ROWS.join("\n")), BSEFO: ok("Data found successfully", BSEFO_ROWS.join("\n")) };
const INDEXLIST = {
  1: ok("Record Found", { exchangeSegment: 1, indexList: ["NIFTY 50_26000", "NIFTY BANK_26001", "INDIA VIX_26002", "NIFTY IT_26003", "NIFTY FIN SERVICE_26037", "NIFTY MID SELECT_26121"] }),
  11: ok("Record Found", { exchangeSegment: 11, indexList: ["SENSEX_26065", "BANKEX_26118", "SNSX50_26013"] }),
};

/** One 1502 quote in the documented layout (Bids/Asks arrays, nested Touchline). */
function depthQuote(seg, id, ltp, { vol = 14085685, bid = ltp - 0.5, ask = ltp + 0.5 } = {}) {
  const lvl = (price, size, orders) => ({ Size: size, Price: price, TotalOrders: orders, BuyBackMarketMaker: 0 });
  return {
    MessageCode: 1502, MessageVersion: 1, ApplicationType: 0, TokenID: 0,
    ExchangeSegment: seg, ExchangeInstrumentID: id, ExchangeTimeStamp: 1445252049,
    Bids: [lvl(bid, 75, 1), lvl(bid - 0.5, 150, 2), lvl(bid - 1, 225, 3), lvl(bid - 1.5, 300, 4), lvl(bid - 2, 375, 5)],
    Asks: [lvl(ask, 75, 1), lvl(ask + 0.5, 150, 2), lvl(ask + 1, 225, 3), lvl(ask + 1.5, 300, 4), lvl(ask + 2, 375, 5)],
    Touchline: {
      BidInfo: lvl(bid, 75, 1), AskInfo: lvl(ask, 75, 1),
      LastTradedPrice: ltp, LastTradedQunatity: 75, TotalBuyQuantity: 18446, TotalSellQuantity: 25283, TotalTradedQuantity: vol,
      AverageTradedPrice: ltp, LastTradedTime: 1445252049, LastUpdateTime: 1445252049, PercentChange: 0.5,
      Open: ltp - 2, High: ltp + 5, Low: ltp - 6, Close: ltp - 1, TotalValueTraded: 1865862348, BuyBackTotalBuy: 0, BuyBackTotalSell: 0,
    },
    BookType: 1, XMarketType: 1,
  };
}
const oiQuote = (seg, id, oi) => ({ MessageCode: 1510, MessageVersion: 1, ApplicationType: 0, TokenID: 0, ExchangeSegment: seg, ExchangeInstrumentID: id, XTSMarketType: 1, OpenInterest: oi });
const listOf = (mdp, quotes, asStrings = true) => ok("Get quotes successfully!", {
  mdp,
  quotesList: quotes.map((q) => ({ exchangeSegment: q.ExchangeSegment, exchangeInstrumentID: q.ExchangeInstrumentID })),
  listQuotes: asStrings ? quotes.map((q) => JSON.stringify(q)) : quotes,
});
/** The single-object listQuotes form shown in the official Quote sample. */
const single = (mdp, q) => ok("Get quotes successfully!", { mdp, quoteList: { exchangeSegment: q.ExchangeSegment, exchangeInstrumentID: q.ExchangeInstrumentID }, listQuotes: q });

const quotesReq = (md, code, seg, firstId, json) => ({
  method: "POST", url: `${md}/instruments/quotes`,
  expectBody: { xtsMessageCode: code, publishFormat: "JSON", instruments: [{ exchangeSegment: seg, exchangeInstrumentID: firstId }] }, json,
});

const NIFTY_WEEKLY = [[40001, 260.5, 1_250_000], [40002, 160.25, 980_000], [40003, 200.1, 2_100_000], [40004, 205.4, 1_900_000], [40005, 150.75, 1_600_000], [40006, 255.9, 870_000]];
const SENSEX_WEEKLY = [[850001, 520.3, 41_000], [850002, 410.6, 38_000], [850003, 455.15, 52_000], [850004, 462.8, 49_000], [850005, 398.2, 30_000], [850006, 515.45, 28_000]];
const RELIANCE_LEGS = [[40401, 92.4, 3_400_000], [40402, 48.15, 2_100_000], [40403, 45.6, 4_800_000], [40404, 101.9, 1_300_000]];

function chainResponses(md, foSeg, cashSeg, spotId, spot, legs) {
  return [
    quotesReq(md, 1502, cashSeg, spotId, single(1502, depthQuote(cashSeg, spotId, spot))),
    quotesReq(md, 1502, foSeg, legs[0][0], listOf(1502, legs.map(([id, ltp]) => depthQuote(foSeg, id, ltp)))),
    quotesReq(md, 1510, foSeg, legs[0][0], listOf(1510, legs.map(([id, , oi]) => oiQuote(foSeg, id, oi)))),
  ];
}

// ── interactive (official samples, dummy ids) ──

const IA_SESSION = ok("Valid User.", {
  enums: { orderSide: ["BUY", "SELL"], dayOrNet: ["DAY", "NET"], exchangeSegment: ["NSECM", "NSEFO", "NSECD", "BSECM", "BSEFO", "MCXFO"] },
  clientCodes: ["DUMMY1"], token: "dummy.ia.token", userID: "DUMMY1", isInvestorClient: true, isOneTouchUser: false,
}, "s-user-0001");
const HOSTLOOKUP = ok("Hostlookup successful", { UniqueKey: "dummyUniqueKey01", connectionString: "https://ttblaze.iifl.com/1interactive", timeStamp: "0", remarks: "" }, "hostlookup");
const PROFILE = ok("Success profile", { ClientId: "DUMMY1", ClientName: "DUMMY CLIENT" }, "s-user-0003");
const BALANCE = ok("OK", {
  BalanceList: {
    limitHeader: "ALL|ALL|ALL",
    limitObject: {
      RMSSubLimits: { cashAvailable: 250000, collateral: 50000, marginUtilized: 52955.28, netMarginAvailable: 247044.72, MTM: 0, UnrealizedMTM: 0, RealizedMTM: 0 },
      marginAvailable: { CashMarginAvailable: 250000, AdhocMargin: 0, NotinalCash: 0, PayInAmount: 0, PayOutAmount: 0 },
      marginUtilized: { MarginUsed: 52955.28, TotalSpanMargin: 0, ExposureMarginPresent: 0 },
      AccountID: "DUMMY1",
    },
  },
}, "s-user-0002");
const ORDERS = ok("Success order book", [
  { LoginID: "DUMMY1", ClientID: "DUMMY1", AppOrderID: 648468730, OrderReferenceID: "", GeneratedBy: "TWSAPI", ExchangeOrderID: "1005239196374108", OrderCategoryType: "NORMAL", ExchangeSegment: "NSEFO", ExchangeInstrumentID: 40003, OrderSide: "BUY", OrderType: "Limit", ProductType: "NRML", TimeInForce: "DAY", OrderPrice: 199.5, OrderQuantity: 75, OrderStopPrice: 0, OrderStatus: "New", OrderAverageTradedPrice: 0, LeavesQuantity: 75, CumulativeQuantity: 0, OrderDisclosedQuantity: 0, OrderGeneratedDateTime: "19-10-2026 11:17:29", ExchangeTransactTime: "19-10-2026 11:17:30", LastUpdateDateTime: "19-10-2026 11:17:29", OrderExpiryDate: "01-01-1980 00:00:00", CancelRejectReason: "", OrderUniqueIdentifier: "mrchub", OrderLegStatus: "SingleOrderLeg", BoLegDetails: 0, IsSpread: false, BoEntryOrderId: "", MessageCode: 9004, MessageVersion: 4, TokenID: 0, ApplicationType: 0, SequenceNumber: 0 },
  { LoginID: "DUMMY1", ClientID: "DUMMY1", AppOrderID: 648468731, OrderReferenceID: "", GeneratedBy: "TWSAPI", ExchangeOrderID: "1005239196374109", OrderCategoryType: "NORMAL", ExchangeSegment: "NSEFO", ExchangeInstrumentID: 40004, OrderSide: "SELL", OrderType: "StopLimit", ProductType: "MIS", TimeInForce: "DAY", OrderPrice: 180, OrderQuantity: 150, OrderStopPrice: 181, OrderStatus: "New", OrderAverageTradedPrice: 0, LeavesQuantity: 150, CumulativeQuantity: 0, OrderDisclosedQuantity: 0, OrderGeneratedDateTime: "19-10-2026 11:20:02", ExchangeTransactTime: "19-10-2026 11:20:02", LastUpdateDateTime: "19-10-2026 11:20:02", OrderExpiryDate: "01-01-1980 00:00:00", CancelRejectReason: "", OrderUniqueIdentifier: "mrchub", OrderLegStatus: "SingleOrderLeg", BoLegDetails: 0, IsSpread: false, BoEntryOrderId: "", MessageCode: 9004, MessageVersion: 4, TokenID: 0, ApplicationType: 0, SequenceNumber: 0 },
  { LoginID: "DUMMY1", ClientID: "DUMMY1", AppOrderID: 648468732, OrderReferenceID: "", GeneratedBy: "TWSAPI", ExchangeOrderID: "1005239196374110", OrderCategoryType: "NORMAL", ExchangeSegment: "NSEFO", ExchangeInstrumentID: 40001, OrderSide: "BUY", OrderType: "Market", ProductType: "NRML", TimeInForce: "DAY", OrderPrice: 0, OrderQuantity: 75, OrderStopPrice: 0, OrderStatus: "Rejected", OrderAverageTradedPrice: 0, LeavesQuantity: 0, CumulativeQuantity: 0, OrderDisclosedQuantity: 0, OrderGeneratedDateTime: "19-10-2026 11:25:41", ExchangeTransactTime: "19-10-2026 11:25:41", LastUpdateDateTime: "19-10-2026 11:25:41", OrderExpiryDate: "01-01-1980 00:00:00", CancelRejectReason: "RMS: Margin Exceeds", OrderUniqueIdentifier: "mrchub", OrderLegStatus: "SingleOrderLeg", BoLegDetails: 0, IsSpread: false, BoEntryOrderId: "", MessageCode: 9004, MessageVersion: 4, TokenID: 0, ApplicationType: 0, SequenceNumber: 0 },
], "s-user-0001");
const TRADES = ok("Success trade book", [
  { LoginID: "DUMMY1", ClientID: "DUMMY1", AppOrderID: 1211010442, OrderReferenceID: "", GeneratedBy: "ClientAPI", ExchangeOrderID: "X_201256262", OrderCategoryType: "NORMAL", ExchangeSegment: "NSEFO", ExchangeInstrumentID: 40201, OrderSide: "BUY", OrderType: "Limit", ProductType: "NRML", TimeInForce: "DAY", OrderPrice: 0, OrderQuantity: 75, OrderStopPrice: 0, OrderStatus: "Filled", OrderAverageTradedPrice: "25040", LeavesQuantity: 0, CumulativeQuantity: 75, OrderDisclosedQuantity: 0, OrderGeneratedDateTime: "19-10-2026 10:05:21", ExchangeTransactTime: "19-10-2026 10:05:21", LastUpdateDateTime: "19-10-2026 10:05:21", OrderUniqueIdentifier: "mrchub", OrderLegStatus: "SingleOrderLeg", LastTradedPrice: 25040, LastTradedQuantity: 75, LastExecutionTransactTime: "19-10-2026 10:05:21", ExecutionID: "203913480", TradingSymbol: "NIFTY 27OCT2026", ExecutionReportIndex: 3, ApiOrderSource: "", IsSpread: false, MessageCode: 9005, MessageVersion: 4, TokenID: 0, ApplicationType: 0, SequenceNumber: 0 },
], "s-orders-0001");
const POSITIONS = ok("Success position", [
  { AccountID: "DUMMY1", TradingSymbol: "NIFTY 27OCT2026", ExchangeSegment: "NSEFO", ExchangeInstrumentID: 40201, ProductType: "NRML", Marketlot: 75, Multiplier: 1, BuyAveragePrice: 25040, SellAveragePrice: 0, OpenBuyQuantity: 75, OpenSellQuantity: 0, Quantity: 75, BuyAmount: 1878000, SellAmount: 0, NetAmount: -1878000, UnrealizedMTM: 4500, RealizedMTM: 0, MTM: 4500, BEP: 25040, SumOfTradedQuantityAndPriceBuy: 1878000, SumOfTradedQuantityAndPriceSell: 0, statisticsLevel: "ParentLevel", isInterOpPosition: "true", MessageCode: 9002, MessageVersion: 1, TokenID: 0, ApplicationType: 0, SequenceNumber: 0 },
  { AccountID: "DUMMY1", TradingSymbol: "RELIANCE", ExchangeSegment: "NSECM", ExchangeInstrumentID: 2885, ProductType: "MIS", Marketlot: 1, Multiplier: 1, BuyAveragePrice: 0, SellAveragePrice: 2851.4, OpenBuyQuantity: 0, OpenSellQuantity: 10, Quantity: -10, BuyAmount: 0, SellAmount: 28514, NetAmount: 28514, UnrealizedMTM: -120, RealizedMTM: 0, MTM: -120, BEP: 2851.4, SumOfTradedQuantityAndPriceBuy: 0, SumOfTradedQuantityAndPriceSell: 28514, statisticsLevel: "ParentLevel", isInterOpPosition: "true", MessageCode: 9002, MessageVersion: 1, TokenID: 0, ApplicationType: 0, SequenceNumber: 0 },
], "s-portfolio-0001");
const HOLDING = (isin, nse, bse, qty, avg) => ({ ISIN: isin, RMSHoldingId: 21885, ClientId: "DUMMY1", ExchangeNSEInstrumentId: nse, ExchangeBSEInstrumentId: bse, ExchangeMSEIInstrumentId: 0, HoldingType: 3, HoldingQuantity: qty, CollateralValuationType: 1, Haircut: 15, CollateralQuantity: 0, CreatedBy: "ADMIN", LastUpdatedBy: "ADMIN", CreatedOn: "2026-07-06T12:18:21", LastUpdatedOn: "2026-07-06T11:39:29", UsedQuantity: 0, IsCollateralHolding: false, BuyAvgPrice: avg, IsBuyAvgPriceProvided: true, AuthorizeQuantity: 0, IsNeedToDelete: false });
const HOLDINGS = ok("Success holding", {
  ClientId: "DUMMY1",
  RMSHoldingList: [{ Holdings: { INE002A01018: HOLDING("INE002A01018", 2885, 500325, 10, 2650.5), INE009A01021: HOLDING("INE009A01021", 0, 500209, 5, 1520) } }],
  CollateralHoldingList: [],
}, "s-portfolio-0012");
const PLACE = ok("Request sent", { AppOrderID: 2190766863, OrderUniqueIdentifier: "mrchub", ClientID: "DUMMY1" }, "s-orders-0001");
const MODIFY = ok("Request sent", { AppOrderID: 2190766863, OrderUniqueIdentifier: "mrchub", ClientID: "DUMMY1" }, "s-orders-0001");
const CANCEL = ok("Request sent", [{ AppOrderID: 2190766863, ClientID: "DUMMY1" }], "s-user-0001");

const OHLC = ok("Data found", {
  exchangeSegment: "NSEFO", exchangeInstrumentID: "40201",
  // Intraday 1-minute candles; epochs are IST wall-clock written as UTC (19 Oct 2026 09:15 / 09:16 / 09:17 IST).
  dataReponse: "1792401300|25010|25025.5|25001|25020|112500|9900000|,1792401360|25020|25030|25012.5|25028|98250|9912000|,1792401420|25028|25040|25022|25035.5|101400|9925500|,",
}, "s-ohlc-0001");

// ── writer ──

function build(id) {
  const b = BROKERS[id];
  const md = b.md;
  const base = [
    { method: "POST", url: `${md}/auth/login`, expectBody: { appKey: b.creds.apiKey, secretKey: b.creds.apiSecret }, json: MD_LOGIN },
    { method: "POST", url: `${md}/instruments/master`, expectBody: { exchangeSegmentList: ["NSEFO"] }, json: MASTER.NSEFO },
    { method: "POST", url: `${md}/instruments/master`, expectBody: { exchangeSegmentList: ["BSEFO"] }, json: MASTER.BSEFO },
    { method: "GET", url: `${md}/instruments/indexlist?exchangeSegment=1`, json: INDEXLIST[1] },
    { method: "GET", url: `${md}/instruments/indexlist?exchangeSegment=11`, json: INDEXLIST[11] },
  ];
  const iaAuth = b.iaAuth.map(({ hostLookup, ...r }) => ({ ...r, json: hostLookup ? HOSTLOOKUP : IA_SESSION }));
  const ia = (method, path, json, extra = {}) => ({ method, url: `${b.ia}${path}`, json, ...extra });

  const files = {
    manifest: {
      brokerId: id, creds: b.creds, symbol: "NIFTY", expiry: "2026-10-20",
      sources: [...DOCS, ...b.extraSources],
      notes: "Generated by __fixtures__/rmoney/generate-xts-fixtures.mjs from the official XTS v2 doc samples (field names and envelopes unchanged; instruments moved onto NIFTY/BANKNIFTY/SENSEX/BANKEX/RELIANCE contracts; dummy ids). Every file answers the logins and masters, because sessions and masters are cached by whichever call needs them first.",
    },
    testConnection: {
      responses: [...base, { method: "GET", url: `${md}/config/clientConfig`, json: CLIENT_CONFIG }, ...iaAuth, ia("GET", "/user/profile", PROFILE)],
      expect: { status: "success" },
    },
    instruments: { responses: base, expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
    expiries: { responses: base, expect: { minRows: 2 } },
    optionChain: { responses: [...base, ...chainResponses(md, 2, 1, 26000, 25012.35, NIFTY_WEEKLY)], expect: { minStrikes: 3 } },
    optionChainMonthly: { args: ["NIFTY", "2026-10-27"], responses: [...base, ...chainResponses(md, 2, 1, 26000, 25012.35, [[40101, 310.2, 3_300_000], [40102, 296.75, 3_050_000]])] },
    optionChainSensex: { args: ["SENSEX", "2026-10-22"], responses: [...base, ...chainResponses(md, 12, 11, 26065, 82010.6, SENSEX_WEEKLY)] },
    optionChainStock: { args: ["RELIANCE", "2026-10-27"], responses: [...base, ...chainResponses(md, 2, 1, 2885, 2851.4, RELIANCE_LEGS)] },
    ltp: { responses: [...base, quotesReq(md, 1502, 1, 26000, single(1502, depthQuote(1, 26000, 25012.35)))] },
    quotes: {
      args: [[{ token: "40201", exchange: "NFO" }, { token: "2885", exchange: "NSE" }]],
      responses: [
        ...base,
        quotesReq(md, 1502, 2, 40201, listOf(1502, [depthQuote(2, 40201, 25040.5), depthQuote(1, 2885, 2851.4, { vol: 5_400_000 })])),
        quotesReq(md, 1510, 2, 40201, listOf(1510, [oiQuote(2, 40201, 9_925_500)])),
      ],
      expect: { minRows: 2 },
    },
    depth: { args: [{ token: "40003", exchange: "NFO" }], responses: [...base, quotesReq(md, 1502, 2, 40003, single(1502, depthQuote(2, 40003, 200.1)))] },
    historical: {
      args: [{ instrument: { token: "40201", exchange: "NFO" }, interval: "1m", from: "2026-10-19", to: "2026-10-19" }],
      responses: [...base, { method: "GET", urlPattern: `^${md.replace(/[.]/g, "\\.")}/instruments/ohlc\\?exchangeSegment=NSEFO&exchangeInstrumentID=40201&startTime=Oct%2019%202026%20091500&endTime=Oct%2019%202026%20153000&compressionValue=60$`, json: OHLC }],
      expect: { minRows: 3 },
    },
    positions: { responses: [...iaAuth, ia("GET", "/portfolio/positions?dayOrNet=NetWise", POSITIONS)], expect: { minRows: 2 } },
    holdings: { responses: [...iaAuth, ia("GET", "/portfolio/holdings", HOLDINGS)], expect: { minRows: 2 } },
    funds: { responses: [...iaAuth, ia("GET", "/user/balance", BALANCE)] },
    orderBook: { responses: [...iaAuth, ia("GET", "/orders", ORDERS)], expect: { minRows: 3 } },
    tradeBook: { responses: [...iaAuth, ia("GET", "/orders/trades", TRADES)], expect: { minRows: 1 } },
    placeOrder: {
      args: [{ exchange: "NFO", token: "40003", transactionType: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 2, price: 199.5, tag: "mrchub" }, 75],
      responses: [...iaAuth, ia("POST", "/orders", PLACE, { expectBody: { exchangeSegment: "NSEFO", exchangeInstrumentID: 40003, productType: "NRML", orderType: "Limit", orderSide: "BUY", timeInForce: "DAY", orderQuantity: 150, limitPrice: 199.5, stopPrice: 0 } })],
    },
    modifyOrder: {
      args: ["2190766863", { orderType: "LIMIT", product: "MARGIN", quantity: 150, price: 198.75 }],
      responses: [...iaAuth, ia("PUT", "/orders", MODIFY, { expectBody: { appOrderID: 2190766863, modifiedOrderType: "Limit", modifiedProductType: "NRML", modifiedOrderQuantity: 150, modifiedLimitPrice: 198.75 } })],
    },
    cancelOrder: {
      args: ["2190766863"],
      responses: [...iaAuth, ia("DELETE", "/orders?appOrderID=2190766863&orderUniqueIdentifier=mrchub", CANCEL)],
    },
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(ROOT, id, `${name}.json`), `${JSON.stringify(content, null, 2)}\n`);
  }
}

for (const id of Object.keys(BROKERS)) build(id);
console.log(`wrote fixtures for ${Object.keys(BROKERS).join(", ")}`);
