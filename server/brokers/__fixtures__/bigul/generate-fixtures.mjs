// Run: node server/brokers/__fixtures__/bigul/generate-fixtures.mjs  (rewrites the JSON fixtures in this folder; no network).
// REST payloads are the samples on https://connect.bigul.co/docs (field names and envelopes unchanged, ids replaced by
// dummies, contracts moved onto the dummy master below). The master is a stored (uncompressed) ZIP laid out like the
// official Bigulmastercsv.zip, with the live files' header rows; it is padded until every byte is below 0x80 so it
// survives the harness's text responses. streamTicks feed the fake WebSocket in bigul.test.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";

const dir = process.argv[2] || new URL(".", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const API = "https://capi.bigul.co/api/v1";
const MASTER = "https://bigul.s3.ap-south-1.amazonaws.com/BigulMasters/Bigulmastercsv.zip";
const DOCS = "https://connect.bigul.co/docs";

const CASH_HEAD = "Exch,ScripCode,Name,Desc,TradingSymbol,TickSize,SERIES,MinimumLotQty,ISIN,UpperCkt,LowerCkt,PrevOpen,PrevHigh,PrevLow,PrevClose,YearlyHigh,YearlyLow,CALevel,SECTOR,HCALEVEL,FREEZEQTY,FINCODE,YEAR_LOW,YEAR_HIGH,DECIMAL_PRECISION,STATUSEXCH,PRICEQUOTEUNIT,PRICEQUOTEQUANTITY,LOTNUMERATOR,LOTDENOMINATOR,DELIVERYUNIT,MAXSINGLETRANQTY,MTF,LVG,surveillance,3YearHigh,3YearLow,5YearHigh,5YearLow,IsFuture,IsOption";
const DERIV_HEAD = "Exch,ScripCode,ScripCodeDaily,ScripCodeIntraday,Name,ULToken,OFISType,CPType,ExpiryDate,StrikePrice,CALevel,MinimumLotQuantity,Desc,TradingSymbol,PrevOI,SERIES,OPTION_TYPE,EXPIRY_DATE,OI_PREV,OI,FREEZEQTY,DECIMAL_PRECISION,LOTSIZE,STATUSEXCH,PRICEQUOTEUNIT,PRICEQUOTEQUANTITY,LOTNUMERATOR,LOTDENOMINATOR,DELIVERYUNIT,MAXSINGLETRANQTY,IsFuture,IsOption,TickSize";
const cash = (exch, code, name, desc, sym, tick, series, isin = "") => `${exch},${code},${name},${desc},${sym},${tick},${series},1,${isin},0,0,0,0,0,0,0,0,0,,0,,,0,0,2,,,,,,,,N,,,0,0,0,0,1,1`;
const deriv = (exch, code, name, ul, strike, lot, desc, sym, prevOi, series, opt, expiry) =>
  `${exch},${code},${code},${code},${name},${ul},4,3,0,${strike},0,${lot},${desc},${sym},${prevOi},${series},${opt},${expiry},${prevOi},${prevOi},1801.0,2,${lot}.0,,,,,,,,0,0,5.0`;

const files = {
  "nse_cm.csv": [CASH_HEAD,
    cash("N", 26000, "Nifty 50", "NIFTY 50", "NIFTY 50", "", "INDEX"),
    cash("N", 26009, "Nifty Bank", "NIFTY BANK", "NIFTY BANK", "", "INDEX"),
    cash("N", 26037, "Nifty Fin Service", "NIFTY FINANCIAL SERVICES", "NIFTY FINANCIAL SERVICES", "", "INDEX"),
    cash("N", 26074, "NIFTY MID SELECT", "NIFTY MIDCAP SELECT", "NIFTY MIDCAP SELECT", "", "INDEX"),
    cash("N", 26008, "Nifty IT", "NIFTY IT", "NIFTY IT", "", "INDEX"),
    cash("N", 2885, "RELIANCE", "RELIANCE INDUSTRIES LTD", "RELIANCE-EQ", "10.0", "EQ", "INE002A01018"),
    cash("N", 11536, "TCS", "TATA CONSULTANCY SERV LT", "TCS-EQ", "10.0", "EQ", "INE467B01029"),
    cash("N", 9999, "SOMEBOND", "SOME BOND", "SOMEBOND-SG", "1.0", "SG")],
  "bse_cm.csv": [CASH_HEAD,
    cash("B", 1, "SENSEX", "SENSEX", "SENSEX", "", "INDEX"),
    cash("B", 12, "BANKEX", "BANKEX", "BANKEX", "", "INDEX"),
    cash("B", 500325, "RELIANCE", "RELIANCE INDUSTRIES LTD.-500325", "RELIANCE", "5.0", "A", "INE002A01018")],
  "nse_fo.csv": [DERIV_HEAD,
    deriv("N", 40001, "NIFTY 50", 26000, "25000.0", 65, "NIFTY 20OCT26 25000.0 CE", "NIFTY26O2025000CE", 1217525, "OPTIDX", "CE", "2026-10-20 14:30:00"),
    deriv("N", 40002, "NIFTY 50", 26000, "25000.0", 65, "NIFTY 20OCT26 25000.0 PE", "NIFTY26O2025000PE", 1017175, "OPTIDX", "PE", "2026-10-20 14:30:00"),
    deriv("N", 40003, "NIFTY 50", 26000, "25100.0", 65, "NIFTY 20OCT26 25100.0 CE", "NIFTY26O2025100CE", 797525, "OPTIDX", "CE", "2026-10-20 14:30:00"),
    deriv("N", 40004, "NIFTY 50", 26000, "25100.0", 65, "NIFTY 20OCT26 25100.0 PE", "NIFTY26O2025100PE", 0, "OPTIDX", "PE", "2026-10-20 14:30:00"),
    deriv("N", 40011, "NIFTY 50", 26000, "25000.0", 65, "NIFTY 27OCT26 25000.0 CE", "NIFTY26OCT25000CE", 0, "OPTIDX", "CE", "2026-10-27 14:30:00"),
    deriv("N", 48704, "NIFTY 50", 26000, "-0.01", 65, "NIFTY 27OCT26 FUT", "NIFTY26OCTFUT", 0, "FUTIDX", "XX", "2026-10-27 14:30:00"),
    deriv("N", 58067, "NIFTY BANK", 26009, "-0.01", 35, "BANKNIFTY 27OCT26 FUT", "BANKNIFTY26OCTFUT", 210060, "FUTIDX", "XX", "2026-10-27 14:30:00"),
    deriv("N", 41001, "NIFTY BANK", 26009, "56000.0", 35, "BANKNIFTY 27OCT26 56000.0 CE", "BANKNIFTY26OCT56000CE", 0, "OPTIDX", "CE", "2026-10-27 14:30:00"),
    deriv("N", 42001, "NIFTY FIN SERVICE", 26037, "26000.0", 60, "FINNIFTY 27OCT26 26000.0 PE", "FINNIFTY26OCT26000PE", 0, "OPTIDX", "PE", "2026-10-27 14:30:00"),
    deriv("N", 43001, "NIFTY MID SELECT", 26074, "13000.0", 120, "MIDCPNIFTY 27OCT26 13000.0 CE", "MIDCPNIFTY26OCT13000CE", 0, "OPTIDX", "CE", "2026-10-27 14:30:00"),
    deriv("N", 43501, "NIFTY NEXT 50", 26013, "70000.0", 25, "NIFTYNXT50 27OCT26 70000.0 CE", "NIFTYNXT5026OCT70000CE", 0, "OPTIDX", "CE", "2026-10-27 14:30:00"),
    deriv("N", 44001, "RELIANCE", 2885, "1220.0", 500, "RELIANCE 27OCT26 1220.0 CE", "RELIANCE26OCT1220CE", 0, "OPTSTK", "CE", "2026-10-27 14:30:00"),
    deriv("N", 44002, "RELIANCE", 2885, "1220.0", 500, "RELIANCE 27OCT26 1220.0 PE", "RELIANCE26OCT1220PE", 0, "OPTSTK", "PE", "2026-10-27 14:30:00"),
    "N,48704 58875,48704 58875,48704 58875,NIFTY,,0,0,1477578600,-0.01,0,,NIFTY 27OCT26 SPREAD,NIFTY26OCT26DECFUT,0,SP-FUTIDX,XX,2026-10-27 14:30:00,0,0,,0,,,,,,,,,0,0,"],
  "bse_fo.csv": [DERIV_HEAD,
    deriv("B", 1125419, "SENSEX", 1, "82000.0", 20, "SENSEX 22OCT26 82000.0 CE", "SENSEX26O2282000CE", 0, "IO", "CE", "2026-10-22"),
    deriv("B", 1125420, "SENSEX", 1, "82000.0", 20, "SENSEX 22OCT26 82000.0 PE", "SENSEX26O2282000PE", 0, "IO", "PE", "2026-10-22"),
    deriv("B", 1155242, "BANKEX", 12, "62000.0", 30, "BANKEX 29OCT26 62000.0 CE", "BANKEX26OCT62000CE", 0, "IO", "CE", "2026-10-29")],
};

// ── ASCII-safe stored ZIP ──
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const asciiSafe = (n) => [0, 8, 16, 24].every((s) => ((n >>> s) & 0xff) < 0x80);

function buildZip() {
  const pads = Object.keys(files).map(() => 0);
  const extra = Object.keys(files).map(() => 0); // local-header filler bytes, to steer the next entry's offset
  let cdPad = 0; // comment bytes on the first central-directory record, to steer the directory's own size
  for (let attempt = 0; attempt < 500_000; attempt++) {
    const names = Object.keys(files);
    const local = [];
    const central = [];
    let offset = 0;
    let retry = -1;
    names.forEach((name, i) => {
      if (retry >= 0) return;
      const data = Buffer.from(files[name].join("\n") + "\n" + "\n".repeat(pads[i]), "ascii");
      const crc = crc32(data);
      if (!asciiSafe(offset)) { retry = i - 1; return; }
      if (!asciiSafe(crc) || !asciiSafe(data.length)) { retry = 100 + i; return; }
      const nm = Buffer.from(name, "ascii");
      const fields = [u16(10), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nm.length)];
      const filler = Buffer.from(" ".repeat(extra[i]), "ascii");
      local.push(Buffer.concat([u32(0x04034b50), ...fields, u16(filler.length), nm, filler, data]));
      const comment = Buffer.from(" ".repeat(i === 0 ? cdPad : 0), "ascii");
      central.push(Buffer.concat([u32(0x02014b50), u16(10), ...fields, u16(0), u16(comment.length), u16(0), u16(0), u32(0), u32(offset), nm, comment]));
      offset += local.at(-1).length;
    });
    if (retry >= 100) { pads[retry - 100] += 1; continue; }
    if (retry >= 0) { extra[retry] += 1; continue; }
    const cd = Buffer.concat(central);
    if (!asciiSafe(offset)) { extra[extra.length - 1] += 1; continue; }
    if (!asciiSafe(cd.length)) { cdPad += 1; continue; }
    const zip = Buffer.concat([...local, cd, u32(0x06054b50), u16(0), u16(0), u16(names.length), u16(names.length), u32(cd.length), u32(offset), u16(0)]);
    if (zip.some((b) => b >= 0x80)) throw new Error("non-ASCII byte in the ZIP");
    return zip.toString("latin1");
  }
  throw new Error("could not build an ASCII-safe ZIP");
}

