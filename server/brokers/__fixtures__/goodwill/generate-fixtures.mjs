/**
 * Writes the Goodwill contract fixtures. Run: node server/brokers/__fixtures__/goodwill/generate-fixtures.mjs
 *
 * Payloads follow the response examples on https://developer.gwcindia.in/api/* and the official Postman
 * collection (same envelopes and field names), moved onto October/November 2026 NIFTY and RELIANCE contracts.
 * The masters use the published Noren column layout of https://giga.gwcindia.in/<SEG>_symbols.txt.zip. The
 * harness can only replay text bodies, so each master ZIP is a valid STORED archive with a correct CRC-32 whose
 * bytes are all 7-bit (padded with newlines until they are). Tokens, order numbers and keys are dummy values.
 * No live call was used.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.gwcindia.in/v1";
const creds = { clientId: "GQ1A0007", apiKey: "dummyGwApiKey456", apiSecret: "dummyGwSecret789", requestToken: "5ca9e0b42c4e94759030e850" };

/** A single-entry stored ZIP whose bytes are all below 0x80, returned as a latin1 string. */
function sevenBitZip(name, content) {
  for (let pad = 0; pad < 4096; pad++) {
    const data = Buffer.from(content + "\n".repeat(pad), "latin1");
    const nameBuf = Buffer.from(name, "latin1");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(0, 42);
    const cdOffset = local.length + nameBuf.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
    if (zip.every((b) => b < 0x80)) return zip.toString("latin1");
  }
  throw new Error(`could not build a 7-bit zip for ${name}`);
}

const NSE = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize,",
  "NSE,26000,1,Nifty 50,NIFTY INDEX,INDEX,0,",
  "NSE,26009,1,Nifty Bank,NIFTY BANK,INDEX,0,",
  "NSE,2885,1,RELIANCE,RELIANCE-EQ,EQ,0.1,",
  "NSE,11915,1,YESBANK,YESBANK-EQ,EQ,0.01,",
  "NSE,14366,1,IDEA,IDEA-EQ,EQ,0.01,",
].join("\n") + "\n";
const o = (token, lot, sym, tsym, exp, inst, ot, strike) => `NFO,${token},${lot},${sym},${tsym},${exp},${inst},${ot},${strike},0.05,`;
const NFO = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize,",
  o(51440, 65, "NIFTY", "NIFTY27OCT26C25000", "27-OCT-2026", "OPTIDX", "CE", 25000),
  o(51441, 65, "NIFTY", "NIFTY27OCT26P25000", "27-OCT-2026", "OPTIDX", "PE", 25000),
  o(35008, 65, "NIFTY", "NIFTY03NOV26C25000", "03-NOV-2026", "OPTIDX", "CE", 25000),
  o(35009, 65, "NIFTY", "NIFTY03NOV26P25000", "03-NOV-2026", "OPTIDX", "PE", 25000),
  o(35010, 65, "NIFTY", "NIFTY03NOV26C25050", "03-NOV-2026", "OPTIDX", "CE", 25050),
  o(35011, 65, "NIFTY", "NIFTY03NOV26P25050", "03-NOV-2026", "OPTIDX", "PE", 25050),
  "NFO,48704,65,NIFTY,NIFTY27OCT26F,27-OCT-2026,FUTIDX,XX,0,0.05,",
  o(35000, 35, "BANKNIFTY", "BANKNIFTY27OCT26C56000", "27-OCT-2026", "OPTIDX", "CE", 56000),
  o(36001, 60, "FINNIFTY", "FINNIFTY27OCT26C25000", "27-OCT-2026", "OPTIDX", "CE", 25000),
  o(64065, 120, "MIDCPNIFTY", "MIDCPNIFTY27OCT26P13000", "27-OCT-2026", "OPTIDX", "PE", 13000),
  o(37001, 25, "NIFTYNXT50", "NIFTYNXT5027OCT26C70000", "27-OCT-2026", "OPTIDX", "CE", 70000),
  o(36342, 500, "RELIANCE", "RELIANCE27OCT26C1400", "27-OCT-2026", "OPTSTK", "CE", 1400),
  o(36343, 500, "RELIANCE", "RELIANCE27OCT26P1400", "27-OCT-2026", "OPTSTK", "PE", 1400),
].join("\n") + "\n";
const masters = [
  { method: "GET", url: "https://giga.gwcindia.in/NSE_symbols.txt.zip", text: sevenBitZip("NSE_symbols.txt", NSE), headers: { "content-type": "application/zip" } },
  { method: "GET", url: "https://giga.gwcindia.in/NFO_symbols.txt.zip", text: sevenBitZip("NFO_symbols.txt", NFO), headers: { "content-type": "application/zip" } },
];
const nfo = masters[1];

