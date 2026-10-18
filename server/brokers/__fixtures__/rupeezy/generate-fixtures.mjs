/**
 * Writes the Rupeezy (Vortex) contract fixtures. Run: node server/brokers/__fixtures__/rupeezy/generate-fixtures.mjs
 *
 * Payloads follow the response samples on https://vortex.rupeezy.in/docs/latest/* (authentication, user,
 * historical, option_chain, regular-order, positions, holdings, trades): same envelopes, field names and types,
 * moved onto October/November 2026 NIFTY, SENSEX and RELIANCE contracts. The master CSV uses the published
 * header of https://static.rupeezy.in/master.csv. Tokens, order ids and the access token are dummy values.
 * No live call was used.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const API = "https://vortex-api.rupeezy.in/v2";
const creds = { applicationId: "dev_TEST01", apiKey: "dummyXApiKey789", authToken: "dummyAuthToken123" };
const ACCESS = "eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.dummy.payload";

const session = {
  method: "POST", url: `${API}/user/session`,
  expectBody: {
    checksum: createHash("sha256").update(`${creds.applicationId}${creds.authToken}${creds.apiKey}`).digest("hex"),
    applicationId: creds.applicationId, token: creds.authToken,
  },
  json: {
    status: "success",
    data: {
      access_token: ACCESS, user_name: "JOHN DOE", login_time: "2026-Oct-19 09:10:50", email: "JOHN.DOE@EXAMPLE.COM", mobile: "9999999999",
      exchanges: ["NSE_EQ", "NSE_FO", "MCX_FO", "NSE_CUR"], product_types: ["INTRADAY", "DELIVERY", "MTF"], others: { userCode: "NXAAE", POA: 2 },
      user_id: "XX9999", tradingActive: true,
    },
  },
};

const HEAD = "token,exchange,symbol,instrument_name,series,expiry_date,option_type,strike_price,tick,lot_size,eligibility,security_desc,asm_gsm_stage,last_trading_date,isin_code,ticker,has_cas_session";
const idx = (token, ex, sym, series, desc) => `${token},${ex},${sym},EQIDX,${series},,,,5,0,0,${desc},,,,${ex.slice(0, 3)}:${sym}IDX,true`;
const eq = (token, sym, desc, isin) => `${token},NSE_EQ,${sym},EQUITIES,EQ,,,,10,1,1,${desc},,,${isin},NSE:${sym},true`;
const opt = (token, ex, sym, type, exp, ot, strike, lot, desc) => `${token},${ex},${sym},${type},XX,${exp},${ot},${strike}.0000000000,5,${lot},1,${desc},,,,${ex.slice(0, 3)}:${desc},false`;
const fut = (token, ex, sym, type, exp, lot, desc) => `${token},${ex},${sym},${type},XX,${exp},XX,0.000000000000000000,10,${lot},1,${desc},,,,${ex.slice(0, 3)}:${desc},false`;
const MASTER = [
  HEAD,
  idx(26000, "NSE_EQ", "NIFTY", "EQ", "NIFTY"),
  idx(26009, "NSE_EQ", "BANKNIFTY", "EQ", "NIFTY BANK"),
  idx(26037, "NSE_EQ", "FINNIFTY", "EQ", "NIFTY FIN SERVICE"),
  idx(26074, "NSE_EQ", "MIDCPNIFTY", "EQ", "NIFTY MID SELECT"),
  idx(26024, "NSE_EQ", "NIFTYPSE", "EQ", "NIFTY PSE"),
  idx(19000, "BSE_EQ", "SENSEX", "A", "SENSEX"),
  idx(19012, "BSE_EQ", "BANKEX", "A", "BANKEX"),
  eq(2885, "RELIANCE", "RELIANCE INDUSTRIES LTD", "INE002A01018"),
  eq(22, "ACC", "ACC LIMITED", "INE012A01025"),
  "500325,BSE_EQ,RELIANCE,EQUITIES,A,,,,5,1,1,RELIANCE INDUSTRIES LTD.,,,INE002A01018,BSE:RELIANCE,true",
  opt(51440, "NSE_FO", "NIFTY", "OPTIDX", "20261027", "CE", 25000, 65, "NIFTY26OCT25000CE"),
  opt(51441, "NSE_FO", "NIFTY", "OPTIDX", "20261027", "PE", 25000, 65, "NIFTY26OCT25000PE"),
  opt(37954, "NSE_FO", "NIFTY", "OPTIDX", "20261103", "CE", 25000, 65, "NIFTY26N0325000CE"),
  opt(37955, "NSE_FO", "NIFTY", "OPTIDX", "20261103", "PE", 25000, 65, "NIFTY26N0325000PE"),
  opt(37956, "NSE_FO", "NIFTY", "OPTIDX", "20261103", "CE", 25050, 65, "NIFTY26N0325050CE"),
  opt(37957, "NSE_FO", "NIFTY", "OPTIDX", "20261103", "PE", 25050, 65, "NIFTY26N0325050PE"),
  fut(48704, "NSE_FO", "NIFTY", "FUTIDX", "20261027", 65, "NIFTY26OCTFUT"),
  opt(35000, "NSE_FO", "BANKNIFTY", "OPTIDX", "20261027", "CE", 56000, 35, "BANKNIFTY26OCT56000CE"),
  opt(36001, "NSE_FO", "FINNIFTY", "OPTIDX", "20261027", "CE", 25000, 60, "FINNIFTY26OCT25000CE"),
  opt(56096, "NSE_FO", "MIDCPNIFTY", "OPTIDX", "20261027", "PE", 13000, 120, "MIDCPNIFTY26OCT13000PE"),
  opt(37001, "NSE_FO", "NIFTYNXT50", "OPTIDX", "20261027", "CE", 70000, 25, "NIFTYNXT5026OCT70000CE"),
  opt(36342, "NSE_FO", "RELIANCE", "OPTSTK", "20261027", "CE", 1400, 500, "RELIANCE26OCT1400CE"),
  opt(36343, "NSE_FO", "RELIANCE", "OPTSTK", "20261027", "PE", 1400, 500, "RELIANCE26OCT1400PE"),
  opt(864588, "BSE_FO", "SENSEX", "OPTIDX", "20261029", "CE", 81000, 20, "SENSEX26OCT81000CE"),
  opt(864589, "BSE_FO", "SENSEX", "OPTIDX", "20261029", "PE", 81000, 20, "SENSEX26OCT81000PE"),
  opt(1102570, "BSE_FO", "BANKEX", "OPTIDX", "20261126", "CE", 64000, 30, "BANKEX26NOV64000CE"),
  fut(1102569, "BSE_FO", "BANKEX", "FUTIDX", "20261126", 30, "BANKEX26NOVFUT"),
  "445566,MCX_FO,CRUDEOIL,FUTCOM,XX,20261119,XX,0.0000000000,100,100,1,CRUDEOIL26NOVFUT,,,,MCX:CRUDEOIL26NOVFUT,false",
].join("\n") + "\n";
const masterResponse = { method: "GET", url: "https://static.rupeezy.in/master.csv", text: MASTER, headers: { "content-type": "text/csv" } };

const depth = (buy, sell) => ({ buy, sell });
const empty5 = [{}, {}, {}, {}, {}];
const quoteRow = (key, exchange, token, ltp, extra = {}) => [key, {
  ticker: key, exchange, token, last_trade_time: 1792040758, last_update_time: 1792040758, last_trade_price: ltp, volume: 23700, average_trade_price: ltp,
  total_buy_quantity: 19500, total_sell_quantity: 12450, open_price: ltp - 4, high_price: ltp + 10, low_price: ltp - 12, close_price: ltp - 3,
  depth: depth(empty5, empty5), ...extra,
}];
const quotesUrl = (keys, mode) => `${API}/data/quotes?${keys.map((k) => `q=${encodeURIComponent(k)}`).join("&")}&mode=${mode}`;

const chainRow = (strike, iv, ceTok, peTok, ce, pe) => ({
  strike_price: strike, iv, theta: -5.74, vega: 7.62, gamma: 0.0003,
  CE: { token: ceTok, instrument_name: "OPTIDX", lot_size: 65, security_description: `NIFTY26N03${strike}CE`, eligibility: 1, ltp: ce[0], open_interest: ce[1], day_first_tick_oi: ce[2], volume: ce[3], delta: ce[4] },
  PE: { token: peTok, instrument_name: "OPTIDX", lot_size: 65, security_description: `NIFTY26N03${strike}PE`, eligibility: 1, ltp: pe[0], open_interest: pe[1], day_first_tick_oi: pe[2], volume: pe[3], delta: pe[4] },
});

const positionsJson = {
  status: "success",
  data: {
    net: [
      { ticker: "NSE:NIFTY26OCT25000CE", exchange: "NSE_FO", symbol: "NIFTY", expiry_date: "20261027", option_type: "CE", token: 51440, product: "INTRADAY", quantity: 65, overnight_buy_value: 0, overnight_sell_value: 0, overnight_average_price: 0, lot_size: 65, multiplier: 1, average_price: 104.1, value: -6766.5, buy_value: 6766.5, sell_value: 0, buy_quantity: 65, sell_quantity: 0, buy_price: 104.1, sell_price: 0 },
      { ticker: "NSE:ITC", exchange: "NSE_EQ", symbol: "ITC", expiry_date: "", option_type: "", token: 1660, product: "MTF", quantity: 0, overnight_buy_value: 380, overnight_sell_value: 0, overnight_average_price: 190, lot_size: 1, multiplier: 1, average_price: 357.3, value: 10, buy_value: 714.6, sell_value: 724.6, buy_quantity: 2, sell_quantity: 2, buy_price: 357.3, sell_price: 362.3 },
    ],
    day: [],
  },
};

const orderRow = {
  order_id: "NXAAE00003K3", ticker: "NSE:NIFTY26OCT25000CE", exchange: "NSE_FO", token: 51440, order_number: "0", status: "PENDING", error_reason: "", transaction_type: "BUY",
  product: "INTRADAY", variety: "SL", total_quantity: 65, pending_quantity: 65, traded_quantity: 0, disclosed_quantity: 0, disclosed_quantity_remaining: 0,
  order_price: 9.5, trigger_price: 9.2, traded_price: 0, validity: "DAY", symbol: "NIFTY", series: "XX", instrument_name: "OPTIDX", expiry_date: "20261027",
  strike_price: 25000, option_type: "CE", lot_size: 65, order_created_at: "2026-10-19 09:47:41", initiated_by: "API", modified_by: "API", is_amo: false,
  order_identifier: "Your identifier", tag_ids: [], middleware_order_id: 12341,
};

const files = {
  manifest: {
    brokerId: "rupeezy",
    creds,
    symbol: "NIFTY",
    expiry: "2026-11-03",
    sources: [
      "https://vortex.rupeezy.in/docs/latest/authentication/", "https://vortex.rupeezy.in/docs/latest/usage/", "https://vortex.rupeezy.in/docs/latest/instrument-list/",
      "https://vortex.rupeezy.in/docs/latest/option_chain/", "https://vortex.rupeezy.in/docs/latest/historical/", "https://vortex.rupeezy.in/docs/latest/feed/",
      "https://vortex.rupeezy.in/docs/latest/regular-order/", "https://vortex.rupeezy.in/docs/latest/positions/", "https://vortex.rupeezy.in/docs/latest/holdings/",
      "https://vortex.rupeezy.in/docs/latest/trades/", "https://vortex.rupeezy.in/docs/latest/user/", "https://static.rupeezy.in/master.csv",
    ],
    notes: "Generated by generate-fixtures.mjs from the official doc samples (dummy ids). Every data fixture also answers the /user/session exchange, because the session is cached on the first call. The funds sample has no envelope in the docs and is kept that way.",
  },
  testConnection: { responses: [session, { method: "GET", url: `${API}/user/funds`, json: { nse: { deposit: 22836.34, net_available: 36909.98 }, mcx: { deposit: 9191.75 } } }], expect: { status: "success" } },
  instruments: { responses: [masterResponse], expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
  expiries: { responses: [masterResponse], expect: { minRows: 2 } },
  optionChain: {
    responses: [session, masterResponse, {
      method: "POST", url: `${API}/strategies/option_chain`, expectBody: { symbol: "NIFTY", exchange: "NSE_EQ", expiry_date: "20261103", greeks: true },
      json: {
        status: "success", message: "",
        response: {
          symbol: "NIFTY", expiry_date: "20261103", has_parent_stock: true, expiry_dates: ["20261027", "20261103", "20261124"],
          options: { exchange: "NSE_FO", list: [
            chainRow(25000, 15.04, 37954, 37955, [717.45, 51100, 50000, 1200, 0.86], [35.95, 512850, 500000, 9000, -0.14]),
            chainRow(25050, 14.7, 37956, 37957, [628.05, 1250, 0, 0, 0.85], [40.55, 63600, 60000, 300, -0.15]),
          ] },
          parent: { symbol: "NIFTY", exchange: "NSE_EQ", token: 26000, isin: "", ltp: 25586 },
        },
      },
    }],
    expect: { minStrikes: 2 },
  },
  ltp: { responses: [session, masterResponse, { method: "GET", url: quotesUrl(["NSE_EQ-26000"], "ltp"), json: { status: "success", data: { "NSE_EQ-26000": { exchange: "NSE_EQ", token: 26000, last_trade_price: 25586.05 } } } }] },
  quotes: {
    args: [[{ token: "51440", exchange: "NFO" }, { token: "2885", exchange: "NSE" }]],
    responses: [session, { method: "GET", url: quotesUrl(["NSE_FO-51440", "NSE_EQ-2885"], "full"), json: { status: "success", data: Object.fromEntries([
      quoteRow("NSE_FO-51440", "NSE_FO", 51440, 104.1, { open_interest: 15450, depth: depth(
        [{ price: 102.15, quantity: 150, orders: 1 }, { price: 102.1, quantity: 150, orders: 1 }, { price: 102.05, quantity: 150, orders: 1 }, { price: 96.5, quantity: 150, orders: 1 }, { price: 87, quantity: 4500, orders: 1 }],
        [{ price: 106.55, quantity: 150 }, { price: 106.6, quantity: 150, orders: 1 }, { price: 106.65, quantity: 300, orders: 2 }, { price: 107.75, quantity: 150, orders: 1 }, { price: 111.8, quantity: 150, orders: 1 }],
      ) }),
      quoteRow("NSE_EQ-2885", "NSE_EQ", 2885, 1412.4, { depth: depth([{ price: 1412.3, quantity: 586 }, {}, {}, {}, {}], empty5) }),
    ]) } }],
    expect: { minRows: 2 },
  },
  depth: {
    args: [{ token: "51440", exchange: "NFO" }],
    responses: [session, { method: "GET", url: quotesUrl(["NSE_FO-51440"], "full"), json: { status: "success", data: Object.fromEntries([quoteRow("NSE_FO-51440", "NSE_FO", 51440, 104.1, { open_interest: 15450, depth: depth(
      [{ price: 102.15, quantity: 150, orders: 1 }, { price: 102.1, quantity: 150, orders: 1 }, {}, {}, {}],
      [{ price: 106.55, quantity: 150 }, { price: 106.6, quantity: 150, orders: 1 }, {}, {}, {}],
    ) })]) } }],
  },
  historical: {
    args: [{ instrument: { token: "2885", exchange: "NSE" }, interval: "5m", from: "2026-10-16", to: "2026-10-16" }],
    responses: [session, {
      method: "GET", urlPattern: "^https://vortex-api\\.rupeezy\\.in/v2/data/history\\?exchange=NSE_EQ&token=2885&from=1792089000&to=1792175399&resolution=5$",
      json: { s: "ok", t: [1792143600, 1792143300, 1792143000], c: [1765.7, 1766.7, 1765.9], o: [1765.9, 1760.65, 1766.55], h: [1765.95, 1769.35, 1766.85], l: [1764.7, 1760.65, 1765], v: [850, 3625, 3910] },
    }],
    expect: { minRows: 3 },
  },
  positions: {
    responses: [session, { method: "GET", url: `${API}/trading/portfolio/positions`, json: positionsJson },
      { method: "GET", url: quotesUrl(["NSE_FO-51440"], "ltp"), json: { status: "success", data: { "NSE_FO-51440": { exchange: "NSE_FO", token: 51440, last_trade_price: 110.1 } } } }],
    expect: { minRows: 2 },
  },
  holdings: {
    responses: [session, { method: "GET", url: `${API}/trading/portfolio/holdings`, json: { status: "success", data: [
      { isin: "IN0020210244", nse: { ticker: "NSE:654GS2032", token: 7843, exchange: "NSE_EQ", symbol: "654GS2032" }, bse: { ticker: "BSE:654GS2032", token: 800440, exchange: "BSE_EQ", symbol: "654GS2032" }, total_free: 1, dp_free: 1, pool_free: 0, t1_quantity: 0, average_price: 95, collateral_quantity: 0, collateral_value: 0 },
      { isin: "INE721Z01010", nse: { ticker: "NSE:AARON", token: 1030, exchange: "NSE_EQ", symbol: "AARON" }, bse: {}, total_free: 1, dp_free: 1, pool_free: 0, t1_quantity: 0, average_price: 137.7, collateral_quantity: 0, collateral_value: 0 },
    ] } }],
    expect: { minRows: 2 },
  },
  funds: {
    responses: [session, { method: "GET", url: `${API}/user/funds`, json: {
      nse: { deposit: 22836.34, funds_transferred: 0, collateral: 14273.64, credit_for_sale: 0, option_credit_for_sale: 0, limit_utilization: -80, mtm_and_booked_loss: -20, booked_profit: 0, total_trading_power: 37009.98, total_utilization: -100, net_available: 36909.98, funds_withdrawn: -100, withdrawable_balance: 21636.34 },
      mcx: { deposit: 9191.75, funds_transferred: 0, collateral: 0, credit_for_sale: 0, option_credit_for_sale: 0, limit_utilization: 0, mtm_and_booked_loss: 0, booked_profit: 0, total_trading_power: 9191.75, total_utilization: 0, net_available: 9191.75, funds_withdrawn: 0, withdrawable_balance: 9191.75 },
    } }],
  },
  orderBook: {
    responses: [session, { method: "GET", url: `${API}/trading/orders`, json: { status: "success", orders: [orderRow], metadata: { total_records: 1, all_records: 1, completed_records: 0, open_records: 1 } } }],
    expect: { minRows: 1 },
  },
  tradeBook: {
    responses: [session, { method: "GET", url: `${API}/trading/trades`, json: { status: "success", trades: [
      { order_id: "NXAAE00002@6", ticker: "NSE:ACC", exchange: "NSE_EQ", token: 22, trade_no: "2416756", exchange_order_no: "1000000016120889", transaction_type: "SELL", product: "INTRADAY", variety: "RL", trade_quantity: 1, trade_price: 1856.75, symbol: "ACC", series: "EQ", instrument_name: "", expiry_date: "", strike_price: 0, option_type: "", traded_at: "2026-10-16 13:06:43", initiated_by: "API", modified_by: "API", order_identifier: "app=DEMO" },
      { order_id: "NXAAE00001@6", ticker: "NSE:ACC", exchange: "NSE_EQ", token: 22, trade_no: "2413994", exchange_order_no: "1000000016098874", transaction_type: "BUY", product: "INTRADAY", variety: "RL", trade_quantity: 1, trade_price: 1857, symbol: "ACC", series: "EQ", instrument_name: "", expiry_date: "", strike_price: 0, option_type: "", traded_at: "2026-10-16 13:06:17", initiated_by: "API", modified_by: "API", order_identifier: "app=DEMO" },
    ], metadata: { total_records: 2 } } }],
    expect: { minRows: 2 },
  },
  placeOrder: {
    args: [{ token: "51440", exchange: "NFO", side: "BUY", orderType: "SL", product: "INTRADAY", lots: 1, price: 10.5, triggerPrice: 10.2 }, 65],
    responses: [session, { method: "POST", url: `${API}/trading/orders/regular`, expectBody: { exchange: "NSE_FO", token: 51440, transaction_type: "BUY", product: "INTRADAY", variety: "SL", quantity: 65, price: 10.5, trigger_price: 10.2, validity: "DAY", is_amo: false },
      json: { data: { order_id: "NXAAE0001851" }, message: "Order placed successfully", status: "success" } }],
  },
  modifyOrder: {
    args: ["NXAAE00003K3", { price: 10.5, triggerPrice: 10.2 }],
    responses: [session,
      { method: "GET", url: `${API}/trading/orders/NXAAE00003K3`, json: { status: "success", code: "s-101", message: "Order history data fetched successfully", data: [orderRow], metadata: { total_records: 1 } } },
      { method: "PUT", url: `${API}/trading/orders/regular/NXAAE00003K3`, expectBody: { variety: "SL", quantity: 65, traded_quantity: 0, price: 10.5, trigger_price: 10.2, disclosed_quantity: 0, validity: "DAY" },
        json: { status: "success", code: "s-101", message: "Order Entry Sent to OMS", data: { order_id: "NXAAE00003K3" } } }],
  },
  cancelOrder: {
    args: ["NXAAE00003K3"],
    responses: [session, { method: "DELETE", url: `${API}/trading/orders/regular/NXAAE00003K3`, json: { status: "success", code: "s-101", message: "Order Cancellation Sent to OMS", data: { order_id: "NXAAE00003K3" } } }],
  },
};

for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
console.log(`wrote ${Object.keys(files).length} fixture files to ${dir}`);
