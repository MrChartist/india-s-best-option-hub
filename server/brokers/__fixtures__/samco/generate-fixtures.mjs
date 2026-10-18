// Run: node server/brokers/__fixtures__/samco/generate-fixtures.mjs  (rewrites the JSON fixtures in this folder; no network).
// Writes server/brokers/__fixtures__/samco/*.json from the official doc samples (dummy ids).
import { mkdirSync, writeFileSync } from "node:fs";
const dir = process.argv[2] || new URL(".", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const B = "https://tradeapi.samco.in";
const SRC = {
  session: "https://docs-tradeapi.samco.in/session/generate-token.html",
  chain: "https://docs-tradeapi.samco.in/option-chain.html",
  multi: "https://docs-tradeapi.samco.in/quote/multi-quote.html",
  index: "https://docs-tradeapi.samco.in/quote/index-quote.html",
  quote: "https://docs-tradeapi.samco.in/quote/get-quote.html",
  depth: "https://docs-tradeapi.samco.in/market-depth.html",
  limits: "https://docs-tradeapi.samco.in/user-limit.html",
  pos: "https://docs-tradeapi.samco.in/position/user-position.html",
  hold: "https://docs-tradeapi.samco.in/user-holding.html",
  ob: "https://docs-tradeapi.samco.in/order/order-book.html",
  tb: "https://docs-tradeapi.samco.in/trade-book.html",
  place: "https://docs-tradeapi.samco.in/order/place-order.html",
  modify: "https://docs-tradeapi.samco.in/order/modify-order.html",
  cancel: "https://docs-tradeapi.samco.in/order/cancel-order.html",
  hist: "https://docs-tradeapi.samco.in/historical/historical-candle-data.html",
  intra: "https://docs-tradeapi.samco.in/intraday/intraday-candle-data.html",
  master: "https://developers.stocknote.com/doc/ScripMaster.csv",
};
const session = { method: "POST", url: `${B}/session/token`, expectBody: { apiKey: "dummyAesApiKey", apiSecret: "dummyAesApiSecret" }, status: 200,
  json: { serverTime: "29/01/26 10:46:06", msgId: "00000000-0000-0000-0000-000000000001", status: "Success", statusMessage: "Session token generated successfully",
    sessionToken: "dummy-session-jwt", tokenId: "00000000-0000-0000-0000-000000000002", accountID: "DV99999", accountName: "DUMMY USER",
    exchangeList: ["NSE", "BSE", "NFO", "BFO", "MCX"], orderTypeList: ["L", "MKT", "SL", "SL-M"], productList: ["MIS", "CNC", "NRML"], srcIp: "203.0.113.10", primaryIp: "203.0.113.10", secondaryIp: "" } };
const H = "exchange,exchangeSegment,symbolCode,tradingSymbol,name,lastPrice,instrument,lotSize,strikePrice,expiryDate,tickSize";
const csv = [H,
  "NSE,nse_cm,2885_NSE,RELIANCE-EQ,RELIANCE,1211.20,EQ,1,,,0.10",
  "NFO,nse_fo,40001_NFO,NIFTY20OCT2625000CE,NIFTY,120.50,OPTIDX,65,25000.0000,20/10/26,0.05",
  "NFO,nse_fo,40002_NFO,NIFTY20OCT2625000PE,NIFTY,98.10,OPTIDX,65,25000.0000,20/10/26,0.05",
  "NFO,nse_fo,40003_NFO,NIFTY20OCT2625100CE,NIFTY,70.00,OPTIDX,65,25100.0000,20/10/26,0.05",
  "NFO,nse_fo,40004_NFO,NIFTY20OCT2625100PE,NIFTY,150.00,OPTIDX,65,25100.0000,20/10/26,0.05",
  "NFO,nse_fo,40011_NFO,NIFTY26OCT25000CE,NIFTY,210.00,OPTIDX,65,25000.0000,27/10/26,0.05",
  "NFO,nse_fo,40012_NFO,NIFTY26OCT25000PE,NIFTY,190.00,OPTIDX,65,25000.0000,27/10/26,0.05",
  "NFO,nse_fo,48704_NFO,NIFTY26OCTFUT,NIFTY,25110.00,FUTIDX,65,,27/10/26,0.10",
  "NFO,nse_fo,41001_NFO,BANKNIFTY26OCT56000CE,BANKNIFTY,400.00,OPTIDX,30,56000.0000,27/10/26,0.05",
  "NFO,nse_fo,41002_NFO,BANKNIFTY26OCT56000PE,BANKNIFTY,380.00,OPTIDX,30,56000.0000,27/10/26,0.05",
  "NFO,nse_fo,42001_NFO,FINNIFTY26OCT26000CE,FINNIFTY,150.00,OPTIDX,60,26000.0000,27/10/26,0.05",
  "NFO,nse_fo,43001_NFO,MIDCPNIFTY26OCT13000PE,MIDCPNIFTY,80.00,OPTIDX,120,13000.0000,27/10/26,0.05",
  "NFO,nse_fo,44001_NFO,RELIANCE26OCT1220CE,RELIANCE,18.00,OPTSTK,500,1220.0000,27/10/26,0.05",
  "NFO,nse_fo,44002_NFO,RELIANCE26OCT1220PE,RELIANCE,22.00,OPTSTK,500,1220.0000,27/10/26,0.05",
  "BFO,bse_fo,1125419_BFO,SENSEX26O2282000CE,SENSEX,300.00,IO,20,82000.0000,22/10/26,0.05",
  "BFO,bse_fo,1125420_BFO,SENSEX26O2282000PE,SENSEX,280.00,IO,20,82000.0000,22/10/26,0.05",
  "BFO,bse_fo,1155242_BFO,BANKEX26OCT62000CE,BANKEX,500.00,IO,30,62000.0000,29/10/26,0.05",
  "MFO,mcx_fo,256981_MFO,SILVER26NOV76250PE,SILVER,0,OPTCOM,30,76250.0000,24/11/26,0.5",
].join("\n");
const master = { method: "GET", url: SRC.master, status: 200, text: csv, headers: { "content-type": "text/csv" } };
const env = (extra) => ({ serverTime: "17/10/26 10:00:00", msgId: "00000000-0000-0000-0000-000000000003", status: "Success", ...extra });
const indexQuote = (name, spot) => ({ method: "GET", url: `${B}/quote/indexQuote?indexName=${encodeURIComponent(name).replace(/%20/g, "+")}`, status: 200,
  json: env({ statusMessage: "Index Quote details retrieved successfully", indexDetails: [{ indexName: name, listingId: "-101", lastTradedTime: "2026-10-16 15:29:59.0", spotPrice: spot, changePercentage: 0.63, averagePrice: 0, openValue: spot - 50, highValue: spot + 80, lowValue: spot - 120, closeValue: spot - 40, totalBuyQuantity: 0, totalSellQuantity: 0, totalTradedValue: 0, totalTradedVolume: 0, change: 40 }] }) });
const leg = (ts, sym, strike, type, ltp, oi, oichg, iv, delta) => ({ tradingSymbol: ts, exchange: "NFO", symbol: sym, strikePrice: `${strike}.0000`, expiryDate: "2026-10-20", instrument: "OPTIDX", optionType: type, underLyingSymbol: "NIFTY", spotPrice: "25041.35",
  lastTradedPrice: ltp, openInterest: oi, openInterestInLot: oi / 65, openInterestChange: oichg, openInterestChangeInLot: oichg / 65, oichangePer: "7.79", volume: 1620250, impliedVolatility: iv, delta, gamma: "0.000530033", theta: "-7.04959", vega: "10.3883",
  bestBids: [{ number: 1, quantity: "200", price: String(ltp - 0.15) }], bestAsks: [{ number: 1, quantity: "250", price: String(ltp + 0.1) }] });
const w = (name, obj) => writeFileSync(`${dir}/${name}.json`, JSON.stringify(obj, null, 2) + "\n");

w("manifest", { brokerId: "samco", creds: { apiKey: "dummyAesApiKey", apiSecret: "dummyAesApiSecret" }, symbol: "NIFTY", expiry: "2026-10-20", sources: Object.values(SRC),
  notes: "Payloads are the official Samco Trade API v3.2 documentation samples (docs-tradeapi.samco.in), trimmed, with ids, names and dates replaced by dummy values. The scrip master fixture uses the live file's header row with a handful of dummy rows." });
w("testConnection", { responses: [session, indexQuote("NIFTY 50", 25041.35)], expect: { status: "success" } });
w("instruments", { responses: [master], expect: { minRows: 10, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } });
w("expiries", { responses: [master], expect: { minRows: 2 } });
w("optionChain", { responses: [master, session,
  { method: "GET", url: `${B}/option/optionChain?exchange=NFO&searchSymbolName=NIFTY&expiryDate=2026-10-20`, status: 200, json: env({ statusMessage: "OptionChain details retrived successfully. ", optionChainDetails: [
    leg("NIFTY20OCT2625000CE", "40001_NFO", 25000, "CE", 120.5, 1312350, 94825, "13.1337", "0.53"),
    leg("NIFTY20OCT2625000PE", "40002_NFO", 25000, "PE", 98.1, 1012350, -4825, "13.8", "-0.47"),
    leg("NIFTY20OCT2625100CE", "40003_NFO", 25100, "CE", 70, 812350, 14825, "12.9", "0.38"),
    leg("NIFTY20OCT2625100PE", "40004_NFO", 25100, "PE", 150, 612350, 4825, "13.5", "-0.62"),
  ] }) }], expect: { minStrikes: 2 } });
w("ltp", { responses: [session, indexQuote("NIFTY 50", 25041.35)] });
w("quotes", { args: [[{ token: "2885_NSE", exchange: "NSE" }, { token: "40001_NFO", exchange: "NFO" }]], responses: [master, session,
  { method: "POST", url: `${B}/quote/multiQuote`, expectBody: { NSE: ["RELIANCE"] }, status: 200, json: env({ statusMessage: "Multiquotes data retrieved successfully", multiQuotes: [
    { exchange: "NSE", symbolName: "RELIANCE", tradingSymbol: "RELIANCE-EQ", companyName: "RELIANCE INDUSTRIES LTD", isin: "INE002A01018", lotSize: "1", averagePrice: "1205.50", totalTradeVolume: "4311783", symbol: "2885_NSE", lastTradeTime: "16 Oct 2026, 03:29:59 PM", lastTradeQuantity: "1", lastTradePrice: "1,211.20", change: "5.70", changePercent: "0.47", open: "1206.00", close: "1211.20", previousClose: "1205.50", low: "1198.10", high: "1215.00", tickSize: "0.10", bidSize: "782", bidPrice: "1211.10", totalTradedValue: "5217617605.06", askSize: "10", askPrice: "1211.20", iv: "0.00" } ] }) },
  { method: "POST", url: `${B}/quote/multiQuote`, expectBody: { NFO: ["NIFTY20OCT2625000CE"] }, status: 200, json: env({ statusMessage: "Multiquotes data retrieved successfully", multiQuotes: [
    { exchange: "NFO", symbolName: "NIFTY", tradingSymbol: "NIFTY20OCT2625000CE", optionType: "CE", instrumentType: "OPTIDX", companyName: "NIFTY", lotSize: "65", strikePrice: "25000.0000", expiry: "20 Oct 26", averagePrice: "118.00", totalTradeVolume: "1620250", symbol: "40001_NFO", lastTradeTime: "16 Oct 2026, 03:29:59 PM", lastTradeQuantity: "65", lastTradePrice: "120.50", multiplier: "65", openInterest: "1312350", previousOpenInterest: "1217525", change: "4.00", changePercent: "3.43", open: "110.00", close: "120.50", previousClose: "116.50", low: "101.00", high: "131.00", tickSize: "0.05", bidSize: "200", bidPrice: "120.35", totalTradedValue: "0.00", askSize: "250", askPrice: "120.60", delta: "0.53", vega: "10.38", theta: "-7.05", gamma: "0.0005", iv: "13.13" } ] }) },
  ], expect: { minRows: 2 } });
w("depth", { args: [{ token: "40002_NFO", exchange: "NFO" }], responses: [master, session,
  { method: "POST", url: `${B}/marketDepth`, expectBody: { exchange: "NFO", symbolName: "NIFTY20OCT2625000PE" }, status: 200, json: env({ statusMessage: "Market depth data retrieved successfully", MarketDepthDetails: { marketDepth: {
    tradingSymbol: "NIFTY20OCT2625000PE", vega: "5.05", theta: "-15.53", gamma: "0.0010", symbol: "40002_NFO", tBuyQty: "774925", iv: "13.80", tSellQty: "985500",
    bestFiveAsk: [{ askNumber: "8", askSize: "1775", askPrice: "98.15" }, { askNumber: "19", askSize: "4350", askPrice: "98.20" }],
    bestFiveBid: [{ bidSize: "1400", bidNumber: "4", bidPrice: "98.05" }, { bidSize: "3850", bidNumber: "13", bidPrice: "98.00" }], atmIV: "11.70", delta: "-0.47", exc: "NFO" } } }) }] });
w("historical", { args: [{ instrument: { token: "2885_NSE", exchange: "NSE" }, interval: "1d", from: "2026-10-14", to: "2026-10-16" }], responses: [master, session,
  { method: "GET", url: `${B}/history/candleData?exchange=NSE&symbolName=RELIANCE&fromDate=2026-10-14&toDate=2026-10-16`, status: 200, json: env({ statusMessage: "Request successful", historicalCandleData: [
    { date: "2026-10-14", open: "1189.9", high: "1194.0", low: "1182.75", close: "1188.0", ltp: "1188.0", volume: "600344" },
    { date: "2026-10-15", open: "1188.0", high: "1209.0", low: "1186.10", close: "1205.5", ltp: "1205.5", volume: "700120" },
    { date: "2026-10-16", open: "1206.0", high: "1215.0", low: "1198.10", close: "1211.2", ltp: "1211.2", volume: "650010" } ] }) }], expect: { minRows: 3 } });
w("positions", { responses: [session, { method: "GET", url: `${B}/position/getPositions?positionType=NET`, status: 200, json: env({ statusMessage: "Request successful",
  positionSummary: { gainingTodayCount: "1", losingTodayCount: "1", totalGainAndLossAmount: "0.00", dayGainAndLossAmount: "-182.70" },
  positionDetails: [
    { averagePrice: "1560.15", exchange: "BSE", markToMarketPrice: "-182.70", lastTradedPrice: "1,550.00", previousClose: "1552.55", productCode: "CNC", symbolDescription: "RELIANCE INDUSTRIES LTD.", tradingSymbol: "RELIANCE", calculatedNetQuantity: "18.0", averageBuyPrice: "1560.15", averageSellPrice: "0.00", boardLotQuantity: "1", boughtPrice: "28082.70", buyQuantity: "18", carryForwardQuantity: "0", carryForwardValue: "0.00", multiplier: "1", netPositionValue: "-182.70", netQuantity: "18", netValue: "-182.70", positionType: "NET", positionConversions: "CNC, NRML", soldValue: "0.00", transactionType: "BUY", realizedGainAndLoss: "0.00", unrealizedGainAndLoss: "-182.70", companyName: "RELIANCE INDUSTRIES LTD.", expiryDate: "--", optionType: "--" },
    { averagePrice: "120.00", exchange: "NFO", markToMarketPrice: "-32.50", lastTradedPrice: "120.50", previousClose: "116.50", productCode: "NRML", symbolDescription: "NIFTY 20 OCT 25000 CE", tradingSymbol: "NIFTY20OCT2625000CE", calculatedNetQuantity: "-65.0", averageBuyPrice: "0.00", averageSellPrice: "120.00", boardLotQuantity: "65", boughtPrice: "0.00", buyQuantity: "0", carryForwardQuantity: "0", carryForwardValue: "0.00", multiplier: "1", netPositionValue: "-32.50", netQuantity: "-65", netValue: "7800.00", positionType: "NET", positionConversions: "NRML, MIS", soldValue: "7800.00", transactionType: "SELL", realizedGainAndLoss: "0.00", unrealizedGainAndLoss: "-32.50", companyName: "NIFTY", expiryDate: "20 Oct 26", optionType: "CE" } ] }) }], expect: { minRows: 2 } });
w("holdings", { responses: [session, { method: "GET", url: `${B}/holding/getHoldings`, status: 200, json: env({ statusMessage: "Request successful",
  holdingSummary: { gainingTodayCount: "0", losingTodayCount: "1", totalGainAndLossAmount: "0.00", dayGainAndLossAmount: "-7.65", portfolioValue: "4650.00" },
  holdingDetails: [{ averagePrice: "1560.15", exchange: "BSE", markToMarketPrice: "-182.70", lastTradedPrice: "1,550.00", previousClose: "1552.55", productCode: "CNC", symbolDescription: "RELIANCE INDUSTRIES LTD.", tradingSymbol: "RELIANCE", totalGainAndLoss: "-30.45", calculatedNetQuantity: "3.0", holdingsQuantity: "3", collateralQuantity: "2", holdingsValue: "4650.00", isin: "INE002A01018", sellableQuantity: "1", totalMarketToMarketPrice: "0" }] }) }], expect: { minRows: 1 } });
w("funds", { responses: [session, { method: "GET", url: `${B}/limit/getLimits`, status: 200, json: env({ statusMessage: "User Limit details retrieved successfully",
  equityLimit: { grossAvailableMargin: "125000.00", payInToday: "0", notionalCash: "0", marginUsed: "15202.50", netAvailableMargin: "109797.50" },
  commodityLimit: { grossAvailableMargin: "0.00", payInToday: "0", notionalCash: "0", marginUsed: "0", netAvailableMargin: "0.00" } }) }] });
const order = (no, status, filled, unfilled, extra = {}) => ({ orderNumber: no, exchange: "NFO", tradingSymbol: "NIFTY20OCT2625000CE", symbolDescription: "NIFTY 20 OCT 25000 CE", transactionType: "BUY", productCode: "NRML", orderType: "L", orderPrice: "118.00", quantity: "130", disclosedQuantity: "0", triggerPrice: "0.00", marketProtection: "3", orderValidity: "DAY", orderStatus: status, orderValue: "15340.00", instrumentName: "OPTIDX", orderTime: "16-Oct-2026 10:47:04", userId: "DV99999", filledQuantity: String(filled), fillPrice: "118.00", averagePrice: filled ? "118.00" : "0.00", unfilledQuantity: String(unfilled), exchangeOrderId: "1100000000000001", rejectionReason: "NA", exchangeConfirmationTime: "16-Oct-2026 10:47:05", cancelledQuantity: "0", referenceLimitPrice: "0.00", coverOrderPercentage: "0.00", orderRemarks: "--", exchangeOrderNumber: "1100000000000001", symbol: "40001_NFO", displayStrikePrice: "25000.00", displayNetQuantity: String(filled), status: status.toLowerCase(), exchangeStatus: status.toLowerCase(), expiry: "20 Oct 26", pendingQuantity: String(unfilled), instrument: "OPTIDX", scripName: "NIFTY", totalQuanity: "130", optionType: "CE", orderPlaceBy: "DV99999", lotQuantity: "65", parentOrderId: "", ...extra });
w("orderBook", { responses: [session, { method: "GET", url: `${B}/order/orderBook`, status: 200, json: env({ statusMessage: "Request successful", orderBookDetails: [
  order("261016000000079", "Complete", 130, 0), order("261016000000080", "Pending", 65, 65), order("261016000000081", "Rejected", 0, 0, { rejectionReason: "Insufficient funds" }), order("261016000000082", "Trigger Pending", 0, 130, { orderType: "SL", triggerPrice: "117.00" }) ] }) }], expect: { minRows: 4 } });
w("tradeBook", { responses: [session, { method: "GET", url: `${B}/trade/tradeBook`, status: 200, json: env({ statusMessage: "Request successful", tradeBookDetails: [
  { orderNumber: "261016000000079", exchange: "NFO", tradingSymbol: "NIFTY20OCT2625000CE", symbolDescription: "NIFTY 20 OCT 25000 CE", transactionType: "BUY", productCode: "NRML", orderType: "L", orderPrice: "118.00", quantity: "130", disclosedQuantity: "0", triggerPrice: "0.00", marketProtection: "3", orderValidity: "DAY", orderStatus: "Complete", orderValue: "15340.00", instrumentName: "OPTIDX", orderTime: "16-Oct-2026 10:47:04", userId: "DV99999", filledQuantity: "130", unfilledQuantity: "0", exchangeConfirmationTime: "10:47:05", coverOrderPercentage: "%", exchangeOrderNumber: "1100000000000001", tradeNumber: "195300", tradePrice: "118.00", tradeDate: "16OCT2026", tradeTime: "10:47:05 AM", strikePrice: "25000.00", optionType: "CE", lastTradePrice: "120.50", expiry: "20 Oct 26" } ] }) }], expect: { minRows: 1 } });
w("placeOrder", { args: [{ token: "40001_NFO", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 2, price: 118 }, 65], responses: [master, session,
  { method: "POST", url: `${B}/order/placeOrder`, expectBody: { symbolName: "NIFTY20OCT2625000CE", exchange: "NFO", transactionType: "BUY", orderType: "L", quantity: "130", price: "118.00", orderValidity: "DAY", productType: "NRML" }, status: 200,
    json: env({ orderNumber: "261016000162545", statusMessage: "NRML Order request placed successfully", exchangeOrderStatus: "PENDING", rejectionReason: "", orderDetails: { pendingQuantity: 130, avgExecutionPrice: "0.00", orderPlacedBy: "--", tradingSymbol: "NIFTY20OCT2625000CE", triggerPrice: "0.00", exchange: "NFO", totalQuantity: 130, transactionType: "B", productType: "NRML" } }) }] });
w("modifyOrder", { args: ["261016000131756", { orderType: "LIMIT", qty: 65, price: 119.5, validity: "DAY" }], responses: [session,
  { method: "PUT", url: `${B}/order/modifyOrder/261016000131756`, expectBody: { orderType: "L", quantity: "65", orderValidity: "DAY", price: "119.50" }, status: 200, json: env({ statusMessage: "Order  modified successfully.", ordernumber: "261016000131756" }) }] });
w("cancelOrder", { args: ["261016000000004"], responses: [session,
  { method: "DELETE", url: `${B}/order/cancelOrder?orderNumber=261016000000004`, status: 200, json: env({ orderNumber: "261016000000004", statusMessage: "Order cancellation request placed successfully" }) }] });
console.log("ok");