const master = { method: "GET", url: MASTER, status: 200, text: buildZip(), headers: { "content-type": "application/zip" } };
const ok = (data, message = "Request successful.") => ({ status: true, message, data, error: null });
const post = (path, json, expectBody) => ({ method: "POST", url: `${API}${path}`, ...(expectBody ? { expectBody } : {}), status: 200, json });
const SESSION = { sessionToken: "dummy.bigul.jwt.token" };
const w = (name, obj) => writeFileSync(`${dir}/${name}.json`, JSON.stringify(obj, null, 2) + "\n");
const base = { source: "CLIENT", clientCode: "DUMMY1" };

const streamTicks = {
  "if|nse_cm|Nifty 50": { ltp: 25041.35, close: 25001.2, open: 24990, high: 25080, low: 24950.5 },
  "if|bse_cm|SENSEX": { ltp: 82015.61, close: 81900.1, open: 81950, high: 82100, low: 81800 },
  "sf|nse_fo|40001": { ltp: 120.5, volume: 1620250, oi: 1312350, bid: 120.35, ask: 120.6, open: 110, high: 131, low: 101, close: 116.5 },
  "sf|nse_fo|40002": { ltp: 98.1, volume: 1320250, oi: 1012350, bid: 98.05, ask: 98.2, open: 101, high: 120, low: 90, close: 104 },
  "sf|nse_fo|40003": { ltp: 70, volume: 920250, oi: 812350, bid: 69.9, ask: 70.1, open: 65, high: 80, low: 60, close: 66 },
  "sf|nse_fo|40004": { ltp: 150.25, volume: 720250, oi: 612350, bid: 150.1, ask: 150.4, open: 160, high: 170, low: 140, close: 155 },
  "sf|nse_fo|58067": { ltp: 56110.4, volume: 210060, oi: 2100600, bid: 56110, ask: 56111, open: 56000, high: 56200, low: 55900, close: 55980 },
  "sf|nse_cm|2885": { ltp: 1215.4, volume: 4241579, bid: 1215.3, ask: 1215.5, open: 1211.2, high: 1220, low: 1205, close: 1211.2 },
  "sf|nse_cm|11536": { ltp: 3124.2, volume: 1241579, bid: 3124, ask: 3124.5, open: 3100, high: 3130, low: 3095, close: 3110 },
  "dp|nse_fo|40001": { bidPrice1: 120.35, bidPrice2: 120.3, askPrice1: 120.6, askPrice2: 120.65, bidQty1: 650, bidQty2: 1300, askQty1: 975, askQty2: 325, bidOrders1: 3, bidOrders2: 5, askOrders1: 4, askOrders2: 1 },
};

