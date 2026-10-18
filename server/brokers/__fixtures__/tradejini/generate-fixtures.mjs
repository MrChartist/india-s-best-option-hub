// Run: node server/brokers/__fixtures__/tradejini/generate-fixtures.mjs  (rewrites the JSON fixtures in this folder; no network).
// Writes server/brokers/__fixtures__/tradejini/*.json. Field names from the official docs (developer.tradejini.com),
// CSV headers from the live scrip master (2026-10); every value is a dummy.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
const dir = process.argv[2] || new URL(".", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const B = "https://api.tradejini.com/v2";
const D = "https://developer.tradejini.com/docs";
const SRC = [`${D}/api-basics`, `${D}/authorization/updatedIndividualToken`, `${D}/account/getUserDetails`, `${D}/symbol-details/versionDetails`, `${D}/symbol-details/getSymbolDetails`,
  `${D}/funds/retrieveFundsLimits`, `${D}/orders/getOrders`, `${D}/orders/placeOrder`, `${D}/orders/modifyOrder`, `${D}/orders/cancelOrder`, `${D}/orders/getTrades`, `${D}/orders/getPositions`,
  `${D}/orders/getHoldings`, `${D}/chart-data/getIntervalChartData`, `${D}/websocket-sdks`, `${D}/rate-limits`];
const groups = { method: "GET", url: `${B}/api/mkt-data/scrips/symbol-store?version=0`, status: 200, json: { s: "ok", d: { version: 1741, updated: true, symbolStore: [
  { name: "Securities", idFormat: "instrument_symbol_series_exchange", sortOrder: 1 }, { name: "FutureContracts", idFormat: "instrument_symbol_exchange_expiry", sortOrder: 3 },
  { name: "NSEOptions", idFormat: "instrument_symbol_exchange_expiry_strike_optType", sortOrder: 4 }, { name: "BSEOptions", idFormat: "instrument_symbol_exchange_expiry_strike_optType", sortOrder: 5 },
  { name: "Index", idFormat: "instrument_excToken_exchange", sortOrder: 10 } ] } } };
const OPT_H = "id,dispName,excToken,lot,tick,asset,freezeQty,weekly,undId";
const csv = (g, text) => ({ method: "GET", url: `${B}/api/mkt-data/scrips/symbol-store/${g}`, status: 200, text, headers: { "content-type": "text/plain" } });
const master = [groups,
  csv("Securities", ["id,dispName,excToken,lot,tick,asset,freezeQty,isin,desc", "EQT_RELIANCE_EQ_NSE,RELIANCE,2885,1,0.1,equity,81195,INE002A01018,RELIANCE INDUSTRIES LTD", "EQT_RELIANCE_A_BSE,RELIANCE,500325,1,0.05,equity,,INE002A01018,RELIANCE INDUSTRIES LTD."].join("\n")),
  csv("FutureContracts", [OPT_H, "FUTIDX_NIFTY_NFO_2026-10-27,NIFTY 27OCT FUT,48704,65,0.1,future,3510,,IDX_-1_NSE", "FUTSTK_RELIANCE_NFO_2026-10-27,RELIANCE 27OCT FUT,48710,500,0.1,future,20000,,EQT_RELIANCE_EQ_NSE"].join("\n")),
  csv("NSEOptions", [OPT_H,
    "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE,NIFTY 20OCT 25000 CE,47029,65,0.05,option,3510,w3,IDX_-1_NSE",
    "OPTIDX_NIFTY_NFO_2026-10-20_25000_PE,NIFTY 20OCT 25000 PE,47030,65,0.05,option,3510,w3,IDX_-1_NSE",
    "OPTIDX_NIFTY_NFO_2026-10-20_25100_CE,NIFTY 20OCT 25100 CE,47031,65,0.05,option,3510,w3,IDX_-1_NSE",
    "OPTIDX_NIFTY_NFO_2026-10-20_25100_PE,NIFTY 20OCT 25100 PE,47032,65,0.05,option,3510,w3,IDX_-1_NSE",
    "OPTIDX_NIFTY_NFO_2026-10-27_25000_CE,NIFTY 27OCT 25000 CE,47101,65,0.05,option,3510,,IDX_-1_NSE",
    "OPTIDX_NIFTY_NFO_2026-10-27_25000_PE,NIFTY 27OCT 25000 PE,47102,65,0.05,option,3510,,IDX_-1_NSE",
    "OPTIDX_BANKNIFTY_NFO_2026-10-27_56000_CE,BANKNIFTY 27OCT 56000 CE,47201,30,0.05,option,900,,IDX_-20_NSE",
    "OPTIDX_FINNIFTY_NFO_2026-10-27_26000_PE,FINNIFTY 27OCT 26000 PE,47301,60,0.05,option,1800,,IDX_-21_NSE",
    "OPTIDX_MIDCPNIFTY_NFO_2026-10-27_13000_CE,MIDCPNIFTY 27OCT 13000 CE,47401,120,0.05,option,2800,,IDX_-18_NSE",
    "OPTIDX_NIFTYNXT50_NFO_2026-10-27_70000_CE,NIFTYNXT50 27OCT 70000 CE,47501,25,0.05,option,600,,IDX_-90_NSE",
    "OPTSTK_RELIANCE_NFO_2026-10-27_1220_CE,RELIANCE 27OCT 1220 CE,106599,500,0.05,option,20000,,EQT_RELIANCE_EQ_NSE",
    "OPTSTK_RELIANCE_NFO_2026-10-27_1220_PE,RELIANCE 27OCT 1220 PE,106600,500,0.05,option,20000,,EQT_RELIANCE_EQ_NSE"].join("\n")),
  csv("BSEOptions", [OPT_H,
    "OPTIDX_SENSEX_BFO_2026-10-22_82000_CE,SENSEX 22OCT 82000 CE,1163531,20,0.05,option,1000,w4,IDX_-51_BSE",
    "OPTIDX_SENSEX_BFO_2026-10-22_82000_PE,SENSEX 22OCT 82000 PE,1163778,20,0.05,option,1000,w4,IDX_-51_BSE",
    "OPTIDX_BANKEX_BFO_2026-10-29_62000_CE,BANKEX 29OCT 62000 CE,1158398,30,0.05,option,900,,IDX_-94_BSE"].join("\n")),
  csv("Index", ["id,dispName,excToken,asset,symbol,availFlag", "IDX_-1_NSE,Nifty 50,-1,index,NIFTY,Y", "IDX_-20_NSE,BANKNIFTY,-20,index,BANKNIFTY,Y", "IDX_-21_NSE,FINNIFTY,-21,index,FINNIFTY,Y",
    "IDX_-18_NSE,MIDCPNIFTY,-18,index,MIDCPNIFTY,Y", "IDX_-51_BSE,SENSEX,-51,index,SENSEX,Y", "IDX_-94_BSE,BANKEX,-94,index,BANKEX,Y"].join("\n")),
];
const ok = (d) => ({ s: "ok", d });
const SESSION = { sessionToken: "dummy-access-token" };
const w = (name, obj) => writeFileSync(`${dir}/${name}.json`, JSON.stringify(name === "manifest" || name === "login" ? obj : { creds: SESSION, ...obj }, null, 2) + "\n");
const ticks = {
  "-1_NSE": { ltp: 25041.35, open: 24990, high: 25080, low: 24950.5, close: 25001.2, vol: 0 },
  "47029_NFO": { ltp: 120.5, open: 110, high: 131, low: 101, close: 116.5, vol: 1620250, OI: 1312350, prevOI: 1217525, bidPrice: 120.35, askPrice: 120.6, spotPrice: 25041.35, iv: 13.13, delta: 0.53, gamma: 0.00053, theta: -7.05, vega: 10.39 },
  "47030_NFO": { ltp: 98.1, open: 101, high: 120, low: 90, close: 104, vol: 1320250, OI: 1012350, prevOI: 1017175, bidPrice: 98.05, askPrice: 98.2, spotPrice: 25041.35, iv: 0.138, delta: -0.47, gamma: 0.00051, theta: -6.9, vega: 10.2 },
  "47031_NFO": { ltp: 70, open: 65, high: 80, low: 60, close: 66, vol: 920250, OI: 812350, prevOI: 797525, bidPrice: 69.9, askPrice: 70.1, spotPrice: 25041.35 },
  "47032_NFO": { ltp: 150, open: 160, high: 170, low: 140, close: 155, vol: 220250, OI: 612350, prevOI: 607525, bidPrice: 149.8, askPrice: 150.3, spotPrice: 25041.35, iv: 13.5, delta: -0.62, gamma: 0.0005, theta: -6.2, vega: 9.8 },
  "2885_NSE": { ltp: 1211.2, open: 1206, high: 1215, low: 1198.1, close: 1205.5, vol: 4311783, bidPrice: 1211.1, askPrice: 1211.2 },
};
w("manifest", { brokerId: "tradejini", creds: { apiKey: "dummyApiKey" }, symbol: "NIFTY", expiry: "2026-10-20", sources: SRC,
  notes: "REST field names and envelopes ({ s, d, msg }) come from the official Tradejini API reference; the reference gives schemas rather than sample bodies, so every value is a dummy. Data fixtures add a dummy sessionToken (manifest creds stay logged-out for sessionLogin.test.mjs). Scrip-master CSVs use the live files' header rows with dummy rows. streamTicks feed the fake WebSocket in tradejini.test.mjs (field names from the official WebSocket SDK docs)." });
const login = JSON.parse(readFileSync(`${dir}/login.json`, "utf-8"));
w("login", login);
w("testConnection", { responses: [{ method: "GET", url: `${B}/api/account/details`, status: 200, json: ok({ userId: "DUMMY01", userName: "DUMMY USER", mobile: "", email: "", pan: "", dpId: "", bankDetails: [], dpIds: [], products: ["delivery", "intraday", "normal"], segments: ["NSE", "BSE", "NFO", "BFO"] }) }], expect: { status: "success" } });
w("instruments", { responses: master, expect: { minRows: 10, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } });
w("expiries", { responses: master, expect: { minRows: 2 } });
w("optionChain", { responses: master, streamTicks: ticks, expect: { minStrikes: 2 } });
w("ltp", { responses: master, streamTicks: ticks });
w("quotes", { args: [[{ token: "EQT_RELIANCE_EQ_NSE", exchange: "NSE" }, { token: "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE", exchange: "NFO" }]], responses: master, streamTicks: ticks, expect: { minRows: 2 } });
const t0 = Math.round((Date.UTC(2026, 9, 16, 9, 15) - 5.5 * 3600_000) / 1000);
w("historical", { args: [{ instrument: { token: "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE", exchange: "NFO" }, interval: "1m", from: t0, to: t0 + 180 }], responses: [...master,
  { method: "GET", url: `${B}/api/mkt-data/chart/interval-data?from=${t0}&to=${t0 + 180}&interval=1&id=OPTIDX_NIFTY_NFO_2026-10-20_25000_CE`, status: 200, json: ok({ bars: [
    [t0, 110, 112.5, 109.8, 112, 65000, 1220000], [t0 + 60, 112, 114, 111.2, 113.4, 52000, 1225000], [t0 + 120, 113.4, 113.9, 111, 111.5, 47000, 1226000] ], sumUpVolume: 0 }) }], expect: { minRows: 3 } });
const sym = (id, exchange, trad, lot, instrument) => ({ id, symbol: trad.split(" ")[0], tradSymbol: trad, exchange, lot: String(lot), instrument, companyName: "", expiry: "", dispSymbol: trad, asset: instrument.startsWith("OPT") ? "option" : "equity", empty: false });
const NCE = "OPTIDX_NIFTY_NFO_2026-10-20_25000_CE";
w("positions", { responses: [{ method: "GET", url: `${B}/api/oms/positions?symDetails=true`, status: 200, json: ok([
  { symId: NCE, product: "normal", buyQty: 0, buyValue: 0, buyAvgPrice: 0, sellQty: 65, sellValue: 7800, sellAvgPrice: 120, cfQty: 0, cfValue: 0, cfAvgPrice: 0, netQty: -65, netAvgPrice: 120, netValue: 7800, realizedPnl: 0, priceFactor: 1, multiplier: 1, sym: sym(NCE, "NFO", "NIFTY 20OCT 25000 CE", 65, "OPTIDX"), dayPos: { dayQty: -65, dayAvg: 120, dayRealizedPnl: 0, dayNetValue: 7800, convertPos: true, dayPremium: 7800 }, convertPos: true, netPremium: 7800, transHistory: false, createTSL: false },
  { symId: "EQT_RELIANCE_EQ_NSE", product: "intraday", buyQty: 10, buyValue: 12000, buyAvgPrice: 1200, sellQty: 10, sellValue: 12100, sellAvgPrice: 1210, cfQty: 0, cfValue: 0, cfAvgPrice: 0, netQty: 0, netAvgPrice: 0, netValue: 0, realizedPnl: 100, priceFactor: 1, multiplier: 1, sym: sym("EQT_RELIANCE_EQ_NSE", "NSE", "RELIANCE-EQ", 1, "EQT"), convertPos: false, netPremium: 0, transHistory: false, createTSL: false } ]) }], expect: { minRows: 2 } });
w("holdings", { responses: [{ method: "GET", url: `${B}/api/oms/holdings?symDetails=true`, status: 200, json: ok({ holdings: [
  { symId: "EQT_RELIANCE_EQ_NSE", sym: sym("EQT_RELIANCE_EQ_NSE", "NSE", "RELIANCE-EQ", 1, "EQT"), qty: 3, avgPrice: 1160.15, t1Qty: 0, saleableQty: 3, pledgeQty: 0, nonPoaQty: 0, dpQty: 3, benQty: 0, unpledgedQty: 0, brokerColQty: 0, btstColqty: 0, usedQty: 0, tradedQty: 0, realizedPnl: 0, totalQty: 3, transHistory: false, dayQty: 0 } ], hasNonPoaRecord: false }) }], expect: { minRows: 1 } });
w("funds", { responses: [{ method: "GET", url: `${B}/api/oms/limits`, status: 200, json: ok({ totalCredits: 125000, availMargin: 109797.5, brokerage: 40, availCash: 100000, peakMargin: 15202.5, payIn: 0, span: 12000, realizedPnl: 100, unrealizedPnL: 0, exposure: 3202.5, adHocMargin: 0, stockCollateral: 25000, optionPremium: 0, segment: "ALL", payOut: 0, brkCollatAmount: 0, unclearedCash: 0, auxCash: 0, auxCollatAmount: 0, auxUnclearedCash: 0, dayCash: 0, turnOverLmt: 0, pendOrdValLmt: 0, turnover: 0, pendOrdValue: 0, marginUsed: 15202.5, premium: 0 }) }] });
const order = (orderId, status, type, qty, fillQty, extra = {}) => ({ symId: NCE, status, qty, side: "buy", type, validity: "day", validTill: "", source: "API", limitPrice: 118, exchOrderId: "1100000000000001", discQty: 0, product: "normal", exchTime: "16-10-2026 10:47:05", orderId, orderTime: "16-10-2026 10:47:04", avgPrice: fillQty ? 118 : 0, amo: false, fillQty, trigPrice: type === "stoplimit" ? 117 : 0, reason: "", pendingQty: status === "open" ? qty - fillQty : 0, sym: sym(NCE, "NFO", "NIFTY 20OCT 25000 CE", 65, "OPTIDX"), mktProt: 0, orderValue: qty * 118, tradeValue: fillQty * 118, modifiable: status === "open", cancellable: status === "open", exitable: false, retriable: false, orderPoll: false, ...extra });
w("orderBook", { responses: [{ method: "GET", url: `${B}/api/oms/orders?symDetails=true`, status: 200, json: ok([
  order("261016000000079", "completed", "limit", 130, 130), order("261016000000080", "open", "limit", 130, 65), order("261016000000081", "rejected", "limit", 65, 0, { reason: "RMS: Margin Exceeds" }),
  order("261016000000082", "open", "stoplimit", 65, 0), order("261016000000083", "cancelled", "limit", 65, 0) ]) }], expect: { minRows: 5 } });
w("tradeBook", { responses: [{ method: "GET", url: `${B}/api/oms/trades?symDetails=true`, status: 200, json: ok([
  { symId: NCE, side: "buy", type: "limit", validity: "day", product: "normal", orderId: "261016000000079", fillId: "195300", fillQty: 130, fillPrice: 118, fillValue: 15340, time: "16-10-2026 10:47:05", exchOrderId: "1100000000000001", avgPrice: 118, sym: sym(NCE, "NFO", "NIFTY 20OCT 25000 CE", 65, "OPTIDX"), remarks: "", legType: "", mainLegOrderId: "" } ]) }], expect: { minRows: 1 } });
w("placeOrder", { args: [{ token: NCE, exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 2, price: 118 }, 65], responses: [...master,
  { method: "POST", url: `${B}/api/oms/place-order`, expectBody: { symId: NCE, qty: "130", side: "buy", type: "limit", product: "normal", limitPrice: "118", validity: "day" }, status: 200, json: ok({ orderId: "261016000000090", msg: "Order Placed Successfully" }) }] });
w("modifyOrder", { args: ["261016000000080", { orderType: "LIMIT", qty: 130, price: 119.5, validity: "DAY" }], responses: [
  { method: "GET", url: `${B}/api/oms/orders`, status: 200, json: ok([order("261016000000080", "open", "limit", 130, 65)]) },
  { method: "PUT", url: `${B}/api/oms/modify-order`, expectBody: { symId: NCE, orderId: "261016000000080", qty: "130", type: "limit", limitPrice: "119.5", validity: "day" }, status: 200, json: ok({ orderId: "261016000000080", msg: "Order Modified Successfully" }) }] });
w("cancelOrder", { args: ["261016000000082"], responses: [
  { method: "DELETE", url: `${B}/api/oms/cancel-order?orderId=261016000000082`, status: 200, json: ok({ orderId: "261016000000082", msg: "Order Cancelled Successfully" }) }] });
console.log("ok");
