/**
 * Writes the ICICI Direct (Breeze) contract fixtures. Run: node server/brokers/__fixtures__/icicidirect/generate-fixtures.mjs
 *
 * Payloads follow the "Sample JSON Response" blocks on https://api.icicidirect.com/breezeapi/documents/index.html
 * (envelope { Success, Status, Error }, field names and types as printed), moved onto October/November 2026 NIFTY
 * and RELIANCE contracts. The security master is a ZIP with the published NSEScripMaster.txt / FONSEScripMaster.txt
 * column layout (trimmed to the columns the adapter reads plus the header names around them). The harness can only
 * replay text bodies, so the ZIP is a valid STORED archive with correct CRC-32s whose bytes are all 7-bit (padded
 * with newlines until they are). Keys, session values and order ids are dummy values. No live call was used.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

const dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.icicidirect.com/breezeapi/api/v1";
const creds = { appKey: "8g791N029R47I831B8153O2f7u8g", secretKey: "dummyBreezeSecret123", apiSession: "58593123" };
const SESSION_TOKEN = "QUgzNzkzMDA6NDUwNTM0MjI=";

/**
 * A multi-entry stored ZIP whose bytes are all below 0x80, returned as a latin1 string. Each entry is padded with
 * newlines until its CRC-32, its size and the next entry's offset are 7-bit; the five real entry names keep the
 * central directory size 7-bit too.
 */
function sevenBitZip(entries) {
  const sevenBit = (n) => [0, 8, 16, 24].every((s) => ((n >>> s) & 0xff) < 0x80);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, "latin1");
    let data;
    let crc;
    for (let pad = 0; ; pad++) {
      if (pad > 20000) throw new Error(`could not build a 7-bit entry for ${name}`);
      data = Buffer.from(content + "\n".repeat(pad), "latin1");
      crc = crc32(data) >>> 0;
      if (sevenBit(crc) && sevenBit(data.length) && sevenBit(offset + 30 + nameBuf.length + data.length)) break;
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...locals, cd, end]);
  if (!zip.every((b) => b < 0x80)) throw new Error("could not build a 7-bit zip");
  return zip.toString("latin1");
}

const q = (vals) => vals.map((v) => `"${v}"`).join(",");
const NSE_HEAD = '"Token", "ShortName", "Series", "CompanyName", "ticksize", "Lotsize", "ISINCode", "Symbol", "ExchangeCode"';
const NSE = [
  NSE_HEAD,
  q(["NIFTY 50", "NIFTY", "0", "NIFTY 50", "0.01", "1", "", "", "NIFTY 50"]),
  q(["2885", "RELIND", "EQ", "RELIANCE INDUSTRIES", "0.1", "1", "INE002A01018", "", "RELIANCE"]),
  q(["1660", "ITC", "EQ", "ITC LIMITED", "0.05", "1", "INE154A01025", "", "ITC"]),
  q(["7075", "UNITEC", "EQ", "UNITECH LIMITED", "0.01", "1", "INE694A01020", "", "UNITECH"]),
  q(["0", "ACRTEC", "BE", "ACROPETAL TECHNOLOGIES LIMITED", "0.01", "1", "INE055L01013", "", "ACROPETAL"]),
].join("\n") + "\n";
const FO_HEAD = '"Token","InstrumentName","ShortName","Series","ExpiryDate","StrikePrice","OptionType","LotSize","TickSize","CompanyName","ExchangeCode"';
const fo = (token, inst, code, exp, strike, ot, lot, name, sym) => q([token, inst, code, inst.startsWith("OPT") ? "OPTION" : "FUTURE", exp, strike, ot, lot, "5", name, sym]);
const FONSE = [
  FO_HEAD,
  fo("51440", "OPTIDX", "NIFTY", "27-Oct-2026", "25000", "CE", "65", "NIFTY 50", "NIFTY 50"),
  fo("51441", "OPTIDX", "NIFTY", "27-Oct-2026", "25000", "PE", "65", "NIFTY 50", "NIFTY 50"),
  fo("35008", "OPTIDX", "NIFTY", "03-Nov-2026", "25000", "CE", "65", "NIFTY 50", "NIFTY 50"),
  fo("35009", "OPTIDX", "NIFTY", "03-Nov-2026", "25000", "PE", "65", "NIFTY 50", "NIFTY 50"),
  fo("35010", "OPTIDX", "NIFTY", "03-Nov-2026", "25050", "CE", "65", "NIFTY 50", "NIFTY 50"),
  fo("35011", "OPTIDX", "NIFTY", "03-Nov-2026", "25050", "PE", "65", "NIFTY 50", "NIFTY 50"),
  fo("61471", "FUTIDX", "NIFTY", "27-Oct-2026", "0", "XX", "65", "NIFTY 50", "NIFTY 50"),
  fo("35000", "OPTIDX", "CNXBAN", "27-Oct-2026", "56000", "CE", "35", "NIFTY BANK", "NIFTY BANK"),
  fo("36001", "OPTIDX", "NIFFIN", "27-Oct-2026", "25000", "CE", "60", "NIFTY FINANCIAL", "NIFTY FIN SERVICE"),
  fo("35004", "OPTIDX", "NIFSEL", "27-Oct-2026", "13000", "PE", "120", "NIFTY MIDCAP SELECT", "NIFTY MID SELECT"),
  fo("37001", "OPTIDX", "NIFNEX", "27-Oct-2026", "70000", "CE", "25", "NIFTY NEXT 50", "NIFTY NEXT 50"),
  fo("36342", "OPTSTK", "RELIND", "27-Oct-2026", "1400", "CE", "500", "RELIANCE INDUSTRIES", "RELIANCE"),
  fo("36343", "OPTSTK", "RELIND", "27-Oct-2026", "1400", "PE", "500", "RELIANCE INDUSTRIES", "RELIANCE"),
].join("\n") + "\n";
const master = {
  method: "GET", url: "https://directlink.icicidirect.com/NewSecurityMaster/SecurityMaster.zip",
  text: sevenBitZip([
    ["BSEScripMaster.txt", '"Token","ShortName"\n"500325","RELIND"\n'], ["CDNSEScripMaster.txt", '"Token","ShortName"\n'], ["FOBSEScripMaster.txt", '"Token","InstrumentName","ShortName"\n'],
    ["FONSEScripMaster.txt", FONSE], ["NSEScripMaster.txt", NSE],
  ]),
  headers: { "content-type": "application/zip" },
};