w("manifest", {
  brokerId: "bigul",
  creds: { apiKey: "dummyAppKey", apiSecret: "dummyAppSecret", clientCode: "DUMMY1" },
  symbol: "NIFTY",
  expiry: "2026-10-20",
  sources: [
    `${DOCS}#url_source_mapping (client base URL https://capi.bigul.co/api/v1, source CLIENT)`,
    `${DOCS}#client_auth (POST /auth/connect/login: headers x-api-key/x-api-secret, body source/clientCode/totp, data.token, valid until 12:30 AM)`,
    `${DOCS}#index_list (POST /order/index-list, error envelopes 400/401/429)`,
    `${DOCS}#master_download_main (${MASTER}; nse_cm/bse_cm/nse_fo/bse_fo CSV headers)`,
    `${DOCS}#margin_required (POST /order/user-limits)`,
    `${DOCS}#portfolio_reporting (POST /order/order-book)`,
    `${DOCS}#trade_position_holdings (POST /order/trade-book, /order/get-position, /order/get-holdings)`,
    `${DOCS}#place_order_api, #modify_order_api, #cancel_order_api (POST /order/vr-place, /order/vr-modify, /order/cancel)`,
    `${DOCS}#ws_intro .. #ws_option_chain and https://bigul.co/downloads/pythonSDK.zip (official SDK: feed URL and binary layout)`,
  ],
  notes: "REST payloads are the docs' samples with dummy ids, moved onto the dummy master's contracts. The master is a stored ZIP with the live files' header rows and dummy rows. Data fixtures add a dummy sessionToken (manifest creds stay logged out). streamTicks feed the fake WebSocket in bigul.test.mjs. Regenerate with generate-fixtures.mjs.",
});

