/**
 * Writes the IndMoney (INDstocks) contract fixtures. Run: node server/brokers/__fixtures__/indmoney/generate-fixtures.mjs
 *
 * Payloads follow the response samples in the official Postman collection
 * (https://documenter.getpostman.com/view/56363899/2sBY4LShyj): same envelopes, field names and value types
 * (including string depth values like "1,102.60"), with dummy ids and current strikes/expiries. The CSVs use
 * the documented headers and row layout. No live call was used.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.indstocks.com";
const SESSION = { accessToken: "dummy-indstocks-token" };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FNO_HEAD = "EXCH,SEGMENT,SECURITY_ID,INSTRUMENT_NAME,EXPIRY_CODE,TRADING_SYMBOL,LOT_UNITS,CUSTOM_SYMBOL,EXPIRY_DATE,STRIKE_PRICE,OPTION_TYPE,TICK_SIZE,EXPIRY_FLAG,SEM_EXCH_INSTRUMENT_TYPE,SERIES,SYMBOL_NAME";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function drv(exch, id, kind, und, iso, strike, type, lot, flag = "M") {
  const [y, m, d] = iso.split("-").map(Number);
  const code = `${d} ${MON[m - 1]} ${y}`;
  const isFut = kind.startsWith("FUT");
  const ts = isFut ? `${und}-${MON[m - 1]}${y}-FUT` : `${und}-${MON[m - 1]}${y}-${strike}-${type}`;
  const custom = isFut ? `${und} ${d} ${MON[m - 1].toUpperCase()} -0.01 FUT` : `${und} ${d} ${MON[m - 1].toUpperCase()} ${strike} ${type}`;
  const exp = `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y} 14:00`;
  return [exch, "D", id, kind, code, ts, lot, custom, exp, isFut ? "-0.01000" : `${strike}.00000`, isFut ? "XX" : type, "5", flag, kind, "", ""].join(",");
}
const FNO = [
  FNO_HEAD,
  drv("NSE", "61001", "OPTIDX", "NIFTY", "2026-11-03", 25000, "CE", 65, "W"),
  drv("NSE", "61002", "OPTIDX", "NIFTY", "2026-11-03", 25000, "PE", 65, "W"),
  drv("NSE", "61003", "OPTIDX", "NIFTY", "2026-11-03", 25050, "CE", 65, "W"),
  drv("NSE", "61004", "OPTIDX", "NIFTY", "2026-11-03", 25050, "PE", 65, "W"),
  drv("NSE", "73871", "OPTIDX", "NIFTY", "2026-10-27", 25000, "CE", 65),
  drv("NSE", "73872", "OPTIDX", "NIFTY", "2026-10-27", 25000, "PE", 65),
  drv("NSE", "48704", "FUTIDX", "NIFTY", "2026-10-27", 0, "", 65),
  drv("NSE", "49445", "OPTIDX", "BANKNIFTY", "2026-10-27", 56000, "PE", 35),
  drv("NSE", "50319", "OPTIDX", "FINNIFTY", "2026-10-27", 25000, "CE", 60),
  drv("NSE", "52001", "OPTIDX", "MIDCPNIFTY", "2026-10-27", 13000, "CE", 140),
  drv("BSE", "823580", "OPTIDX", "SENSEX", "2026-10-22", 81000, "CE", 20, "W"),
  drv("BSE", "823581", "OPTIDX", "SENSEX", "2026-10-22", 81000, "PE", 20, "W"),
  drv("BSE", "824001", "OPTIDX", "BANKEX", "2026-10-27", 62000, "CE", 30),
  drv("NSE", "46263", "OPTSTK", "RELIANCE", "2026-10-27", 1400, "CE", 500),
  drv("NSE", "46264", "OPTSTK", "RELIANCE", "2026-10-27", 1400, "PE", 500),
  drv("NSE", "68772", "FUTSTK", "PREMIERENE", "2026-10-27", 0, "", 650),
  drv("NSE", "65655", "OPTIDX", "NIFTYNXT50", "2026-10-27", 79900, "CE", 25),
].join("\n") + "\n";
const EQUITY = [
  FNO_HEAD,
  "NSE,E,2885,EQUITY,,RELIANCE,1,RELIANCE INDUSTRIES LTD,,0.00000,,10,NA,ES,EQ,Reliance Industries Ltd",
  "BSE,E,512463,EQUITY,,LLOYDSENT,1,LLOYDS ENTERPRISES LIMITED,,0.00000,,1,NA,ES,A,Lloyds Enterprises Ltd",
  "BSE,E,810908,EQUITY,,774KA37,1,774KARSDL37,,0.00000,,5,NA,DBT,G,774KARSDL37",
  "NSE,E,17922,EQUITY,,GEEKAYWIRE,1,GEEKAY WIRES LIMITED,,0.00000,,1,NA,Other,EQ,Geekay Wires Ltd",
].join("\n") + "\n";
const INDEX = [
  "EXCH,SEGMENT,SECURITY_ID",
  "NSE,NIFTY IT,40000004",
  "BSE,SENSEX,40000006",
  "NSE,NIFTY 50,40000001",
  "NSE,BANK NIFTY,40000003",
  "BSE,BANKEX,40000033",
  "NSE,Nifty Midcap Sel,40000093",
  "NSE,Nifty Financial,40000100",
  "NSE,NiftyFinSrv25 50,40000076",
].join("\n") + "\n";
const csv = (source, text) => ({ method: "GET", url: `${API}/market/instruments?source=${source}`, text, headers: { "content-type": "text/csv" } });
const masters = [csv("fno", FNO), csv("index", INDEX), csv("equity", EQUITY)];

const depth = (bid, ask, code) => ({
  [code]: {
    aggregate: { total_buy: "1,250", total_sell: "1,281", buy_percentage: 49, sell_percentage: 51 },
    depth: [
      { buy: { quantity: "650", price: bid }, sell: { quantity: "1,281", price: ask } },
      { buy: { quantity: "0.00", price: "0.00" }, sell: { quantity: "0.00", price: "0.00" } },
    ],
  },
});
const fullQuote = (code, ltp, bid, ask, extra = {}) => ({
  live_price: ltp, day_change: 34.6, day_change_percentage: 3.24, day_low: ltp * 0.97, day_high: ltp * 1.02, day_open: ltp * 0.98,
  prev_close: ltp * 0.99, "52week_high": ltp * 1.5, "52week_low": ltp * 0.7, upper_circuit: ltp * 1.2, lower_circuit: ltp * 0.8,
  market_depth: depth(bid, ask, code), volume: 20994760, ...extra,
});
const qPattern = (codes) => `^${esc(`${API}/market/quotes/full?scrip-codes=`)}${codes.map(esc).join("%2C")}$`;

const orderRow = (over = {}) => ({
  created_at: "2026-10-16T09:18:40.446948+05:30", updated_at: "2026-10-16T09:18:40.498595+05:30", user_id: "710354", security_id: "73871", isin: "",
  name: "NIFTY 27 OCT 25000 CE", id: "DRV-28131451", exch_order_id: "1300000002340881", txn_type: "BUY", exchange: "NSE", segment: "DERIVATIVE",
  product: "MARGIN", order_type: "MARKET", validity: "DAY", mkt_type: "NL", off_mkt_flag: "false", traded_qty: 65, requested_qty: 65,
  requested_price: "43.55", traded_price: "43.55", sl_trigger_price: "", sl_limit_price: "", tgt_trigger_price: "", tgt_limit_price: "", status: "SUCCESS", extra_info: "", ...over,
});
const eqOrder = orderRow({
  security_id: "11915", isin: "INE528G01035", name: "Yes Bank Ltd", id: "EQ-93842477", exch_order_id: "1000000048655764", segment: "EQUITY",
  product: "CNC", order_type: "LIMIT", validity: "", off_mkt_flag: "true", traded_qty: 0, requested_qty: 1, requested_price: "23.60", traded_price: "0.00", status: "PENDING",
});
const orderBook = { method: "GET", url: `${API}/order-book`, json: { status: "success", data: [orderRow(), eqOrder] } };

const fixtures = {
  manifest: {
    brokerId: "indmoney",
    creds: { clientId: "IND1234567" },
    symbol: "NIFTY",
    expiry: "2026-11-03",
    sources: [
      "https://api-docs.indstocks.com/getting-started/",
      "https://documenter.getpostman.com/view/56363899/2sBY4LShyj",
    ],
    notes: "Generated by generate-fixtures.mjs from the official Postman collection samples (documented envelopes and field names; dummy ids). manifest.creds stays logged out; data fixtures add creds.accessToken (the session field).",
  },
  login: {
    secrets: { mpin: "4321", totpCode: "278460" },
    responses: [{ method: "POST", url: `${API}/generate/token`, expectBody: { mpin: "4321", totp: "278460" }, json: { token: "eyJh.dummy-session-token", expires_in: 1785461400 } }],
  },
  testConnection: {
    creds: SESSION,
    responses: [{ method: "GET", url: `${API}/user/profile`, json: { status: "success", data: { user_id: "123456", email: "abc@example.com", first_name: "Test", last_name: "User", demat_id: "1234xxxxxxxxxxxx", is_nse_onboarded: true, is_bse_onboarded: true, is_nse_fno_onboarded: true, is_bse_fno_onboarded: true, ucc: "1ABCDE2N7X", is_ddpi_active: true } } }],
    expect: { status: "success" },
  },
  instruments: { creds: SESSION, responses: masters, expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
  expiries: { creds: SESSION, responses: masters, expect: { minRows: 2 } },
  optionChain: {
    creds: SESSION,
    responses: [
      ...masters,
      {
        method: "GET", urlPattern: qPattern(["NIDX_40000001", "NFO_61001", "NFO_61002", "NFO_61003", "NFO_61004"]),
        json: { status: "success", data: {
          NIDX_40000001: fullQuote("NIDX_40000001", 25041.7, "0.00", "0.00"),
          NFO_61001: fullQuote("NFO_61001", 182.4, "182.20", "182.45"),
          NFO_61002: fullQuote("NFO_61002", 139.1, "139.05", "139.25"),
          NFO_61003: fullQuote("NFO_61003", 154.6, "154.50", "154.80"),
          NFO_61004: fullQuote("NFO_61004", 161.3, "161.10", "161.40"),
        } },
      },
    ],
    expect: { minStrikes: 2 },
  },
  ltp: {
    creds: SESSION,
    responses: [...masters, { method: "GET", url: `${API}/market/quotes/ltp?scrip-codes=NIDX_40000001`, json: { status: "success", data: { NIDX_40000001: { live_price: 25041.7 } } } }],
  },
  quotes: {
    creds: SESSION,
    args: [[{ token: "2885", exchange: "NSE" }, { token: "73871", exchange: "NFO" }]],
    responses: [...masters, {
      method: "GET", urlPattern: qPattern(["NSE_2885", "NFO_73871"]),
      json: { status: "success", data: { NSE_2885: fullQuote("NSE_2885", 1402.6, "1,402.55", "1,402.60"), NFO_73871: fullQuote("NFO_73871", 212.35, "212.30", "212.40") } },
    }],
    expect: { minRows: 2 },
  },
  depth: {
    creds: SESSION,
    args: [{ token: "1594", exchange: "NSE" }],
    responses: [...masters, { method: "GET", url: `${API}/market/quotes/mkt?scrip-codes=NSE_1594`, json: { status: "success", data: { NSE_1594: { market_depth: depth("1,102.55", "1,102.60", "NSE_1594") } } } }],
  },
  historical: {
    creds: SESSION,
    args: [{ instrument: { token: "1594", exchange: "NSE" }, interval: "60m", from: "2026-07-01", to: "2026-07-02" }],
    responses: [...masters, {
      method: "GET", url: `${API}/market/historical/60minute?scrip-codes=NSE_1594&start_time=1782844200000&end_time=1783017000000`,
      json: { success: true, data: { NSE_1594: { candles: [
        { ts: 1782877500, o: 1007, h: 1013.9, l: 999.3, c: 1000.4, v: 2847163 },
        { ts: 1782881100, o: 1000.4, h: 1002, l: 996.7, c: 999.6, v: 1389042 },
        { ts: 1782884700, o: 999.5, h: 999.9, l: 994.6, c: 995.4, v: 1022170 },
      ] } } },
    }],
    expect: { minRows: 3 },
  },
  positions: {
    creds: SESSION,
    responses: [
      { method: "GET", url: `${API}/portfolio/positions?segment=derivative&product=margin`, json: { status: "success", data: [
        { net_qty: 20, avg_price: 1.2, realized_profit: -1.0000000000000009, segment: "DERIVATIVE", product: "MARGIN", exchange: "", security_id: "823580", symbol: "SENSEX", drv_instrument: "OPTIDX", drv_expiry_date: "10/22/2026 14:00", drv_option_type: "CE", drv_strike_price: 81000, buy_qty: 40, buy_avg: 1.25, sell_qty: 20, sell_avg: 1.2, day_buy_qty: null, day_buy_val: null, day_sell_qty: null, day_sell_val: null, cf_buy_qty: null, cf_buy_val: null, cf_sell_qty: null, cf_sell_val: null, position_id: "535654528" },
      ] } },
      { method: "GET", url: `${API}/portfolio/positions?segment=derivative&product=intraday`, json: { status: "success", data: [] } },
      { method: "GET", url: `${API}/portfolio/positions?segment=equity&product=cnc`, json: { status: "success", data: [] } },
      { method: "GET", url: `${API}/portfolio/positions?segment=equity&product=intraday`, json: { status: "success", data: [
        { net_qty: 0, avg_price: 1146.85, realized_profit: -2.550000000000182, segment: "EQUITY", product: "INTRADAY", exchange: "NSE", isin: "INE560A01023", security_id: "1521", symbol: "INDIAGLYCO", drv_instrument: "", buy_qty: 1, buy_avg: 1149.4, sell_qty: 1, sell_avg: 1146.85, day_buy_qty: 1, day_buy_val: 1149.4, day_sell_qty: 1, day_sell_val: 1146.85, cf_buy_qty: null, cf_buy_val: null, cf_sell_qty: null, cf_sell_val: null, position_id: "86016462" },
      ] } },
    ],
    expect: { minRows: 2 },
  },
  holdings: {
    creds: SESSION,
    responses: [{ method: "GET", url: `${API}/portfolio/holdings`, json: { status: "success", data: [{ total_qty: 1, avg_price: 217.3, used_qty: 0, isin: "INE509F01029", security_id: "18520", symbol: "CUPID", t1_avg_price: 217.3, t1_qty: 1, dp_qty: 0, dp_avg_price: 0 }] } }],
    expect: { minRows: 1 },
  },
  funds: {
    creds: SESSION,
    responses: [{ method: "GET", url: `${API}/funds`, json: { status: "success", data: {
      sod_balance: 9060.28, pledge_received: 0, pledge_remained: 0,
      detailed_avl_balance: { option_sell: 1468.8027400000137, future: 1468.8027400000137, option_buy: 69686.30274000001, comm_option_buy: 1468.8027400000137, eq_mis: 1468.8027400000137, eq_cnc: 1468.8027400000137, eq_mtf: 963.3452400000124 },
      withdrawal_balance: 1528.8027400000074, funds_added: 0, funds_withdrawn: 0, realized_pnl: 31725.982500000002, unrealized_pnl: 39.137500000000486, brokerage: 0, eq_charges: 462.18999999999994, fno_charges: 0,
    } } }],
  },
  orderBook: { creds: SESSION, responses: [orderBook], expect: { minRows: 2 } },
  tradeBook: {
    creds: SESSION,
    responses: [
      orderBook,
      { method: "GET", url: `${API}/trade-book?segment=EQUITY`, json: { status: "success", data: [{ fill_id: 4537749, exch_order_id: "1000000048655764", quantity: 1, price: 23.6, trade_date: "2026-10-16T09:44:58+05:30", trade_serial_no: "1784101498466827356", scrip_code: "11915" }] } },
      { method: "GET", url: `${API}/trade-book?segment=DERIVATIVE`, json: { status: "success", data: [
        { fill_id: 4219700, exch_order_id: "1300000002340881", quantity: 65, price: 43.55, trade_date: "2026-10-16T09:18:41+05:30", trade_serial_no: "1784099414758911082", scrip_code: "73871" },
        { fill_id: 4244180, exch_order_id: "9999999999999999", quantity: 20, price: 1.25, trade_date: "2026-10-16T10:11:49+05:30", trade_serial_no: "1784099509605309869", scrip_code: "823580" },
      ] } },
    ],
    expect: { minRows: 2 },
  },
  placeOrder: {
    creds: SESSION,
    args: [{ tradingSymbol: "NIFTY-Oct2026-25000-CE", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 2, price: 95 }, 65],
    responses: [...masters, {
      method: "POST", url: `${API}/order`,
      expectBody: { txn_type: "BUY", exchange: "NSE", segment: "DERIVATIVE", product: "MARGIN", order_type: "LIMIT", validity: "DAY", security_id: "73871", qty: 130, algo_id: "99999", limit_price: 95, is_amo: false },
      json: { status: "success", data: { order_id: "DRV-29301125", order_status: "O-PENDING" } },
    }],
  },
  modifyOrder: {
    creds: SESSION,
    args: ["DRV-28131451", { qty: 130, price: 44 }],
    responses: [{ method: "POST", url: `${API}/order/modify`, expectBody: { order_id: "DRV-28131451", segment: "DERIVATIVE", qty: 130, limit_price: 44 }, json: { status: "success", data: { order_id: "DRV-28131451", order_status: "MODIFIED" } } }],
  },
  cancelOrder: {
    creds: SESSION,
    args: ["EQ-93842477"],
    responses: [{ method: "POST", url: `${API}/order/cancel`, expectBody: { order_id: "EQ-93842477", segment: "EQUITY" }, json: { status: "success", data: { order_id: "EQ-93842477", order_status: "CANCELLED" } } }],
  },
};

for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
console.log(`wrote ${Object.keys(fixtures).length} IndMoney fixtures`);