const session = {
  method: "GET", url: `${API}/customerdetails`, expectBody: { SessionToken: creds.apiSession, AppKey: creds.appKey },
  json: { Success: {
    exg_trade_date: { NSE: "19-Oct-2026", BSE: "19-Oct-2026", FNO: "19-Oct-2026", NDX: "19-Oct-2026" }, exg_status: { NSE: "O", BSE: "O", FNO: "Y", NDX: "O" },
    segments_allowed: { Trading: "Y", Equity: "Y", Derivatives: "Y", Currency: "Z" }, idirect_userid: "379XTZ300", session_token: SESSION_TOKEN,
    idirect_user_name: "JOHN SMITH", idirect_ORD_TYP: "N", idirect_lastlogin_time: "19-Oct-2026 09:50:42", mf_holding_mode_popup_flg: "N",
    commodity_exchange_status: "N", commodity_trade_date: "19-Oct-2026", commodity_allowed: "O",
  }, Status: 200, Error: null },
};
const ok = (Success) => ({ Success, Status: 200, Error: null });
const fundsJson = ok({ bank_account: "123456789012", total_bank_balance: 800000.0, allocated_equity: 200000.0, allocated_fno: 200000.0, allocated_commodity: 0, allocated_currency: 0, block_by_trade_equity: 0.0, block_by_trade_fno: 12500.53, block_by_trade_commodity: 0.0, block_by_trade_currency: 0.0, block_by_trade_balance: 12500.53, unallocated_balance: "387499.47" });

const chainLeg = (right, strike, ltp, oi, chg) => ({
  exchange_code: "NFO", product_type: "Options", stock_code: "NIFTY", expiry_date: "03-Nov-2026", right, strike_price: strike, ltp, ltt: "19-Oct-2026 11:36:56",
  best_bid_price: ltp - 0.5, best_bid_quantity: "1500", best_offer_price: ltp + 0.5, best_offer_quantity: "150", open: ltp - 5, high: ltp + 8, low: ltp - 9, previous_close: ltp - 2,
  ltp_percent_change: 1.2, upper_circuit: 6750.4, lower_circuit: 0.05, total_quantity_traded: "623325", spot_price: "25012.35", ltq: "75", open_interest: oi, chnge_oi: chg, total_buy_qty: "1000", total_sell_qty: "1200",
});
const quoteJson = (o) => ok([{ exchange_code: "NSE", product_type: "", stock_code: "NIFTY", expiry_date: "", right: "*", strike_price: 0.0, ltp: 25012.35, ltt: "19-Oct-2026 11:36:56", best_bid_price: 0, best_bid_quantity: "0", best_offer_price: 0, best_offer_quantity: "0", open: 24990, high: 25050.6, low: 24970, previous_close: 24985.4, ltp_percent_change: 0.1, upper_circuit: 0, lower_circuit: 0, total_quantity_traded: "0", spot_price: "25012.35", ...o }]);
const orderRow = {
  order_id: "20261019N300001234", exchange_order_id: null, exchange_code: "NFO", stock_code: "NIFTY", product_type: "Options", action: "Buy", order_type: "Limit", stoploss: "0.00",
  quantity: "65", price: "120.00", validity: "Day", disclosed_quantity: "0", expiry_date: "03-Nov-2026", right: "Call", strike_price: 25000.0, average_price: "0", cancelled_quantity: "0",
  pending_quantity: "65", status: "Ordered", user_remark: "", order_datetime: "19-Oct-2026 09:26", parent_order_id: null, modification_number: null,
  exchange_acknowledgement_date: null, SLTP_price: null, exchange_acknowledge_number: null, initial_limit: null, intial_sltp: null, LTP: null, limit_offset: null, mbc_flag: null, cutoff_price: null, validity_date: "",
};
const cashOrder = { ...orderRow, order_id: "20261019N300001235", exchange_code: "NSE", stock_code: "ITC", product_type: "Cash", order_type: "Limit", quantity: "1", price: "420.00", expiry_date: null, right: null, strike_price: 0.0, average_price: "419.95", pending_quantity: "0", status: "Executed" };
const orderBooks = [
  { method: "GET", url: `${API}/order`, expectBody: { exchange_code: "NSE" }, json: ok([cashOrder]) },
  { method: "GET", url: `${API}/order`, expectBody: { exchange_code: "NFO" }, json: ok([orderRow]) },
];

