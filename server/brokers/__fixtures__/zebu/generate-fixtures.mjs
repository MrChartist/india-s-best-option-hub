/**
 * Writes the Zebu contract fixtures. Field names and envelopes come from the official OAuth doc samples
 * (https://zebumyntapi.web.app/OAuth/...); master headers are those of the published *_symbols.txt files.
 * The docs' equity examples are moved onto NIFTY (20 Oct 2026 weekly, 27 Oct monthly), SENSEX (22 Oct
 * weekly), BANKEX and RELIANCE contracts. Every id, token and name is a dummy. Master ZIPs are valid stored
 * (uncompressed) archives whose bytes are all 7-bit, so they replay unchanged as fixture text.
 * Run: node server/brokers/__fixtures__/zebu/generate-fixtures.mjs
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const HOST = "https://go.mynt.in";
const API = `${HOST}/NorenWClientAPI`;
const UID = "Z12345";
const creds = { userId: UID, clientId: "Z12345_U", apiSecret: "dummySecretCode", authCode: "dummyAuthCode" };
const write = (name, value) => writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
const jdata = (o) => JSON.stringify(o).replace(/&/g, "\\u0026");

// ── 7-bit stored ZIP ──
function u16(n) { return [n & 0xff, (n >> 8) & 0xff]; }
function u32(n) { return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }
const sevenBit = (bytes) => bytes.every((b) => b < 0x80);
function zipText(name, content) {
  let body = content;
  for (;;) {
    const data = Buffer.from(body, "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const local = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBuf.length), ...u16(0)];
    const cdOffset = local.length + nameBuf.length + data.length;
    const central = [0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBuf.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0)];
    const cdSize = central.length + nameBuf.length;
    const eocd = [0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(1), ...u16(1), ...u32(cdSize), ...u32(cdOffset), ...u16(0)];
    const all = [...local, ...nameBuf, ...data, ...central, ...nameBuf, ...eocd];
    if (sevenBit(all)) return Buffer.from(all).toString("latin1");
    body += "\n";
  }
}

const NFO = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize,",
  "NFO,40001,65,NIFTY,NIFTY20OCT26C24950,20-OCT-2026,OPTIDX,CE,24950,0.05,",
  "NFO,40002,65,NIFTY,NIFTY20OCT26P24950,20-OCT-2026,OPTIDX,PE,24950,0.05,",
  "NFO,40003,65,NIFTY,NIFTY20OCT26C25000,20-OCT-2026,OPTIDX,CE,25000,0.05,",
  "NFO,40004,65,NIFTY,NIFTY20OCT26P25000,20-OCT-2026,OPTIDX,PE,25000,0.05,",
  "NFO,40005,65,NIFTY,NIFTY20OCT26C25050,20-OCT-2026,OPTIDX,CE,25050,0.05,",
  "NFO,40006,65,NIFTY,NIFTY20OCT26P25050,20-OCT-2026,OPTIDX,PE,25050,0.05,",
  "NFO,40011,65,NIFTY,NIFTY27OCT26C25000,27-OCT-2026,OPTIDX,CE,25000,0.05,",
  "NFO,40012,65,NIFTY,NIFTY27OCT26P25000,27-OCT-2026,OPTIDX,PE,25000,0.05,",
  "NFO,40020,65,NIFTY,NIFTY27OCT26F,27-OCT-2026,FUTIDX,XX,-0.01,0.1,",
  "NFO,40031,120,MIDCPNIFTY,MIDCPNIFTY27OCT26F,27-OCT-2026,FUTIDX,XX,-0.01,0.05,",
  "NFO,61473,25,NIFTYNXT50,NIFTYNXT5027OCT26C68000,27-OCT-2026,OPTIDX,CE,68000,0.05,",
  "NFO,144303,500,RELIANCE,RELIANCE27OCT26C1460,27-OCT-2026,OPTSTK,CE,1460,0.05,",
  "NFO,144304,500,RELIANCE,RELIANCE27OCT26P1460,27-OCT-2026,OPTSTK,PE,1460,0.05,",
].join("\n");
const BFO = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,Strike,TickSize,",
  "BFO,884018,20,BSXOPT,SENSEX26O2282700CE,22-OCT-2026,OPTIDX,CE,82700,0.05,",
  "BFO,884019,20,BSXOPT,SENSEX26O2282700PE,22-OCT-2026,OPTIDX,PE,82700,0.05,",
  "BFO,884002,30,BKXOPT,BANKEX26OCT62000CE,29-OCT-2026,OPTIDX,CE,62000,0.05,",
  "BFO,884500,20,SX50OPT,SENSEX5026OCT26900PE,29-OCT-2026,OPTIDX,PE,26900,0.05,",
  "BFO,1134977,2425,ZOMAOPT,ETERNAL26OCT375PE,29-OCT-2026,OPTSTK,PE,375,0.05,",
].join("\n");
const NSE = [
  "Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize,",
  "NSE,26000,1,Nifty 50,NIFTY INDEX,INDEX,0,",
  "NSE,26009,1,Nifty Bank,NIFTY BANK,INDEX,0,",
  "NSE,26037,1,Nifty Fin Services,FINNIFTY,INDEX,0,",
  "NSE,2885,1,RELIANCE,RELIANCE-EQ,EQ,0.1,",
  "NSE,22,1,ACC,ACC-EQ,EQ,0.05,",
  "NSE,978323,1,10DCAL28A,10DCAL28A,GB,0.01,",
].join("\n");
const master = (exch, text) => ({ method: "GET", url: `${HOST}/${exch}_symbols.txt.zip`, headers: { "content-type": "application/zip" }, text: zipText(`${exch}_symbols.txt`, text) });

const checksum = createHash("sha256").update(`${creds.clientId}${creds.apiSecret}${creds.authCode}`).digest("hex");
const genAcsTok = {
  method: "POST",
  url: `${API}/GenAcsTok`,
  expectBody: { jData: jdata({ code: creds.authCode, checksum }) },
  json: { stat: "Ok", access_token: "dummyZebuAccessToken", refresh_token: "dummyZebuRefreshToken", expires_in: "3600", request_time: "10:06:54 16-10-2026" },
};
const call = (endpoint, payload, json, { actid = true } = {}) => ({
  method: "POST",
  url: `${API}${endpoint}`,
  expectBody: { jData: jdata({ uid: UID, ...(actid ? { actid: UID } : {}), ...payload }) },
  json,
});
const quote = (exch, token, tsym, lp, bp1, sp1, extra = {}) => call("/GetQuotes", { exch, token }, {
  request_time: "12:05:21 16-10-2026", stat: "Ok", exch, tsym, cname: tsym, symname: tsym.replace(/\d.*$/, ""), seg: exch === "NFO" ? "DER" : "EQT", instname: exch === "NFO" ? "OPTIDX" : "EQ",
  pp: "2", ls: exch === "NFO" ? "65" : "1", ti: "0.05", mult: "1", uc: "999999.00", lc: "0.05", prcftr_d: "(1 / 1 ) * (1 / 1)", token, lp, o: lp, h: lp, l: lp, v: "543025", ltq: "65", ltt: "12:05:20",
  bp1, sp1, bp2: "0.00", sp2: "0.00", bp3: "0.00", sp3: "0.00", bp4: "0.00", sp4: "0.00", bp5: "0.00", sp5: "0.00",
  bq1: "650", sq1: "325", bq2: "0", sq2: "0", bq3: "0", sq3: "0", bq4: "0", sq4: "0", bq5: "0", sq5: "0",
  bo1: "3", so1: "2", bo2: "0", so2: "0", bo3: "0", so3: "0", bo4: "0", so4: "0", bo5: "0", So5: "0", ...extra,
}, { actid: false });
const quotes = [
  quote("NSE", "26000", "Nifty 50", "25012.15", "0.00", "0.00"),
  quote("BSE", "1", "SENSEX", "82710.40", "0.00", "0.00"),
  quote("NFO", "40001", "NIFTY20OCT26C24950", "128.40", "128.10", "128.60"),
  quote("NFO", "40002", "NIFTY20OCT26P24950", "62.15", "62.00", "62.30"),
  quote("NFO", "40003", "NIFTY20OCT26C25000", "96.80", "96.55", "96.95", { oi: "165900" }),
  quote("NFO", "40004", "NIFTY20OCT26P25000", "82.35", "82.20", "82.50"),
  quote("NFO", "40005", "NIFTY20OCT26C25050", "70.05", "69.90", "70.20"),
  quote("NFO", "40006", "NIFTY20OCT26P25050", "106.60", "106.40", "106.75"),
];
const limits = call("/Limits", {}, { request_time: "10:06:54 16-10-2026", stat: "Ok", prfname: "ZEBUETRADE", cash: "200000.00", payin: "0.00", payout: "0.00", brkcollamt: "25000.00", unclearedcash: "0.00", daycash: "0.00", marginused: "72569.51", turnoverlmt: "10000000000000.00", pendordvallmt: "1000000000000.00", blk_amt: "0.00" });

write("manifest", {
  brokerId: "zebu",
  creds,
  symbol: "NIFTY",
  expiry: "2026-10-20",
  sources: [
    "https://zebumyntapi.web.app/OAuth/",
    "https://zebumyntapi.web.app/OAuth/Authentication/",
    "https://zebumyntapi.web.app/OAuth/Masters/",
    "https://zebumyntapi.web.app/OAuth/Market%20Quotes/",
    "https://zebumyntapi.web.app/OAuth/Order/",
    "https://zebumyntapi.web.app/OAuth/Portfolio/",
    "https://zebumyntapi.web.app/OAuth/Limits/",
    "https://zebumyntapi.web.app/OAuth/Users/",
    "https://go.mynt.in/NFO_symbols.txt.zip",
  ],
  notes: "Generated by generate-fixtures.mjs from the official OAuth doc samples (documented field names; dummy ids). Every capability fixture also answers the one-time code exchange, because the session is cached on the first call. Request bodies are matched exactly (jData=<json>) so each GetQuotes token gets its own reply.",
});

const all = (...rest) => [genAcsTok, ...rest];
write("testConnection", { responses: all(limits), expect: { status: "success" } });
write("instruments", { responses: all(master("NSE", NSE), master("NFO", NFO), master("BFO", BFO)), expect: { minRows: 15, underlyings: ["NIFTY", "SENSEX", "BANKEX", "RELIANCE", "ETERNAL"] } });
write("expiries", { responses: all(master("NFO", NFO)), expect: { minRows: 2 } });
write("optionChain", { responses: all(master("NFO", NFO), ...quotes), expect: { minStrikes: 3 } });
write("ltp", { responses: all(...quotes) });
write("quotes", { args: [[{ token: "40003", exchange: "NFO" }, { token: "26000", exchange: "NSE" }]], responses: all(...quotes), expect: { minRows: 2 } });
write("depth", { args: [{ token: "40003", exchange: "NFO" }], responses: all(...quotes) });
write("historical", {
  args: [{ instrument: { token: "26000", exchange: "NSE" }, interval: "1m", from: "2026-10-16", to: "2026-10-16" }],
  responses: all(call("/TPSeries", { exch: "NSE", token: "26000", st: "1792122300", et: "1792144800", intrv: "1" }, [
    { stat: "Ok", time: "16-10-2026 09:16:00", into: "24961.00", inth: "24970.50", intl: "24955.00", intc: "24968.20", intvwap: "0.00", intv: "0", intoi: "0", v: "0", oi: "0" },
    { stat: "Ok", time: "16-10-2026 09:15:00", into: "24960.35", inth: "24990.00", intl: "24940.10", intc: "24961.00", intvwap: "0.00", intv: "0", intoi: "0", v: "0", oi: "0" },
  ], { actid: false })),
  expect: { minRows: 2 },
});
write("positions", {
  responses: all(call("/PositionBook", {}, [
    { stat: "Ok", uid: UID, actid: UID, exch: "NSE", tsym: "ACC-EQ", token: "22", prd: "C", pp: "2", ls: "1", ti: "5.00", mult: "1", prcftr: "1.000000", daybuyqty: "2", daysellqty: "2", daybuyamt: "2610.00", daybuyavgprc: "1305.00", daysellamt: "2610.00", daysellavgprc: "1305.00", cfbuyqty: "0", cfsellqty: "0", netqty: "0", netavgprc: "0.00", lp: "1306.00", urmtom: "0.00", rpnl: "0.00", cforgavgprc: "0.00" },
    { stat: "Ok", uid: UID, actid: UID, exch: "NFO", tsym: "NIFTY20OCT26C25000", token: "40003", prd: "M", pp: "2", ls: "65", ti: "0.05", daybuyqty: "65", daysellqty: "0", daybuyavgprc: "96.80", netqty: "65", netavgprc: "96.80", lp: "99.20", urmtom: "156.00", rpnl: "0.00" },
  ])),
  expect: { minRows: 2 },
});
write("holdings", {
  responses: all(call("/Holdings", { prd: "C" }, [
    { stat: "Ok", exch_tsym: [{ exch: "NSE", token: "13", tsym: "ABB-EQ" }], holdqty: "20", colqty: "0", btstqty: "0", btstcolqty: "0", usedqty: "0", upldprc: "1800.00" },
    { stat: "Ok", exch_tsym: [{ exch: "BSE", token: "500410", tsym: "ACC" }, { exch: "NSE", token: "22", tsym: "ACC-EQ" }], holdqty: "15", colqty: "0", btstqty: "0", btstcolqty: "0", usedqty: "5", upldprc: "1400.00" },
  ])),
  expect: { minRows: 2 },
});
write("funds", { responses: all(limits) });
const book = [
  { stat: "Ok", exch: "NFO", tsym: "NIFTY20OCT26C25000", norenordno: "26101600000002", prc: "95.00", qty: "130", prd: "M", status: "OPEN", trantype: "B", prctyp: "LMT", fillshares: "0", avgprc: "0", exchordid: "250620000000343421", uid: UID, actid: UID, ret: "DAY", amo: "No", token: "40003", norentm: "09:41:00 16-10-2026" },
  { stat: "Ok", exch: "NSE", tsym: "ABB-EQ", norenordno: "26101600000003", prc: "5830.00", qty: "50", prd: "C", status: "REJECTED", trantype: "B", prctyp: "LMT", fillshares: "0", avgprc: "0", rejreason: "Insufficient funds", uid: UID, actid: UID, ret: "DAY", amo: "No", token: "13", norentm: "09:42:10 16-10-2026" },
];
const orderBook = call("/OrderBook", {}, book, { actid: false });
write("orderBook", { responses: all(orderBook), expect: { minRows: 2 } });
write("tradeBook", {
  responses: all(call("/TradeBook", {}, [
    { stat: "Ok", norenordno: "26101600000001", uid: UID, actid: UID, exch: "NSE", prctyp: "LMT", ret: "DAY", prd: "M", flid: "102", fltm: "16-10-2026 09:30:02", trantype: "S", tsym: "ACCELYA-EQ", qty: "180", token: "7053", fillshares: "180", flqty: "180", pp: "2", ls: "1", ti: "0.05", prc: "800.00", flprc: "800.00", norentm: "09:30:02 16-10-2026", exch_tm: "16-10-2026 09:30:02", remarks: "WC TEST Order", exchordid: "6857" },
  ])),
  expect: { minRows: 1 },
});

const order = { tradingSymbol: "NIFTY20OCT26C25000", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 2, price: 95 };
write("placeOrder", {
  args: [order, 65],
  responses: all(call("/PlaceOrder", { exch: "NFO", tsym: "NIFTY20OCT26C25000", qty: "130", prc: "95", dscqty: "0", prd: "M", trantype: "B", prctyp: "LMT", ret: "DAY" },
    { request_time: "10:48:03 16-10-2026", stat: "Ok", norenordno: "26101600000002" })),
});
write("modifyOrder", {
  args: ["26101600000002", { price: 96.5 }],
  responses: all(orderBook, call("/ModifyOrder", { exch: "NFO", norenordno: "26101600000002", prctyp: "LMT", prc: "96.5", qty: "130", tsym: "NIFTY20OCT26C25000", ret: "DAY" },
    { request_time: "14:14:08 16-10-2026", stat: "Ok", result: "26101600000002" })),
});
write("cancelOrder", {
  args: ["26101600000002"],
  responses: all(call("/CancelOrder", { norenordno: "26101600000002" }, { request_time: "14:14:10 16-10-2026", stat: "Ok", result: "26101600000002" }, { actid: false })),
});
