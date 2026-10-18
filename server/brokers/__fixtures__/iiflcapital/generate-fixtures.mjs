/**
 * Writes the IIFL Capital contract fixtures. Run: node server/brokers/__fixtures__/iiflcapital/generate-fixtures.mjs
 *
 * Payloads follow the response samples and field tables on https://developers.iiflcapital.com/apidocs/*
 * (envelopes { status: "Ok", message, result }, field names and types as documented; the order-book, trade-book
 * and open-interest samples are printed without an envelope and are kept that way). The historical-data page
 * documents the candle fields (initialTimestamp, open, high, low, close, volume) but prints no full sample; that
 * fixture wraps them in the standard envelope. The CSVs use the published contract-file headers. Dummy ids.
 * No live call was used.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.iiflcapital.com/v1";

const session = {
  method: "POST", url: `${API}/getusersession`,
  // checkSum = SHA-256("TEST101" + "dummyAuthCode123" + "dummyAppSecret456")
  expectBody: { checkSum: "26ce98a193779ac750ccc884938bb45790670ceb55929fb1c5b38bcec4134aaa" },
  json: { status: "Ok", userSession: "eyJhbGciOi.dummy.bx844uFwWA" },
};
const ok = (result) => ({ status: "Ok", message: "Success", result });

const HEAD = "Exchange,Underlying Instrument Symbol,Instrument ID,Instrument Type,Option Type,Strike Price,Underlying Instrument Name,Formatted Ins Name,Trading Symbol,qtyLimit,Expiry,Lot Size,Tick Size";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fo(ex, und, id, type, opt, strike, iso, lot, sym) {
  const [y, m, d] = iso.split("-").map(Number);
  const formatted = opt ? `${und} ${d} ${MON[m - 1].toUpperCase()} ${y} ${strike} ${opt}` : `${und} ${d} ${MON[m - 1]} ${y}`;
  return [ex, und, id, type, opt, opt ? strike : "", und, formatted, sym, "1800", `${String(d).padStart(2, "0")}-${MON[m - 1]}-${y} 23:59`, lot, "0.05"].join(",");
}
const INDICES = [
  HEAD,
  "NSEEQ,NIFTY 50,999920000,INDEX,,,NIFTY 50,NIFTY 50,NIFTY 50 INDEX,,,,0",
  "NSEEQ,NIFTY BANK,999920005,INDEX,,,NIFTY BANK,BANK NIFTY,BANK NIFTY INDEX,,,,0",
  "NSEEQ,NIFTY FIN SERVICE,999920041,INDEX,,,NIFTY FIN SERVICE,NIFTY FIN SERVICE,NIFTY FIN SERVICE,,,,0",
  "NSEEQ,NIFTY MIDCAP SELECT,999920056,INDEX,,,NIFTY MIDCAP SELECT,NIFTY MIDCAP SELECT,NIFTY MIDCAP SELECT,,,,0",
  "NSEEQ,NIFTY IT,999920008,INDEX,,,NIFTY IT,NIFTY IT,NIFTY IT INDEX,,,,0",
  "BSEEQ,SENSEX,999901,INDEX,,,SENSEX,SENSEX,SENSEX,,,,0",
  "BSEEQ,BANKEX,999903,INDEX,,,BANKEX,BANKEX,BSE INDEX BANKEX,,,,0",
].join("\n") + "\n";
const NSEFO = [
  HEAD,
  fo("NSEFO", "NIFTY", "35008", "OPTIDX", "CE", 25000, "2026-11-03", 65, "NIFTY26N0325000CE"),
  fo("NSEFO", "NIFTY", "35009", "OPTIDX", "PE", 25000, "2026-11-03", 65, "NIFTY26N0325000PE"),
  fo("NSEFO", "NIFTY", "35010", "OPTIDX", "CE", 25050, "2026-11-03", 65, "NIFTY26N0325050CE"),
  fo("NSEFO", "NIFTY", "35011", "OPTIDX", "PE", 25050, "2026-11-03", 65, "NIFTY26N0325050PE"),
  fo("NSEFO", "NIFTY", "51440", "OPTIDX", "CE", 25000, "2026-10-27", 65, "NIFTY26OCT25000CE"),
  fo("NSEFO", "NIFTY", "51441", "OPTIDX", "PE", 25000, "2026-10-27", 65, "NIFTY26OCT25000PE"),
  fo("NSEFO", "NIFTY", "35382", "FUTIDX", "", 0, "2026-10-27", 65, "NIFTY26OCTFUT"),
  fo("NSEFO", "BANKNIFTY", "35000", "OPTIDX", "CE", 56000, "2026-10-27", 35, "BANKNIFTY26OCT56000CE"),
  fo("NSEFO", "FINNIFTY", "36001", "OPTIDX", "CE", 25000, "2026-10-27", 60, "FINNIFTY26OCT25000CE"),
  fo("NSEFO", "MIDCPNIFTY", "36101", "OPTIDX", "PE", 13000, "2026-10-27", 140, "MIDCPNIFTY26OCT13000PE"),
  fo("NSEFO", "RELIANCE", "36342", "OPTSTK", "CE", 1400, "2026-10-27", 500, "RELIANCE26OCT1400CE"),
  fo("NSEFO", "RELIANCE", "36343", "OPTSTK", "PE", 1400, "2026-10-27", 500, "RELIANCE26OCT1400PE"),
  fo("NSEFO", "NIFTYNXT50", "37001", "OPTIDX", "CE", 70000, "2026-10-27", 25, "NIFTYNXT5026OCT70000CE"),
].join("\n") + "\n";
const BSEFO = [
  HEAD,
  fo("BSEFO", "SENSEX", "1163250", "OPTIDX", "CE", 81000, "2026-10-22", 20, "SENSEX26O2281000CE"),
  fo("BSEFO", "SENSEX", "1163251", "OPTIDX", "PE", 81000, "2026-10-22", 20, "SENSEX26O2281000PE"),
  fo("BSEFO", "BANKEX", "1164001", "OPTIDX", "CE", 62000, "2026-10-27", 30, "BANKEX26OCT62000CE"),
  fo("BSEFO", "APLAPOLLO", "1163268", "OTPSTK", "CE", 1920, "2026-12-31", 350, "APLAPOLLO26DEC1920CE"),
  fo("BSEFO", "SENSEX50", "1165001", "OPTIDX", "CE", 26000, "2026-10-29", 25, "SENSEX5026O2926000CE"),
].join("\n") + "\n";
const NSEEQ = [
  "Exchange,Underlying Instrument Symbol,Instrument ID,Instrument Type,Option Type,Strike Price,Underlying Instrument Name,Formatted Instrument Name,Trading Symbol,Series,qtyLimit,Expiry,Lot Size,Tick Size",
  "NSEEQ,RELIANCE,2885,0,,,RELIANCE,RELIANCE INDUSTRIES LTD,RELIANCE-EQ,EQ,81195,,1,0.1",
  "NSEEQ,INFY,1594,0,,,INFY,INFOSYS LIMITED,INFY-EQ,EQ,100000,,1,0.1",
].join("\n") + "\n";
const file = (seg, text) => ({ method: "GET", url: `${API}/contractfiles/${seg}.csv`, text, headers: { "content-type": "text/csv" } });
const files = [file("INDICES", INDICES), file("NSEFO", NSEFO), file("BSEFO", BSEFO), file("NSEEQ", NSEEQ)];

const quote = (exchange, instrumentId, ltp, extra = {}) => ({
  exchange, instrumentId, ltp, lastTradedQuantity: 5, averageTradedPrice: ltp, tradedVolume: 7360198, open: ltp * 0.99, high: ltp * 1.01,
  low: ltp * 0.98, close: ltp * 0.985, bestBidPrice: Math.round((ltp - 0.05) * 100) / 100, bestBidQuantity: 4, bestAskPrice: Math.round((ltp + 0.05) * 100) / 100,
  bestAskQuantity: 13, totalBidQuantity: 404715, totalAskQuantity: 216809, tickTimestamp: "16-Oct-2026 15:29:59", ...extra,
});
const oi = (id, value) => ({ method: "POST", url: `${API}/marketdata/openinterest`, expectBody: { exchange: "NSEFO", instrumentId: id }, json: { exchange: "NSEFO", instrumentId: Number(id), openInterest: value, dayHighOi: value + 1000, dayLowOi: value - 1000 } });

const orderRow = (over = {}) => ({
  clientId: "TEST102", placedBy: "TEST102", brokerOrderId: "240920000000124", exchangeOrderId: "1100000000089930", orderStatus: "cancelled",
  formattedInstrumentName: "INFOSYS LIMITED", tradingSymbol: "INFY-EQ", instrumentId: "1594", exchange: "NSEEQ", transactionType: "BUY", quantity: "1",
  product: "INTRADAY", orderComplexity: "REGULAR", orderType: "LIMIT", price: "1800.0", averageTradedPrice: "0.0", slTriggerPrice: "0.0", validity: "DAY",
  disclosedQty: "0", marketProtectionPercent: "0.0", exchangeTimestamp: "20-Sep-2024 16:05:33", exchangeUpdateTime: "20-Sep-2024 16:05:32",
  rejectionReason: "", mainLegOrderId: "NA", pendingQuantity: "1", filledQuantity: "0", appKey: "NA", apiOrderSource: "API", algoId: "", source: "API",
  orderTag: "NA", brokerUpdateTime: "17-Feb-2025 06:48:39", ...over,
});

const fixtures = {
  manifest: {
    brokerId: "iiflcapital",
    creds: { clientId: "TEST101", appSecret: "dummyAppSecret456", authCode: "dummyAuthCode123" },
    symbol: "NIFTY",
    expiry: "2026-11-03",
    sources: [
      "https://developers.iiflcapital.com/apidocs/introduction",
      "https://developers.iiflcapital.com/apidocs/user",
      "https://developers.iiflcapital.com/apidocs/ordermanagement",
      "https://developers.iiflcapital.com/apidocs/portfolio",
      "https://developers.iiflcapital.com/apidocs/marketdataapis",
      "https://developers.iiflcapital.com/apidocs/annexure",
      "https://github.com/IIFLCapital/IIFL-Markets-Open-API-Postman-Collection-Official-",
      "https://api.iiflcapital.com/v1/contractfiles/INDICES.csv",
    ],
    notes: "Generated by generate-fixtures.mjs from the official doc samples and field tables (dummy ids). Every data fixture carries the getusersession exchange so each capability can run on its own. Historical: the docs give only the candle field table; the envelope is assumed (needs live verification).",
  },
  testConnection: {
    responses: [session, { method: "GET", url: `${API}/profile`, json: ok({ clientId: "3******4", clientName: "Test User", isTotpEnabled: "Y", isPoaProvided: "Y", accountStatus: "Na", exchanges: ["BSECURR", "BSEEQ", "BSEFO", "NSECURR", "NSEEQ", "NSEFO"], products: ["NORMAL", "INTRADAY", "DELIVERY", "BNPL"], orderComplexity: ["REGULAR", "AMO", "BO", "CO"], email: "te**********@example.com", phoneNumber: "8********4" }) }],
    expect: { status: "success" },
  },
  instruments: { responses: files, expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
  expiries: { responses: files, expect: { minRows: 2 } },
  optionChain: {
    responses: [
      session, ...files,
      {
        method: "POST", url: `${API}/marketdata/marketquotes`,
        expectBody: [{ exchange: "NSEEQ", instrumentId: "999920000" }, { exchange: "NSEFO", instrumentId: "35008" }],
        json: ok([
          quote("NSEEQ", 999920000, 25041.7),
          quote("NSEFO", 35008, 182.4), quote("NSEFO", 35009, 139.1), quote("NSEFO", 35010, 154.6), quote("NSEFO", 35011, 161.3),
        ]),
      },
      oi("35008", 412300), oi("35009", 388150), oi("35010", 201775), oi("35011", 99820),
    ],
    expect: { minStrikes: 2 },
  },
  ltp: {
    responses: [session, ...files, { method: "POST", url: `${API}/marketdata/marketquotes`, expectBody: [{ exchange: "NSEEQ", instrumentId: "999920000" }], json: ok([quote("NSEEQ", 999920000, 25041.7)]) }],
  },
  quotes: {
    args: [[{ token: "1594", exchange: "NSE" }, { token: "51440", exchange: "NFO" }]],
    responses: [session, {
      method: "POST", url: `${API}/marketdata/marketquotes`, expectBody: [{ exchange: "NSEEQ", instrumentId: "1594" }, { exchange: "NSEFO", instrumentId: "51440" }],
      json: ok([quote("NSEEQ", 1594, 1412.95), quote("NSEFO", 51440, 212.35, { bestAskPrice: undefined, besAskPrice: 212.4 })]),
    }],
    expect: { minRows: 2 },
  },
  depth: {
    args: [{ token: "35008", exchange: "NFO" }],
    responses: [session, {
      method: "POST", url: `${API}/marketdata/marketdepth`, expectBody: { exchange: "NSEFO", instrumentId: "35008" },
      json: ok({ exchange: "NSEFO", instrumentId: 35008, totalBidQuantity: 404715, totalAskQuantity: 216809, marketDepth: {
        bids: [{ price: 182.35, quantity: 650, orders: 3 }, { price: 182.3, quantity: 1300, orders: 5 }, { price: 0, quantity: 0, orders: 0 }],
        asks: [{ price: 182.45, quantity: 325, orders: 2 }, { price: 182.5, quantity: 975, orders: 4 }],
      } }),
    }],
  },
  historical: {
    args: [{ instrument: { token: "1594", exchange: "NSE" }, interval: "1m", from: "2024-09-19", to: "2024-09-20" }],
    responses: [session, {
      method: "POST", url: `${API}/marketdata/historicaldata`, expectBody: { exchange: "NSEEQ", instrumentId: "1594", interval: "1 minute", fromDate: "19-Sep-2024", toDate: "20-Sep-2024" },
      json: ok([
        { initialTimestamp: "19-Sep-2024 09:17:00", open: 295.2, high: 295.6, low: 292.7, close: 294.45, volume: 9149737 },
        { initialTimestamp: "19-Sep-2024 09:18:00", open: 294.45, high: 294.9, low: 293.8, close: 294.1, volume: 512300 },
        { initialTimestamp: "19-Sep-2024 09:19:00", open: 294.1, high: 294.3, low: 293.5, close: 293.9, volume: 401120 },
      ]),
    }],
    expect: { minRows: 3 },
  },
  positions: {
    responses: [session, { method: "GET", url: `${API}/positions`, json: ok([
      { instrumentId: "35382", tradingSymbol: "NIFTY26OCTFUT", formattedInstrumentName: "NIFTY 27 Oct 2026", exchange: "NSEFO", product: "NORMAL", realizedPnl: 1000, netQuantity: 65, netAveragePrice: "25010.5", overnightQuantity: 0, overnightPrice: "0", buyQuantity: 65, buyPrice: 25010.5, sellQuantity: 0, sellPrice: 0, dayBuyQuantity: "65", dayBuyPrice: 25010.5, dayBuyValue: "1625682.50", daySellQuantity: "0", daySellPrice: "0.00", daySellValue: "0.00", multiplier: "1", lotSize: "65", tickSize: "0.10", previousDayClose: "24987.85" },
      { instrumentId: "1594", tradingSymbol: "INFY-EQ", formattedInstrumentName: "INFOSYS LIMITED", exchange: "NSEEQ", product: "INTRADAY", realizedPnl: -12.5, netQuantity: 0, netAveragePrice: "0", buyQuantity: 5, buyPrice: 1410, sellQuantity: 5, sellPrice: 1407.5, multiplier: "1", lotSize: "1", tickSize: "0.10", previousDayClose: "1389.65" },
    ]) }],
    expect: { minRows: 2 },
  },
  holdings: {
    responses: [session, { method: "GET", url: `${API}/holdings`, json: ok([{ isin: "INE002A01018", nseInstrumentId: "2885", bseInstrumentId: "500325", nseTradingSymbol: "RELIANCE-EQ", bseTradingSymbol: "RELIANCE", formattedInstrumentName: "RELIANCE INDUSTRIES LTD.", product: "DELIVERY", totalQuantity: 300, dpQuantity: 300, collateralQuantity: 0, t1Quantity: 0, authorizedQuantity: "0", averageTradedPrice: "2800.00", previousDayClose: null }]) }],
    expect: { minRows: 1 },
  },
  funds: {
    responses: [session, { method: "GET", url: `${API}/limits`, json: ok({ tradingLimit: 19990000, openingCashLimit: 0, intradayPayin: 20000000, collateralMargin: 0, creditForSell: 0, adhocMargin: 0, utilizedMargin: 0, blockedForPayout: 10000, utilizedSpanMargin: 0, utilizedExposureMargin: 0 }) }],
  },
  orderBook: {
    responses: [session, { method: "GET", url: `${API}/orders`, json: [
      orderRow(),
      orderRow({ brokerOrderId: "240807000000068", exchangeOrderId: "9000000000000000000", orderStatus: "rejected", formattedInstrumentName: "IDEA VODAFONE LIMITED", tradingSymbol: "IDEA-EQ", instrumentId: "14366", product: "NORMAL", orderType: "MARKET", price: "0", rejectionReason: "RMS:Margin Exceeds,****duct", pendingQuantity: "0" }),
      orderRow({ brokerOrderId: "261016000000201", orderStatus: "Open", tradingSymbol: "NIFTY26OCT25000CE", instrumentId: "51440", exchange: "NSEFO", transactionType: "SELL", quantity: "130", product: "NORMAL", price: "95.0", pendingQuantity: "65", filledQuantity: "65", averageTradedPrice: "95.0" }),
    ] }],
    expect: { minRows: 3 },
  },
  tradeBook: {
    responses: [session, { method: "GET", url: `${API}/trades`, json: [{ clientId: "31625881", placedBy: "31625881", brokerOrderId: "240807000000068", exchangeOrderId: "900000000000000", exchangeTradeId: "893487609000000", formattedInstrumentName: "IDEA VODAFONE", tradingSymbol: "IDEA-EQ", instrumentId: "14366", exchange: "NSEEQ", transactionType: "BUY", product: "NORMAL", orderComplexity: "REGULAR", orderType: "MARKET", validity: "DAY", tradedPrice: "15.60", filledQuantity: "50", fillTimestamp: "07-Aug-2024 16:14:17", algoId: "algo123", orderTag: "123abc" }] }],
    expect: { minRows: 1 },
  },
  placeOrder: {
    args: [{ tradingSymbol: "NIFTY26OCT25000CE", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 2, price: 95 }, 65],
    responses: [session, ...files, {
      method: "POST", url: `${API}/orders`,
      expectBody: [{ instrumentId: "51440", exchange: "NSEFO", transactionType: "BUY", quantity: "130", orderComplexity: "REGULAR", product: "NORMAL", orderType: "LIMIT", validity: "DAY", price: "95" }],
      json: ok([{ status: "Success", message: "Success", brokerOrderId: "240919000000041", requestTime: "19-Sep-2024 18:48:46" }]),
    }],
  },
  modifyOrder: {
    args: ["240919000000041", { price: 96.5 }],
    responses: [session, { method: "PUT", url: `${API}/orders/240919000000041`, expectBody: { price: "96.5" }, json: ok({ status: "Success", message: "Success", brokerOrderId: "240919000000041", requestTime: "19-Sep-2024 18:48:46" }) }],
  },
  cancelOrder: {
    args: ["240919000000041"],
    responses: [session, { method: "DELETE", url: `${API}/orders/240919000000041`, json: ok({ status: "Success", message: "Success", brokerOrderId: "240919000000041", requestTime: "19-Sep-2024 18:48:46" }) }],
  },
};

for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
console.log(`wrote ${Object.keys(fixtures).length} IIFL Capital fixtures`);