const files = {
  manifest: {
    brokerId: "icicidirect",
    creds,
    symbol: "NIFTY",
    expiry: "2026-11-03",
    sources: [
      "https://api.icicidirect.com/breezeapi/documents/index.html",
      "https://directlink.icicidirect.com/NewSecurityMaster/SecurityMaster.zip",
    ],
    notes: "Generated by generate-fixtures.mjs from the official doc samples (dummy ids). Every data fixture also answers the CustomerDetails exchange, because the session is cached on the first call. The OptionChain sample has no envelope header printed in the docs beyond the Success list; it is wrapped like every other Breeze response.",
  },
  testConnection: { responses: [session, { method: "GET", url: `${API}/funds`, json: fundsJson }], expect: { status: "success" } },
  instruments: { responses: [master], expect: { minRows: 12, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "RELIANCE"] } },
  expiries: { responses: [master], expect: { minRows: 2 } },
  optionChain: {
    responses: [session, master,
      { method: "GET", url: `${API}/OptionChain`, expectBody: { stock_code: "NIFTY", exchange_code: "NFO", expiry_date: "2026-11-03T06:00:00.000Z", product_type: "options", right: "call" },
        json: ok([chainLeg("Call", 25000.0, 182.4, 5110000.0, 120000.0), chainLeg("Call", 25050.0, 155.2, 1250000.0, -5000.0)]) },
      { method: "GET", url: `${API}/OptionChain`, expectBody: { stock_code: "NIFTY", exchange_code: "NFO", expiry_date: "2026-11-03T06:00:00.000Z", product_type: "options", right: "put" },
        json: ok([chainLeg("Put", 25000.0, 160.05, 5128500.0, 300000.0), chainLeg("Put", 25050.0, 183.9, 636000.0, 0.0)]) }],
    expect: { minStrikes: 2 },
  },
  ltp: { responses: [session, master, { method: "GET", url: `${API}/quotes`, expectBody: { stock_code: "NIFTY", exchange_code: "NSE", product_type: "cash" }, json: quoteJson({}) }] },
  quotes: {
    args: [[{ token: "35008", exchange: "NFO" }, { token: "2885", exchange: "NSE" }]],
    responses: [session, master,
      { method: "GET", url: `${API}/quotes`, expectBody: { stock_code: "NIFTY", exchange_code: "NFO", product_type: "options", expiry_date: "2026-11-03T06:00:00.000Z", right: "call", strike_price: "25000" },
        json: quoteJson({ exchange_code: "NFO", product_type: "Options", expiry_date: "03-Nov-2026", right: "Call", strike_price: 25000.0, ltp: 182.4, best_bid_price: 182.0, best_offer_price: 182.8, total_quantity_traded: "623325" }) },
      { method: "GET", url: `${API}/quotes`, expectBody: { stock_code: "RELIND", exchange_code: "NSE", product_type: "cash" },
        json: quoteJson({ stock_code: "RELIND", ltp: 1412.4, best_bid_price: 1412.3, best_offer_price: 1412.5, total_quantity_traded: "1951000" }) }],
    expect: { minRows: 2 },
  },
  historical: {
    args: [{ instrument: { token: "35008", exchange: "NFO" }, interval: "1m", from: "2026-10-16", to: "2026-10-16" }],
    responses: [session, master, {
      method: "GET", urlPattern: "^https://breezeapi\\.icicidirect\\.com/api/v2/historicalcharts\\?stock_code=NIFTY&exch_code=NFO&from_date=2026-10-16T00%3A00%3A00\\.000Z&to_date=2026-10-16T23%3A59%3A59\\.000Z&interval=1minute&product_type=options&expiry_date=2026-11-03&right=call&strike_price=25000$",
      json: ok([
        { datetime: "2026-10-16 09:22:00", stock_code: "NIFTY", exchange_code: "NFO", product_type: "Options", expiry_date: "03-NOV-26", right: "Call", strike_price: "25000", open: "196.85", high: "201.8", low: "196.5", close: "200.3", volume: "249000", open_interest: "2435175", count: 7 },
        { datetime: "2026-10-16 09:21:00", stock_code: "NIFTY", exchange_code: "NFO", product_type: "Options", expiry_date: "03-NOV-26", right: "Call", strike_price: "25000", open: "201.15", high: "203.9", low: "195.5", close: "197.55", volume: "304575", open_interest: "2435175", count: 6 },
      ]),
    }],
    expect: { minRows: 2 },
  },
  positions: {
    responses: [session, master, { method: "GET", url: `${API}/portfoliopositions`, json: ok([
      { segment: "fno", product_type: "Options", exchange_code: "NFO", stock_code: "NIFTY", expiry_date: "03-Nov-2026", strike_price: "25000", right: "Call", action: "Buy", quantity: "65", average_price: "150", settlement_id: null, margin_amount: null, ltp: "182.40", price: "182.40", stock_index_indicator: "Index", cover_quantity: "0", stoploss_trigger: "0", underlying: "NIFTY" },
      { segment: "fno", product_type: "Options", exchange_code: "NFO", stock_code: "NIFTY", expiry_date: "27-Oct-2026", strike_price: "25000", right: "Put", action: "NA", quantity: "0", average_price: "0", ltp: "29.95", price: "28.85", underlying: "NIFTY" },
    ]) }],
    expect: { minRows: 2 },
  },
  holdings: {
    responses: [session, master, { method: "GET", url: `${API}/dematholdings`, json: ok([{ stock_code: "UNITEC", stock_ISIN: "INE694A01020", quantity: "1", demat_total_bulk_quantity: "1", demat_avail_quantity: "0", blocked_quantity: "0", demat_allocated_quantity: "1" }]) }],
    expect: { minRows: 1 },
  },
  funds: { responses: [session, { method: "GET", url: `${API}/funds`, json: fundsJson }] },
  orderBook: { responses: [session, master, ...orderBooks], expect: { minRows: 2 } },
  tradeBook: {
    responses: [session, master,
      { method: "GET", url: `${API}/trades`, expectBody: { exchange_code: "NSE" }, json: ok([
        { book_type: "Trade-Book", trade_date: "19-Oct-2026", stock_code: "ITC", action: "Buy", quantity: "1", average_cost: "452.20", brokerage_amount: "0.00", product_type: "limit", exchange_code: "NSE", order_id: "20261019N300012345", segment: "M", settlement_code: "2026027", ltp: "451.95", order_type: "limit", expiry_date: null, right: null, strike_price: null },
      ]) },
      { method: "GET", url: `${API}/trades`, expectBody: { exchange_code: "NFO" }, json: { Success: null, Status: 500, Error: "No Data Found" } }],
    expect: { minRows: 1 },
  },
  placeOrder: {
    args: [{ token: "35008", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 1, price: 120 }, 65],
    responses: [session, master, { method: "POST", url: `${API}/order`,
      expectBody: { stock_code: "NIFTY", exchange_code: "NFO", product: "options", action: "buy", order_type: "limit", stoploss: "", quantity: "65", price: "120", validity: "day", disclosed_quantity: "0", expiry_date: "2026-11-03T06:00:00.000Z", right: "call", strike_price: "25000" },
      json: ok({ order_id: "202610191400001234", message: "Successfully Placed the order", user_remark: "" }) }],
  },
  modifyOrder: {
    args: ["20261019N300001234", { price: 121.5 }],
    responses: [session, ...orderBooks, { method: "PUT", url: `${API}/order`,
      expectBody: { order_id: "20261019N300001234", exchange_code: "NFO", order_type: "limit", stoploss: "", quantity: "65", price: "121.5", validity: "day", disclosed_quantity: "0", expiry_date: "2026-11-03T06:00:00.000Z", right: "call", strike_price: "25000" },
      json: ok({ message: "Successfully Modified the order", order_id: "20261019N300001234" }) }],
  },
  cancelOrder: {
    args: ["20261019N300001234"],
    responses: [session, ...orderBooks, { method: "DELETE", url: `${API}/order`, expectBody: { order_id: "20261019N300001234", exchange_code: "NFO" }, json: ok({ order_id: "20261019N300001234", message: "Your Order Canceled successfully." }) }],
  },
};

for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
console.log(`wrote ${Object.keys(files).length} fixture files to ${dir}`);
