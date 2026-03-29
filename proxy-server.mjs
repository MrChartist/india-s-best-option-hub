/**
 * Local CORS Proxy Server for Mr. Chartist Options Terminal
 * 
 * Features:
 *   1. HTTP Proxy — forwards to Dhan API v2 and NSE India (CORS handled)
 *   2. WebSocket Relay — connects to Dhan Live Market Feed, parses binary,
 *      and broadcasts real-time JSON ticks to browser clients via ws://localhost:4002/ws
 * 
 * Usage:
 *   npm run proxy          # standalone
 *   npm run dev:live       # combined with Vite dev server
 * 
 * @port 4002 (configurable via PROXY_PORT env var)
 */

import http from "node:http";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

// ── Load .env manually (no external deps needed) ──
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(resolve(__dirname, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env file is optional */ }

const PORT = parseInt(process.env.PROXY_PORT || "4002", 10);
const DHAN_BASE = "https://api.dhan.co/v2";
const NSE_BASE = "https://www.nseindia.com";

// ══════════════════════════════════════════════
// ── SECTION 1: In-Memory Cache ──
// ══════════════════════════════════════════════

const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// ══════════════════════════════════════════════
// ── SECTION 2: Dhan REST API ──
// ══════════════════════════════════════════════

const INDEX_SECURITY_IDS = {
  NIFTY: { secId: 13, exchSeg: "IDX_I" },
  BANKNIFTY: { secId: 25, exchSeg: "IDX_I" },
  FINNIFTY: { secId: 27, exchSeg: "IDX_I" },
  MIDCPNIFTY: { secId: 442, exchSeg: "IDX_I" },
  SENSEX: { secId: 1, exchSeg: "IDX_I" },
};

const UNDERLYING_MAP = {
  NIFTY: { underlyingScrip: 13, expirySegment: "NSE_FNO" },
  BANKNIFTY: { underlyingScrip: 25, expirySegment: "NSE_FNO" },
  FINNIFTY: { underlyingScrip: 27, expirySegment: "NSE_FNO" },
  MIDCPNIFTY: { underlyingScrip: 442, expirySegment: "NSE_FNO" },
};

async function dhanFetch(path, body, method = "POST", customClientId, customAccessToken) {
  const clientId = customClientId || process.env.DHAN_CLIENT_ID;
  const accessToken = customAccessToken || process.env.DHAN_ACCESS_TOKEN;

  if (!clientId || !accessToken) {
    throw new Error("DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via headers.");
  }

  const url = `${DHAN_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
  };

  if (body && method === "POST") {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dhan API error [${res.status}]: ${errText}`);
  }
  return res.json();
}

