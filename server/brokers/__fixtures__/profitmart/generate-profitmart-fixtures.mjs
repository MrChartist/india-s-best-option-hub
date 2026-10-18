/**
 * Regenerates the Profitmart contract fixtures:
 *   node server/brokers/__fixtures__/profitmart/generate-profitmart-fixtures.mjs
 * Not a test and never run by vitest. Payloads are transcribed from the official ProfitMax API docs
 * (https://profitmax.profitmart.in/ApiDocs/docs/...) with every account id, token and name replaced by a
 * dummy value; the docs' equity examples are moved onto NIFTY / SENSEX / RELIANCE contracts using the
 * documented field names. The symbol-master layouts follow the live Profitmart files (BFO carries
 * CompanyName and the extra price/OI columns, and its ZIP entry is named BFO_Symbol.txt). Request bodies are
 * matched exactly (expectBody.jData), so the fixtures also pin the request shape.
 *
 * The harness can only replay text bodies, so each master ZIP is a valid STORED (uncompressed) archive with a
 * correct CRC-32, padded with blank lines until every byte is 7-bit and survives the text round trip.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

const DIR = dirname(fileURLToPath(import.meta.url));
const HOST = "https://profitmax.profitmart.in";
const API = `${HOST}/NorenWClientAPI`;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const jd = (o) => JSON.stringify(o).replace(/&/g, "\\u0026");

function storedZip(name, content) {
  const nameBuf = Buffer.from(name, "latin1");
  for (let pad = 0; pad < 4000; pad++) {
    const data = Buffer.from(content + "\n".repeat(pad), "latin1");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + nameBuf.length, 12); end.writeUInt32LE(30 + nameBuf.length + data.length, 16);
    const zip = Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
    if (zip.every((b) => b < 0x80)) return zip.toString("latin1");
  }
  throw new Error(`could not build a 7-bit zip for ${name}`);
}

// ── dummy account and market data ──
const UID = "PM00000";
const TOKEN = "dummyProfitmartAccessToken";
const CREDS = { clientId: UID, apiKey: "dummyProfitmartClientId", apiSecret: "dummyProfitmartSecret", requestCode: "1f775888-0000-4000-8000-000000000000" };
const W = "20-OCT-2026";
const M = "27-OCT-2026";
const LEGS = [
  { token: "40001", strike: 24950, type: "CE", lp: "141.30", oi: "1520400", poi: "1487100", v: "2310450", bp1: "141.10", sp1: "141.45" },
  { token: "40002", strike: 24950, type: "PE", lp: "78.15", oi: "2104500", poi: "2010300", v: "2988300", bp1: "78.00", sp1: "78.30" },
  { token: "40003", strike: 25000, type: "CE", lp: "104.95", oi: "3165900", poi: "2932500", v: "5430250", bp1: "104.85", sp1: "105.05" },
  { token: "40004", strike: 25000, type: "PE", lp: "92.40", oi: "2876400", poi: "2905200", v: "4876100", bp1: "92.25", sp1: "92.55" },
  { token: "40005", strike: 25050, type: "CE", lp: "74.60", oi: "1988700", poi: "1802400", v: "3120400", bp1: "74.45", sp1: "74.75" },
  { token: "40006", strike: 25050, type: "PE", lp: "112.80", oi: "1210200", poi: "1199400", v: "1650300", bp1: "112.60", sp1: "112.95" },
];
const nfoSym = (root, exp, type, strike) => `${root}${exp.slice(0, 2)}${exp.slice(3, 6)}${exp.slice(9)}${type[0]}${strike}`;

const NFO = [
  ...LEGS.map((l) => [l.token, "65", "NIFTY", nfoSym("NIFTY", W, l.type, l.strike), W, "OPTIDX", l.type, String(l.strike)]),
  ["40011", "65", "NIFTY", nfoSym("NIFTY", M, "CE", 25000), M, "OPTIDX", "CE", "25000"],
  ["40012", "65", "NIFTY", nfoSym("NIFTY", M, "PE", 25000), M, "OPTIDX", "PE", "25000"],
  ["40020", "65", "NIFTY", "NIFTY27OCT26F", M, "FUTIDX", "XX", "0"],
  ["40031", "30", "BANKNIFTY", nfoSym("BANKNIFTY", M, "CE", 56000), M, "OPTIDX", "CE", "56000"],
  ["40041", "60", "FINNIFTY", nfoSym("FINNIFTY", M, "CE", 26500), M, "OPTIDX", "CE", "26500"],
  ["40051", "120", "MIDCPNIFTY", nfoSym("MIDCPNIFTY", M, "PE", 13000), M, "OPTIDX", "PE", "13000"],
  ["40061", "25", "NIFTYNXT50", nfoSym("NIFTYNXT50", M, "CE", 68000), M, "OPTIDX", "CE", "68000"],
  ["106743", "500", "RELIANCE", nfoSym("RELIANCE", M, "CE", 1460), M, "OPTSTK", "CE", "1460"],
  ["106744", "500", "RELIANCE", nfoSym("RELIANCE", M, "PE", 1460), M, "OPTSTK", "PE", "1460"],
];
const nfoText = ["Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize,",
  ...NFO.map(([tok, lot, sym, tsym, exp, inst, opt, strike]) => ["NFO", tok, lot, sym, tsym, exp, inst, opt, strike, "0.05", ""].join(","))].join("\n") + "\n";
const BFO = [
  ["825001", "20", "SENSEX", "SENSEX26O2282000CE", "SENSEX 22OCT26 82000 CE", "22-OCT-2026", "OPTIDX", "CE", "82000"],
  ["825002", "20", "SENSEX", "SENSEX26O2282000PE", "SENSEX 22OCT26 82000 PE", "22-OCT-2026", "OPTIDX", "PE", "82000"],
  ["825101", "30", "BANKEX", "BANKEX26OCT63000CE", "BANKEX 29OCT26 63000 CE", "29-OCT-2026", "OPTIDX", "CE", "63000"],
  ["825201", "75", "SENSEX50", "SENSEX5026OCT26900CE", "SENSEX50 29OCT26 26900 CE", "29-OCT-2026", "OPTIDX", "CE", "26900"],
  ["1165536", "3000", "WIPRO", "WIPRO26NOV202.5PE", "", "26-NOV-2026", "OPTSTK", "PE", "202.5"],
];
const bfoText = ["Exchange,Token,LotSize,Symbol,TradingSymbol,CompanyName,Expiry,Instrument,OptionType,StrikePrice,TickSize,PrevClose,UpperCkt,LowerCkt,OI,FreezeQty",
  ...BFO.map(([tok, lot, sym, tsym, name, exp, inst, opt, strike]) => ["BFO", tok, lot, sym, tsym, name, exp, inst, opt, strike, "0.05", "0", "0", "0", "0", ""].join(","))].join("\n") + "\n";
const nseText = ["Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize,",
  "NSE,26000,1,Nifty 50,NIFTY INDEX,INDEX,0,", "NSE,26009,1,Nifty Bank,NIFTY BANK,INDEX,0,",
  "NSE,2885,1,RELIANCE,RELIANCE-EQ,EQ,0.10,", "NSE,22,1,ACC,ACC-EQ,EQ,0.10,"].join("\n") + "\n";

// GetQuotes field names from the official "Get Quotes" page.
const quote = (exch, l, tsym, extra = {}) => ({ request_time: "10:05:21 17-10-2026", stat: "Ok", exch, tsym, token: l.token, pp: "2", ls: extra.ls ?? "65", ti: "0.05",
  lp: l.lp, c: extra.c ?? l.lp, h: extra.h ?? l.lp, l: extra.l ?? l.lp, o: extra.o ?? l.lp, v: l.v ?? "0", oi: l.oi, poi: l.poi, bp1: l.bp1, sp1: l.sp1, bq1: "650", sq1: "325" });
const SPOT = quote("NSE", { token: "26000", lp: "25012.15", v: "0", bp1: "0.00", sp1: "0.00" }, "Nifty 50", { ls: "1", o: "24950.10", h: "25060.35", l: "24931.80", c: "24980.55" });

const DOC = {
  // GenAcsTok success sample (fields per the official page; values are dummies).
  genAcsTok: { USERID: UID, access_token: TOKEN, expires_in: 28800, refresh_token: "dummyRefreshToken", scope: "trade", actid: UID, uid: UID, stat: "Ok", susertoken: "dummySuserToken" },
  limits: { request_time: "18:07:31 29-05-2020", stat: "Ok", cash: "1500000.00", payin: "0.00", payout: "0.00", brkcollamt: "0.00", unclearedcash: "0.00", daycash: "0.00",
    turnoverlmt: "50000000.00", pendordvallmt: "20000000.00", turnover: "3915000.00", pendordval: "2871000.00", marginused: "394554.00", mtomcurper: "0.00", urmtom: "30540.00",
    grexpo: "3915000.00", uzpnl_e_i: "15270.00", uzpnl_e_m: "61080.00", uzpnl_e_c: "-45810.00" },
  positions: [{ stat: "Ok", uid: UID, actid: UID, exch: "NSE", tsym: "SUZLON-EQ", s_prdt_ali: "CNC", prd: "C", token: "12018", symname: "SUZLON", instname: "EQ",
    cname: "SUZLON ENERGY LIMITED", frzqty: "1891775", pp: "2", ls: "1", ti: "0.01", mult: "1", prcftr: "1.000000", daybuyqty: "1", daysellqty: "0", daybuyamt: "53.35",
    daybuyavgprc: "53.35", daysellamt: "0.00", daysellavgprc: "0.00", cfbuyqty: "0", cfsellqty: "0", dayavgprc: "53.35", netqty: "1", netavgprc: "53.35", upldprc: "0.00",
    netupldprc: "53.35", lp: "53.35", urmtom: "0.00", bep: "53.35", totbuyamt: "53.35", totsellamt: "0.00", totbuyavgprc: "53.35", totsellavgprc: "0.00", rpnl: "-0.00" }],
  holdings: [{ stat: "Ok", exch_tsym: [
    { exch: "NSE", token: "15119", cm_e: "1", fo_e: "0", cur_e: "0", tsym: "BALAJEE-EQ", pp: "2", ti: "0.05", ls: "1", isin: "INE000A00000", cname: "DUMMY BALAJEE LTD" },
    { exch: "BSE", token: "500001", cm_e: "1", fo_e: "0", cur_e: "0", tsym: "BALAJEE", pp: "2", ti: "0.05", ls: "1", isin: "INE000A00000", cname: "DUMMY BALAJEE LTD" }],
  upldprc: "400.00", sell_amt: "0.000000", holdqty: "10", hair_cut: "0.00", brk_hair_cut: "0.00", dpqty: "0", benqty: "0", unplgdqty: "0", colqty: "0", brkcolqty: "0",
  btstqty: "0", usedqty: "0", trdqty: "0", epi_done_qty: "0", s_prdt_ali: "CNC", prd: "C", c: "500.00" }],
  orderBook: [
    { stat: "Ok", norenordno: "26101700000001", kidid: "2", uid: UID, actid: UID, exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", ordenttm: "1792214411", trantype: "B",
      prctyp: "LMT", ret: "DAY", token: "40003", instname: "OPTIDX", ordersource: "API", pp: "2", ls: "65", ti: "0.05", prc: "104.50", dscqty: "0", s_prdt_ali: "NRML", prd: "M",
      status: "OPEN", st_intrn: "OPEN", fillshares: "65", avgprc: "104.50", norentm: "09:20:11 17-10-2026", exch_tm: "17-10-2026 09:20:11", remarks: "", exchordid: "1100000000034342" },
    { stat: "Ok", norenordno: "25121100000307", kidid: "2", uid: UID, actid: UID, exch: "NSE", tsym: "ACC-EQ", rejby: "", qty: "1", ordenttm: "1765445890", trantype: "B",
      prctyp: "LMT", ret: "DAY", rejreason: " ", token: "22", instname: "EQ", ordersource: "WEB", pp: "2", ls: "1", ti: "0.10", prc: "1782.30", rprc: "1782.30", dscqty: "0",
      s_prdt_ali: "CNC", prd: "C", status: "CANCELED", st_intrn: "CANCELED", norentm: "15:08:10 11-12-2025", exch_tm: "11-12-2025 15:08:10", remarks: "", exchordid: "252",
      cancelqty: "1", rqty: "1" },
  ],
  // The official Trade Book sample is an array nested inside an array; kept as documented.
  tradeBook: [[{ stat: "Ok", norenordno: "26011500000656", uid: UID, actid: UID, exch: "NSE", prctyp: "LMT", ret: "DAY", s_prdt_ali: "NRML", prd: "M", flid: "180",
    fltm: "15-01-2026 15:53:32", trantype: "B", tsym: "EDELWEISS-EQ", qty: "1", token: "15119", fillshares: "1", flqty: "1", mult: "1", pp: "2", ls: "1", ti: "0.01",
    prc: "120.00", prcftr: "1.000000", flprc: "120.00", norentm: "15:53:32 15-01-2026", avgprc: "120.00", exch_tm: "15-01-2026 15:53:32", remarks: "", exchordid: "178" }]],
  tpseries: [
    { stat: "Ok", time: "02-06-2020 15:46:23", into: "0.00", inth: "0.00", intl: "0.00", intc: "0.00", intvwap: "0.00", intv: "0", intoi: "0", v: "980515", oi: "128702" },
    { stat: "Ok", time: "02-06-2020 15:44:23", into: "1286.50", inth: "1288.00", intl: "1286.00", intc: "1287.50", intvwap: "1287.10", intv: "6", intoi: "0", v: "980515", oi: "128702" },
    { stat: "Ok", time: "02-06-2020 15:43:23", into: "1287.00", inth: "1287.00", intl: "0.00", intc: "1287.00", intvwap: "128702.00", intv: "4", intoi: "128702", v: "980511", oi: "128702" },
  ],
  depthQuote: { request_time: "16:40:05 04-12-2025", stat: "Ok", exch: "NSE", tsym: "ACC-EQ", cname: "ACC LIMITED", symname: "ACC", seg: "EQT", instname: "EQ", isin: "INE012A01025",
    pp: "2", ls: "1", ti: "0.10", mult: "1", lut: "1764667383", uc: "2208.20", lc: "1472.20", token: "22", lp: "1847.00", c: "1850.50", h: "1857.00", l: "1844.20", ap: "1849.64",
    o: "1850.50", v: "60469", ltq: "1", ltt: "14:52:58", ltd: "02-12-2025", tbq: "38589", tsq: "48125",
    bp1: "1846.30", sp1: "1847.00", bp2: "1846.20", sp2: "1847.70", bp3: "1846.10", sp3: "1847.80", bp4: "1846.00", sp4: "1847.90", bp5: "1845.90", sp5: "1848.00",
    bq1: "1", sq1: "19", bq2: "8", sq2: "19", bq3: "4", sq3: "15", bq4: "53", sq4: "27", bq5: "9", sq5: "464",
    bo1: "1", so1: "1", bo2: "2", so2: "2", bo3: "2", so3: "2", bo4: "8", so4: "4", bo5: "3", so5: "5" },
  placeOk: { request_time: "10:48:03 17-10-2026", stat: "Ok", norenordno: "26101700000017" },
  modifyOk: { request_time: "16:04:06 17-10-2026", stat: "Ok", result: "26101700000017" },
  cancelOk: { request_time: "16:04:10 17-10-2026", stat: "Ok", result: "26101700000017" },
};

const ORDER = { tradingSymbol: "NIFTY20OCT26C25000", exchange: "NFO", transactionType: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 2, price: 104.5, correlationId: "mrc-0001" };
const PLACE = { uid: UID, actid: UID, exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", dscqty: "0", prc: "104.5", prd: "M", trantype: "B", prctyp: "LMT", ret: "DAY", ordersource: "API", remarks: "mrc-0001" };
const CHANGES = { exchange: "NFO", tradingSymbol: "NIFTY20OCT26C25000", quantity: 130, price: 105, orderType: "LIMIT", validity: "DAY" };
const MODIFY = { uid: UID, norenordno: "26101700000017", exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", prc: "105", prctyp: "LMT", ret: "DAY", ordersource: "API" };

const post = (endpoint, data, json) => ({ method: "POST", url: `${API}${endpoint}`, expectBody: { jData: jd(data) }, json });
const auth = { method: "POST", url: `${API}/GenAcsTok`,
  expectBody: { jData: jd({ code: CREDS.requestCode, checksum: sha(`${CREDS.apiKey}${CREDS.apiSecret}${CREDS.requestCode}`) }) }, json: DOC.genAcsTok };
const masters = [
  { method: "GET", url: `${HOST}/NFO_symbols.txt.zip`, text: storedZip("NFO_symbols.txt", nfoText), headers: { "content-type": "application/zip" } },
  { method: "GET", url: `${HOST}/BFO_symbols.txt.zip`, text: storedZip("BFO_Symbol.txt", bfoText), headers: { "content-type": "application/zip" } },
  { method: "GET", url: `${HOST}/NSE_symbols.txt.zip`, text: storedZip("NSE_symbols.txt", nseText), headers: { "content-type": "application/zip" } },
];
const q = (exch, token) => ({ uid: UID, exch, token });
const legQuotes = LEGS.map((l) => post("/GetQuotes", q("NFO", l.token), quote("NFO", l, nfoSym("NIFTY", W, l.type, l.strike))));
const spot = post("/GetQuotes", q("NSE", "26000"), SPOT);
const docs = (page) => `https://profitmax.profitmart.in/ApiDocs/docs/${page.replace(/ /g, "%20")}`;

const files = {
  manifest: {
    brokerId: "profitmart", creds: CREDS, symbol: "NIFTY", expiry: "2026-10-20",
    sources: [
      docs("Login And User Details/OAuth Flow"), docs("Login And User Details/GenAcsTok"), docs("Orders and Trades/Place Order"),
      docs("Orders and Trades/Modify Order"), docs("Orders and Trades/Cancel Order"), docs("Orders and Trades/Order Book"), docs("Orders and Trades/Trade Book"),
      docs("Orders and Trades/Positions Book"), docs("Holdings and Limits/Holdings"), docs("Holdings and Limits/Limits"), docs("Watch Lists/Get Quotes"),
      docs("Chart Data/Get Time Price Data"), docs("Chart Data/EOD Chart Data"), docs("Websocket API/Connect"),
      "https://profitmax.profitmart.in/NFO_symbols.txt.zip (live layout, 18 Oct 2026)", "https://profitmax.profitmart.in/BFO_symbols.txt.zip (live layout, 18 Oct 2026)",
    ],
    notes: "Generated by __fixtures__/profitmart/generate-profitmart-fixtures.mjs from the official ProfitMax API doc samples (trimmed; dummy ids). Equity examples were moved onto NIFTY (20 Oct 2026 weekly, 27 Oct monthly), SENSEX, BANKEX and RELIANCE contracts with the documented field names. Every capability file also answers the one-time code exchange because the session is cached on the first call. Master ZIPs are valid stored archives padded to 7-bit so they replay as text.",
  },
  testConnection: { responses: [auth, post("/Limits", { uid: UID, actid: UID }, DOC.limits)], expect: { status: "success" } },
  instruments: { responses: [auth, ...masters], expect: { minRows: 15, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
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
  positions: { responses: [auth, post("/PositionBook", { uid: UID, actid: UID }, DOC.positions)], expect: { minRows: 1 } },
  holdings: { responses: [auth, post("/Holdings", { uid: UID, actid: UID, prd: "C" }, DOC.holdings)], expect: { minRows: 1 } },
  funds: { responses: [auth, post("/Limits", { uid: UID, actid: UID }, DOC.limits)] },
  orderBook: { responses: [auth, post("/OrderBook", { uid: UID }, DOC.orderBook)], expect: { minRows: 2 } },
  tradeBook: { responses: [auth, post("/TradeBook", { uid: UID, actid: UID }, DOC.tradeBook)], expect: { minRows: 1 } },
  placeOrder: { args: [ORDER, 65], responses: [auth, post("/PlaceOrder", PLACE, DOC.placeOk)] },
  modifyOrder: { args: ["26101700000017", CHANGES], responses: [auth, post("/ModifyOrder", MODIFY, DOC.modifyOk)] },
  cancelOrder: { args: ["26101700000017"], responses: [auth, post("/CancelOrder", { uid: UID, norenordno: "26101700000017" }, DOC.cancelOk)] },
};

mkdirSync(DIR, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(DIR, `${name}.json`), JSON.stringify(content, null, 2) + "\n");
console.log("Profitmart fixtures written:", Object.keys(files).length, "files");
