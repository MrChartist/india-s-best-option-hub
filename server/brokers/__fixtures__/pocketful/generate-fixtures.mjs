// Run: node server/brokers/__fixtures__/pocketful/generate-fixtures.mjs  (rewrites the JSON fixtures in this folder; no network).
// Writes server/brokers/__fixtures__/pocketful/*.json from the official doc samples (dummy ids). The contract master
// is a real (stored, uncompressed) ZIP whose every byte is < 0x80, so it survives the harness's text response.
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
const dir = process.argv[2] || new URL(".", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const B = "https://algo.pocketful.in";
const D = "https://api.pocketful.in/docs/curl";
const H = "exchange_token,trading_symbol,company_name,close_price,expiry,strike,tick_size,lot_size,instrument_name,option_type,segment,exchange,fin_instrm_pdct_tp_cd,asset_code";
const files = {
  "NSECompactScrip.csv": [H, "26000,Nifty 50,,25001.20,,0.0000,0.0000,0,,,INDICES,NSE,,", "26009,Nifty Bank,,56010.50,,0.0000,0.0000,0,,,INDICES,NSE,,", "26037,Nifty Fin Service,,26364.20,,0.0000,0.0000,0,,,INDICES,NSE,,",
    "26074,NIFTY MID SELECT,,13722.60,,0.0000,0.0000,0,,,INDICES,NSE,,", "26017,India VIX,,14.03,,0.0000,0.0000,0,,,INDICES,NSE,,", '2885,RELIANCE-EQ,"RELIANCE INDUSTRIES LTD",1211.2,,0.0000,0.1000,1,EQ,,EQ,NSE,,'],
  "BSECompactScrip.csv": [H, "1,SENSEX,SENSEX,82015.61,,0.0000,0.0000,0,,,IDX,BSE,,", "12,BANKEX,BANKEX,62899.26,,0.0000,0.0000,0,,,IDX,BSE,,", "47,SNSX50,SNSX50,24200.62,,0.0000,0.0000,0,,,IDX,BSE,,"],
  "NFOCompactScrip.csv": [H, "40001,NIFTY26O2025000CE,NIFTY,116.5,20-Oct-2026,25000.0000,0.0500,65,OPTIDX,CE,XX,NFO,,", "40002,NIFTY26O2025000PE,NIFTY,104,20-Oct-2026,25000.0000,0.0500,65,OPTIDX,PE,XX,NFO,,",
    "40003,NIFTY26O2025100CE,NIFTY,66,20-Oct-2026,25100.0000,0.0500,65,OPTIDX,CE,XX,NFO,,", "40004,NIFTY26O2025100PE,NIFTY,155,20-Oct-2026,25100.0000,0.0500,65,OPTIDX,PE,XX,NFO,,",
    "40011,NIFTY26OCT25000CE,NIFTY,210,27-Oct-2026,25000.0000,0.0500,65,OPTIDX,CE,XX,NFO,,", "48704,NIFTY26OCTFUT,NIFTY,25119.2,27-Oct-2026,-0.0100,0.1000,65,FUTIDX,XX,XX,NFO,,",
    "41001,BANKNIFTY26OCT56000CE,BANKNIFTY,400,27-Oct-2026,56000.0000,0.0500,30,OPTIDX,CE,XX,NFO,,", "42001,FINNIFTY26OCT26000PE,FINNIFTY,150,27-Oct-2026,26000.0000,0.0500,60,OPTIDX,PE,XX,NFO,,",
    "43001,MIDCPNIFTY26OCT13000CE,MIDCPNIFTY,80,27-Oct-2026,13000.0000,0.0500,120,OPTIDX,CE,XX,NFO,,", "43501,NIFTYNXT5026OCT70000CE,NIFTYNXT50,80,27-Oct-2026,70000.0000,0.0500,25,OPTIDX,CE,XX,NFO,,",
    "44001,RELIANCE26OCT1220CE,RELIANCE,18,27-Oct-2026,1220.0000,0.0500,500,OPTSTK,CE,XX,NFO,,", "44002,RELIANCE26OCT1220PE,RELIANCE,22,27-Oct-2026,1220.0000,0.0500,500,OPTSTK,PE,XX,NFO,,"],
  "BFOCompactScrip.csv": [H, "1125419,SENSEX26O2282000CE,SENSEX,300,22-Oct-2026,82000.0000,0.0500,20,IO,CE,IO,BFO,BSXOPT,BSX", "1125420,SENSEX26O2282000PE,SENSEX,280,22-Oct-2026,82000.0000,0.0500,20,IO,PE,IO,BFO,BSXOPT,BSX",
    "1155242,BANKEX26OCT62000CE,BANKEX,500,29-Oct-2026,62000.0000,0.0500,30,IO,CE,IO,BFO,BKXOPT,BKX"],
};
const okBytes = (n, len) => { for (let i = 0; i < len; i++) if (((n >>> (8 * i)) & 0xff) >= 0x80) return false; return true; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function buildZip() {
  const entries = Object.entries(files).map(([name, lines]) => ({ name, base: lines.join("\n") + "\n", pad: 0 }));
  for (let attempt = 0; attempt < 200000; attempt++) {
    const local = []; const central = []; let offset = 0; let good = true;
    for (const [i, e] of entries.entries()) {
      const data = Buffer.from(e.base + "\n".repeat(e.pad), "ascii");
      const crc = crc32(data);
      if (!okBytes(offset, 4)) { entries[i - 1].pad += 1; good = false; break; }
      if (!okBytes(crc, 4) || !okBytes(data.length, 4)) { e.pad += 1; good = false; break; }
      const name = Buffer.from(e.name, "ascii");
      local.push(Buffer.concat([u32(0x04034b50), u16(10), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]));
      central.push(Buffer.concat([u32(0x02014b50), u16(10), u16(10), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
      offset += local.at(-1).length;
    }
    if (!good) continue;
    const cd = Buffer.concat(central);
    if (!okBytes(cd.length, 4) || !okBytes(offset, 4)) { entries.at(-1).pad += 1; continue; }
    const zip = Buffer.concat([...local, cd, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
    if (zip.some((b) => b >= 0x80)) throw new Error("non-ascii byte");
    return zip.toString("latin1");
  }
  throw new Error("could not build an ASCII-safe zip");
}
const master = { method: "GET", url: `${B}/api/v1/contract/Compact?info=download&exchanges=NSE,NFO,BSE,BFO`, status: 200, text: buildZip(), headers: { "content-type": "application/zip" } };
const ok = (data, message = "") => ({ data, message, status: "success" });
const q = (query) => new URLSearchParams(query).toString();
const ltp = (exch, seg, token, v) => ({ method: "GET", url: `${B}/api/v1/marketdata/${exch}/${seg}?${q({ token, key: "last_trade_price" })}`, status: 200, json: ok(v) });
const w = (name, obj) => writeFileSync(`${dir}/${name}.json`, JSON.stringify(obj, null, 2) + "\n");
const C = "DUMMY1";
const ticks = {
  "1|26000": { ltp: 25041.35, open: 24990, high: 25080, low: 24950.5, close: 25001.2, vol: 0 },
  "2|40001": { ltp: 120.5, open: 110, high: 131, low: 101, close: 116.5, vol: 1620250, oi: 1312350, ioi: 1217525, bid: 120.35, ask: 120.6 },
  "2|40002": { ltp: 98.1, open: 101, high: 120, low: 90, close: 104, vol: 1320250, oi: 1012350, ioi: 1017175, bid: 98.05, ask: 98.2 },
  "2|40003": { ltp: 70, open: 65, high: 80, low: 60, close: 66, vol: 920250, oi: 812350, ioi: 797525, bid: 69.9, ask: 70.1 },
  "6|1": { ltp: 82100.5, open: 82000, high: 82300, low: 81900, close: 82015.61, vol: 0 },
  "7|1125419": { ltp: 300, open: 290, high: 320, low: 280, close: 295, vol: 5000, oi: 1000, ioi: 800, bid: 299.5, ask: 300.5 },
  "7|1125420": { ltp: 280, open: 290, high: 300, low: 270, close: 285, vol: 4000, oi: 900, ioi: 950, bid: 279.5, ask: 280.5 },
  "2|40004": { ltp: 150, open: 160, high: 170, low: 140, close: 155, vol: 220250, oi: 612350, ioi: 607525, bid: 149.8, ask: 150.3 },
};
w("manifest", { brokerId: "pocketful", creds: { accessToken: "dummy-access-token", clientId: C }, symbol: "NIFTY", expiry: "2026-10-20",
  sources: [`${D}/login`, `${D}/individual-profile`, `${D}/security-id-list`, `${D}/get-market-data`, `${D}/get-last-traded-price`, `${D}/option-chain`, `${D}/getting-started`, `${D}/detailed-marketdata`, `${D}/connecting-websockets`,
    `${D}/fetch-position-netwise`, `${D}/fetch-demat-holdings`, `${D}/funds`, `${D}/fetch-pending-orders`, `${D}/fetch-completed-orders`, `${D}/trade-book`, `${D}/place-regular-order`, `${D}/modify-regular-order`, `${D}/cancel-regular-order`, `${D}/annexure`,
    "https://github.com/pocketful-tech/pocketfulapi-javascript"],
  notes: "Payloads are the official Pocketful API documentation samples (api.pocketful.in/docs/curl), trimmed, with ids, names and dates replaced by dummy values. The contract-master ZIP uses the live files' header row with dummy rows. streamTicks feed the fake WebSocket in pocketful.test.mjs (prices in rupees; encoded as paise like the docs' sample packet)." });
w("testConnection", { responses: [{ method: "GET", url: `${B}/api/v1/user/profile?client_id=${C}`, status: 200, json: { data: { broker_id: "Pocketful", client_id: C, email_id: "", exchanges_subscribed: '["BFO","BSE","MCX","NFO","NSE"]', lastlogintime: "", name: "DUMMY USER", phone_number: "", products_enabled: '["NRML","MIS","CNC","MTF"]' }, errorcode: "", message: "SUCCESS", status: true } }], expect: { status: "success" } });
w("instruments", { responses: [master], expect: { minRows: 10, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } });
w("expiries", { responses: [master], expect: { minRows: 2 } });
w("optionChain", { responses: [master], streamTicks: ticks, expect: { minStrikes: 2 } });
w("ltp", { responses: [master, ltp("NSE", "Capital", "26000", 25041.35)] });
w("quotes", { args: [[{ token: "2885", exchange: "NSE" }, { token: "40001", exchange: "NFO" }]], responses: [master,
  { method: "GET", url: `${B}/api/v1/marketdata/NSE/Capital?token=2885`, status: 200, json: ok({ ask_price: 121120, ask_qty: 1089, average_trade_price: 1205.97, bid_price: 121110, bid_qty: 3486, close_price: 1205.5, exchange: "NSE", exchange_timestamp: 1792130398, high_price: 1215, instrument_token: 2885, last_trade_price: 1211.2, last_trade_qty: 1, last_trade_time: 1792130397, low_price: 1198.1, open_price: 1206, segment: "Capital", total_buy_qty: 317485, total_sell_qty: 401730, trade_volume: 4311783, yearly_high: 160800, yearly_low: 111400 }) },
  { method: "GET", url: `${B}/api/v1/marketdata/NFO/FutOpt?token=40001`, status: 200, json: ok({ ask_price: 120.6, bid_price: 120.35, close_price: 116.5, exchange: "NFO", high_price: 131, instrument_token: 40001, last_trade_price: 120.5, low_price: 101, open_price: 110, segment: "FutOpt", trade_volume: 1620250 }) }], expect: { minRows: 2 } });
w("historical", { args: [{ instrument: { token: "40001", exchange: "NFO" }, interval: "1m", from: "2026-10-16T03:45:00Z", to: "2026-10-16T03:48:00Z" }], responses: [master,
  { method: "POST", url: `${B}/api/data/v1/historical`, expectBody: { symbol: "NIFTY", product_type: "options", type: "CE", strike_price: 25000, expiry_date: "2026-10-20", interval: "1minute", from_date: "2026-10-16T09:15:00", to_date: "2026-10-16T09:18:00" }, status: 200,
    json: { status: "success", data: [
      { timestamp: "2026-10-16T09:15:00Z", open: 110.5, high: 112.25, low: 109.8, close: 112.1, volume: 65000, open_interest: 1220000 },
      { timestamp: "2026-10-16T09:16:00Z", open: 112.1, high: 114, low: 111.2, close: 113.4, volume: 52000, open_interest: 1225000 },
      { timestamp: "2026-10-16T09:17:00Z", open: 113.4, high: 113.9, low: 111, close: 111.5, volume: 47000, open_interest: 1226000 } ] } }], expect: { minRows: 3 } });
w("positions", { responses: [{ method: "GET", url: `${B}/api/v1/positions?client_id=${C}&type=historical`, status: 200, json: ok([
  { average_buy_price: 0, average_price: 0, average_sell_price: 120, buy_amount: 0, buy_quantity: 0, cf_buy_amount: 0, cf_buy_quantity: 0, cf_sell_amount: 0, cf_sell_quantity: 0, client_id: C, close_price: 0, exchange: "NFO", instrument_token: 40001, ltp: 120.5, multiplier: 1, net_amount: 7800, net_quantity: -65, previous_close: 116.5, pro_cli: "CLIENT", prod_type: 0, product: "NRML", realized_mtm: 0, segment: "FutOpt", sell_amount: 7800, sell_quantity: 65, symbol: "NIFTY", token: 40001, trading_symbol: "NIFTY26O2025000CE", v_login_id: C },
  { average_buy_price: 40520, average_price: 0, average_sell_price: 40538, buy_amount: 40520, buy_quantity: 1, cf_buy_amount: 0, cf_buy_quantity: 0, cf_sell_amount: 0, cf_sell_quantity: 0, client_id: C, close_price: 0, exchange: "MCX", instrument_token: 222895, ltp: 40520, multiplier: 1, net_amount: 18, net_quantity: 0, previous_close: 40697, pro_cli: "CLIENT", prod_type: 0, product: "NRML", realized_mtm: 18, segment: "FutOpt", sell_amount: 40538, sell_quantity: 1, symbol: "GOLDGUINEA", token: 222895, trading_symbol: "GOLDGUINEA26NOVFUT", v_login_id: C } ]) }], expect: { minRows: 2 } });
w("holdings", { responses: [{ method: "GET", url: `${B}/api/v1/holdings?client_id=${C}`, status: 200, json: ok({ holdings: [
  { branch_code: "", buy_avg: 240.2, buy_avg_mtm: 277.75, client_id: C, exchange: "NSE", free_quantity: 55, instrument_details: { exchange: 1, instrument_name: "EQ", instrument_token: 3045, trading_symbol: "SBIN-EQ" }, isin: "INE062A01020", ltp: 245.25, pending_quantity: 0, pledge_quantity: 0, previous_close: 240.2, quantity: 55, symbol: "SBIN", t0_price: 0, t0_quantity: 0, t1_price: 0, t1_quantity: 0, t2_price: 0, t2_quantity: 0, today_pledge_quantity: 0, token: 3045, trading_symbol: "SBIN", transaction_type: "", used_quantity: 0 } ] }) }], expect: { minRows: 1 } });
const fv = [["Available", "109797.50"], ["Adhoc Deposit", "0.00"], ["Cash Deposit", "125000.00"], ["Delivery", "0.00"], ["DP Collateral Benefit", "0.00"], ["DP Credit for Sale", "0.00"], ["DP Pledge Collateral", "0.00"], ["Manual Collateral", "0.00"], ["Pay In", "0.00"], ["Net Margin", "0.00"], ["Notion Deposit", "0.00"], ["Overdraft", "0.00"], ["Pay out", "0.00"], ["Pool Collateral Benefit", "0.00"], ["Pool Pledge Collateral", "0.00"], ["Premium", "0.00"], ["Sar Collateral Benefit", "0.00"], ["Sar Credit for Sale", "0.00"], ["Span Margin", "12000.00"], ["Var Margin", "0.00"], ["Extreme Loss Margin", "3202.50"], ["Option Credit For Sell", "0.00"]];
w("funds", { responses: [{ method: "GET", url: `${B}/api/v2/funds/view?client_id=${C}&type=all`, status: 200, json: ok({ client_id: C, headers: ["Description", ""], values: fv }) }] });
const order = (id, status, qty, filled, extra = {}) => ({ mode: "NEW", exchange: "NFO", segment: "", login_id: C, deposit: 0, order_status: status, product: "NRML", order_type: "LIMIT", rejection_reason: "", order_side: "BUY", instrument_token: 40001, exchange_time: 1792130000, nnf_id: 333333333333100, quantity: qty, trading_symbol: "NIFTY26O2025000CE", client_id: C, average_trade_price: filled ? 118 : 0, underlying_token: null, oms_order_id: id, lot_size: 65, isin: "", disclosed_quantity: 0, execution_type: "REGULAR", source: "", device: "web", exchange_order_id: "", validity: "DAY", leg_order_indicator: null, trade_price: 0, spread_token: null, market_protection_percentage: 0, filled_quantity: filled, order_tag: "", sl_trigger_price: 0, square_off: false, order_status_info: "", square_off_value: 0, tags: null, order_entry_time: 1792129984, last_activity_reference: 0, trigger_price: 0, sl_order_price: 0, stop_loss_value: 0, rejection_code: 0, average_price: 0, trailing_stop_loss: 0, price: 118, user_order_id: "12780", symbol: "NIFTY", is_trailing: false, pro_cli: "CLIENT", remaining_quantity: qty - filled, contract_description: {}, series: "OPTIDX", target_price_type: "absolute", sl_order_quantity: 0, ...extra });
const pending = { method: "GET", url: `${B}/api/v1/orders?type=pending&client_id=${C}`, status: 200, json: ok({ orders: [order("2026101643", "PENDING", 130, 65), order("2026101644", "AMO_MODIFY_CONFIRMED", 65, 0), order("2026101646", "PENDING", 65, 0, { order_type: "SL", trigger_price: 117 })] }) };
const completed = { method: "GET", url: `${B}/api/v1/orders?type=completed&client_id=${C}`, status: 200, json: ok({ orders: [order("2026101635", "COMPLETE", 130, 130), order("2026101636", "REJECTED", 65, 0, { rejection_reason: "RMS: margin exceeds" }), order("2026101637", "AMO_CANCEL_CONFIRMED", 65, 0)] }) };
w("orderBook", { responses: [pending, completed], expect: { minRows: 6 } });
w("tradeBook", { responses: [{ method: "GET", url: `${B}/api/v1/trades?client_id=${C}`, status: 200, json: ok({ orders: [order("2026101635", "CONFIRMED", 130, 130, { exchange_order_id: "1100000029886168", trade_price: 118, exchange_time: 1792130025 })] }) }], expect: { minRows: 1 } });
w("placeOrder", { args: [{ token: "40001", exchange: "NFO", side: "BUY", orderType: "LIMIT", product: "MARGIN", validity: "DAY", lots: 2, price: 118 }, 65], responses: [master,
  { method: "POST", url: `${B}/api/v1/orders`, expectBody: { exchange: "NFO", instrument_token: "40001", client_id: C, order_type: "LIMIT", amo: false, price: 118, quantity: 130, validity: "DAY", product: "NRML", order_side: "BUY", device: "WEB", trigger_price: 0, execution_type: "REGULAR" }, status: 200, json: ok({ oms_order_id: "200018000000003" }, "Order place successfully") }] });
w("modifyOrder", { args: ["2026101643", { orderType: "LIMIT", qty: 130, price: 119.5, validity: "DAY" }], responses: [pending, completed,
  { method: "PUT", url: `${B}/api/v1/orders`, expectBody: { exchange: "NFO", instrument_token: "40001", client_id: C, order_type: "LIMIT", price: 119.5, quantity: 130, validity: "DAY", product: "NRML", order_side: "BUY", oms_order_id: "2026101643", execution_type: "REGULAR" }, status: 200, json: ok({ oms_order_id: "2026101643" }, "Order modification request submitted") }] });
w("cancelOrder", { args: ["2026101644"], responses: [
  { method: "DELETE", url: `${B}/api/v1/orders/2026101644`, expectBody: { oms_order_id: "2026101644", client_id: C, execution_type: "REGULAR" }, status: 200, json: ok({ oms_order_id: "2026101644" }, "Order cancellation request submitted for OMS Order: 2026101644") }] });
console.log("ok");
