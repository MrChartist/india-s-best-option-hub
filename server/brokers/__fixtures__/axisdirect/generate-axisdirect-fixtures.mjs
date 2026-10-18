/**
 * Regenerates the Axis Direct contract fixtures:
 *   node server/brokers/__fixtures__/axisdirect/generate-axisdirect-fixtures.mjs
 * Not a test and never run by vitest.
 *
 * Payloads are the decrypted response samples of the official "RAPID APIs by Axis Direct" Postman collection
 * (https://documenter.getpostman.com/view/33771924/2sA3BkasEf), trimmed, with ids and names replaced by dummy
 * values and the equity quote example moved onto NIFTY contracts using the documented field names. RAPID
 * responses are AES-GCM encrypted, so each sample is encrypted here with a fixed test key (TEST_SECRET_KEY,
 * which the test installs through __setSecretKeyFactoryForTests) and a fixed nonce, giving byte-stable files.
 * Request bodies are encrypted with a random nonce at run time, so fixtures match on URL only and the tests
 * decrypt the recorded request bodies to check them.
 *
 * The handshake public key is a throwaway 2048-bit RSA key made by this script; its private half is discarded.
 * The security master is a few rows in the live file's exact column layout (checked 18 Oct 2026).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, generateKeyPairSync } from "node:crypto";

const DIR = dirname(fileURLToPath(import.meta.url));
const TEST_SECRET_KEY = "00112233445566778899aabbccddeeff";
const AUTH = "https://welcome-api.axisdirect.in";
const TRADING = "https://invest-api.axisdirect.in";
const FUNDS = "https://funds-api.axisdirect.in";
const MASTER_URL = "https://invest-static-assets.axisdirect.in/TELESCOPE/security_master_web/SecurityMaster.csv";

let counter = 0;
function enc(obj) {
  const nonce = Buffer.alloc(16, 0);
  nonce.writeUInt32BE(++counter, 12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(TEST_SECRET_KEY, "utf8"), nonce);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return `${nonce.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}
const wrapped = (inner) => ({ statusCode: 200, status: "OK", data: { payload: enc(inner) } });
const post = (url, inner) => ({ method: "POST", url, json: wrapped(inner) });

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY_B64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const CREDS = { apiClientId: "dummyAxisClientId", authorizationKey: "dummyAxisAuthorisationKey", ssoId: "9a000000-d000-4000-8000-190000000002" };

// ── login (Handshake + SSO Authenticate samples; expiry moved onto the test date, 17 Oct 2026) ──
const handshake = { method: "POST", url: `${AUTH}/handshake`, json: { statusCode: 200, status: "OK", data: { publicKey: PUBLIC_KEY_B64 } } };
const authenticate = post(`${AUTH}/sso/authenticate`, {
  statusCode: 200, status: "OK",
  data: {
    metadata: { accounts: [{ accountType: "RCL", isPrimary: true, name: "DUMMY", subAccountId: "100006" }], isPasswordExpired: false, lastLoggedInAt: "2026-10-17T03:36:08Z", name: "DUMMY", userId: "dummyUserId" },
    authToken: { token: "dummyAxisAuthToken", expireAt: "2026-10-17T10:45:10.940184129+05:30" },
    refreshToken: { token: "dummyAxisRefreshToken", expireAt: "2026-10-17T23:59:59+05:30" },
    accounts: [{ subAccountId: "100006", isPrimary: true, name: "DUMMY", accountType: "RCL" }],
  },
});
const login = [handshake, authenticate];

// ── security master (live column layout) ──
const HEADER = "illiquid_sec,optiontype,is_etf,underlying,cover_allowed,lotsize,highprice,searchable,sem_tt_eligibility,exchange_symbol,sector_code,coname,odin_segmentid,odin_token_id,security_status,yesterday_open_int,odinuniqueid,fifty_two_week_high,scriptid,cmots_cocode_os,t_sett_day,segment,openprice,asset_class,sem_gsm_flag,emargin_allowed,quater_ago_rate,tcsuniqueid,expirydate,unique_key,asm_flag,instrumenttype,lowprice,yesterday_rate,market_cap,half_year_ago_rate,sem_reg_group_id,product_end_date_time,isin_code,@version,sem_gsm_stage,strikeprice,odin_llfc_segmentid,tcs_token_id,week_ago_rate,cmots_cocode,created_date,asl_allowed,sem_intersettlement_flg,mtf_margin,max_single_order_qty,search_priority,asl_hcut_pcnt,exchange_status,updated_date,sector_description,sem_exch_spcl_mar_pct,exchange_series,collateral_allowed,mcx_metric,dprhigh,@timestamp,solus_req,exchange,ticksize,nri_allowed,exchangesecurityid,closeprice,dprlow,gtd_allowed,m_cap_type,fifty_two_week_low";
const COLS = HEADER.split(",");
const csvCell = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, "\"\"")}"` : String(v));
const row = (o) => COLS.map((c) => csvCell(o[c] ?? "")).join(",");
const idx = (scriptid, root, name, exch, secId, und) => ({ scriptid, exchange_symbol: root, coname: name, exchange: exch, segment: "EQ", instrumenttype: "Underlying", exchangesecurityid: secId, exchange_series: "EQ", searchable: `${root} ${name} Underlying`, underlying: und ?? "" });
const opt = (scriptid, exch, root, und, expiry, strike, type, lot, label) => ({ scriptid, exchange: exch, segment: "FO", instrumenttype: "OPTIDX", exchange_symbol: root, underlying: und, expirydate: expiry, strikeprice: `${strike}.0`, optiontype: type, lotsize: lot, ticksize: "0.05", coname: label, searchable: `${root} ${label} Derivative` });
const LEGS = [
  { id: "3340001", strike: 24950, type: "CE", ltp: 141.3, oi: "1520400", v: "2310450", b: 141.1, s: 141.45 },
  { id: "3340002", strike: 24950, type: "PE", ltp: 78.15, oi: "2104500", v: "2988300", b: 78, s: 78.3 },
  { id: "3340003", strike: 25000, type: "CE", ltp: 104.95, oi: "3165900", v: "5430250", b: 104.85, s: 105.05 },
  { id: "3340004", strike: 25000, type: "PE", ltp: 92.4, oi: "2876400", v: "4876100", b: 92.25, s: 92.55 },
  { id: "3340005", strike: 25050, type: "CE", ltp: 74.6, oi: "1988700", v: "3120400", b: 74.45, s: 74.75 },
  { id: "3340006", strike: 25050, type: "PE", ltp: 112.8, oi: "1210200", v: "1650300", b: 112.6, s: 112.95 },
];
const master = [HEADER,
  row(idx("9926000", "NIFTY", "Nifty 50                 ", "NSE", "26000")),
  row(idx("9926009", "BANKNIFTY", "Nifty Bank", "NSE", "26009")),
  row(idx("9926013", "NIFTYNXT50", "Nifty Next 50", "NSE", "26013")),
  row(idx("9919000", "SENSEX", "SENSEX", "BSE", "19000")),
  row(idx("9919012", "BANKEX", "BANKEX", "BSE", "19012")),
  ...LEGS.map((l) => row(opt(l.id, "NSE", "NIFTY", "9926000", "2026-10-20", l.strike, l.type, "65", `NIFTY 20 OCT 26 ${l.strike} ${l.type}`))),
  row(opt("3340011", "NSE", "NIFTY", "9926000", "2026-10-27", 25000, "CE", "65", "NIFTY 27 OCT 26 25000 CE")),
  row({ ...opt("3358875", "NSE", "NIFTY", "9926000", "2026-10-27", 0, "XX", "65", "NIFTY 27 OCT 26 FUT"), instrumenttype: "FUTIDX", strikeprice: "0.0" }),
  row(opt("3340031", "NSE", "BANKNIFTY", "9926009", "2026-10-27", 56000, "CE", "30", "BANKNIFTY 27 OCT 26 56000 CE")),
  row(opt("3350288", "NSE", "FINNIFTY", "9926037", "2026-10-27", 24300, "PE", "60", "FINNIFTY 27 OCT 26 24300 PE")),
  row(opt("3340051", "NSE", "MIDCPNIFTY", "9926074", "2026-10-27", 13000, "PE", "120", "MIDCPNIFTY 27 OCT 26 13000 PE")),
  row(opt("3340061", "NSE", "NIFTYNXT50", "9926013", "2026-10-27", 68000, "CE", "25", "NIFTYNXT50 27 OCT 26 68000 CE")),
  row(opt("771125429", "BSE", "SENSEX", "9919000", "2026-10-22", 82000, "CE", "20", "SENSEX 22 OCT 26 82000 CE")),
  row(opt("77866170", "BSE", "BANKEX", "9919012", "2026-10-29", 63000, "PE", "30", "BANKEX 29 OCT 26 63000 PE")),
  row(opt("771138870", "BSE", "SENSEX50", "99847", "2026-10-29", 26900, "CE", "75", "SENSEX50 29 OCT 26 26900 CE")),
  row({ ...opt("3341459", "NSE", "RELIANCE", "222885", "2026-10-27", 1460, "CE", "500", "RELIANCE 27 OCT 26 1460 CE"), instrumenttype: "OPTSTK" }),
  row({ scriptid: "222885", exchange: "NSE", segment: "EQ", instrumenttype: "Equity", exchange_symbol: "RELIANCE", coname: "RELIANCE INDUSTRIES LTD", lotsize: "1", ticksize: "0.1", exchange_series: "EQ", exchangesecurityid: "2885", searchable: "RELIANCE INE002A01018 RELIANCE INDUSTRIES LTD Stocks 1000, Oil" }),
  row({ scriptid: "11500325", exchange: "BSE", segment: "EQ", instrumenttype: "Equity", exchange_symbol: "RELIANCE", coname: "RELIANCE INDUSTRIES LTD", lotsize: "1", ticksize: "0.05", exchange_series: "A" }),
  row({ scriptid: "55578656", exchange: "MCX", segment: "COMM", instrumenttype: "OPTFUT", exchange_symbol: "COPPER", underlying: "55574829", expirydate: "2026-10-23", strikeprice: "1250.0", optiontype: "CE", lotsize: "2500", coname: "COPPER 23 OCT 26 1250 CE" }),
].join("\n") + "\n";
const masterResp = { method: "GET", url: MASTER_URL, text: master, headers: { "content-type": "binary/octet-stream" } };

// ── market data (Quotes sample field names) ──
const tl = (scriptId, q) => ({ scriptId, ltp: q.ltp, buyQty: "650", sellQty: "325", buyPrice: q.b, sellPrice: q.s, lastTradeQuantity: "65", lastTradeTime: "2026-10-17 103010",
  lastUpdateTime: "2026-10-17 103011", openInterest: q.oi ?? "0", netChangeFromPrevClose: "+1.20", closePrice: q.c ?? q.ltp, openPrice: q.o ?? q.ltp, highPrice: q.h ?? q.ltp,
  lowPrice: q.l ?? q.ltp, volume: q.v ?? "0", averageTradedPrice: q.ltp, totalBuyQty: "0", totalSellQty: "0", lifeTimeHigh: 0, lifeTimeLow: 0, marketType: "" });
const SPOT_Q = tl("9926000", { ltp: 25012.15, b: 0, s: 0, o: 24950.1, h: 25060.35, l: 24931.8, c: 24980.55 });
const quotesResp = (rows) => post(`${TRADING}/feedbroadcast/multi-touch-line`, { statusCode: 200, status: "OK", message: "Successfully Fetched MutliTouchLine Broadcast", data: rows });

const marketStatus = { statusCode: 200, status: "OK", data: [
  { exchangeSegment: "NSE_EQ", updatedAt: "17/10/2026 09:15:00", marketStatus: "Open" },
  { exchangeSegment: "NSE_FO", updatedAt: "17/10/2026 09:15:00", marketStatus: "Open" },
  { exchangeSegment: "BSE_EQ", updatedAt: "17/10/2026 09:15:00", marketStatus: "Open" },
] };

// ── portfolio samples ──
const positionsEq = { statusCode: 200, status: "OK", data: [{ product: "DELIVERY", netQty: -1, buyQty: 0, avgBuyPrice: 0, totalSellQuantity: 1, avgSellPrice: 1407.7, avgTradedPrice: 1407.7,
  realizedPL: 0, unrealizedPL: 0, overallPL: 0, scriptId: "224963", symbol: "ICICIBANK", positionSide: "sell", instrument: "Equity", netPrice: 1407.7, netValue: -1407.7,
  optionType: "", expiryDate: "", lotSize: 1, sellValue: -1407.7, strikePrice: 0, tcsCode: "ICICIBANKEQ", isin: "INE090A01021", exchange: "NSE", securityDescription: "ICICI BANK LTD" }] };
const positionsFo = { statusCode: 200, status: "OK", data: [{ avgBuyPrice: 141.3, avgSellPrice: 0, buyQty: 130, buyValue: 18369, netPrice: 141.3, netQty: 130, netValue: -18369,
  exchange: "NSE", expiryDate: "2026-10-20", instrument: "OPTIDX", lotSize: 65, optionType: "CE", positionSide: "buy", product: "MARGIN", realizedPL: -1077.1875,
  unrealizedPL: 520, scriptId: "3340001", symbol: "NIFTY 20 OCT 26 24950 CE", strikePrice: 24950, sellQty: 0, series: "" }] };
const holdings = { statusCode: 200, status: "OK", data: { holdingDetails: [{ isinCode: "INF846K01X63",
  securityInfo: [{ scriptId: "221044", exchange: "NSE", symbol: "AXISBNKETF", haircutPct: -1, collateralAllowed: "N" }], totalFreeQty: 5, dpFreeQty: 0, poolFreeQty: 0, t1Qty: 0,
  avgPrice: 506.67, ltp: 0, pnl: 0, currentValue: 0, investedValue: 2533.37, product: "", collateralQty: 0, collateralValue: 0, closePrice: 0, holdingQty: "5",
  unrealizedGain: "-123.22", realizedGain: "", interSettlementQty: "0", emarginNetQuantity: 0, dematHeldQty: 0, pledge: 0, emargin: 0, dmatfreeQty: "5" }] } };
const limits = { statusCode: 200, status: "OK", data: { ledgerBalance: 250000, realizedProfitLossAndPremium: 0, mtm: 0, currentMarginAvailable: 180000, marginAgainstCollateral: 0, marginAddedToday: 0, marginUtilizedToday: 70000 } };

const files = {
  manifest: {
    brokerId: "axisdirect", creds: CREDS, symbol: "NIFTY", expiry: "2026-10-20",
    sources: [
      "https://documenter.getpostman.com/view/33771924/2sA3BkasEf (Encryption and Decryption; Login: Handshake API, SSO Initiate API, SSO Authenticate, Get AuthToken using RefreshToken; Security Master; Margin/Limit APIs: Available Margin; Market: Get Market Status, Quotes; Books/Reports: GetPositions; Portfolio: Holdings)",
      "https://simplehai.axisdirect.in/RapidAPI",
      `${MASTER_URL} (live column layout, 18 Oct 2026)`,
    ],
    notes: "Generated by __fixtures__/axisdirect/generate-axisdirect-fixtures.mjs. Responses are the collection's decrypted samples (dummy ids), re-encrypted with the fixed test key 00112233445566778899aabbccddeeff. Every capability file also answers the handshake and SSO Authenticate because the session is cached on the first call.",
  },
  testConnection: { responses: [...login, { method: "GET", url: `${TRADING}/markettracking/tracking/get-market-status`, json: wrapped(marketStatus) }], expect: { status: "success" } },
  instruments: { responses: [...login, masterResp], expect: { minRows: 15, underlyings: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE"] } },
  expiries: { responses: [...login, masterResp], expect: { minRows: 2 } },
  ltp: { responses: [...login, masterResp, quotesResp([SPOT_Q])] },
  // Request bodies are encrypted, so one multi-touch-line answer serves both the spot and the legs call.
  optionChain: { responses: [...login, masterResp, quotesResp([SPOT_Q, ...LEGS.map((l) => tl(l.id, l))])], expect: { minStrikes: 3 } },
  quotes: { args: [[{ token: "3340003", exchange: "NFO" }, { token: "9926000", exchange: "NSE" }]], responses: [...login, quotesResp([tl("3340003", LEGS[2]), SPOT_Q])], expect: { minRows: 2 } },
  positions: { responses: [...login, post(`${TRADING}/trading/portfolio/get-positions`, positionsEq)], expect: { minRows: 1 } },
  holdings: { responses: [...login, post(`${TRADING}/trading/portfolio/v2/get-holdings`, holdings)], expect: { minRows: 1 } },
  funds: { responses: [...login, post(`${FUNDS}/funds/inquiry/get-limits`, limits)] },
};
// Extra sample for axisdirect.test.mjs (not a capability name, so the harness ignores it).
files["positions-fo"] = { responses: [post(`${TRADING}/trading/portfolio/get-positions`, positionsFo)] };

mkdirSync(DIR, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(DIR, `${name}.json`), JSON.stringify(content, null, 2) + "\n");
console.log("Axis Direct fixtures written:", Object.keys(files).length, "files");