const session = {
  method: "POST", url: `${API}/login-response`,
  expectBody: { api_key: creds.apiKey, request_token: creds.requestToken, signature: createHash("sha256").update(`${creds.apiKey}${creds.requestToken}${creds.apiSecret}`).digest("hex") },
  json: {
    status: "success",
    data: {
      clnt_id: "GQ1A0007", name: "TEST USER", email: "TEST@EXAMPLE.COM", exarr: ["BSE", "NFO", "NSE", "MCX", "ICEX"], prarr: ["BO", "CNC", "CO", "MIS", "NRML"], orarr: ["L", "MKT", "SL", "SL-M"],
      exchDetail: { EQUITY: [{ product: ["BO", "CNC", "CO", "MIS", "NRML"], exchseg: "nse_cm", exch: "NSE" }], DERIVATIVE: [{ product: ["BO", "CO", "MIS", "NRML"], exchseg: "nse_fo", exch: "NFO" }] },
      usersessionid: "3279379865", access_token: "8a5e32e1126025fefbcefc88eb6eb9a9",
    },
  },
};
const quote = (exchange, token, sym, tsym, price, extra = {}) => ({
  method: "POST", url: `${API}/getquote`, expectBody: { exchange, token: String(token) },
  json: { status: "success", data: {
    symbol_name: sym, trading_symbl: tsym, token: String(token), company_name: sym, last_trade_time: "13:18:29", last_price: String(price), change: "0.0", change_per: "0.0",
    last_quantity: "1", buy_quantity: "37308286", sell_quantity: "26519029", volume: "119231", average_price: String(price), open: String(price - 2), high: String(price + 5),
    low: String(price - 6), close: String(price - 1), tick_size: "0.05", multiplier: "1", lot_size: "65", decimalprecision: "2", yearly_low_price: "12.10", yearly_high_price: "24.75", ...extra,
  } },
});
const spot = quote("NSE", 26000, "Nifty 50", "NIFTY INDEX", 25012.35, { lot_size: "1" });

const orderRow = {
  exchange: "NFO", token: "35008", tsym: "NIFTY03NOV26C25000", product: "NRML", pricetype: "L", validity: "DAY", price: "120.00", trgprc: "", qty: "65", dscqty: "0", trantype: "B",
  avgprc: "", fillshares: "0", remarks: "", exchordid: "1100000017705694", syomorderid: "", nstordno: "23031400017243", orderentrytime: "13:10:32 19-10-2026",
  exchconfrmtime: "19-10-2026 13:10:32", status: "open", ordvaldate: "", rejreason: "",
};