w("login", {
  secrets: { totpCode: "123456" },
  responses: [{ method: "POST", url: `${API}/auth/connect/login`, expectBody: { source: "CLIENT", clientCode: "DUMMY1", totp: "123456" }, status: 200,
    json: { status: true, message: "TOTP verified successfully", data: { token: "dummy.bigul.jwt.token" }, error: null } }],
});

w("testConnection", { creds: SESSION, responses: [post("/order/index-list", ok({ idxList: ["Nifty 50", "Nifty Next 50", "Nifty Bank", "Nifty IT"] }), { ...base, exch: "NSE" })] });
w("instruments", { responses: [master], expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"] } });
w("expiries", { responses: [master], expect: { minRows: 2 } });
w("optionChain", { creds: SESSION, responses: [master], expect: { minStrikes: 2 }, streamTicks });
w("ltp", { creds: SESSION, responses: [master] });
w("quotes", { creds: SESSION, args: [[{ token: "40001", exchange: "NFO" }, { token: "2885", exchange: "NSE" }]], responses: [master], expect: { minRows: 2 } });
w("depth", { creds: SESSION, args: [{ token: "40001", exchange: "NFO" }], responses: [master] });

const orderRow = {
  brkClnt: "--", ordValDt: "NA", exUsrInfo: "NA", mfdBy: "NA", rmk: "HT", ordSrc: "EnterpriseWeb", prc: "1564.90", prcTp: "L",
  cnlQty: 0, qty: 100, unFldSz: 100, exOrdId: "1300000000011514", actId: "DUMMY1", trgPrc: "0.00", tok: "2885", fldQty: 0,
  ordDtTm: "24-Dec-2025 11:49:18", avgPrc: "0.00", stat: "Ok", prod: "CNC", exSeg: "nse_cm", ordSt: "open pending",
  trnsTp: "B", nOrdNo: "1300000000011514", trdSym: "RELIANCE-EQ",
};
const orderBook = post("/order/order-book", ok([orderRow]), base);
w("orderBook", { creds: SESSION, responses: [orderBook], expect: { minRows: 1 } });
w("tradeBook", { creds: SESSION, responses: [master, post("/order/trade-book", ok([{
  exOrdId: "1300000000018810", actId: "DUMMY1", fldQty: 3, flDt: "23-Dec-2025", avgPrc: "3465.00", prcTp: "L", prod: "MIS",
  exTm: "23-Dec-2025 12:25:41", exSeg: "nse_cm", trdSym: "TCS-EQ", flId: "600001954", flTm: "23-12-2025 12:25:41", trnsTp: "B",
  nOrdNo: "1110050961", ordDur: "DAY", stkPrc: "0.00", sym: "TCS" }]), base)], expect: { minRows: 1 } });
w("positions", { creds: SESSION, responses: [master, post("/order/get-position", ok([{
  buyAmt: "1944054.00", cfSellAmt: "0.00", prod: "NRML", exSeg: "nse_fo", sqrFlg: "Y", actId: "DUMMY1", flBuyQty: "35", flSellQty: "0",
  sellAmt: "0.00", posFlg: "true", trdSym: "BANKNIFTY26OCTFUT", sym: "BANKNIFTY", expDt: "27 Oct, 2026", brdLtQty: 35, exp: "27-OCT-2026",
  lotSz: "35", optTp: "XX", stkPrc: "0.00" }]), base)], expect: { minRows: 1 }, streamTicks });
w("holdings", { creds: SESSION, responses: [post("/order/get-holdings", ok({ hldVal: [{
  clprc: "1211.20", bseTrdSym: "RELIANCE", nseTrdSym: "RELIANCE-EQ", ex1: "nse_cm", ex2: "bse_cm", usdQty: "0", hldQty: "1000", scripCode: "500325",
  series: "EQ", prod: "CNC", colTp: "1", prc: "1300.00", hrCutPrc: "330000.00", tok1: "2885", tok2: "500325", slbQty: "1000" }] }), { ...base, prod: "CNC" })], expect: { minRows: 1 } });
w("funds", { creds: SESSION, responses: [post("/order/user-limits", ok({
  AddPreExpMrgnMisPrsnt: "0.00", CurExpMrgnNrmlPrsnt: "0.00", RmsPayOutAmt: "0.00", AdhocMargin: "0.00", tid: "server1_6228",
  AmountUtilizedPrsnt: "12500.00", CollateralValue: "12474366.00", RMSRequiredMargin: "0.00", stCode: 200, BoardLotLimit: "0" }), { ...base, seg: "ALL", exch: "ALL", prod: "ALL" })] });

w("placeOrder", {
  creds: SESSION,
  args: [{ token: "40001", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 1, price: 120.5 }, 65],
  responses: [master, post("/order/vr-place", ok({ nOrdNo: "1310111898" }), { ...base, es: "nse_fo", pc: "NRML", pr: "120.5", pt: "L", qt: "65", rt: "DAY", tk: "40001", ts: "NIFTY26O2025000CE", tt: "B", tp: "0" })],
});
w("modifyOrder", {
  creds: SESSION,
  args: ["1300000000011514", { orderType: "LIMIT", qty: 100, price: 1560 }],
  responses: [orderBook, post("/order/vr-modify", ok({ nOrdNo: "1300000000011514" }), { ...base, no: "1300000000011514", es: "nse_cm", pc: "CNC", pr: "1560", pt: "L", qt: "100", tk: "2885", ts: "RELIANCE-EQ", tt: "B" })],
});
w("cancelOrder", { creds: SESSION, args: ["1310111902"], responses: [post("/order/cancel", ok({ result: "1310111902" }), { ...base, on: "1310111902", am: "NO" })] });

console.log("Bigul fixtures written to", dir);
