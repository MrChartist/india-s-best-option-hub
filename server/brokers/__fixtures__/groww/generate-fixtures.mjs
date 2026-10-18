/**
 * Writes the Groww contract fixtures. Run: node server/brokers/__fixtures__/groww/generate-fixtures.mjs
 *
 * Every payload follows the response samples on https://groww.in/trade-api/docs/curl/* (field names,
 * envelopes and value types as documented), with dummy ids and prices moved to current strikes/expiries.
 * The CSV uses the documented instrument.csv header and row layout. No live call was used.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const API = "https://api.groww.in";
const CSV_URL = "https://growwapi-assets.groww.in/instruments/instrument.csv";

const tokenResp = {
  method: "POST", url: `${API}/v1/token/api/access`, expectBody: { key_type: "approval" },
  json: { token: "dummy-groww-access-token", tokenRefId: "ref-123", sessionName: "my-session", expiry: "2026-10-18T06:00:00", isActive: true },
};
const ok = (payload) => ({ status: "SUCCESS", payload });

const HEADER = "exchange,exchange_token,trading_symbol,groww_symbol,name,instrument_type,segment,series,isin,underlying_symbol,underlying_exchange_token,expiry_date,strike_price,lot_size,tick_size,freeze_quantity,is_reserved,buy_allowed,sell_allowed";
const idx = (ex, tok, sym, name) => `${ex},${tok},${sym},${ex}-${sym},${name},IDX,CASH,,${sym},,,,,,,,,0,0`;
const opt = (ex, tok, sym, gsym, type, und, undTok, exp, strike, lot) => `${ex},${tok},${sym},${gsym},,${type},FNO,,,${und},${undTok},${exp},${strike},${lot},0.05,1801,0,1,1`;
const CSV = [
  HEADER,
  idx("NSE", "NIFTY", "NIFTY", "NIFTY 50"),
  idx("NSE", "BANKNIFTY", "BANKNIFTY", "NIFTY Bank"),
  idx("NSE", "FINNIFTY", "FINNIFTY", "Nifty Financial Services"),
  idx("NSE", "NIFTYMIDSELECT", "NIFTYMIDSELECT", "Nifty Midcap Select"),
  idx("BSE", "1", "SENSEX", "Bse Sensex"),
  idx("BSE", "14", "BANKEX", "Bse Bankex"),
  "NSE,2885,RELIANCE,NSE-RELIANCE,Reliance Industries,EQ,CASH,EQ,INE002A01018,,,,,1,0.1,,,1,1",
  opt("NSE", "61001", "NIFTY26N0325000CE", "NSE-NIFTY-03Nov26-25000-CE", "CE", "NIFTY", "26000", "2026-11-03", "25000", "65"),
  opt("NSE", "61002", "NIFTY26N0325000PE", "NSE-NIFTY-03Nov26-25000-PE", "PE", "NIFTY", "26000", "2026-11-03", "25000", "65"),
  opt("NSE", "61003", "NIFTY26N0325050CE", "NSE-NIFTY-03Nov26-25050-CE", "CE", "NIFTY", "26000", "2026-11-03", "25050", "65"),
  opt("NSE", "61004", "NIFTY26N0325050PE", "NSE-NIFTY-03Nov26-25050-PE", "PE", "NIFTY", "26000", "2026-11-03", "25050", "65"),
  opt("NSE", "51440", "NIFTY26OCT25000CE", "NSE-NIFTY-27Oct26-25000-CE", "CE", "NIFTY", "26000", "2026-10-27", "25000", "65"),
  opt("NSE", "51441", "NIFTY26OCT25000PE", "NSE-NIFTY-27Oct26-25000-PE", "PE", "NIFTY", "26000", "2026-10-27", "25000", "65"),
  "NSE,48704,NIFTY26OCTFUT,NSE-NIFTY-27Oct26-FUT,,FUT,FNO,,,NIFTY,26000,2026-10-27,-0.01,65,0.1,3511,0,1,1",
  opt("NSE", "49445", "BANKNIFTY26OCT56000PE", "NSE-BANKNIFTY-27Oct26-56000-PE", "PE", "BANKNIFTY", "26009", "2026-10-27", "56000", "35"),
  opt("NSE", "50319", "FINNIFTY26OCT25000CE", "NSE-FINNIFTY-27Oct26-25000-CE", "CE", "FINNIFTY", "26037", "2026-10-27", "25000", "60"),
  opt("NSE", "52001", "MIDCPNIFTY26OCT13000CE", "NSE-MIDCPNIFTY-27Oct26-13000-CE", "CE", "MIDCPNIFTY", "26074", "2026-10-27", "13000", "140"),
  opt("BSE", "1162037", "SENSEX26O2281000CE", "BSE-SENSEX-22Oct26-81000-CE", "CE", "SENSEX", "1", "2026-10-22", "81000", "20"),
  opt("BSE", "1162038", "SENSEX26O2281000PE", "BSE-SENSEX-22Oct26-81000-PE", "PE", "SENSEX", "1", "2026-10-22", "81000", "20"),
  opt("BSE", "1170001", "BANKEX26OCT62000CE", "BSE-BANKEX-29Oct26-62000-CE", "CE", "BANKEX", "14", "2026-10-29", "62000", "30"),
  opt("NSE", "73176", "RELIANCE26OCT1400CE", "NSE-RELIANCE-27Oct26-1400-CE", "CE", "RELIANCE", "2885", "2026-10-27", "1400", "500"),
  opt("NSE", "73177", "RELIANCE26OCT1400PE", "NSE-RELIANCE-27Oct26-1400-PE", "PE", "RELIANCE", "2885", "2026-10-27", "1400", "500"),
  opt("NSE", "80001", "NIFTYNXT5026OCT70000CE", "NSE-NIFTYNXT50-27Oct26-70000-CE", "CE", "NIFTYNXT50", "26013", "2026-10-27", "70000", "25"),
  "MCX,450001,CRUDEOIL26NOV5000CE,MCX-CRUDEOIL-16Nov26-5000-CE,,CE,COMMODITY,,,CRUDEOIL,,2026-11-16,5000,100,0.1,,0,1,1",
].join("\n") + "\n";
const csvResp = { method: "GET", url: CSV_URL, text: CSV, headers: { "content-type": "text/csv" } };

const orderRow = (over = {}) => ({
  groww_order_id: "GMK39038RDT490CCVRO", trading_symbol: "WIPRO", order_status: "OPEN", remark: "Order placed successfully",
  quantity: 100, price: 2500, trigger_price: 2450, filled_quantity: 100, remaining_quantity: 10, average_fill_price: 2500,
  deliverable_quantity: 10, amo_status: "PENDING", validity: "DAY", exchange: "NSE", order_type: "MARKET", transaction_type: "BUY",
  segment: "CASH", product: "CNC", created_at: "2023-10-01T10:15:30", exchange_time: "2023-10-01T10:15:30",
  trade_date: "2019-08-24T14:15:22Z", order_reference_id: "Ab-654321234-1628190", ...over,
});
const fnoOrder = orderRow({
  groww_order_id: "GMK39038RDT490CCVRP", trading_symbol: "NIFTY26OCT25000CE", order_status: "EXECUTED", quantity: 130, price: 95,
  trigger_price: 0, filled_quantity: 130, remaining_quantity: 0, average_fill_price: 94.5, order_type: "LIMIT", segment: "FNO", product: "NRML",
});
const orderListResps = [
  { method: "GET", urlPattern: "^https://api\\.groww\\.in/v1/order/list\\?segment=CASH&page=0&page_size=100$", json: ok({ order_list: [orderRow()] }) },
  { method: "GET", urlPattern: "^https://api\\.groww\\.in/v1/order/list\\?segment=FNO&page=0&page_size=100$", json: ok({ order_list: [fnoOrder] }) },
];
const trade = (over = {}) => ({
  price: 2500, isin: "INE075A01022", quantity: 100, groww_order_id: "GMK39038RDT490CCVRO", groww_trade_id: "TRADE123456",
  exchange_trade_id: "EXCH123456", exchange_order_id: "EXORD123456", trade_status: "COMPLETED", trading_symbol: "WIPRO",
  remark: "Trade executed successfully", exchange: "NSE", segment: "CASH", product: "CNC", transaction_type: "BUY",
  created_at: "2024-08-24T14:15:22Z", trade_date_time: "2024-08-24T14:15:22Z", settlement_number: "SETTLE123456", ...over,
});

const quote = (over = {}) => ({
  average_price: 150.25, bid_quantity: 1000, bid_price: 150, day_change: -0.5, day_change_perc: -0.33, upper_circuit_limit: 151,
  lower_circuit_limit: 148.5, ohlc: "{open: 149.50,high: 150.50,low: 148.50,close: 149.50}",
  depth: { buy: [{ price: 150, quantity: 1000 }, { price: 149.95, quantity: 500 }], sell: [{ price: 150.5, quantity: 2000 }, { price: 150.55, quantity: 300 }] },
  high_trade_range: 150.5, implied_volatility: 0.25, last_trade_quantity: 500, last_trade_time: 1633072800000, low_trade_range: 148.25,
  last_price: 149.5, market_cap: 5000000000, offer_price: 150.5, offer_quantity: 2000, oi_day_change: 100, oi_day_change_percentage: 0.5,
  open_interest: 2000, previous_open_interest: 1900, total_buy_quantity: 5000, total_sell_quantity: 4000, volume: 10000,
  week_52_high: 160, week_52_low: 140, ...over,
});

const leg = (ltp, oi, vol, iv, delta, sym) => ({ greeks: { delta, gamma: 0.0012, theta: -8.1, vega: 13.1, rho: 2.7, iv }, trading_symbol: sym, ltp, open_interest: oi, volume: vol });

const fixtures = {
  manifest: {
    brokerId: "groww",
    creds: { apiKey: "dummy-groww-api-key", apiSecret: "dummy-groww-api-secret" },
    symbol: "NIFTY",
    expiry: "2026-11-03",
    sources: [
      "https://groww.in/trade-api/docs/curl",
      "https://groww.in/trade-api/docs/curl/instruments",
      "https://groww.in/trade-api/docs/curl/orders",
      "https://groww.in/trade-api/docs/curl/portfolio",
      "https://groww.in/trade-api/docs/curl/margin",
      "https://groww.in/trade-api/docs/curl/live-data",
      "https://groww.in/trade-api/docs/curl/backtesting",
      "https://groww.in/trade-api/docs/curl/user",
      "https://groww.in/trade-api/docs/curl/annexures",
    ],
    notes: "Generated by generate-fixtures.mjs from the official doc samples (documented field names and envelopes; dummy ids). The instrument CSV uses the documented header. Every data fixture carries the key-pair token exchange response so each capability can run on its own.",
  },
  testConnection: {
    responses: [tokenResp, { method: "GET", url: `${API}/v1/user/detail`, json: ok({ vendor_user_id: "d86890d1-c60d-4ebd-9730-4f451670", ucc: "924189", nse_enabled: true, bse_enabled: true, ddpi_enabled: false, active_segments: ["CASH", "FNO"] }) }],
    expect: { status: "success" },
  },
  instruments: {
    responses: [csvResp],
    expect: { minRows: 20, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] },
  },
  expiries: { responses: [csvResp], expect: { minRows: 2 } },
  optionChain: {
    responses: [
      tokenResp, csvResp,
      {
        method: "GET", url: `${API}/v1/option-chain/exchange/NSE/underlying/NIFTY?expiry_date=2026-11-03`,
        json: ok({
          underlying_ltp: 25041.7,
          strikes: {
            25000: { CE: leg(182.4, 412300, 98110, 12.84, 0.5421, "NIFTY26N0325000CE"), PE: leg(139.1, 388150, 87012, 13.02, -0.4579, "NIFTY26N0325000PE") },
            25050: { CE: leg(154.6, 201775, 60331, 12.71, 0.5012, "NIFTY26N0325050CE"), PE: leg(161.3, 99820, 31440, 13.11, -0.4988, "NIFTY26N0325050PE") },
          },
        }),
      },
    ],
    expect: { minStrikes: 2 },
  },
  ltp: { responses: [tokenResp, csvResp, { method: "GET", url: `${API}/v1/live-data/ltp?segment=CASH&exchange_symbols=NSE_NIFTY`, json: ok({ NSE_NIFTY: 25041.7 }) }] },
  quotes: {
    args: [[{ token: "2885", exchange: "NSE" }, { token: "51440", exchange: "NFO" }]],
    responses: [
      tokenResp, csvResp,
      { method: "GET", url: `${API}/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE`, json: ok(quote({ open_interest: 0, previous_open_interest: 0 })) },
      { method: "GET", url: `${API}/v1/live-data/quote?exchange=NSE&segment=FNO&trading_symbol=NIFTY26OCT25000CE`, json: ok(quote({ last_price: 212.35, open_interest: 5123400 })) },
    ],
    expect: { minRows: 2 },
  },
  depth: {
    args: [{ token: "2885", exchange: "NSE" }],
    responses: [tokenResp, csvResp, { method: "GET", url: `${API}/v1/live-data/quote?exchange=NSE&segment=CASH&trading_symbol=RELIANCE`, json: ok(quote()) }],
  },
  historical: {
    args: [{ instrument: { token: "NIFTY", exchange: "NSE" }, interval: "30m", from: "2025-09-24", to: "2025-09-24" }],
    responses: [
      tokenResp, csvResp,
      {
        method: "GET", urlPattern: "^https://api\\.groww\\.in/v1/historical/candles\\?exchange=NSE&segment=CASH&groww_symbol=NSE-NIFTY&start_time=2025-09-24\\+09%3A15%3A00&end_time=2025-09-24\\+15%3A30%3A00&candle_interval=30minute$",
        json: ok({
          candles: [
            ["2025-09-24T10:30:00", 245.95, 246.15, 245.05, 245.6, 735060, null],
            ["2025-09-24T11:00:00", 245.64, 245.66, 244.8, 244.94, 682373, null],
            ["2025-09-24T11:30:00", 244.95, 245.28, 244.6, 245.13, 353800, null],
          ],
          closing_price: 244.6, start_time: "2025-09-24 10:30:00", end_time: "2025-09-24 13:30:00", interval_in_minutes: 30,
        }),
      },
    ],
    expect: { minRows: 3 },
  },
  positions: {
    responses: [tokenResp, {
      method: "GET", url: `${API}/v1/positions/user`,
      json: ok({ positions: [
        { trading_symbol: "RELIANCE", credit_quantity: 10, credit_price: 12500, debit_quantity: 5, debit_price: 12000, carry_forward_credit_quantity: 8, carry_forward_credit_price: 12300, carry_forward_debit_quantity: 3, carry_forward_debit_price: 11800, exchange: "NSE", symbol_isin: "INE123A01016", quantity: 15, product: "CNC", net_carry_forward_quantity: 10, net_price: 12400, net_carry_forward_price: 12200, realised_pnl: 500 },
        { trading_symbol: "NIFTY26OCT25000CE", segment: "FNO", credit_quantity: 130, credit_price: 95, debit_quantity: 0, debit_price: 0, carry_forward_credit_quantity: 0, carry_forward_credit_price: 0, carry_forward_debit_quantity: 0, carry_forward_debit_price: 0, exchange: "NSE", symbol_isin: "", quantity: 130, product: "NRML", net_carry_forward_quantity: 0, net_price: 95, net_carry_forward_price: 0, realised_pnl: 0 },
      ] }),
    }],
    expect: { minRows: 2 },
  },
  holdings: {
    responses: [tokenResp, {
      method: "GET", url: `${API}/v1/holdings/user`,
      json: ok({ holdings: [{ isin: "INE545U01014", trading_symbol: "RELIANCE", quantity: 10, average_price: 100, pledge_quantity: 2, demat_locked_quantity: 1, groww_locked_quantity: 1.5, repledge_quantity: 0.5, t1_quantity: 3, demat_free_quantity: 5, corporate_action_additional_quantity: 1, active_demat_transfer_quantity: 1 }] }),
    }],
    expect: { minRows: 1 },
  },
  funds: {
    responses: [tokenResp, {
      method: "GET", url: `${API}/v1/margins/detail/user`,
      json: ok({ clear_cash: 5000, net_margin_used: 35000, brokerage_and_charges: 200, collateral_used: 3000, collateral_available: 7000, adhoc_margin: 1500,
        fno_margin_details: { net_fno_margin_used: 15000, span_margin_used: 7000, exposure_margin_used: 4000, future_balance_available: 3000, option_buy_balance_available: 11000, option_sell_balance_available: 1000 },
        equity_margin_details: { net_equity_margin_used: 10000, cnc_margin_used: 5000, mis_margin_used: 3000, cnc_balance_available: 9000, mis_balance_available: 1000 } }),
    }],
  },
  orderBook: { responses: [tokenResp, ...orderListResps], expect: { minRows: 2 } },
  tradeBook: {
    responses: [
      tokenResp, ...orderListResps,
      { method: "GET", url: `${API}/v1/order/trades/GMK39038RDT490CCVRO?segment=CASH&page=0&page_size=50`, json: ok({ trade_list: [trade()] }) },
      { method: "GET", url: `${API}/v1/order/trades/GMK39038RDT490CCVRP?segment=FNO&page=0&page_size=50`, json: ok({ trade_list: [trade({ price: 94.5, quantity: 130, isin: "", groww_order_id: "GMK39038RDT490CCVRP", groww_trade_id: "TRADE123457", trading_symbol: "NIFTY26OCT25000CE", segment: "FNO", product: "NRML" })] }) },
    ],
    expect: { minRows: 2 },
  },
  placeOrder: {
    args: [{ tradingSymbol: "NIFTY26OCT25000CE", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", lots: 2, price: 95 }, 65],
    responses: [tokenResp, {
      method: "POST", url: `${API}/v1/order/create`,
      expectBody: { trading_symbol: "NIFTY26OCT25000CE", quantity: 130, price: 95, trigger_price: 0, validity: "DAY", exchange: "NSE", segment: "FNO", product: "NRML", order_type: "LIMIT", transaction_type: "BUY" },
      json: ok({ groww_order_id: "GMK39038RDT490CCVRO", order_status: "OPEN", order_reference_id: "Ab654321234162819", remark: "Order placed successfully" }),
    }],
  },
  modifyOrder: {
    args: ["GMK39038RDT490CCVRO", { orderType: "LIMIT", price: 2510 }],
    responses: [tokenResp, ...orderListResps, {
      method: "POST", url: `${API}/v1/order/modify`,
      expectBody: { quantity: 100, price: 2510, trigger_price: 0, order_type: "LIMIT", segment: "CASH", groww_order_id: "GMK39038RDT490CCVRO" },
      json: ok({ groww_order_id: "GMK39038RDT490CCVRO", order_status: "OPEN" }),
    }],
  },
  cancelOrder: {
    args: ["GMK39038RDT490CCVRO"],
    responses: [tokenResp, ...orderListResps, {
      method: "POST", url: `${API}/v1/order/cancel`, expectBody: { segment: "CASH", groww_order_id: "GMK39038RDT490CCVRO" },
      json: ok({ groww_order_id: "GMK39038RDT490CCVRO", order_status: "CANCELLED" }),
    }],
  },
};

for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
console.log(`wrote ${Object.keys(fixtures).length} Groww fixtures`);