const files = {
  manifest: {
    brokerId: "goodwill",
    creds,
    symbol: "NIFTY",
    expiry: "2026-11-03",
    sources: [
      "https://developer.gwcindia.in/api/", "https://developer.gwcindia.in/api/login", "https://developer.gwcindia.in/api/profile", "https://developer.gwcindia.in/api/balance",
      "https://developer.gwcindia.in/api/position", "https://developer.gwcindia.in/api/holdings", "https://developer.gwcindia.in/api/orderBook", "https://developer.gwcindia.in/api/tradeBook",
      "https://developer.gwcindia.in/api/placeOrder", "https://developer.gwcindia.in/api/modifyOrder", "https://developer.gwcindia.in/api/cancelOrder", "https://developer.gwcindia.in/api/getQuote",
      "https://developer.gwcindia.in/api/instruments", "https://developer.gwcindia.in/api/webSocket", "https://developer.gwcindia.in/api/appendix",
    ],
    notes: "Generated by generate-fixtures.mjs from the official doc examples (dummy ids). Every data fixture also answers the login-response exchange, because the session is cached on the first call.",
  },
  testConnection: { responses: [session, { method: "GET", url: `${API}/profile`, json: { status: "success", data: { client_id: "GQ1A0007", name: "TEST USER", email: "TEST@EXAMPLE.COM", exarr: ["NSE", "NFO"], prarr: [], orarr: ["MKT", "LMT", "SL-LMT", "SL-MKT"] } } }], expect: { status: "success" } },
  instruments: { responses: masters, expect: { minRows: 12, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "RELIANCE"] } },
  expiries: { responses: [nfo], expect: { minRows: 2 } },
  optionChain: {
    responses: [session, ...masters, spot,
      quote("NFO", 35008, "NIFTY", "NIFTY03NOV26C25000", 182.4), quote("NFO", 35009, "NIFTY", "NIFTY03NOV26P25000", 160.05),
      quote("NFO", 35010, "NIFTY", "NIFTY03NOV26C25050", 155.2), quote("NFO", 35011, "NIFTY", "NIFTY03NOV26P25050", 183.9)],
    expect: { minStrikes: 2 },
  },
  ltp: { responses: [session, spot] },
  quotes: {
    args: [[{ token: "11915", exchange: "NSE" }, { token: "35008", exchange: "NFO" }]],
    responses: [session, quote("NSE", 11915, "YESBANK", "YESBANK-EQ", 15.65), quote("NFO", 35008, "NIFTY", "NIFTY03NOV26C25000", 182.4)],
    expect: { minRows: 2 },
  },
  positions: {
    responses: [session, { method: "GET", url: `${API}/positions`, json: { status: "success", data: [
      { exchange: "NSE", product: "MIS", tsym: "IDEA-EQ", token: "14366", cfbuyqty: "0", cfbuyavgprc: "", cfsellqty: "0", cfsellavgprc: "", bqty: "0", buyavgprc: "0.00", sqty: "0", sellavgprc: "0.00", netqty: "0", netbuyavgprc: "655.00", netsellavgprc: "650.00", netamt: "0", ltp: "6.60", bep: "", realisedprofitloss: "-0.75", unrealisedprofitloss: "0.00" },
      { exchange: "NFO", product: "NRML", tsym: "NIFTY03NOV26C25000", token: "35008", cfbuyqty: "0", cfbuyavgprc: "", cfsellqty: "0", cfsellavgprc: "", bqty: "0", buyavgprc: "0.00", sqty: "65", sellavgprc: "190.00", netqty: "-65", netbuyavgprc: "0.00", netsellavgprc: "190.00", netamt: "12350", ltp: "182.40", bep: "190.00", realisedprofitloss: "0.00", unrealisedprofitloss: "494.00" },
    ] } }],
    expect: { minRows: 2 },
  },
  holdings: {
    responses: [session, { method: "GET", url: `${API}/holdings`, json: { status: "success", data: [
      { exchange: "NSE", token: "11915", tsym: "YESBANK-EQ", isin: "INE528G01035", holdqty: "0", btst_qty: "1", sellable_qty: "1", average_price: "15.75", ltp: "15.55", pcode: "CNC", coll_qty: "", coll_type: "" },
    ] } }],
    expect: { minRows: 1 },
  },
  funds: {
    responses: [session, { method: "GET", url: `${API}/balance`, json: { status: "success", data: { segment: "ALL", bookedpnl: "1.45", unbookedpnl: "0", openingbalance: "2016.03", credits: "0", payinamt: "0.00", utilizedamount: "77.04", payoutamt: "0.00", varmargin: "", spanmargin: "", realisedmtom: "1.45", unrealisedmtom: "", debits: "0" } } }],
  },
  orderBook: {
    responses: [session, { method: "GET", url: `${API}/orderbook`, json: { status: "success", data: [orderRow, {
      exchange: "NSE", token: "14366", tsym: "IDEA-EQ", product: "CNC", pricetype: "MKT", validity: "DAY", price: "0.00", trgprc: "", qty: "1", dscqty: "0", trantype: "S", avgprc: "6.55",
      fillshares: "1", remarks: "", exchordid: "1100000017705695", syomorderid: "", nstordno: "23031400017244", orderentrytime: "13:10:32 14-03-2023", exchconfrmtime: "14-03-2023 13:10:32",
      status: "complete", ordvaldate: "", rejreason: "",
    }] } }],
    expect: { minRows: 2 },
  },
  tradeBook: {
    responses: [session, { method: "GET", url: `${API}/tradebook`, json: { status: "success", data: [
      { exchange: "NSE", tsym: "IDEA-EQ", product: "MIS", pricetype: "MKT", trantype: "S", qty: "1", exchordid: "1100000010905576", nstordno: "23031400011069", exchtime: "14-03-2023 11:33:50", price: "6.55" },
    ] } }],
    expect: { minRows: 1 },
  },
  placeOrder: {
    args: [{ token: "35008", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 1, price: 120 }, 65],
    responses: [session, nfo, { method: "POST", url: `${API}/placeorder`, expectBody: { tsym: "NIFTY03NOV26C25000", exchange: "NFO", trantype: "B", validity: "DAY", pricetype: "L", qty: "65", discqty: "0", price: "120", trgprc: "0", product: "NRML", amo: "NO" },
      json: { status: "success", data: { nstordno: "220104000034606" } } }],
  },
  modifyOrder: {
    args: ["23031400017243", { price: 121.5 }],
    responses: [session, { method: "GET", url: `${API}/orderbook`, json: { status: "success", data: [orderRow] } },
      { method: "POST", url: `${API}/modifyorder`, expectBody: { exchange: "NFO", tsym: "NIFTY03NOV26C25000", nstordno: "23031400017243", trantype: "B", pricetype: "L", price: "121.5", qty: "65", discqty: "0", trgprc: "0", validity: "DAY", filledqty: "0", product: "NRML" },
        json: { status: "success", data: { result: "23031400017243" } } }],
  },
  cancelOrder: {
    args: ["220106000024964"],
    responses: [session, { method: "POST", url: `${API}/cancelorder`, expectBody: { nstordno: "220106000024964" }, json: { status: "success", data: { result: "220106000024964" } } }],
  },
};

for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
console.log(`wrote ${Object.keys(files).length} fixture files to ${dir}`);
