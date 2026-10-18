/**
 * Regenerates the contract fixtures for the three Noren adapters (flattrade, shoonya, tradesmart):
 *   node server/brokers/__fixtures__/shoonya/generate-noren-fixtures.mjs
 * Not a test and never run by vitest. Payloads are transcribed from the official docs' samples
 * (Flattrade: https://pi.flattrade.in/docs; Shoonya: https://shoonya.com/api-documentation/*), trimmed,
 * with every account id, token and name replaced by a dummy value and the docs' equity examples moved
 * onto NIFTY/SENSEX/RELIANCE contracts using the documented field names. Request bodies are matched
 * exactly (expectBody.jData) so the fixtures also pin the request shape.
 *
 * Shoonya and TradeSmart publish their masters as ZIPs, and the harness can only replay text bodies. So
 * the ZIP fixtures are real, valid STORED (uncompressed) archives with a correct CRC-32, padded with
 * blank lines until every byte is 7-bit, which survives the text round trip byte for byte.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const jd = (o) => JSON.stringify(o).replace(/&/g, "\\u0026");

// ── a stored ZIP whose bytes are all < 0x80 ──
function asciiZip(name, content) {
  for (let pad = 0; pad < 4000; pad++) {
    const data = Buffer.from(content + "\n".repeat(pad), "latin1");
    const nameBuf = Buffer.from(name, "latin1");
    const crc = crc32(data) >>> 0;
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0, 6); lfh.writeUInt16LE(0, 8);
    lfh.writeUInt32LE(0, 10); lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26); lfh.writeUInt16LE(0, 28);
    const cdOffset = 30 + nameBuf.length + data.length;
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0, 8); cdh.writeUInt16LE(0, 10);
    cdh.writeUInt32LE(0, 12); cdh.writeUInt32LE(crc, 16); cdh.writeUInt32LE(data.length, 20); cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28); cdh.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + nameBuf.length, 12); eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([lfh, nameBuf, data, cdh, nameBuf, eocd]);
    if (zip.every((b) => b < 0x80)) return zip.toString("latin1");
  }
  throw new Error(`could not build a 7-bit zip for ${name}`);
}

// ── shared market fixtures ──
const UID = "FZ00000";
const EXPIRY_W = "20-OCT-2026";
const EXPIRY_M = "27-OCT-2026";
const NIFTY_LEGS = [
  { token: "40001", strike: 24950, type: "CE", lp: "141.30", oi: "1520400", poi: "1487100", v: "2310450", bp1: "141.10", sp1: "141.45" },
  { token: "40002", strike: 24950, type: "PE", lp: "78.15", oi: "2104500", poi: "2010300", v: "2988300", bp1: "78.00", sp1: "78.30" },
  { token: "40003", strike: 25000, type: "CE", lp: "104.95", oi: "3165900", poi: "2932500", v: "5430250", bp1: "104.85", sp1: "105.05" },
  { token: "40004", strike: 25000, type: "PE", lp: "92.40", oi: "2876400", poi: "2905200", v: "4876100", bp1: "92.25", sp1: "92.55" },
  { token: "40005", strike: 25050, type: "CE", lp: "74.60", oi: "1988700", poi: "1802400", v: "3120400", bp1: "74.45", sp1: "74.75" },
  { token: "40006", strike: 25050, type: "PE", lp: "112.80", oi: "1210200", poi: "1199400", v: "1650300", bp1: "112.60", sp1: "112.95" },
];
const tsymNfo = (root, exp, type, strike) => `${root}${exp.slice(0, 2)}${exp.slice(3, 6)}${exp.slice(9)}${type[0]}${strike}`;

const NFO_ROWS = [
  ...NIFTY_LEGS.map((l) => ({ ex: "NFO", token: l.token, lot: "65", sym: "NIFTY", tsym: tsymNfo("NIFTY", EXPIRY_W, l.type, l.strike), inst: "OPTIDX", exp: EXPIRY_W, strike: String(l.strike), opt: l.type })),
  { ex: "NFO", token: "40011", lot: "65", sym: "NIFTY", tsym: tsymNfo("NIFTY", EXPIRY_M, "CE", 25000), inst: "OPTIDX", exp: EXPIRY_M, strike: "25000", opt: "CE" },
  { ex: "NFO", token: "40012", lot: "65", sym: "NIFTY", tsym: tsymNfo("NIFTY", EXPIRY_M, "PE", 25000), inst: "OPTIDX", exp: EXPIRY_M, strike: "25000", opt: "PE" },
  { ex: "NFO", token: "40020", lot: "65", sym: "NIFTY", tsym: "NIFTY27OCT26F", inst: "FUTIDX", exp: EXPIRY_M, strike: "0", opt: "XX" },
  { ex: "NFO", token: "40031", lot: "30", sym: "BANKNIFTY", tsym: tsymNfo("BANKNIFTY", EXPIRY_M, "CE", 56000), inst: "OPTIDX", exp: EXPIRY_M, strike: "56000", opt: "CE" },
  { ex: "NFO", token: "40041", lot: "60", sym: "FINNIFTY", tsym: tsymNfo("FINNIFTY", EXPIRY_M, "CE", 26500), inst: "OPTIDX", exp: EXPIRY_M, strike: "26500", opt: "CE" },
  { ex: "NFO", token: "40051", lot: "120", sym: "MIDCPNIFTY", tsym: tsymNfo("MIDCPNIFTY", EXPIRY_M, "PE", 13000), inst: "OPTIDX", exp: EXPIRY_M, strike: "13000", opt: "PE" },
  { ex: "NFO", token: "40061", lot: "25", sym: "NIFTYNXT50", tsym: tsymNfo("NIFTYNXT50", EXPIRY_M, "CE", 68000), inst: "OPTIDX", exp: EXPIRY_M, strike: "68000", opt: "CE" },
];
const NFO_STOCK_ROWS = [
  { ex: "NFO", token: "106743", lot: "500", sym: "RELIANCE", tsym: tsymNfo("RELIANCE", EXPIRY_M, "CE", 1460), inst: "OPTSTK", exp: EXPIRY_M, strike: "1460", opt: "CE" },
  { ex: "NFO", token: "106744", lot: "500", sym: "RELIANCE", tsym: tsymNfo("RELIANCE", EXPIRY_M, "PE", 1460), inst: "OPTSTK", exp: EXPIRY_M, strike: "1460", opt: "PE" },
  { ex: "NFO", token: "106700", lot: "500", sym: "RELIANCE", tsym: "RELIANCE27OCT26F", inst: "FUTSTK", exp: EXPIRY_M, strike: "0", opt: "XX" },
];
const BFO_ROWS = [
  { ex: "BFO", token: "825001", lot: "20", bucket: "BSXOPT", sym: "SENSEX", tsym: "SENSEX22OCT2682000CE", inst: "OPTIDX", exp: "22-OCT-2026", strike: "82000", opt: "CE" },
  { ex: "BFO", token: "825002", lot: "20", bucket: "BSXOPT", sym: "SENSEX", tsym: "SENSEX22OCT2682000PE", inst: "OPTIDX", exp: "22-OCT-2026", strike: "82000", opt: "PE" },
  { ex: "BFO", token: "825101", lot: "30", bucket: "BKXOPT", sym: "BANKEX", tsym: "BANKEX29OCT2663000CE", inst: "OPTIDX", exp: "29-OCT-2026", strike: "63000", opt: "CE" },
  { ex: "BFO", token: "825201", lot: "60", bucket: "SX50OPT", sym: "SENSEX50", tsym: "SENSEX5022OCT2626900CE", inst: "OPTIDX", exp: "22-OCT-2026", strike: "26900", opt: "CE" },
];
const NSE_ROWS = [
  { ex: "NSE", token: "2885", lot: "1", sym: "RELIANCE", tsym: "RELIANCE-EQ", inst: "EQ" },
  { ex: "NSE", token: "22", lot: "1", sym: "ACC", tsym: "ACC-EQ", inst: "EQ" },
];

// Flattrade CSV layout (official "Scrip Master" files).
const ftDeriv = (rows) => ["Exchange,Token,Lotsize,Symbol,Tradingsymbol,Instrument,Expiry,Strike,Optiontype",
  ...rows.map((r) => [r.ex, r.token, r.lot, r.sym, r.tsym, r.inst, r.exp, r.strike, r.opt].join(","))].join("\n") + "\n";
const ftCash = (rows) => ["Exchange,Token,Lotsize,Symbol,Tradingsymbol,Instrument", ...rows.map((r) => [r.ex, r.token, r.lot, r.sym, r.tsym, r.inst].join(","))].join("\n") + "\n";
// Shoonya/TradeSmart .txt layout (trailing comma included, as in the live files).
const shDeriv = (rows) => ["Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize,",
  ...rows.map((r) => [r.ex, r.token, r.lot, r.ex === "BFO" ? r.bucket : r.sym, r.tsym, r.exp, r.inst, r.opt, r.strike, r.ex === "BFO" ? "0.05" : "0.05", ""].join(","))].join("\n") + "\n";
const shCash = (rows) => ["Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize,",
  "NSE,26000,1,NIFTY,NIFTY INDEX,INDEX,0.05,", ...rows.map((r) => [r.ex, r.token, r.lot, r.sym, r.tsym, r.inst, "0.05", ""].join(","))].join("\n") + "\n";

function quote(exch, l, extra = {}) {
  // Field names from the official GetQuotes response (Flattrade 8.2 / Shoonya market-quotes).
  return { request_time: "10:05:21 17-10-2026", stat: "Ok", exch, tsym: extra.tsym, token: l.token, pp: "2", ls: extra.ls ?? "65", ti: "0.05",
    lp: l.lp, o: extra.o ?? l.lp, h: extra.h ?? l.lp, l: extra.l ?? l.lp, c: extra.c ?? l.lp, v: l.v ?? "0", oi: l.oi, poi: l.poi,
    bp1: l.bp1, sp1: l.sp1, bq1: "650", sq1: "325" };
}
const SPOT = quote("NSE", { token: "26000", lp: "25012.15", v: "0", bp1: "0.00", sp1: "0.00" }, { tsym: "Nifty 50", ls: "1", o: "24950.10", h: "25060.35", l: "24931.80", c: "24980.55" });

// Official samples (trimmed, dummy ids).
const DOC = {
  userDetails: { request_time: "20:20:04 19-05-2020", prarr: [{ prd: "C", s_prdt_ali: "Delivery", exch: ["NSE", "BSE"] }, { prd: "I", s_prdt_ali: "Intraday", exch: ["NSE", "BSE", "NFO"] }],
    exarr: ["NSE", "NFO"], orarr: ["LMT", "SL-LMT"], brkname: "DUMMY", brnchid: "DUMMY", email: "user@example.com", actid: UID, uprev: "INVESTOR", stat: "Ok" },
  limits: { request_time: "18:07:31 29-05-2020", stat: "Ok", cash: "1500000.00", payin: "0.00", payout: "0.00", brkcollamt: "0.00", unclearedcash: "0.00", daycash: "0.00",
    turnoverlmt: "50000000.00", pendordvallmt: "20000000.00", turnover: "391500.00", pendordval: "287100.00", marginused: "394554.00", mtomcurper: "0.00", urmtom: "30540.00",
    grexpo: "391500.00", uzpnl_e_i: "15270.00", uzpnl_e_m: "61080.00", uzpnl_e_c: "-45810.00" },
  positionsFlattrade: [{ stat: "Ok", uid: UID, actid: UID, exch: "NSE", tsym: "ACC-EQ", prarr: "C", pp: "2", ls: "1", ti: "5.00", mult: "1", prcftr: "1.000000",
    daybuyqty: "2", daysellqty: "2", daybuyamt: "2610.00", daybuyavgprc: "1305.00", daysellamt: "2610.00", daysellavgprc: "1305.00", cfbuyqty: "0", cfsellqty: "0",
    cfbuyamt: "0.00", cfbuyavgprc: "0.00", cfsellamt: "0.00", cfsellavgprc: "0.00", openbuyqty: "0", opensellqty: "23", openbuyamt: "0.00", openbuyavgprc: "0.00",
    opensellamt: "30015.00", opensellavgprc: "1305.00", netqty: "0", netavgprc: "0.00", lp: "0.00", urmtom: "0.00", rpnl: "0.00", cforgavgprc: "0.00" }],
  positionsShoonya: [{ stat: "Ok", uid: UID, actid: UID, exch: "NSE", tsym: "EMIL-EQ", s_prdt_ali: "MIS", prd: "I", token: "11530", symname: "EMIL", instname: "EQ",
    cname: "ELECTRONICS MART IND LTD", frzqty: "552883", pp: "2", ls: "1", ti: "0.01", mult: "1", prcftr: "1.000000", daybuyqty: "200", daysellqty: "200",
    daybuyamt: "37060.00", daybuyavgprc: "185.30", daysellamt: "36740.00", daysellavgprc: "183.70", cfbuyqty: "0", cfsellqty: "0", netqty: "0", netavgprc: "0.00",
    upldprc: "0.00", netupldprc: "0.00", lp: "184.75", urmtom: "0.00", bep: "0.00", totbuyamt: "37060.00", totsellamt: "36740.00", totbuyavgprc: "185.30",
    totsellavgprc: "183.70", rpnl: "-320.00" }],
  holdings: [
    { stat: "Ok", exch_tsym: [{ exch: "NSE", token: "13", tsym: "ABB-EQ" }], holdqty: "20", colqty: "0", btstqty: "0", btstcolqty: "0", usedqty: "0", upldprc: "1800.00" },
    { stat: "Ok", exch_tsym: [{ exch: "NSE", token: "22", tsym: "ACC-EQ" }], holdqty: "15", colqty: "0", btstqty: "0", btstcolqty: "0", usedqty: "0", upldprc: "1400.00" },
  ],
  orderBook: [
    { stat: "Ok", exch: "NFO", tsym: "NIFTY20OCT26C25000", norenordno: "26101700000001", prc: "104.50", qty: "130", prd: "M", status: "OPEN", trantype: "B", prctyp: "LMT",
      fillshares: "65", avgprc: "104.50", exchordid: "1100000000034342", uid: UID, actid: UID, ret: "DAY", token: "40003", norentm: "09:20:11 17-10-2026" },
    { stat: "Ok", exch: "NSE", tsym: "ABB-EQ", norenordno: "26101700000002", prc: "1278.30", qty: "50", prd: "C", status: "REJECTED", trantype: "B", prctyp: "LMT",
      fillshares: "0", avgprc: "0", rejreason: "Insufficient funds", uid: UID, actid: UID, ret: "DAY", norentm: "09:21:40 17-10-2026" },
  ],
  tradeBook: [{ stat: "Ok", norenordno: "20121300065715", uid: UID, actid: UID, exch: "NSE", prctyp: "LMT", ret: "DAY", prd: "M", flid: "102", fltm: "13-12-2020 19:59:32",
    trantype: "S", tsym: "ACCELYA-EQ", qty: "180", token: "7053", fillshares: "180", flqty: "180", pp: "2", ls: "1", ti: "0.05", prc: "800.00", flprc: "800.00",
    norentm: "19:59:32 13-12-2020", exch_tm: "00:00:00 01-01-1980", remarks: "WC TEST Order", exchordid: "6857" }],
  tpseries: [
    { stat: "Ok", time: "02-06-2020 15:46:23", into: "0.00", inth: "0.00", intl: "0.00", intc: "0.00", intvwap: "0.00", intv: "0", intoi: "0", v: "980515", oi: "128702" },
    { stat: "Ok", time: "02-06-2020 15:44:23", into: "1286.50", inth: "1288.00", intl: "1286.00", intc: "1287.50", intvwap: "1287.10", intv: "6", intoi: "0", v: "980515", oi: "128702" },
    { stat: "Ok", time: "02-06-2020 15:43:23", into: "1287.00", inth: "1287.00", intl: "0.00", intc: "1287.00", intvwap: "128702.00", intv: "4", intoi: "128702", v: "980511", oi: "128702" },
  ],
  depthQuote: { request_time: "12:05:21 18-05-2021", stat: "Ok", exch: "NSE", tsym: "ACC-EQ", cname: "ACC LIMITED", symname: "ACC", seg: "EQT", instname: "EQ",
    isin: "INE012A01025", pp: "2", ls: "1", ti: "0.05", mult: "1", uc: "2093.95", lc: "1713.25", token: "22", lp: "1902.35", h: "1910.00", l: "1890.10", v: "182400",
    bp1: "1902.30", sp1: "1902.45", bp2: "1902.25", sp2: "1902.50", bp3: "1902.20", sp3: "1902.55", bp4: "0.00", sp4: "0.00", bp5: "0.00", sp5: "0.00",
    bq1: "12", sq1: "30", bq2: "8", sq2: "5", bq3: "40", sq3: "9", bq4: "0", sq4: "0", bq5: "0", sq5: "0", bo1: "2", so1: "3", bo2: "1", so2: "1", bo3: "4", so3: "2", bo4: "0", so4: "0", bo5: "0", So5: "0" },
  placeOk: { request_time: "10:48:03 17-10-2026", stat: "Ok", norenordno: "26101700000017" },
  modifyOk: { request_time: "14:14:08 17-10-2026", stat: "Ok", result: "26101700000017" },
  cancelOk: { request_time: "14:14:10 17-10-2026", stat: "Ok", result: "26101700000017" },
};

const ORDER = { tradingSymbol: "NIFTY20OCT26C25000", exchange: "NFO", transactionType: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 2, price: 104.5, correlationId: "mrc-0001" };
const PLACE_BODY = { uid: UID, actid: UID, exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", dscqty: "0", prc: "104.5", prd: "M", trantype: "B", prctyp: "LMT", ret: "DAY", ordersource: "API", remarks: "mrc-0001" };
const MODIFY_CHANGES = { exchange: "NFO", tradingSymbol: "NIFTY20OCT26C25000", quantity: 130, price: 105, orderType: "LIMIT", validity: "DAY" };
const MODIFY_BODY = { uid: UID, norenordno: "26101700000017", exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", prc: "105", prctyp: "LMT", ret: "DAY", ordersource: "API" };

// ── per-broker specs ──
const BROKERS = {
  flattrade: {
    uidField: "clientId", base: "https://piconnect.flattrade.in/PiConnectAPI", token: "GHUDWU53H32MTHPA536Q32WR",
    creds: { clientId: UID, apiKey: "dummyApiKey", apiSecret: "dummyApiSecret", requestCode: "dummyRequestCode" },
    auth: (c) => ({ method: "POST", url: "https://authapi.flattrade.in/trade/apitoken",
      expectBody: { api_key: c.apiKey, request_code: c.requestCode, api_secret: sha(`${c.apiKey}${c.requestCode}${c.apiSecret}`) },
      json: { token: "GHUDWU53H32MTHPA536Q32WR", client: UID, status: "Ok", emsg: "" } }),
    body: (data, token) => ({ jData: jd(data), jKey: token }),
    masters: () => [
      { method: "GET", url: "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/Nfo_Index_Derivatives.csv", text: ftDeriv(NFO_ROWS), headers: { "content-type": "text/csv" } },
      { method: "GET", url: "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/Nfo_Equity_Derivatives.csv", text: ftDeriv(NFO_STOCK_ROWS), headers: { "content-type": "text/csv" } },
      { method: "GET", url: "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/Bfo_Index_Derivatives.csv", text: ftDeriv(BFO_ROWS), headers: { "content-type": "text/csv" } },
      { method: "GET", url: "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/NSE_Equity.csv", text: ftCash(NSE_ROWS), headers: { "content-type": "text/csv" } },
    ],
    connection: ["/UserDetails", { uid: UID }, DOC.userDetails],
    positions: DOC.positionsFlattrade,
    sources: [
      "https://pi.flattrade.in/docs (v2.0, 31 Mar 2026): Login Flow, 1.1 Place Order, 1.2 Modify Order, 1.3 Cancel Order, 1.7 Order Book, 1.10 Trade Book, 1.11 Position Book, 2.1 Holdings, 2.2 Limits, 3.1 Get Index List, 3.4 Get Time Price Data, 3.5 Get EOD Chart data, 6 Web Socket API, 7.1 User Details, 8.2 Get Quotes, 10 Scrip Master, 11/12 Rate Limits",
      "https://flattrade.s3.ap-south-1.amazonaws.com/scripmaster/Nfo_Index_Derivatives.csv",
    ],
  },
  shoonya: {
    uidField: "userId", base: "https://api.shoonya.com/NorenWClientAPI", token: "dummyShoonyaAccessToken",
    creds: { userId: UID, apiKey: "dummyClientId", apiSecret: "dummySecretKey", requestCode: "dummyAuthCode" },
    auth: (c) => ({ method: "POST", url: "https://api.shoonya.com/NorenWClientAPI/GenAcsTok",
      expectBody: { jData: jd({ code: c.requestCode, checksum: sha(`${c.apiKey}${c.apiSecret}${c.requestCode}`) }) },
      json: { stat: "Ok", susertoken: "dummyShoonyaAccessToken", uid: UID, actid: UID } }),
    body: (data) => ({ jData: jd(data) }),
    masters: () => [
      { method: "GET", url: "https://api.shoonya.com/NFO_symbols.txt.zip", text: asciiZip("NFO_symbols.txt", shDeriv([...NFO_ROWS, ...NFO_STOCK_ROWS])), headers: { "content-type": "application/zip" } },
      { method: "GET", url: "https://api.shoonya.com/BFO_symbols.txt.zip", text: asciiZip("BFO_symbols.txt", shDeriv(BFO_ROWS)), headers: { "content-type": "application/zip" } },
      { method: "GET", url: "https://api.shoonya.com/NSE_symbols.txt.zip", text: asciiZip("NSE_symbols.txt", shCash(NSE_ROWS)), headers: { "content-type": "application/zip" } },
    ],
    connection: ["/Limits", { uid: UID, actid: UID }, DOC.limits],
    positions: DOC.positionsShoonya,
    sources: [
      "https://shoonya.com/api-documentation/manual-authentication-oauth",
      "https://shoonya.com/api-documentation/api-structure",
      "https://shoonya.com/api-documentation/error-handling",
      "https://shoonya.com/api-documentation/rate-limits",
      "https://shoonya.com/api-documentation/place-order",
      "https://shoonya.com/api-documentation/modify-order",
      "https://shoonya.com/api-documentation/cancel-order",
      "https://shoonya.com/api-documentation/order-book",
      "https://shoonya.com/api-documentation/trade-book",
      "https://shoonya.com/api-documentation/positions",
      "https://shoonya.com/api-documentation/holdings",
      "https://shoonya.com/api-documentation/funds-limits",
      "https://shoonya.com/api-documentation/market-quotes",
      "https://shoonya.com/api-documentation/time-price-series",
      "https://shoonya.com/api-documentation/historical-data",
      "https://shoonya.com/api-documentation/websocket-overview",
      "https://shoonya.com/api-documentation/subscribe-market-feed",
      "https://shoonya.com/api-documentation/symbol-master",
      "https://shoonya.com/api-documentation/exchange-segment-codes",
      "https://shoonya.com/api-documentation/product-type-codes",
    ],
  },
  tradesmart: {
    uidField: "clientId", base: "https://v2api.tradesmartonline.in/NorenWClientAPIv2", token: "dummyTradesmartAccessToken",
    creds: { clientId: UID, apiKey: "dummyAppKey", apiSecret: "dummySecretKey", requestCode: "dummyAuthCode" },
    auth: (c) => ({ method: "POST", url: "https://v2api.tradesmartonline.in/NorenWClientAPIv2/GenAcsTok",
      expectBody: { jData: jd({ code: c.requestCode, checksum: sha(`${c.apiKey}${c.apiSecret}${c.requestCode}`) }) },
      json: { stat: "Ok", access_token: "dummyTradesmartAccessToken", actid: UID, expires_in: 28800 } }),
    body: (data) => ({ jData: jd(data) }),
    masters: () => [
      { method: "GET", url: "https://v2api.tradesmartonline.in/NFO_symbols.txt.zip", text: asciiZip("NFO_symbols.txt", shDeriv([...NFO_ROWS, ...NFO_STOCK_ROWS])), headers: { "content-type": "application/zip" } },
      { method: "GET", url: "https://v2api.tradesmartonline.in/BFO_symbols.txt.zip", text: asciiZip("BFO_symbols.txt", shDeriv(BFO_ROWS)), headers: { "content-type": "application/zip" } },
      { method: "GET", url: "https://v2api.tradesmartonline.in/NSE_symbols.txt.zip", text: asciiZip("NSE_symbols.txt", shCash(NSE_ROWS)), headers: { "content-type": "application/zip" } },
    ],
    connection: ["/Limits", { uid: UID, actid: UID }, DOC.limits],
    positions: DOC.positionsShoonya,
    sources: [
      "https://apidocs.tradesmartonline.in/v2/ (official; blocked by a Cloudflare challenge during this work, HTTP 403 — not re-read)",
      "https://pypi.org/project/NorenRestApiOAuth/ (Kambala's Noren OAuth SDK: GenAcsTok fields, Bearer + jData transport)",
      "https://shoonya.com/api-documentation/api-structure (same Noren OAuth contract; payload field names)",
      "https://pi.flattrade.in/docs (Noren payload samples)",
    ],
  },
};

function build(id, b) {
  const dir = join(ROOT, id);
  mkdirSync(dir, { recursive: true });
  const post = (endpoint, data, json) => ({ method: "POST", url: `${b.base}${endpoint}`, expectBody: b.body(data, b.token), json });
  const auth = b.auth(b.creds);
  const q = (exch, token) => ({ uid: UID, exch, token });
  const legQuotes = NIFTY_LEGS.map((l) => post("/GetQuotes", q("NFO", l.token), quote("NFO", l, { tsym: tsymNfo("NIFTY", EXPIRY_W, l.type, l.strike) })));
  const spot = post("/GetQuotes", q("NSE", "26000"), SPOT);
  const masters = b.masters();
  const files = {
    manifest: {
      brokerId: id, creds: b.creds, symbol: "NIFTY", expiry: "2026-10-20", sources: b.sources,
      notes: "Generated by __fixtures__/shoonya/generate-noren-fixtures.mjs from the official doc samples (trimmed; dummy ids). The docs' equity examples were moved onto NIFTY (20 Oct 2026 weekly, 27 Oct monthly), SENSEX (22 Oct weekly), BANKEX and RELIANCE contracts with the documented field names. Every capability file also answers the one-time code exchange, because the session is cached on the first call. Master ZIPs are valid stored archives padded to 7-bit so they replay as text.",
    },
    testConnection: { responses: [auth, post(b.connection[0], b.connection[1], b.connection[2])], expect: { status: "success" } },
    instruments: { responses: [auth, ...masters], expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
    expiries: { responses: [auth, ...masters], expect: { minRows: 2 } },
    optionChain: { responses: [auth, ...masters, spot, ...legQuotes], expect: { minStrikes: 3 } },
    ltp: { responses: [auth, ...masters, spot] },
    quotes: { args: [[{ token: "40003", exchange: "NFO" }, { token: "26000", exchange: "NSE" }]], responses: [auth, legQuotes[2], spot], expect: { minRows: 2 } },
    depth: { args: [{ token: "22", exchange: "NSE" }], responses: [auth, post("/GetQuotes", q("NSE", "22"), DOC.depthQuote)] },
    historical: {
      args: [{ instrument: { token: "22", exchange: "NSE" }, interval: "1m", from: "2020-06-02", to: "2020-06-02" }],
      responses: [auth, post("/TPSeries", { uid: UID, exch: "NSE", token: "22", st: "1591036200", et: "1591122599", intrv: "1" }, DOC.tpseries)],
      expect: { minRows: 2 },
    },
    positions: { responses: [auth, post("/PositionBook", { uid: UID, actid: UID }, b.positions)], expect: { minRows: 1 } },
    holdings: { responses: [auth, post("/Holdings", { uid: UID, actid: UID, prd: "C" }, DOC.holdings)], expect: { minRows: 2 } },
    funds: { responses: [auth, post("/Limits", { uid: UID, actid: UID }, DOC.limits)] },
    orderBook: { responses: [auth, post("/OrderBook", { uid: UID }, DOC.orderBook)], expect: { minRows: 2 } },
    tradeBook: { responses: [auth, post("/TradeBook", { uid: UID, actid: UID }, DOC.tradeBook)], expect: { minRows: 1 } },
    placeOrder: { args: [ORDER, 65], responses: [auth, post("/PlaceOrder", PLACE_BODY, DOC.placeOk)] },
    modifyOrder: { args: ["26101700000017", MODIFY_CHANGES], responses: [auth, post("/ModifyOrder", MODIFY_BODY, DOC.modifyOk)] },
    cancelOrder: { args: ["26101700000017"], responses: [auth, post("/CancelOrder", { uid: UID, norenordno: "26101700000017" }, DOC.cancelOk)] },
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(content, null, 2) + "\n");
}

for (const [id, b] of Object.entries(BROKERS)) build(id, b);
console.log("Noren fixtures written for", Object.keys(BROKERS).join(", "));