async function handleDhanProxy(params, userClientId, userAccessToken) {
  const endpoint = params.get("endpoint");
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry");
  const userPrefix = userClientId ? `user:${userClientId}:` : "";
  const cacheKey = `dhan:${userPrefix}${endpoint}:${symbol}:${expiry || ""}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  switch (endpoint) {
    case "option-chain": {
      const underlying = UNDERLYING_MAP[symbol];
      if (!underlying) throw new Error(`Unknown symbol: ${symbol}. Supported: ${Object.keys(UNDERLYING_MAP).join(", ")}`);

      let expiryDate = expiry;
      if (!expiryDate) {
        const expiryListKey = `dhan:expiry-list:${symbol}:`;
        let expiryList = getCached(expiryListKey);
        if (!expiryList) {
          expiryList = await dhanFetch("/optionchain/expirylist", {
            UnderlyingScrip: underlying.underlyingScrip,
            UnderlyingSeg: underlying.expirySegment,
          }, "POST", userClientId, userAccessToken);
          setCache(expiryListKey, expiryList, 60000);
          await new Promise(r => setTimeout(r, 3500));
        }
        if (expiryList?.data?.length > 0) expiryDate = expiryList.data[0];
      }

      const body = {
        UnderlyingScrip: underlying.underlyingScrip,
        UnderlyingSeg: underlying.expirySegment,
      };
      if (expiryDate) body.ExpiryDate = expiryDate;

      const result = await dhanFetch("/optionchain", body, "POST", userClientId, userAccessToken);
      setCache(cacheKey, result, 3500);
      return { data: result, cacheHit: false };
    }

    case "expiry-list": {
      const underlying = UNDERLYING_MAP[symbol];
      if (!underlying) throw new Error(`Unknown symbol: ${symbol}`);

      const result = await dhanFetch("/optionchain/expirylist", {
        UnderlyingScrip: underlying.underlyingScrip,
        UnderlyingSeg: underlying.expirySegment,
      }, "POST", userClientId, userAccessToken);
      setCache(cacheKey, result, 60000);
      return { data: result, cacheHit: false };
    }

    case "ltp": {
      const secInfo = INDEX_SECURITY_IDS[symbol];
      if (!secInfo) throw new Error(`Unknown index: ${symbol}`);

      const result = await dhanFetch("/marketfeed/ltp", {
        NSE_FNO: [secInfo.secId],
      }, "POST", userClientId, userAccessToken);
      setCache(cacheKey, result, 2000);
      return { data: result, cacheHit: false };
    }

    case "instruments": {
      // Download Dhan instrument master CSV (public URL, no auth needed)
      const instrumentCacheKey = "dhan:instruments-master";
      const cached = getCached(instrumentCacheKey);
      if (cached) return { data: cached, cacheHit: true };

      console.log("  📥 Downloading Dhan instrument master CSV...");
      const csvUrl = "https://images.dhan.co/api-data/api-scrip-master.csv";
      const csvRes = await fetch(csvUrl);
      if (!csvRes.ok) throw new Error(`Failed to download instrument master: ${csvRes.status}`);
      const csvText = await csvRes.text();

      // Parse CSV — Actual columns (16 total):
      // SEM_EXM_EXCH_ID, SEM_SEGMENT, SEM_SMST_SECURITY_ID, SEM_INSTRUMENT_NAME,
      // SEM_EXPIRY_CODE, SEM_TRADING_SYMBOL, SEM_LOT_UNITS, SEM_CUSTOM_SYMBOL,
      // SEM_EXPIRY_DATE, SEM_STRIKE_PRICE, SEM_OPTION_TYPE, SEM_TICK_SIZE,
      // SEM_EXPIRY_FLAG, SEM_EXCH_INSTRUMENT_TYPE, SEM_SERIES, SM_SYMBOL_NAME
      //
      // CSV segment mapping: exchange + segment code → combined segment name
      // NSE + E → NSE_EQ, NSE + D → NSE_FNO, NSE + I → IDX_I, BSE + E → BSE_EQ, MCX + M → MCX_COMM
      const SEGMENT_MAP = {
        "NSE:E": "NSE_EQ",
        "NSE:D": "NSE_FNO",
        "NSE:I": "IDX_I",
        "NSE:C": "NSE_CUR",
        "NSE:M": "NSE_MF",
        "BSE:E": "BSE_EQ",
        "BSE:D": "BSE_FNO",
        "BSE:I": "BSE_IDX",
        "BSE:C": "BSE_CUR",
        "MCX:M": "MCX_COMM",
      };
      const ALLOWED_SEGMENTS = new Set(["NSE_EQ", "NSE_FNO", "IDX_I"]);

      const lines = csvText.split("\n");
      const header = lines[0].split(",").map(h => h.trim());
      
      const instruments = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        if (cols.length < 8) continue;
        
        const exchId = cols[header.indexOf("SEM_EXM_EXCH_ID")]?.trim();
        const segCode = cols[header.indexOf("SEM_SEGMENT")]?.trim();
        const secId = cols[header.indexOf("SEM_SMST_SECURITY_ID")]?.trim();
        const instrName = cols[header.indexOf("SEM_INSTRUMENT_NAME")]?.trim();
        const tradingSymbol = cols[header.indexOf("SEM_TRADING_SYMBOL")]?.trim();
        const lotUnitsRaw = cols[header.indexOf("SEM_LOT_UNITS")]?.trim();
        const lotSize = parseInt(parseFloat(lotUnitsRaw) || 1);
        const customSymbol = cols[header.indexOf("SEM_CUSTOM_SYMBOL")]?.trim();
        const expiryDate = cols[header.indexOf("SEM_EXPIRY_DATE")]?.trim();
        const strikePrice = parseFloat(cols[header.indexOf("SEM_STRIKE_PRICE")]?.trim()) || 0;
        const optionType = cols[header.indexOf("SEM_OPTION_TYPE")]?.trim();

        // Map exchange + segment code → combined segment name
        const exchangeSegment = SEGMENT_MAP[`${exchId}:${segCode}`];
        if (!exchangeSegment || !ALLOWED_SEGMENTS.has(exchangeSegment)) continue;

        // Extract base symbol from custom symbol (e.g., "EICHERMOT 26 MAY 5200 PUT" → "EICHERMOT")
        const baseSymbol = customSymbol?.split(" ")[0] || tradingSymbol?.split("-")[0] || tradingSymbol;

        instruments.push({
          securityId: secId,
          symbol: baseSymbol,
          tradingSymbol,
          exchangeSegment,
          instrumentType: instrName,
          lotSize,
          expiryDate: expiryDate && expiryDate !== "0001-01-01" ? expiryDate : undefined,
          strikePrice: strikePrice || undefined,
          optionType: optionType && optionType !== "XX" ? optionType : undefined,
        });
      }

      console.log(`  ✅ Parsed ${instruments.length} instruments from CSV`);
      setCache(instrumentCacheKey, { instruments, count: instruments.length }, 3600000); // 1hr cache
      return { data: { instruments, count: instruments.length }, cacheHit: false };
    }

    case "historical": {
      // Fetch intraday historical candle data
      const secId = params.get("securityId");
      const exchSeg = params.get("exchangeSegment") || "IDX_I";
      const instrument = params.get("instrument") || "INDEX";
      const interval = params.get("interval") || "5";
      const fromDate = params.get("fromDate");
      const toDate = params.get("toDate");

      if (!secId) throw new Error("Missing securityId parameter");

      // Default: last 2 trading days
      const now = new Date();
      const twoDaysAgo = new Date(now);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 3); // 3 days back to cover weekends
      
      const from = fromDate || `${twoDaysAgo.toISOString().split("T")[0]} 09:15`;
      const to = toDate || `${now.toISOString().split("T")[0]} 15:30`;

      const historicalCacheKey = `dhan:hist:${secId}:${interval}:${from}:${to}`;
      const cachedHist = getCached(historicalCacheKey);
      if (cachedHist) return { data: cachedHist, cacheHit: true };

      const body = {
        securityId: secId,
        exchangeSegment: exchSeg,
        instrument,
        fromDate: from,
        toDate: to,
        interval,
        expiryCode: 0,
        oi: exchSeg === "NSE_FNO",
      };

      const result = await dhanFetch("/charts/intraday", body, "POST", userClientId, userAccessToken);
      setCache(historicalCacheKey, result, 60000); // 1min cache
      return { data: result, cacheHit: false };
    }

    default:
      throw new Error(`Unknown endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical`);
  }
}

// ══════════════════════════════════════════════
// ── SECTION 3: NSE API ──
// ══════════════════════════════════════════════

let nseSessionCookies = "";
let nseSessionExpiry = 0;

async function getNSESession() {
  if (nseSessionCookies && Date.now() < nseSessionExpiry) return nseSessionCookies;

  const res = await fetch(NSE_BASE, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });
  const setCookie = res.headers.get("set-cookie") || "";
  nseSessionCookies = setCookie
    .split(",")
    .map(c => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  nseSessionExpiry = Date.now() + 120000;
  await res.text();
  return nseSessionCookies;
}

async function handleNSEProxy(params) {
  const endpoint = params.get("endpoint");
  const symbol = params.get("symbol");
  const cacheKey = `nse:${endpoint}:${symbol || ""}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  const cookies = await getNSESession();

  let apiPath;
  switch (endpoint) {
    case "option-chain":
      if (symbol && ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTY NEXT 50"].includes(symbol.toUpperCase())) {
        apiPath = `/api/option-chain-indices?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
      } else if (symbol) {
        apiPath = `/api/option-chain-equities?symbol=${encodeURIComponent(symbol.toUpperCase())}`;
      } else {
        apiPath = `/api/option-chain-indices?symbol=NIFTY`;
      }
      break;
    case "indices":
      apiPath = "/api/allIndices";
      break;
    case "market-status":
      apiPath = "/api/marketStatus";
      break;
    case "equity-derivatives":
      apiPath = `/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O`;
      break;
    case "market-data-pre-open":
      apiPath = "/api/market-data-pre-open?key=FO";
      break;
    case "fii-dii":
      apiPath = "/api/fiidiiTradeReact";
      break;
    default:
      throw new Error(`Unknown NSE endpoint: ${endpoint}`);
  }

  const nseRes = await fetch(`${NSE_BASE}${apiPath}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://www.nseindia.com/option-chain",
      Cookie: cookies,
    },
  });

  const data = await nseRes.json();
  const ttl = endpoint === "fii-dii" ? 300000 : 30000; // FII/DII: 5min cache, others: 30s
  setCache(cacheKey, data, ttl);
  return { data, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 3b: TradingView Scanner ──
// ══════════════════════════════════════════════

const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/india/scan";

// Top F&O stocks for TradingView scanning
const FNO_TICKERS = [
  "RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK","HINDUNILVR","SBIN","BHARTIARTL",
  "ITC","KOTAKBANK","LT","AXISBANK","ASIANPAINT","MARUTI","TATAMOTORS","SUNPHARMA",
  "TITAN","WIPRO","ULTRACEMCO","BAJFINANCE","HCLTECH","NTPC","POWERGRID","ONGC",
  "ADANIENT","ADANIPORTS","COALINDIA","DRREDDY","NESTLEIND","CIPLA","BAJAJFINSV",
  "GRASIM","JSWSTEEL","BRITANNIA","TECHM","INDUSINDBK","HINDALCO","M&M","APOLLOHOSP",
  "EICHERMOT","DIVISLAB","BPCL","HEROMOTOCO","TATASTEEL","SBILIFE","HDFCLIFE",
  "SHRIRAMFIN","TRENT","BAJAJ-AUTO","BANKBARODA","PNB","CANBK","IDFCFIRSTB",
  "FEDERALBNK","BANDHANBNK","RBLBANK","AUBANK","MANAPPURAM","MUTHOOTFIN",
  "CHOLAFIN","LICHSGFIN","CANFINHOME","RECLTD","PFC","HAL","BEL","BHEL",
  "IRCTC","ZOMATO","PAYTM","DLF","GODREJPROP","OBEROIRLTY","VEDL","JINDALSTEL",
  "SAIL","NMDC","IOC","GAIL","TATAPOWER","SIEMENS","ABB","VOLTAS","HAVELLS",
  "POLYCAB","LTIM","MPHASIS","COFORGE","PERSISTENT","TORNTPHARM","LUPIN",
  "AUROPHARMA","BIOCON","GODREJCP","DABUR","MARICO","COLPAL","MCX","INDIGO",
  "TVSMOTOR","MRF","ASHOKLEY","ESCORTS","DIXON","CROMPTON","JUBLFOOD","SUNTV",
].map(s => `NSE:${s}`);

const INDEX_TICKERS = ["NSE:NIFTY","NSE:BANKNIFTY","NSE:CNXFINANCE","BSE:SENSEX"];

async function handleTradingViewScan(params) {
  const scanType = params.get("type") || "stocks"; // "stocks" or "indices"
  const cacheKey = `tv:scan:${scanType}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  const isIndices = scanType === "indices";
  const tickers = isIndices ? INDEX_TICKERS : FNO_TICKERS;

  const body = {
    symbols: { tickers },
    columns: [
      "name", "description", "close", "change", "change_abs",
      "volume", "open", "high", "low", "Perf.W", "Perf.1M",
      "market_cap_basic", "average_volume_10d_calc",
      ...(isIndices ? [] : ["sector"]),
    ],
  };

  const res = await fetch(TRADINGVIEW_SCAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://www.tradingview.com/",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TradingView scan error [${res.status}]: ${errText}`);
  }

  const rawData = await res.json();
  
  // Parse TradingView response into clean format
  const stocks = (rawData.data || []).map(item => {
    const d = item.d || [];
    const cols = body.columns;
    const obj = {};
    cols.forEach((col, i) => { obj[col] = d[i]; });
    
    // Extract exchange:symbol from s (e.g. "NSE:RELIANCE")
    const [exchange, symbol] = (item.s || "").split(":");
    
    return {
      symbol: symbol || obj.name || "",
      name: obj.description || symbol || "",
      exchange: exchange || "NSE",
      ltp: obj.close || 0,
      change: obj.change || 0,
      changeAbs: obj.change_abs || 0,
      changePercent: obj.change || 0,
      volume: obj.volume || 0,
      open: obj.open || 0,
      high: obj.high || 0,
      low: obj.low || 0,
      weekChange: obj["Perf.W"] || 0,
      monthChange: obj["Perf.1M"] || 0,
      marketCap: obj.market_cap_basic || 0,
      avgVolume10d: obj.average_volume_10d_calc || 0,
      sector: obj.sector || "",
    };
  });

  console.log(`  📊 TradingView ${scanType}: ${stocks.length} results`);
  setCache(cacheKey, { stocks, totalCount: rawData.totalCount, timestamp: Date.now() }, 15000); // 15s cache
  return { data: { stocks, totalCount: rawData.totalCount, timestamp: Date.now() }, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 4: Dhan WebSocket Live Market Feed ──
// ══════════════════════════════════════════════

// Exchange segment enum (from Dhan Annexure)
const EXCHANGE_SEGMENTS = {
  0: "IDX_I",    // Index
  1: "NSE_EQ",   // NSE Equity
  2: "NSE_FNO",  // NSE F&O
  3: "NSE_CUR",  // NSE Currency
  4: "BSE_EQ",   // BSE Equity
  5: "MCX_COMM", // MCX Commodity
  7: "BSE_CUR",  // BSE Currency
  8: "BSE_FNO",  // BSE F&O
};

// Reverse lookup: segment name → number
const SEGMENT_NUMBERS = Object.fromEntries(Object.entries(EXCHANGE_SEGMENTS).map(([k, v]) => [v, parseInt(k)]));

// Security ID → human-readable symbol name
const SECURITY_ID_TO_SYMBOL = {
  13: "NIFTY",
  25: "BANKNIFTY",
  27: "FINNIFTY",
  442: "MIDCPNIFTY",
  26: "INDIAVIX",
  1: "SENSEX",
};

// Instruments to subscribe for real-time data
const WS_INSTRUMENTS = [
  { ExchangeSegment: "IDX_I", SecurityId: "13" },   // NIFTY 50
  { ExchangeSegment: "IDX_I", SecurityId: "25" },   // NIFTY BANK
  { ExchangeSegment: "IDX_I", SecurityId: "27" },   // NIFTY FIN SERVICE
  { ExchangeSegment: "IDX_I", SecurityId: "442" },  // MIDCAP NIFTY
  { ExchangeSegment: "IDX_I", SecurityId: "26" },   // INDIA VIX
];

// Latest tick cache (securityId → latest merged data)
const latestTicks = new Map();

/** Parse Dhan binary market feed packet (Little Endian) */
function parseDhanBinaryPacket(buffer) {
  if (buffer.length < 8) return null;

  const view = new DataView(buffer.buffer || buffer, buffer.byteOffset || 0, buffer.length);
  const responseCode = view.getUint8(0);
  const exchangeSegmentNum = view.getUint8(3);
  const securityId = view.getUint32(4, true); // Little Endian

  const exchangeSegment = EXCHANGE_SEGMENTS[exchangeSegmentNum] || `UNKNOWN_${exchangeSegmentNum}`;
  const symbol = SECURITY_ID_TO_SYMBOL[securityId] || `ID_${securityId}`;

  switch (responseCode) {
    case 2: { // Ticker Packet: LTP + LTT
      if (buffer.length < 16) return null;
      const ltp = view.getInt32(8, true) / 100;
      const ltt = view.getUint32(12, true);
      return { type: "ticker", responseCode, exchangeSegment, securityId, symbol, ltp, ltt };
    }

    case 4: { // Quote Packet: Full trade data
      if (buffer.length < 50) return null;
      const ltp = view.getInt32(8, true) / 100;
      const ltq = view.getUint16(12, true);
      const ltt = view.getUint32(14, true);
      const avgPrice = view.getInt32(18, true) / 100;
      const volume = view.getUint32(22, true);
      const totalSellQty = view.getUint32(26, true);
      const totalBuyQty = view.getUint32(30, true);
      const open = view.getInt32(34, true) / 100;
      const close = view.getInt32(38, true) / 100;
      const high = view.getInt32(42, true) / 100;
      const low = view.getInt32(46, true) / 100;
      return {
        type: "quote", responseCode, exchangeSegment, securityId, symbol,
        ltp, ltq, ltt, avgPrice, volume, totalSellQty, totalBuyQty,
        open, close, high, low,
      };
    }

    case 5: { // OI Data
      if (buffer.length < 12) return null;
      const oi = view.getUint32(8, true);
      return { type: "oi", responseCode, exchangeSegment, securityId, symbol, oi };
    }

    case 6: { // Prev Close
      if (buffer.length < 16) return null;
      const prevClose = view.getInt32(8, true) / 100;
      const prevOI = view.getUint32(12, true);
      return { type: "prevClose", responseCode, exchangeSegment, securityId, symbol, prevClose, prevOI };
    }

    case 8: { // Full Packet (Quote + OI + Depth)
      if (buffer.length < 62) return null;
      const ltp = view.getInt32(8, true) / 100;
      const ltq = view.getUint16(12, true);
      const ltt = view.getUint32(14, true);
      const avgPrice = view.getInt32(18, true) / 100;
      const volume = view.getUint32(22, true);
      const totalSellQty = view.getUint32(26, true);
      const totalBuyQty = view.getUint32(30, true);
      const open = view.getInt32(34, true) / 100;
      const close = view.getInt32(38, true) / 100;
      const high = view.getInt32(42, true) / 100;
      const low = view.getInt32(46, true) / 100;
      const oi = view.getUint32(50, true);
      const oiDayHigh = view.getUint32(54, true);
      const oiDayLow = view.getUint32(58, true);
      return {
        type: "full", responseCode, exchangeSegment, securityId, symbol,
        ltp, ltq, ltt, avgPrice, volume, totalSellQty, totalBuyQty,
        open, close, high, low, oi, oiDayHigh, oiDayLow,
      };
    }

    case 50: { // Disconnection packet
      let disconnectCode = 0;
      if (buffer.length >= 10) disconnectCode = view.getUint16(8, true);
      console.warn(`  ⚠️  Dhan WebSocket disconnection packet, code: ${disconnectCode}`);
      return { type: "disconnect", responseCode, disconnectCode };
    }

    default:
      return null;
  }
}

// ── Dhan WebSocket Connection Manager ──

let dhanWS = null;
let dhanWSReconnectTimer = null;
let dhanWSReconnectDelay = 1000;
let dhanWSConnected = false;
let dhanWSCredentials = { clientId: null, accessToken: null };

function connectDhanWebSocket(clientId, accessToken) {
  if (dhanWS && dhanWS.readyState === WebSocket.OPEN) {
    console.log("  ℹ️  Dhan WebSocket already connected");
    return;
  }

  if (!clientId || !accessToken) {
    console.log("  ⚠️  No Dhan credentials for WebSocket — skipping");
    return;
  }

  dhanWSCredentials = { clientId, accessToken };

  const wsUrl = `wss://api-feed.dhan.co?version=2&token=${accessToken}&clientId=${clientId}&authType=2`;
  console.log(`  🔌 Connecting to Dhan WebSocket...`);

  try {
    dhanWS = new WebSocket(wsUrl);
  } catch (err) {
    console.error("  ❌ Dhan WebSocket connection error:", err.message);
    scheduleDhanReconnect();
    return;
  }

  dhanWS.on("open", () => {
    console.log("  ✅ Dhan WebSocket connected!");
    dhanWSConnected = true;
    dhanWSReconnectDelay = 1000;

    // Subscribe to index instruments (Quote data = RequestCode 17)
    const subscribeMsg = JSON.stringify({
      RequestCode: 21, // Subscribe Quote for indices (use 15 for ticker, 17 for quote, 21 for full)
      InstrumentCount: WS_INSTRUMENTS.length,
      InstrumentList: WS_INSTRUMENTS,
    });
    dhanWS.send(subscribeMsg);
    console.log(`  📡 Subscribed to ${WS_INSTRUMENTS.length} instruments (Quote mode)`);

    // Broadcast connection status to browser clients
    broadcastToClients({ type: "status", connected: true, instrumentCount: WS_INSTRUMENTS.length });
  });

  dhanWS.on("message", (data) => {
    try {
      // Dhan sends binary data
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const parsed = parseDhanBinaryPacket(buf);
      if (!parsed || parsed.type === "disconnect") return;

      // Merge into latest tick cache
      const key = parsed.securityId;
      const existing = latestTicks.get(key) || {};
      const merged = { ...existing, ...parsed, timestamp: Date.now() };

      // Calculate change from prevClose if available
      if (merged.prevClose && merged.ltp) {
        merged.change = merged.ltp - merged.prevClose;
        merged.changePercent = (merged.change / merged.prevClose) * 100;
      }

      latestTicks.set(key, merged);

      // Broadcast to all connected browser clients
      broadcastToClients(merged);
    } catch (err) {
      // Silently ignore parse errors for unusual packets
    }
  });

  dhanWS.on("close", (code, reason) => {
    console.log(`  🔴 Dhan WebSocket closed (${code}): ${reason || "no reason"}`);
    dhanWSConnected = false;
    broadcastToClients({ type: "status", connected: false });
    scheduleDhanReconnect();
  });

  dhanWS.on("error", (err) => {
    console.error("  ❌ Dhan WebSocket error:", err.message);
    dhanWSConnected = false;
  });

  // Respond to server pings automatically (ws library handles this by default)
}

function scheduleDhanReconnect() {
  if (dhanWSReconnectTimer) clearTimeout(dhanWSReconnectTimer);
  dhanWSReconnectDelay = Math.min(dhanWSReconnectDelay * 2, 30000);
  console.log(`  🔄 Reconnecting in ${dhanWSReconnectDelay / 1000}s...`);
  dhanWSReconnectTimer = setTimeout(() => {
    connectDhanWebSocket(dhanWSCredentials.clientId, dhanWSCredentials.accessToken);
  }, dhanWSReconnectDelay);
}

// ── Local WebSocket Server (Browser ↔ Proxy) ──

const localWSS = new WebSocketServer({ noServer: true });

function broadcastToClients(data) {
  const json = JSON.stringify(data);
  localWSS.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
}

localWSS.on("connection", (ws) => {
  console.log("  🌐 Browser WebSocket client connected");

  // Send current status
  ws.send(JSON.stringify({
    type: "status",
    connected: dhanWSConnected,
    instrumentCount: WS_INSTRUMENTS.length,
  }));

  // Send all latest cached ticks immediately so browser has data instantly
  for (const [, tickData] of latestTicks) {
    ws.send(JSON.stringify(tickData));
  }

  // Handle messages from browser (e.g., credential updates, custom subscriptions)
  ws.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());

      if (parsed.type === "configure") {
        // Browser is sending Dhan credentials for WebSocket
        const { clientId, accessToken } = parsed;
        if (clientId && accessToken) {
          console.log("  🔑 Received Dhan credentials from browser, connecting WebSocket...");
          connectDhanWebSocket(clientId, accessToken);
        }
      }

      if (parsed.type === "subscribe" && parsed.instruments) {
        // Dynamic subscription support (future: option chain instruments)
        if (dhanWS && dhanWS.readyState === WebSocket.OPEN) {
          dhanWS.send(JSON.stringify({
            RequestCode: 21,
            InstrumentCount: parsed.instruments.length,
            InstrumentList: parsed.instruments,
          }));
        }
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on("close", () => {
    console.log("  🔌 Browser WebSocket client disconnected");
  });
});

// ══════════════════════════════════════════════
// ── SECTION 5: HTTP Server ──
// ══════════════════════════════════════════════

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-dhan-client-id, x-dhan-access-token",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = url.searchParams;

  res.setHeader("Content-Type", "application/json");
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (url.pathname === "/api/dhan-proxy") {
      const userClientId = req.headers["x-dhan-client-id"];
      const userAccessToken = req.headers["x-dhan-access-token"];
      const { data, cacheHit } = await handleDhanProxy(params, userClientId, userAccessToken);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/nse-proxy") {
      const { data, cacheHit } = await handleNSEProxy(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/tv-scan") {
      const { data, cacheHit } = await handleTradingViewScan(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/test-connection") {
      // Test Dhan API connection with user credentials
      const userClientId = req.headers["x-dhan-client-id"];
      const userAccessToken = req.headers["x-dhan-access-token"];
      try {
        const result = await dhanFetch("/optionchain/expirylist", {
          UnderlyingScrip: 13, UnderlyingSeg: "NSE_FNO",
        }, "POST", userClientId, userAccessToken);
        res.writeHead(200);
        res.end(JSON.stringify({ status: "success", message: "Dhan API connected", data: result }));
      } catch (err) {
        res.writeHead(200); // 200 so frontend can read the error
        res.end(JSON.stringify({ status: "error", message: err.message }));
      }
    } else if (url.pathname === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        websocket: {
          dhanConnected: dhanWSConnected,
          browserClients: localWSS.clients.size,
          instrumentsSubscribed: WS_INSTRUMENTS.length,
          cachedTicks: latestTicks.size,
        },
        sources: {
          dhan: !!process.env.DHAN_CLIENT_ID,
          tradingview: true,
          nse: true,
        },
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found. Use /api/dhan-proxy, /api/nse-proxy, /api/tv-scan, or /ws" }));
    }
  } catch (err) {
    console.error(`[Proxy Error] ${url.pathname}:`, err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

// Handle WebSocket upgrade for /ws path
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (url.pathname === "/ws") {
    localWSS.handleUpgrade(request, socket, head, (ws) => {
      localWSS.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  🚀 Mr. Chartist Proxy Server");
  console.log(`  ├─ HTTP:       http://localhost:${PORT}`);
  console.log(`  ├─ WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`  ├─ Health:     http://localhost:${PORT}/health`);
  console.log(`  ├─ Dhan (1°):  http://localhost:${PORT}/api/dhan-proxy?endpoint=option-chain&symbol=NIFTY`);
  console.log(`  ├─ NSE  (2°):  http://localhost:${PORT}/api/nse-proxy?endpoint=indices`);
  console.log(`  └─ TV Scanner: http://localhost:${PORT}/api/tv-scan?type=stocks`);
  console.log("");
  console.log("  Data Priority: Dhan → NSE → TradingView");
  console.log("  Dhan credentials:", process.env.DHAN_CLIENT_ID ? "✅ Loaded from .env" : "⚠️  Not set (configure in .env or Broker Settings)");
  console.log("");

  // Auto-connect Dhan WebSocket if credentials are in .env
  if (process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN) {
    connectDhanWebSocket(process.env.DHAN_CLIENT_ID, process.env.DHAN_ACCESS_TOKEN);
  }
});
