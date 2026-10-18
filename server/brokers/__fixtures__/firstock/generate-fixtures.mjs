/**
 * Writes the Firstock contract fixtures. Field names and envelopes come from the official doc samples
 * (https://firstock.in/api/docs/...); CSV headers are those of the published symbol files. The docs'
 * examples are moved onto NIFTY (20 Oct 2026 weekly, 27 Oct monthly), SENSEX (22 Oct weekly), BANKEX and
 * RELIANCE contracts. Every id, token and name is a dummy.
 * Run: node server/brokers/__fixtures__/firstock/generate-fixtures.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const BASE = "https://api.firstock.in/V1";
const session = { sessionToken: "dummy-susertoken" };
const auth = { userId: "AB1234", jKey: "dummy-susertoken" };
const write = (name, value) => writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
const ok = (message, data) => ({ status: "success", message, data });
const post = (endpoint, json, expectBody = {}) => ({ method: "POST", url: `${BASE}${endpoint}`, expectBody: { ...auth, ...expectBody }, json });
const csv = (file, text) => ({ method: "GET", url: `${BASE}/symbols/${file}?ref=firstock.in`, text });

const INDICES = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize",
  "NFO,40001,65,NIFTY,NIFTY20OCT26C24950,20-OCT-2026,OPTIDX,CE,24950,0.05",
  "NFO,40002,65,NIFTY,NIFTY20OCT26P24950,20-OCT-2026,OPTIDX,PE,24950,0.05",
  "NFO,40003,65,NIFTY,NIFTY20OCT26C25000,20-OCT-2026,OPTIDX,CE,25000,0.05",
  "NFO,40004,65,NIFTY,NIFTY20OCT26P25000,20-OCT-2026,OPTIDX,PE,25000,0.05",
  "NFO,40005,65,NIFTY,NIFTY20OCT26C25050,20-OCT-2026,OPTIDX,CE,25050,0.05",
  "NFO,40006,65,NIFTY,NIFTY20OCT26P25050,20-OCT-2026,OPTIDX,PE,25050,0.05",
  "NFO,40011,65,NIFTY,NIFTY27OCT26C25000,27-OCT-2026,OPTIDX,CE,25000,0.05",
  "NFO,40012,65,NIFTY,NIFTY27OCT26P25000,27-OCT-2026,OPTIDX,PE,25000,0.05",
  "NFO,40020,65,NIFTY,NIFTY27OCT26F,27-OCT-2026,FUTIDX,FUT,-0.01,0.1",
  "NFO,40031,120,MIDCPNIFTY,MIDCPNIFTY27OCT26C13000,27-OCT-2026,OPTIDX,CE,13000,0.05",
  "NFO,40041,25,NIFTYNXT50,NIFTYNXT5027OCT26C68000,27-OCT-2026,OPTIDX,CE,68000,0.05",
  "BFO,1163250,20,SENSEX,SENSEX26O2282700CE,22-OCT-2026,OPTIDX,CE,82700,0.05",
  "BFO,1163251,20,SENSEX,SENSEX26O2282700PE,22-OCT-2026,OPTIDX,PE,82700,0.05",
  "BFO,1155242,30,BANKEX,BANKEX26OCT62000CE,29-OCT-2026,OPTIDX,CE,62000,0.05",
].join("\n");
const NFO = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,CompanyName,Expiry,Instrument,OptionType,StrikePrice,TickSize,FreezeQty",
  "NFO,36342,500,RELIANCE,RELIANCE27OCT26C1460,\"RELIANCE OCT 1460 C\",27-OCT-2026,OPTSTK,CE,1460,0.05,20000",
  "NFO,36343,500,RELIANCE,RELIANCE27OCT26P1460,\"RELIANCE, OCT 1460 P\",27-OCT-2026,OPTSTK,PE,1460,0.05,20000",
  "NFO,40003,65,NIFTY,NIFTY20OCT26C25000,NIFTY 20OCT 25000 C,20-OCT-2026,OPTIDX,CE,25000,0.05,1800",
].join("\n");
const BFO = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,CompanyName,Expiry,Instrument,OptionType,StrikePrice,TickSize,FreezeQty",
  "BFO,1163268,350,APLAPOLLO,APLAPOLLO26OCT1920CE,APLAPOLLO 29 OCT 1920 CE,29-OCT-2026,OPTSTK,CE,1920,0.05,100000000",
].join("\n");
const NSE = [
  "Exchange,Token,LotSize,TradingSymbol,CompanyName,ISIN,TickSize,FreezeQty",
  "NSE,2885,1,RELIANCE-EQ,RELIANCE INDUSTRIES LTD,INE002A01018,0.1,0.0",
  "NSE,14366,1,IDEA-EQ,VODAFONE IDEA LIMITED,INE669E01016,0.01,0.0",
].join("\n");

const indexList = post("/indexList", ok("All indexes", [
  { exchange: "NSE", token: "26000", tradingSymbol: "NIFTY", symbol: "NIFTY", idxname: "NIFTY 50" },
  { exchange: "NSE", token: "26009", tradingSymbol: "BANKNIFTY", symbol: "BANKNIFTY", idxname: "NIFTY BANK" },
  { exchange: "NSE", token: "26074", tradingSymbol: "MIDCPNIFTY", symbol: "MIDCPNIFTY", idxname: "NIFTY MID SELECT" },
  { exchange: "BSE", token: "1", tradingSymbol: "SENSEX", symbol: "SENSEX", idxname: "SENSEX" },
]));

const quoteRow = (exchange, tradingSymbol, token, ltp, bid, ask, extra = {}) => ({
  VWAP: "0.00", bestBuyOrder1: "3", bestBuyPrice1: bid, bestBuyQuantity1: "650", bestBuyPrice2: "0.00", bestBuyQuantity2: "0", bestBuyOrder2: "0",
  bestSellOrder1: "2", bestSellPrice1: ask, bestSellQuantity1: "325", bestSellPrice2: "0.00", bestSellQuantity2: "0", bestSellOrder2: "0",
  companyName: tradingSymbol, dayClosePrice: ltp, dayHighPrice: ltp, dayLowPrice: ltp, dayOpenPrice: ltp, exchange, identifier: `${exchange}:${tradingSymbol}`,
  instrumentName: exchange === "NFO" ? "OPTIDX" : "", lastTradedPrice: ltp, lotSize: exchange === "NFO" ? "65" : "1", multipler: "1", openInterest: "0.00",
  priceFactor: "(1 / 1 ) * (1 / 1)", pricePrecision: "2", requestTime: "10:44:35 16-10-2026", segment: exchange === "NFO" ? "Options" : "Indices",
  symbolName: tradingSymbol, tickSize: "0.05", token, totalBuyQuantity: "0", totalSellQuantity: "0", tradingSymbol, ...extra,
});
const multiQuotes = post("/getMultiQuotes", ok("Multiple quotes data retrieved successfully", [
  quoteRow("NSE", "NIFTY", "26000", "25012.15", "0.00", "0.00"),
  quoteRow("BSE", "SENSEX", "1", "82710.40", "0.00", "0.00"),
  quoteRow("NFO", "NIFTY20OCT26C24950", "40001", "128.40", "128.10", "128.60"),
  quoteRow("NFO", "NIFTY20OCT26P24950", "40002", "62.15", "62.00", "62.30"),
  quoteRow("NFO", "NIFTY20OCT26C25000", "40003", "96.80", "96.55", "96.95", { openInterest: "165900.00" }),
  quoteRow("NFO", "NIFTY20OCT26P25000", "40004", "82.35", "82.20", "82.50"),
  quoteRow("NFO", "NIFTY20OCT26C25050", "40005", "70.05", "69.90", "70.20"),
  quoteRow("NFO", "NIFTY20OCT26P25050", "40006", "106.60", "106.40", "106.75"),
]));

const greekRow = (token, tradingSymbol, optionType, strike, ltp, iv, delta, oi) => ({
  exchange: "NFO", token, tradingSymbol, optionType, pricePrecision: "2", lotSize: "65", tickSize: "0.05", strikePrice: `${strike}.00`,
  lastTradedPrice: ltp, parentToken: "26000", delta, gamma: "0.0007", theta: "-11.5", vega: "8.3", rho: "0.15", iv, oi,
});
const chain = post("/optionChainGreeks", ok("Option chain with Greeks retrieved successfully", [
  greekRow("40001", "NIFTY20OCT26C24950", "CE", 24950, "128.40", "13.40", "0.58", "102300"),
  greekRow("40002", "NIFTY20OCT26P24950", "PE", 24950, "62.15", "13.90", "-0.42", "98100"),
  greekRow("40003", "NIFTY20OCT26C25000", "CE", 25000, "96.80", "13.10", "0.51", "165900"),
  greekRow("40004", "NIFTY20OCT26P25000", "PE", 25000, "82.35", "13.60", "-0.49", "171200"),
  greekRow("40005", "NIFTY20OCT26C25050", "CE", 25050, "70.05", "", "", "88000"),
  greekRow("40006", "NIFTY20OCT26P25050", "PE", 25050, "106.60", "13.20", "-0.60", "75400"),
]), { exchange: "NFO", symbol: "NIFTY", expiry: "20OCT26", count: "ALL" });

const limit = post("/limit", ok("Successfully fetched RMS limits", { availableMargin: "152430.49", brkcollamt: "0.00", cash: "200000.00", collateral: "25000.00", expo: "4100.00", marginused: "72569.51", totalMargin: "225000.00", payin: "0.00", peak_mar: "0.00", premium: "6292.00", requestTime: "17:14:15 16-10-2026", span: "62177.51" }));

write("manifest", {
  brokerId: "firstock",
  creds: { userId: "AB1234", vendorCode: "AB1234_API", apiKey: "dummyApiKey" },
  symbol: "NIFTY",
  expiry: "2026-10-20",
  sources: [
    "https://firstock.in/api/docs/login/",
    "https://firstock.in/api/docs/downloaders/",
    "https://firstock.in/api/docs/request-responses/",
    "https://firstock.in/api/docs/exception-errors/",
    "https://firstock.in/api/docs/index-list/",
    "https://firstock.in/api/docs/option-chain-with-greeks/",
    "https://firstock.in/api/docs/get-multi-quote/",
    "https://firstock.in/api/docs/time-price-regular-interval/",
    "https://firstock.in/api/docs/time-price-day-interval/",
    "https://firstock.in/api/docs/position-book/",
    "https://firstock.in/api/docs/holding-details/",
    "https://firstock.in/api/docs/limits/",
    "https://firstock.in/api/docs/order-book/",
    "https://firstock.in/api/docs/trade-book/",
    "https://firstock.in/api/docs/place-order/",
    "https://firstock.in/api/docs/modify-order/",
    "https://firstock.in/api/docs/cancel-order/",
    "https://api.firstock.in/V1/symbols/Indices?ref=firstock.in",
  ],
  notes: "Generated by generate-fixtures.mjs from the official doc samples (documented field names and envelopes; dummy ids). CSV headers match the published symbol files. manifest.creds stays logged out for sessionLogin.test.mjs; data fixtures add creds.sessionToken.",
});

write("login", {
  secrets: { password: "Hunter2Pass!", totpCode: "123456" },
  responses: [{
    method: "POST",
    url: `${BASE}/login`,
    expectBody: { userId: "AB1234", TOTP: "123456", vendorCode: "AB1234_API", apiKey: "dummyApiKey" },
    json: ok("Login successful", { actid: "AB1234", userName: "DUMMY USER", susertoken: "dummy-susertoken", email: "dummy@example.com" }),
  }],
});

write("testConnection", { creds: session, responses: [limit], expect: { status: "success" } });
write("instruments", { creds: session, responses: [csv("Indices", INDICES), csv("NFO", NFO), csv("BFO", BFO), csv("NSE", NSE)], expect: { minRows: 15, underlyings: ["NIFTY", "SENSEX", "BANKEX", "MIDCPNIFTY", "RELIANCE"] } });
write("expiries", { creds: session, responses: [csv("Indices", INDICES)], expect: { minRows: 2 } });
write("optionChain", { creds: session, responses: [csv("Indices", INDICES), chain, indexList, multiQuotes], expect: { minStrikes: 3 } });
write("ltp", { creds: session, responses: [indexList, multiQuotes] });
write("quotes", { creds: session, args: [[{ token: "40003", exchange: "NFO" }, { token: "26000", exchange: "NSE" }]], responses: [csv("Indices", INDICES), csv("NFO", NFO), indexList, multiQuotes], expect: { minRows: 2 } });
write("depth", { creds: session, args: [{ token: "40003", exchange: "NFO" }], responses: [csv("Indices", INDICES), multiQuotes] });
write("historical", {
  creds: session,
  args: [{ instrument: { token: "26000", exchange: "NSE" }, interval: "1m", from: "2026-10-16", to: "2026-10-16" }],
  responses: [indexList, post("/timePriceSeries", ok("Successfully fetched charts data", [
    { time: "2026-10-16T09:16:00", epochTime: 1792122360, open: 24961, high: 24970.5, low: 24955, close: 24968.2, volume: 0, oi: 0 },
    { time: "2026-10-16T09:15:00", epochTime: 1792122300, open: 24960.35, high: 24990, low: 24940.1, close: 24961, volume: 0, oi: 0 },
  ]), { exchange: "NSE", tradingSymbol: "NIFTY", interval: "1mi", startTime: "09:15:00 16-10-2026", endTime: "15:30:00 16-10-2026" })],
  expect: { minRows: 2 },
});
write("positions", {
  creds: session,
  responses: [post("/positionBook", ok("Positions retrieved successfully", [
    { RealizedPNL: "0.03", cfBuyAmt: "", cfBuyQty: "", cfSellAmt: "", cfSellQty: "", dayBuyAmount: "7.68", dayBuyAveragePrice: "7.68", dayBuyQuantity: "01", daySellAmount: "7.71", daySellAveragePrice: "7.71", daySellQuantity: "01", exchange: "NSE", lastTradedPrice: "7.72", lotSize: "1", netAveragePrice: "0.00", netQuantity: "0", netUploadPrice: "0.00", product: "C", tickSize: "5.00", token: "14366", totalMTM: "0.03", totalPNL: "0.03", tradingSymbol: "IDEA-EQ", uploadPrice: "00", userId: "AB1234" },
    { RealizedPNL: "0.00", dayBuyAmount: "6292.00", dayBuyAveragePrice: "96.80", dayBuyQuantity: "65", daySellQuantity: "0", exchange: "NFO", lastTradedPrice: "99.20", lotSize: "65", netAveragePrice: "96.80", netQuantity: "65", product: "M", token: "40003", totalMTM: "156.00", totalPNL: "156.00", tradingSymbol: "NIFTY20OCT26C25000", userId: "AB1234" },
  ]))],
  expect: { minRows: 2 },
});
write("holdings", {
  creds: session,
  responses: [post("/holdingsDetails", ok("Fetched holdings", [
    { exchangeTradingSymbol: [{ exchange: "NSE", token: "18562", tradingSymbol: "MITTAL-EQ", pricePrecision: "2", tickSize: "0.01", lotSize: "1" }], sellAmount: "0.000000", holdQuantity: "1", hairCut: "1.00", dpQuantity: "0", unPledgeQuantity: "0", uploadPrice: "2.23", BTSTQuantity: "0", usedQuantity: "0", tradeQuantity: "0", brokerCollateralQuantity: "0", beneficiaryQuantity: "0", collateralQuantity: "0" },
    { exchangeTradingSymbol: [{ exchange: "BSE", token: "532648", tradingSymbol: "YESBANK", pricePrecision: "2", tickSize: "0.01", lotSize: "1" }, { exchange: "NSE", token: "11915", tradingSymbol: "YESBANK-EQ", pricePrecision: "2", tickSize: "0.01", lotSize: "1" }], sellAmount: "37.540000", holdQuantity: "4", hairCut: "0.20", dpQuantity: "0", uploadPrice: "20.13", BTSTQuantity: "0", usedQuantity: "2", tradeQuantity: "2", collateralQuantity: "0" },
  ]))],
  expect: { minRows: 2 },
});
write("funds", { creds: session, responses: [limit] });

const orderRows = [
  { averagePrice: "0.00", exchange: "NSE", fillShares: "", lotSize: "1", orderNumber: "26101600013102", orderTime: "1792141654", price: "0.00", priceType: "MKT", product: "C", quantity: "13", rejectReason: "RED:Margin Shortfall:INR 4,301.68 Available:INR 77.09 for C-AB1234 [ONLINE]", remarks: "", retention: "DAY", status: "REJECTED", tickSize: "0.01", token: "14366", tradingSymbol: "IDEA-EQ", transactionType: "S", userId: "AB1234" },
  { averagePrice: "0.00", exchange: "NFO", fillShares: "0", lotSize: "65", orderNumber: "26101600007328", orderTime: "1792127268", price: "95.00", priceType: "LMT", product: "M", quantity: "130", rejectReason: "", remarks: "", retention: "DAY", status: "OPEN", tickSize: "0.05", token: "40003", tradingSymbol: "NIFTY20OCT26C25000", transactionType: "B", userId: "AB1234" },
];
const orderBook = post("/orderBook", ok("Order book", orderRows));
write("orderBook", { creds: session, responses: [orderBook], expect: { minRows: 2 } });
write("tradeBook", {
  creds: session,
  responses: [post("/tradeBook", ok("Trade history data received", [
    { exchange: "NSE", exchangeUpdateTime: "16-10-2026 09:30:02", exchordid: "1200000006968574", fillId: "401070025", fillPrice: 2837, fillQuantity: "1", fillTime: "16-10-2026 09:30:02", fillshares: "1", lotSize: "1", orderNumber: "26101600002340", orderTime: "09:30:02 16-10-2026", priceFactor: "1.000000", pricePrecision: "2", priceType: "MKT", product: "C", quantity: "1", retention: "DAY", tickSize: "0.05", token: "21001", tradingSymbol: "PSB-EQ", transactionType: "B", userId: "AB1234" },
  ]))],
  expect: { minRows: 1 },
});

const order = { tradingSymbol: "NIFTY20OCT26C25000", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 2, price: 95 };
write("placeOrder", {
  creds: session,
  args: [order, 65],
  responses: [post("/placeOrder", ok("Order details", { orderNumber: "26101600007328", requestTime: "17:50:52 16-10-2026" }),
    { exchange: "NFO", retention: "DAY", product: "M", priceType: "LMT", tradingSymbol: "NIFTY20OCT26C25000", transactionType: "B", price: "95", triggerPrice: "0", quantity: "130" })],
});
write("modifyOrder", {
  creds: session,
  args: ["26101600007328", { price: 96.5 }],
  responses: [orderBook, post("/modifyOrder", ok("Order modification details", { orderNumber: "26101600007328", requestTime: "18:07:09 16-10-2026" }),
    { orderNumber: "26101600007328", product: "M", priceType: "LMT", tradingSymbol: "NIFTY20OCT26C25000", price: "96.5", quantity: "130", retention: "DAY" })],
});
write("cancelOrder", {
  creds: session,
  args: ["26101600007328"],
  responses: [post("/cancelOrder", ok("Order cancellation details", { orderNumber: "26101600007328", requestTime: "17:59:57 16-10-2026" }), { orderNumber: "26101600007328" })],
});
