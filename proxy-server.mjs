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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
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

// Last-known-good cache — persists valid data for 18h (across market close)
// This ensures after-hours users still see the last available option chain, PCR, max pain etc.
const lastGoodCache = new Map();
const LAST_GOOD_TTL = 18 * 60 * 60 * 1000; // 18 hours

// ── Disk-backed persistent cache directory ──
const CACHE_DIR = resolve(__dirname, ".cache");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

function diskCacheKeyToFilename(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

function setLastGoodToDisk(key, data) {
  try {
    const filepath = join(CACHE_DIR, diskCacheKeyToFilename(key));
    writeFileSync(filepath, JSON.stringify({ data, timestamp: Date.now() }), "utf-8");
  } catch (e) {
    console.warn(`  ⚠️ Failed to write cache to disk for ${key}:`, e.message);
  }
}

function getLastGoodFromDisk(key) {
  try {
    const filepath = join(CACHE_DIR, diskCacheKeyToFilename(key));
    if (!existsSync(filepath)) return null;
    const raw = JSON.parse(readFileSync(filepath, "utf-8"));
    if (raw && raw.data && raw.timestamp && Date.now() - raw.timestamp < LAST_GOOD_TTL) {
      return raw;
    }
  } catch { /* ignore corrupt files */ }
  return null;
}

// Rehydrate lastGoodCache from disk on startup
try {
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(CACHE_DIR, file), "utf-8"));
      if (raw?.data && raw?.timestamp && Date.now() - raw.timestamp < LAST_GOOD_TTL) {
        // Reconstruct the key from the filename (reverse of the sanitization)
        lastGoodCache.set(file.replace(/\.json$/, ""), raw);
      }
    } catch { /* skip corrupt entries */ }
  }
  if (lastGoodCache.size > 0) {
    console.log(`  📦 Rehydrated ${lastGoodCache.size} last-good cache entries from disk`);
  }
} catch { /* .cache dir doesn't exist yet, will be created on first write */ }

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key, data, ttlMs) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function setLastGood(key, data) {
  lastGoodCache.set(diskCacheKeyToFilename(key), { data, timestamp: Date.now() });
  setLastGoodToDisk(key, data); // Persist to disk
}

function getLastGood(key) {
  // Try in-memory first
  const diskKey = diskCacheKeyToFilename(key);
  const entry = lastGoodCache.get(diskKey);
  if (entry && Date.now() - entry.timestamp < LAST_GOOD_TTL) return entry;
  if (entry) lastGoodCache.delete(diskKey);
  
  // Fallback to disk
  const diskEntry = getLastGoodFromDisk(key);
  if (diskEntry) {
    lastGoodCache.set(diskKey, diskEntry); // Rehydrate in-memory
    return diskEntry;
  }
  return null;
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
  NIFTY: { underlyingScrip: 13, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
  BANKNIFTY: { underlyingScrip: 25, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
  FINNIFTY: { underlyingScrip: 27, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
  MIDCPNIFTY: { underlyingScrip: 442, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
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
      const lastGoodKey = `lastgood:oc:${symbol}:${expiry || "nearest"}`;

      try {
        let expiryDate = expiry;
        if (!expiryDate) {
          try {
            const expiryListKey = `dhan:expiry-list:${symbol}:`;
            let expiryList = getCached(expiryListKey);
            if (!expiryList) {
              expiryList = await dhanFetch("/optionchain/expirylist", {
                UnderlyingScrip: underlying.underlyingScrip,
                UnderlyingSeg: underlying.expirySegment,
              }, "POST", userClientId, userAccessToken);
              setCache(expiryListKey, expiryList, 300000);
            }
            if (expiryList?.data?.length > 0) expiryDate = expiryList.data[0];
          } catch (expiryErr) {
            // Expiry list failed — will try OC without specific expiry
            console.log(`  ⚠️ Expiry list fetch failed for ${symbol}: ${expiryErr.message}`);
          }
        }

        const body = {
          UnderlyingScrip: underlying.underlyingScrip,
          UnderlyingSeg: underlying.ocSegment,
        };
        if (expiryDate) body.Expiry = expiryDate;

        let result;
        try {
          result = await dhanFetch("/optionchain", body, "POST", userClientId, userAccessToken);
        } catch (ocErr) {
          // If "Invalid Expiry Date" error, retry without expiry
          if (ocErr.message.includes("Invalid Expiry") && expiryDate) {
            console.log(`  🔄 Retrying OC for ${symbol} without expiry date...`);
            const retryBody = { UnderlyingScrip: underlying.underlyingScrip, UnderlyingSeg: underlying.ocSegment };
            result = await dhanFetch("/optionchain", retryBody, "POST", userClientId, userAccessToken);
          } else {
            throw ocErr;
          }
        }
        
        // Check if chain has actual data (not empty)
        const hasData = result?.data?.oc && Object.keys(result.data.oc).length > 0;
        if (hasData) {
          // Save to last-good cache for after-hours serving
          setLastGood(lastGoodKey, result);
          setCache(cacheKey, result, 5000);
          return { data: result, cacheHit: false };
        }
        
        // Dhan returned empty — check last-good cache
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Serving last-good OC for ${symbol} (cached ${Math.round((Date.now() - lastGood.timestamp) / 60000)}min ago)`);
          const afterHoursResult = { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
          setCache(cacheKey, afterHoursResult, 30000);
          return { data: afterHoursResult, cacheHit: false };
        }
        
        // No last-good — return the empty result (not a 500!)
        setCache(cacheKey, result, 30000); // Cache empty result for 30s to avoid hammering
        return { data: result, cacheHit: false };
      } catch (e) {
        // Dhan API failed — try last-good cache
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Dhan error, serving last-good OC for ${symbol}: ${e.message}`);
          const afterHoursResult = { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
          return { data: afterHoursResult, cacheHit: false };
        }
        // No cache — return clean empty response instead of 500
        const is429 = e.message.includes("429") || e.message.includes("Too many");
        const cacheTTL = is429 ? 120000 : 60000; // 2min for rate-limits, 1min for others
        console.log(`  ⚠️ OC unavailable for ${symbol} (no cache): ${e.message}${is429 ? " [rate-limited, backing off 2min]" : ""}`);
        const emptyResult = { status: "success", data: { oc: {} }, afterHours: true };
        setCache(cacheKey, emptyResult, cacheTTL);
        return { data: emptyResult, cacheHit: false };
      }
    }

    case "expiry-list": {
      const underlying = UNDERLYING_MAP[symbol];
      if (!underlying) throw new Error(`Unknown symbol: ${symbol}`);
      const lastGoodKey = `lastgood:expiry:${symbol}`;

      try {
        const result = await dhanFetch("/optionchain/expirylist", {
          UnderlyingScrip: underlying.underlyingScrip,
          UnderlyingSeg: underlying.expirySegment,
        }, "POST", userClientId, userAccessToken);
        if (result?.data?.length > 0) {
          setLastGood(lastGoodKey, result);
        }
        setCache(cacheKey, result, 300000); // 5min cache for expiry list
        return { data: result, cacheHit: false };
      } catch (e) {
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Serving last-good expiry list for ${symbol}: ${e.message}`);
          return { data: lastGood.data, cacheHit: false };
        }
        throw e;
      }
    }

    case "ltp": {
      const secInfo = INDEX_SECURITY_IDS[symbol];
      if (!secInfo) throw new Error(`Unknown index: ${symbol}`);

      const result = await dhanFetch("/marketfeed/ltp", {
        [secInfo.exchSeg]: [secInfo.secId],
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
      // Fetch intraday or daily historical candle data
      const secId = params.get("securityId");
      const exchSeg = params.get("exchangeSegment") || "IDX_I";
      const instrument = params.get("instrument") || "INDEX";
      const interval = params.get("interval") || "5";
      const fromDate = params.get("fromDate");
      const toDate = params.get("toDate");

      if (!secId) throw new Error("Missing securityId parameter");

      const isDailyCandle = interval === "D";

      // Default: last 2 trading days for intraday, 1 year for daily
      const now = new Date();
      const defaultDaysBack = isDailyCandle ? 365 : 3;
      const defaultFrom = new Date(now);
      defaultFrom.setDate(defaultFrom.getDate() - defaultDaysBack);
      
      let from = fromDate || `${defaultFrom.toISOString().split("T")[0]} 09:15`;
      const to = toDate || `${now.toISOString().split("T")[0]} 15:30`;

      // Enforce Dhan's 90-day limit for intraday charts (DH-905)
      if (!isDailyCandle) {
        const fromDateObj = new Date(from.split(" ")[0]);
        const toDateObj = new Date(to.split(" ")[0]);
        const daysDiff = Math.ceil((toDateObj - fromDateObj) / (1000 * 60 * 60 * 24));
        if (daysDiff > 90) {
          const clampedFrom = new Date(toDateObj);
          clampedFrom.setDate(clampedFrom.getDate() - 89);
          from = `${clampedFrom.toISOString().split("T")[0]} 09:15`;
          console.log(`  📐 Clamped intraday date range to 90 days (was ${daysDiff}d)`);
        }
      }

      const historicalCacheKey = `dhan:hist:${secId}:${interval}:${from}:${to}`;
      const cachedHist = getCached(historicalCacheKey);
      if (cachedHist) return { data: cachedHist, cacheHit: true };

      // "D" = Daily candles → /charts/historical (no interval param needed)
      // Anything else ("1","5","15","60") = intraday → /charts/intraday
      const apiPath = isDailyCandle ? "/charts/historical" : "/charts/intraday";

      const body = {
        securityId: secId,
        exchangeSegment: exchSeg,
        instrument,
        fromDate: from.includes(" ") ? from : `${from} 09:15`,
        toDate: to.includes(" ") ? to : `${to} 15:30`,
        expiryCode: 0,
        oi: exchSeg === "NSE_FNO",
      };
      // Only add interval for intraday calls
      if (!isDailyCandle) {
        body.interval = interval;
      }

      console.log(`  📊 Fetching ${isDailyCandle ? "daily" : "intraday"} chart: ${secId} (${from} → ${to}), interval=${interval}`);
      const result = await dhanFetch(apiPath, body, "POST", userClientId, userAccessToken);
      setCache(historicalCacheKey, result, isDailyCandle ? 300000 : 60000); // 5min cache for daily, 1min for intraday
      return { data: result, cacheHit: false };
    }

    default:
      throw new Error(`Unknown endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical`);
  }
}

// ══════════════════════════════════════════════
// ── SECTION 2b: Multi-Broker REST Handlers ──
//    All handlers return Dhan-compatible JSON:
//    { status:"success", data:{ oc:{}, last_price:N } }
//    so parseDhanOptionChain() works unchanged.
// ══════════════════════════════════════════════

const EXPIRY_SYMBOL_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY", SENSEX: "SENSEX", BANKEX: "BANKEX",
};

// ── Shared: build Dhan-compatible OC response ──
function buildDhanCompatOC(strikeMap, spotPrice) {
  const oc = {};
  for (const [strike, legs] of Object.entries(strikeMap)) {
    oc[strike] = {
      ce: legs.ce || null,
      pe: legs.pe || null,
    };
  }
  return { status: "success", data: { oc, last_price: spotPrice } };
}

// ── Zerodha (Kite Connect) ──
const KITE_BASE = "https://api.kite.trade";
const KITE_NFO_CSV = "https://api.kite.trade/instruments/NFO";
const KITE_SYMBOL_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
};

async function handleZerodhaProxy(params, apiKey, accessToken) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  if (!apiKey || !accessToken) throw new Error("Zerodha: Missing api key or access token");

  const headers = {
    "X-Kite-Version": "3",
    Authorization: `token ${apiKey}:${accessToken}`,
  };

  // Step 1: Download NFO instruments CSV (cached 4h)
  const csvCacheKey = `zerodha:csv`;
  let csvText = getCached(csvCacheKey);
  if (!csvText) {
    console.log("  📥 Fetching Zerodha NFO instruments CSV...");
    const csvRes = await fetch(KITE_NFO_CSV, { headers });
    if (!csvRes.ok) throw new Error(`Zerodha CSV error ${csvRes.status}`);
    csvText = await csvRes.text();
    setCache(csvCacheKey, csvText, 4 * 60 * 60 * 1000);
  }

  // Step 2: Parse CSV - columns: instrument_token,exchange_token,tradingsymbol,name,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
  const lines = csvText.trim().split("\n").slice(1);
  const underlyingName = KITE_SYMBOL_MAP[symbol] || symbol;

  // Find all expiry dates for this symbol
  const allExpiries = new Set();
  const relevantLines = [];
  for (const line of lines) {
    const cols = line.split(",");
    if (cols.length < 10) continue;
    const ts = cols[2]; // tradingsymbol
    const expCol = cols[4]; // expiry YYYY-MM-DD
    const instrType = cols[8]; // CE or PE
    const name = cols[3]; // underlying name
    if (name === underlyingName && (instrType === "CE" || instrType === "PE")) {
      allExpiries.add(expCol);
      relevantLines.push(cols);
    }
  }

  const sortedExpiries = Array.from(allExpiries).sort();
  const targetExpiry = expiry || sortedExpiries[0];
  if (!targetExpiry) throw new Error(`Zerodha: No F&O expiry found for ${symbol}`);

  // Collect instrument tokens for target expiry
  const strikeData = {}; // strike -> { ce: token, pe: token, ceTs: ..., peTs: ... }
  for (const cols of relevantLines) {
    if (cols[4] !== targetExpiry) continue;
    const token = cols[0];
    const strike = parseFloat(cols[5]);
    const instrType = cols[8];
    const ts = cols[2];
    if (!strikeData[strike]) strikeData[strike] = {};
    if (instrType === "CE") { strikeData[strike].ceToken = token; strikeData[strike].ceTs = ts; }
    else { strikeData[strike].peToken = token; strikeData[strike].peTs = ts; }
  }

  // Step 3: Batch quote request (max 500 instruments at once)
  const allTokens = [];
  for (const v of Object.values(strikeData)) {
    if (v.ceToken) allTokens.push(`NFO:${v.ceTs}`);
    if (v.peToken) allTokens.push(`NFO:${v.peTs}`);
  }

  if (allTokens.length === 0) throw new Error(`Zerodha: No strikes found for ${symbol} expiry ${targetExpiry}`);

  // Kite quote endpoint
  const quoteUrl = `${KITE_BASE}/quote?${allTokens.map(t => `i=${encodeURIComponent(t)}`).join("&")}`;
  const quoteRes = await fetch(quoteUrl, { headers });
  if (!quoteRes.ok) {
    const errText = await quoteRes.text();
    throw new Error(`Zerodha quote error ${quoteRes.status}: ${errText}`);
  }
  const quoteJson = await quoteRes.json();
  const quotes = quoteJson.data || {};

  // Build OC
  let spotPrice = 0;
  const strikeMap = {};
  for (const [strike, v] of Object.entries(strikeData)) {
    const ceQ = v.ceTs ? quotes[`NFO:${v.ceTs}`] : null;
    const peQ = v.peTs ? quotes[`NFO:${v.peTs}`] : null;
    if (ceQ?.last_price) spotPrice = ceQ.ohlc?.close || spotPrice;
    strikeMap[strike] = {
      ce: ceQ ? {
        last_price: ceQ.last_price || 0, ltp: ceQ.last_price || 0,
        volume: ceQ.volume || 0, oi: ceQ.oi || 0, oi_chg: ceQ.oi_day_change || 0,
        implied_volatility: 0, bid_price: ceQ.depth?.buy?.[0]?.price || 0,
        ask_price: ceQ.depth?.sell?.[0]?.price || 0,
      } : null,
      pe: peQ ? {
        last_price: peQ.last_price || 0, ltp: peQ.last_price || 0,
        volume: peQ.volume || 0, oi: peQ.oi || 0, oi_chg: peQ.oi_day_change || 0,
        implied_volatility: 0, bid_price: peQ.depth?.buy?.[0]?.price || 0,
        ask_price: peQ.depth?.sell?.[0]?.price || 0,
      } : null,
    };
  }

  // Spot price from NSE index (Kite doesn't give index spot in OC)
  try {
    const ltpRes = await fetch(`${KITE_BASE}/quote/ltp?i=NSE:${underlyingName === "NIFTY" ? "NIFTY 50" : underlyingName.replace("BANKNIFTY", "NIFTY BANK")}`, { headers });
    if (ltpRes.ok) {
      const ltpJson = await ltpRes.json();
      const ltpData = Object.values(ltpJson.data || {})[0];
      if (ltpData?.last_price) spotPrice = ltpData.last_price;
    }
  } catch { /* use last known */ }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Upstox ──
const UPSTOX_BASE = "https://api.upstox.com/v2";
const UPSTOX_INDEX_MAP = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  FINNIFTY: "NSE_INDEX|Nifty Fin Service",
  MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
  SENSEX: "BSE_INDEX|SENSEX",
  BANKEX: "BSE_INDEX|BANKEX",
};

async function handleUpstoxProxy(params, accessToken) {
  if (!accessToken) throw new Error("Upstox: Missing access token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const instrKey = UPSTOX_INDEX_MAP[symbol] || `NSE_INDEX|${symbol}`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };

  // Get expiry list first if no expiry specified
  let targetExpiry = expiry;
  if (!targetExpiry) {
    const expRes = await fetch(`${UPSTOX_BASE}/option/contract?instrument_key=${encodeURIComponent(instrKey)}`, { headers });
    if (expRes.ok) {
      const expJson = await expRes.json();
      const expiries = expJson?.data?.map(d => d.expiry).filter(Boolean).sort();
      targetExpiry = expiries?.[0];
    }
    if (!targetExpiry) throw new Error("Upstox: Could not determine expiry date");
  }

  const ocUrl = `${UPSTOX_BASE}/option/chain?instrument_key=${encodeURIComponent(instrKey)}&expiry_date=${targetExpiry}`;
  const ocRes = await fetch(ocUrl, { headers });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`Upstox OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const data = ocJson?.data || [];

  let spotPrice = 0;
  const strikeMap = {};

  for (const item of data) {
    const strike = item.strike_price;
    if (!strike) continue;
    const ceD = item.call_options?.market_data;
    const peD = item.put_options?.market_data;
    const ceG = item.call_options?.option_greeks;
    const peG = item.put_options?.option_greeks;
    if (item.underlying_spot_price) spotPrice = item.underlying_spot_price;

    strikeMap[strike] = {
      ce: ceD ? {
        last_price: ceD.ltp || 0, ltp: ceD.ltp || 0,
        volume: ceD.volume || 0, oi: ceD.oi || 0, oi_chg: ceD.net_change_in_oi || 0,
        implied_volatility: ceG?.iv || 0, delta: ceG?.delta || 0, gamma: ceG?.gamma || 0,
        theta: ceG?.theta || 0, vega: ceG?.vega || 0,
        bid_price: ceD.bid_price || 0, ask_price: ceD.ask_price || 0,
      } : null,
      pe: peD ? {
        last_price: peD.ltp || 0, ltp: peD.ltp || 0,
        volume: peD.volume || 0, oi: peD.oi || 0, oi_chg: peD.net_change_in_oi || 0,
        implied_volatility: peG?.iv || 0, delta: peG?.delta || 0, gamma: peG?.gamma || 0,
        theta: peG?.theta || 0, vega: peG?.vega || 0,
        bid_price: peD.bid_price || 0, ask_price: peD.ask_price || 0,
      } : null,
    };
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Angel One (SmartAPI) ──
const ANGEL_BASE = "https://apiconnect.angelone.in/rest/secure/angelbroking";
const ANGEL_OC_EXPIRY_FORMAT = (dateStr) => {
  // YYYY-MM-DD -> DDMMMYYYY e.g. 29JAN2026
  const d = new Date(dateStr);
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${String(d.getDate()).padStart(2,"0")}${months[d.getMonth()]}${d.getFullYear()}`;
};
const ANGEL_INDEX_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY", SENSEX: "SENSEX",
};

async function handleAngelProxy(params, apiKey, jwtToken) {
  if (!apiKey || !jwtToken) throw new Error("Angel One: Missing API key or JWT token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const angelSymbol = ANGEL_INDEX_MAP[symbol] || symbol;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${jwtToken}`,
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-PrivateKey": apiKey,
  };

  // Expiry list if not provided
  let targetExpiry = expiry ? ANGEL_OC_EXPIRY_FORMAT(expiry) : null;
  if (!targetExpiry) {
    const expiryRes = await fetch(`${ANGEL_BASE}/market/v1/expirylist?name=${angelSymbol}&expirytype=NEXT`, {
      method: "GET", headers,
    });
    if (expiryRes.ok) {
      const expiryJson = await expiryRes.json();
      targetExpiry = expiryJson?.data?.expiryList?.[0] || null;
    }
    if (!targetExpiry) throw new Error("Angel One: Could not fetch expiry list");
  }

  const ocUrl = `${ANGEL_BASE}/market/v1/optionchain?name=${angelSymbol}&expirydate=${targetExpiry}`;
  const ocRes = await fetch(ocUrl, { method: "GET", headers });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`Angel OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const ocData = ocJson?.data?.fetched || [];
  const spotPrice = ocJson?.data?.quotient?.[0]?.lastPrice || 0;

  const strikeMap = {};
  for (const item of ocData) {
    const strike = item.strikePrice;
    if (!strike) continue;
    const optType = item.optionType; // CE or PE
    const leg = {
      last_price: item.lastPrice || 0, ltp: item.lastPrice || 0,
      volume: item.tradedVolume || 0, oi: item.openInterest || 0,
      oi_chg: item.netChange || 0, implied_volatility: item.impliedVolatility || 0,
      bid_price: item.bidPrice || 0, ask_price: item.askPrice || 0,
    };
    if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
    if (optType === "CE") strikeMap[strike].ce = leg;
    else strikeMap[strike].pe = leg;
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Fyers ──
const FYERS_BASE = "https://api-t1.fyers.in";
const FYERS_INDEX_MAP = {
  NIFTY: "NSE:NIFTY50-INDEX", BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX", MIDCPNIFTY: "NSE:MIDCPNIFTY-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

async function handleFyersProxy(params, appId, accessToken) {
  if (!appId || !accessToken) throw new Error("Fyers: Missing App ID or access token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const fyersSymbol = FYERS_INDEX_MAP[symbol] || `NSE:${symbol}-INDEX`;
  const authHeader = `${appId}:${accessToken}`;
  const headers = { Authorization: authHeader, Accept: "application/json" };

  // Expiry list
  let targetExpiry = expiry;
  if (!targetExpiry) {
    const expiryRes = await fetch(`${FYERS_BASE}/data/options/expiry?symbol=${encodeURIComponent(fyersSymbol)}`, { headers });
    if (expiryRes.ok) {
      const expiryJson = await expiryRes.json();
      targetExpiry = expiryJson?.data?.expiryDates?.[0];
    }
    if (!targetExpiry) throw new Error("Fyers: Could not determine expiry");
  }

  const ocUrl = `${FYERS_BASE}/data/optionchain?symbol=${encodeURIComponent(fyersSymbol)}&strikecount=30&timestamp=${targetExpiry}`;
  const ocRes = await fetch(ocUrl, { headers });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`Fyers OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const optionsData = ocJson?.data?.optionsChain || [];
  const spotPrice = ocJson?.data?.s_p || 0;

  const strikeMap = {};
  for (const item of optionsData) {
    const strike = item.strike_price;
    if (!strike) continue;
    const optType = item.option_type; // CE or PE
    const leg = {
      last_price: item.ltp || 0, ltp: item.ltp || 0,
      volume: item.volume || 0, oi: item.oi || 0, oi_chg: item.oi_change || 0,
      implied_volatility: item.iv || 0, delta: item.delta || 0,
      gamma: item.gamma || 0, theta: item.theta || 0, vega: item.vega || 0,
      bid_price: item.bid || 0, ask_price: item.ask || 0,
    };
    if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
    if (optType === "CE") strikeMap[strike].ce = leg;
    else strikeMap[strike].pe = leg;
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Groww ──
const GROWW_BASE = "https://api.groww.in";
const GROWW_INDEX_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY", SENSEX: "SENSEX",
};

async function handleGrowwProxy(params, accessToken) {
  if (!accessToken) throw new Error("Groww: Missing access token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const growwSymbol = GROWW_INDEX_MAP[symbol] || symbol;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const baseUrl = `${GROWW_BASE}/v1/option-chain/exchange/NSE/underlying/${growwSymbol}`;
  const ocUrl = expiry ? `${baseUrl}?expiry=${expiry}` : baseUrl;

  const ocRes = await fetch(ocUrl, { headers });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`Groww OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const strikeList = ocJson?.data?.options_chain || ocJson?.options_chain || [];
  const spotPrice = ocJson?.data?.spot_price || ocJson?.spot_price || 0;

  const strikeMap = {};
  for (const item of strikeList) {
    const strike = item.strike_price;
    if (!strike) continue;
    const ceD = item.call_option || item.CE;
    const peD = item.put_option || item.PE;
    strikeMap[strike] = {
      ce: ceD ? {
        last_price: ceD.last_price || ceD.ltp || 0, ltp: ceD.ltp || ceD.last_price || 0,
        volume: ceD.volume || 0, oi: ceD.open_interest || ceD.oi || 0,
        oi_chg: ceD.change_in_oi || 0, implied_volatility: ceD.iv || 0,
        bid_price: ceD.bid || 0, ask_price: ceD.ask || 0,
      } : null,
      pe: peD ? {
        last_price: peD.last_price || peD.ltp || 0, ltp: peD.ltp || peD.last_price || 0,
        volume: peD.volume || 0, oi: peD.open_interest || peD.oi || 0,
        oi_chg: peD.change_in_oi || 0, implied_volatility: peD.iv || 0,
        bid_price: peD.bid || 0, ask_price: peD.ask || 0,
      } : null,
    };
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── ICICI Breeze ──
const BREEZE_BASE = "https://api.icicidirect.com/breezeapi/api/v1";
const BREEZE_STOCK_CODE_MAP = {
  NIFTY: "CNXNIF", BANKNIFTY: "CNXBAN", FINNIFTY: "CNXFIN",
  MIDCPNIFTY: "CNXMID", SENSEX: "BSE30",
};

async function handleBreezeProxy(params, apiKey, sessionToken) {
  if (!apiKey || !sessionToken) throw new Error("ICICI Breeze: Missing API key or session token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const stockCode = BREEZE_STOCK_CODE_MAP[symbol] || symbol;
  const headers = {
    "X-SessionToken": sessionToken,
    "apikey": apiKey,
    "Content-Type": "application/json",
  };

  // Format expiry: YYYY-MM-DDT07:00:00.000Z
  let expiryFormatted = expiry ? `${expiry}T07:00:00.000Z` : undefined;

  if (!expiryFormatted) {
    // Fetch nearest expiry
    const expUrl = `${BREEZE_BASE}/expirydate?stock_code=${stockCode}&product_type=options&exchange_code=NFO`;
    const expRes = await fetch(expUrl, { headers });
    if (expRes.ok) {
      const expJson = await expRes.json();
      const expiryDate = expJson?.Success?.[0]?.expiry_date;
      if (expiryDate) expiryFormatted = expiryDate;
    }
    if (!expiryFormatted) throw new Error("Breeze: Could not determine expiry");
  }

  const ocUrl = `${BREEZE_BASE}/optionchain?stock_code=${stockCode}&exchange_code=NFO&product_type=options&expiry_date=${encodeURIComponent(expiryFormatted)}&right=others&strike_price=0`;
  const ocRes = await fetch(ocUrl, { headers });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`Breeze OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const ocData = ocJson?.Success || [];
  let spotPrice = 0;

  const strikeMap = {};
  for (const item of ocData) {
    const strike = parseFloat(item.strike_price || "0");
    if (!strike) continue;
    const optType = item.right; // Call or Put
    const leg = {
      last_price: parseFloat(item.ltp || "0"), ltp: parseFloat(item.ltp || "0"),
      volume: parseInt(item.total_quantity || "0", 10), oi: parseInt(item.open_interest || "0", 10),
      oi_chg: 0, implied_volatility: 0,
      bid_price: parseFloat(item.best_bid_price || "0"),
      ask_price: parseFloat(item.best_offer_price || "0"),
    };
    if (item.ltp_close) spotPrice = parseFloat(item.ltp_close || "0");
    if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
    if (optType === "Call" || optType === "CE" || optType === "call") strikeMap[strike].ce = leg;
    else strikeMap[strike].pe = leg;
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Shoonya (Finvasia) ──
const SHOONYA_BASE = "https://api.shoonya.com/NorenWClientTP";
const SHOONYA_SYMBOL_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY", SENSEX: "SENSEX",
};

async function handleShoonyaProxy(params, userId, sessionToken) {
  if (!userId || !sessionToken) throw new Error("Shoonya: Missing user ID or session token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const shoonyaSymbol = SHOONYA_SYMBOL_MAP[symbol] || symbol;

  // Format expiry as DDMMMYYYY e.g. 29JAN2026
  let expiryFormatted = expiry;
  if (expiry && expiry.includes("-")) {
    const d = new Date(expiry);
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    expiryFormatted = `${String(d.getDate()).padStart(2,"0")}${months[d.getMonth()]}${d.getFullYear()}`;
  }

  // Shoonya has no OC endpoint — search for instruments, get LTP for each
  const searchBody = `jKey=${sessionToken}&uid=${userId}&stext=${shoonyaSymbol}&exch=NFO`;
  const searchRes = await fetch(`${SHOONYA_BASE}/SearchScrip`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: searchBody,
  });
  if (!searchRes.ok) throw new Error(`Shoonya SearchScrip error ${searchRes.status}`);
  const searchJson = await searchRes.json();
  const instruments = searchJson?.values || [];

  // Filter to target expiry and CE/PE
  const filtered = instruments.filter(i => {
    if (expiryFormatted && !i.tsym?.includes(expiryFormatted)) return false;
    return i.optt === "CE" || i.optt === "PE";
  });

  if (filtered.length === 0) throw new Error(`Shoonya: No instruments found for ${symbol} ${expiryFormatted || ""}`);

  // Batch LTP request (up to 50 at once)
  const strikeMap = {};
  const batchSize = 50;
  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    const ltpBody = `jKey=${sessionToken}&uid=${userId}&jData=${JSON.stringify(batch.map(b => ({ exch: "NFO", token: b.token })))}`;
    const ltpRes = await fetch(`${SHOONYA_BASE}/GetMultiQuotes`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: ltpBody,
    });
    if (!ltpRes.ok) continue;
    const ltpJson = await ltpRes.json();
    const quotes = Array.isArray(ltpJson) ? ltpJson : (ltpJson?.data || []);

    for (let j = 0; j < batch.length && j < quotes.length; j++) {
      const instr = batch[j];
      const q = quotes[j];
      const strike = parseFloat(instr.strprc || "0");
      if (!strike) continue;
      const optType = instr.optt;
      const leg = {
        last_price: parseFloat(q?.lp || "0"), ltp: parseFloat(q?.lp || "0"),
        volume: parseInt(q?.v || "0", 10), oi: parseInt(q?.oi || "0", 10),
        oi_chg: 0, implied_volatility: 0,
        bid_price: parseFloat(q?.bp1 || "0"), ask_price: parseFloat(q?.sp1 || "0"),
      };
      if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
      if (optType === "CE") strikeMap[strike].ce = leg;
      else strikeMap[strike].pe = leg;
    }
  }

  return buildDhanCompatOC(strikeMap, 0);
}

// ── Kotak Neo ──
const KOTAK_BASE = "https://gw-napi.kotaksecurities.com";
const KOTAK_INDEX_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
};

async function handleKotakProxy(params, apiKey, accessToken, sid, auth) {
  if (!apiKey || !accessToken) throw new Error("Kotak Neo: Missing API key or access token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const kotakSymbol = KOTAK_INDEX_MAP[symbol] || symbol;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Sid: sid || "",
    Auth: auth || "",
    neo_fin_key: apiKey,
  };

  // Get instrument tokens for NFO
  const instrUrl = `${KOTAK_BASE}/api/v1/instruments?instrument_type=OP&exchange_segment=nfo_cm&symbol=${kotakSymbol}`;
  const instrRes = await fetch(instrUrl, { headers });
  if (!instrRes.ok) throw new Error(`Kotak instruments error ${instrRes.status}`);
  const instrJson = await instrRes.json();
  const instruments = instrJson?.data || [];

  // Filter by expiry
  let targetExpiry = expiry;
  if (!targetExpiry) {
    const expiries = [...new Set(instruments.map(i => i.expiry).filter(Boolean))].sort();
    targetExpiry = expiries[0];
  }
  if (!targetExpiry) throw new Error("Kotak: No expiry found");

  const filtered = instruments.filter(i => i.expiry === targetExpiry);
  const strikeMap = {};
  let spotPrice = 0;

  // Batch quote
  const tokens = filtered.map(i => i.token).filter(Boolean);
  if (tokens.length > 0) {
    const quoteBody = { instrument_tokens: tokens.map(t => ({ instrument_token: t, exchange_segment: "nfo_cm" })) };
    const quoteRes = await fetch(`${KOTAK_BASE}/api/v1/quotes`, {
      method: "POST",
      headers,
      body: JSON.stringify(quoteBody),
    });
    if (quoteRes.ok) {
      const quoteJson = await quoteRes.json();
      const quoteMap = {};
      for (const q of (quoteJson?.data || [])) quoteMap[q.instrument_token] = q;

      for (const instr of filtered) {
        const strike = parseFloat(instr.strike_price || "0");
        if (!strike) continue;
        const optType = instr.option_type; // CE or PE
        const q = quoteMap[instr.token] || {};
        const leg = {
          last_price: q.last_price || 0, ltp: q.last_price || 0,
          volume: q.volume || 0, oi: q.open_interest || 0,
          oi_chg: q.change_in_oi || 0, implied_volatility: 0,
          bid_price: q.buy_price1 || 0, ask_price: q.sell_price1 || 0,
        };
        if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
        if (optType === "CE") strikeMap[strike].ce = leg;
        else strikeMap[strike].pe = leg;
      }
    }
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Alice Blue ──
const ALICEBLUE_BASE = "https://ant.aliceblueonline.com/rest/AliceBlueAPIService/api";
const ALICEBLUE_EXCHANGE_MAP = {
  NIFTY: "NFO", BANKNIFTY: "NFO", FINNIFTY: "NFO", MIDCPNIFTY: "NFO",
  SENSEX: "BFO", BANKEX: "BFO",
};

async function handleAliceBlueProxy(params, userId, sessionId) {
  if (!userId || !sessionId) throw new Error("Alice Blue: Missing user ID or session ID");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const exchange = ALICEBLUE_EXCHANGE_MAP[symbol] || "NFO";
  const authHeader = `Basic ${Buffer.from(`${userId}:${sessionId}`).toString("base64")}`;
  const headers = {
    Authorization: authHeader,
    "Content-Type": "application/json",
  };

  // Get master contract
  const masterUrl = `${ALICEBLUE_BASE}/contracts/Contract.json.gz`;
  // Alice Blue uses a different approach — search instruments
  const searchUrl = `${ALICEBLUE_BASE}/ScripMaster/getScripByTicker?exchange=${exchange}&trading_symbol=${symbol}`;
  const searchRes = await fetch(searchUrl, { headers });
  if (!searchRes.ok) throw new Error(`Alice Blue search error ${searchRes.status}`);
  const searchJson = await searchRes.json();
  const instruments = Array.isArray(searchJson) ? searchJson : (searchJson?.data || []);

  // Filter CE/PE options with target expiry
  let targetExpiry = expiry;
  if (!targetExpiry) {
    const expiries = [...new Set(instruments.map(i => i.expiry_date || i.expiryDate).filter(Boolean))].sort();
    targetExpiry = expiries[0];
  }

  const filtered = instruments.filter(i => {
    const instrExpiry = i.expiry_date || i.expiryDate || "";
    const optType = i.instrument_type || i.instrumentType || "";
    return instrExpiry === targetExpiry && (optType === "OPTIDX" || optType === "OPT") && (i.option_type === "CE" || i.option_type === "PE");
  });

  const strikeMap = {};
  if (filtered.length > 0) {
    const tokens = filtered.map(i => ({ exchange, token: i.code || i.token }));
    const quoteBody = { data: tokens };
    const quoteRes = await fetch(`${ALICEBLUE_BASE}/marketWatch/scripsMW`, {
      method: "POST",
      headers,
      body: JSON.stringify(quoteBody),
    });
    if (quoteRes.ok) {
      const quoteJson = await quoteRes.json();
      const quoteList = quoteJson?.data || quoteJson || [];
      for (let idx = 0; idx < filtered.length; idx++) {
        const instr = filtered[idx];
        const q = quoteList[idx] || {};
        const strike = parseFloat(instr.strike_price || instr.strikePrice || "0");
        if (!strike) continue;
        const optType = instr.option_type || instr.optionType;
        const leg = {
          last_price: q.ltp || q.last_price || 0, ltp: q.ltp || 0,
          volume: q.vol || q.volume || 0, oi: q.oi || q.open_interest || 0,
          oi_chg: 0, implied_volatility: 0,
          bid_price: q.bid || q.best_bid || 0, ask_price: q.ask || q.best_ask || 0,
        };
        if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
        if (optType === "CE") strikeMap[strike].ce = leg;
        else strikeMap[strike].pe = leg;
      }
    }
  }

  return buildDhanCompatOC(strikeMap, 0);
}

// ── 5paisa ──
const FIVEPAISA_BASE = "https://Openapi.5paisa.com";
const FIVEPAISA_SCRIP_CODE_MAP = {
  NIFTY: 999920000, BANKNIFTY: 999920005, FINNIFTY: 999920051,
  MIDCPNIFTY: 999920011, SENSEX: 999941173,
};

async function handleFivePaisaProxy(params, jwtToken, clientCode, appKey) {
  if (!jwtToken || !clientCode) throw new Error("5paisa: Missing JWT token or client code");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const underlyingScripCode = FIVEPAISA_SCRIP_CODE_MAP[symbol];
  if (!underlyingScripCode) throw new Error(`5paisa: Unknown symbol ${symbol}`);

  const headers = {
    Authorization: `bearer ${jwtToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Get expiry dates
  let expiryDate = expiry;
  if (!expiryDate) {
    const expRes = await fetch(`${FIVEPAISA_BASE}/V8/1/ExpiryDate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ head: { key: appKey || "" }, body: { ScripCode: underlyingScripCode, ExchType: "D" } }),
    });
    if (expRes.ok) {
      const expJson = await expRes.json();
      expiryDate = expJson?.body?.ExpiryDates?.[0]?.Date;
    }
    if (!expiryDate) throw new Error("5paisa: Could not fetch expiry date");
  }

  // Option chain v4
  const ocBody = {
    head: { key: appKey || "" },
    body: {
      ScripCode: underlyingScripCode, ExchType: "D",
      ExpiryDate: expiryDate,
      OptionType: "PE_CE",
    },
  };
  const ocRes = await fetch(`${FIVEPAISA_BASE}/V8/1/OptionChainv4`, {
    method: "POST", headers, body: JSON.stringify(ocBody),
  });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`5paisa OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const strikeList = ocJson?.body?.OptionChainDetails || [];
  const spotPrice = ocJson?.body?.Underlying || 0;

  const strikeMap = {};
  for (const item of strikeList) {
    const strike = item.StrikeRate || item.StrikePrice;
    if (!strike) continue;
    const optType = item.CPType; // CE or PE
    const leg = {
      last_price: item.LastRate || 0, ltp: item.LastRate || 0,
      volume: item.TradedQty || 0, oi: item.OpenInterest || 0,
      oi_chg: item.OIChange || 0, implied_volatility: item.ImpliedVolatility || 0,
      bid_price: item.BidRate || 0, ask_price: item.OfferRate || 0,
    };
    if (!strikeMap[strike]) strikeMap[strike] = { ce: null, pe: null };
    if (optType === "CE") strikeMap[strike].ce = leg;
    else strikeMap[strike].pe = leg;
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Motilal Oswal ──
const MOTILAL_BASE = "https://openapi.motilaloswal.com";
const MOTILAL_SYMBOL_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
};

async function handleMotilalProxy(params, apiKey, authToken) {
  if (!apiKey || !authToken) throw new Error("Motilal Oswal: Missing API key or auth token");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  const motilalSymbol = MOTILAL_SYMBOL_MAP[symbol] || symbol;
  const headers = {
    "Content-Type": "application/json",
    apiKey,
    authToken,
  };

  // Motilal offers LTP but no dedicated OC — get quotes for known strikes
  // First get current spot price
  let spotPrice = 0;
  try {
    const ltpBody = { scripArray: [{ exchange: "NSE", scripCode: motilalSymbol }] };
    const ltpRes = await fetch(`${MOTILAL_BASE}/rest/v2/quote/ltp`, {
      method: "POST", headers, body: JSON.stringify(ltpBody),
    });
    if (ltpRes.ok) {
      const ltpJson = await ltpRes.json();
      spotPrice = ltpJson?.data?.[0]?.ltp || 0;
    }
  } catch { /* spotPrice stays 0 */ }

  // Motilal does not have a public OC endpoint; return minimal response
  // so frontend falls back to NSE
  if (!spotPrice) throw new Error("Motilal Oswal: Option chain endpoint not available, using NSE fallback");

  // Return empty OC with spot price — caller will fall back to NSE for OC
  return { status: "no_oc", data: { oc: {}, last_price: spotPrice } };
}

// ── Samco StockNote ──
const SAMCO_BASE = "https://api.stocknote.com";
const SAMCO_INDEX_MAP = {
  NIFTY: "NIFTY", BANKNIFTY: "BANKNIFTY", FINNIFTY: "FINNIFTY",
  MIDCPNIFTY: "MIDCPNIFTY",
};

async function handleSamcoProxy(params, userId, password, yearOfBirth) {
  if (!userId || !password) throw new Error("Samco: Missing user ID or password");

  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry"); // YYYY-MM-DD

  // Login to get session token
  const loginBody = { body: { userId, password, yob: yearOfBirth || "" } };
  const loginRes = await fetch(`${SAMCO_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody),
  });
  if (!loginRes.ok) throw new Error(`Samco login error ${loginRes.status}`);
  const loginJson = await loginRes.json();
  const sessionToken = loginJson?.sessionToken;
  if (!sessionToken) throw new Error("Samco: Login failed — no session token returned");

  const samcoSymbol = SAMCO_INDEX_MAP[symbol] || symbol;
  const headers = {
    Authorization: sessionToken,
    "Content-Type": "application/json",
  };

  const ocUrl = expiry
    ? `${SAMCO_BASE}/optionChain?searchSymbolName=${samcoSymbol}&strikeFromDate=${expiry}&strikeToDate=${expiry}`
    : `${SAMCO_BASE}/optionChain?searchSymbolName=${samcoSymbol}`;

  const ocRes = await fetch(ocUrl, { headers });
  if (!ocRes.ok) {
    const errText = await ocRes.text();
    throw new Error(`Samco OC error ${ocRes.status}: ${errText}`);
  }
  const ocJson = await ocRes.json();
  const strikeList = ocJson?.optionChainDetails || [];
  const spotPrice = ocJson?.underlyingValue || 0;

  const strikeMap = {};
  for (const item of strikeList) {
    const strike = parseFloat(item.strikePrice || "0");
    if (!strike) continue;
    const ceD = item.CE || item.callOption;
    const peD = item.PE || item.putOption;
    strikeMap[strike] = {
      ce: ceD ? {
        last_price: ceD.lastPrice || 0, ltp: ceD.lastPrice || 0,
        volume: ceD.totalTradedVolume || 0, oi: ceD.openInterest || 0,
        oi_chg: ceD.changeinOpenInterest || 0, implied_volatility: ceD.impliedVolatility || 0,
        bid_price: ceD.bidPrice || 0, ask_price: ceD.askPrice || 0,
      } : null,
      pe: peD ? {
        last_price: peD.lastPrice || 0, ltp: peD.lastPrice || 0,
        volume: peD.totalTradedVolume || 0, oi: peD.openInterest || 0,
        oi_chg: peD.changeinOpenInterest || 0, implied_volatility: peD.impliedVolatility || 0,
        bid_price: peD.bidPrice || 0, ask_price: peD.askPrice || 0,
      } : null,
    };
  }

  return buildDhanCompatOC(strikeMap, spotPrice);
}

// ── Universal Test Connection ──
async function handleTestBrokerConnection(brokerId, req) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith("x-")) headers[k] = v;
  }
  const params = new URLSearchParams({ symbol: "NIFTY" });

  try {
    switch (brokerId) {
      case "dhan": {
        const result = await dhanFetch("/optionchain/expirylist",
          { UnderlyingScrip: 13, UnderlyingSeg: "NSE_FNO" }, "POST",
          headers["x-dhan-client-id"], headers["x-dhan-access-token"]);
        return { status: "success", broker: "dhan", message: "Dhan API connected", expiryCount: result?.data?.length };
      }
      case "zerodha": {
        const result = await handleZerodhaProxy(params, headers["x-zerodha-api-key"], headers["x-zerodha-access-token"]);
        return { status: "success", broker: "zerodha", message: "Zerodha Kite connected", hasData: !!result?.data };
      }
      case "upstox": {
        const result = await handleUpstoxProxy(params, headers["x-upstox-access-token"]);
        return { status: "success", broker: "upstox", message: "Upstox API connected", hasData: !!result?.data };
      }
      case "angelone": {
        const result = await handleAngelProxy(params, headers["x-angel-api-key"], headers["x-angel-jwt-token"]);
        return { status: "success", broker: "angelone", message: "Angel One SmartAPI connected", hasData: !!result?.data };
      }
      case "fyers": {
        const result = await handleFyersProxy(params, headers["x-fyers-app-id"], headers["x-fyers-access-token"]);
        return { status: "success", broker: "fyers", message: "Fyers API connected", hasData: !!result?.data };
      }
      case "groww": {
        const result = await handleGrowwProxy(params, headers["x-groww-access-token"]);
        return { status: "success", broker: "groww", message: "Groww API connected", hasData: !!result?.data };
      }
      case "shoonya": {
        const result = await handleShoonyaProxy(params, headers["x-shoonya-user-id"], headers["x-shoonya-session-token"]);
        return { status: "success", broker: "shoonya", message: "Shoonya API connected", hasData: !!result?.data };
      }
      case "icicibreeze": {
        const result = await handleBreezeProxy(params, headers["x-icici-api-key"], headers["x-icici-session-token"]);
        return { status: "success", broker: "icicibreeze", message: "ICICI Breeze API connected", hasData: !!result?.data };
      }
      case "kotakneo": {
        const result = await handleKotakProxy(params, headers["x-kotak-api-key"], headers["x-kotak-access-token"], headers["x-kotak-sid"], headers["x-kotak-auth"]);
        return { status: "success", broker: "kotakneo", message: "Kotak Neo API connected", hasData: !!result?.data };
      }
      case "aliceblue": {
        const result = await handleAliceBlueProxy(params, headers["x-aliceblue-user-id"], headers["x-aliceblue-session-id"]);
        return { status: "success", broker: "aliceblue", message: "Alice Blue API connected", hasData: !!result?.data };
      }
      case "fivepaisa": {
        const result = await handleFivePaisaProxy(params, headers["x-5paisa-jwt-token"], headers["x-5paisa-client-code"], headers["x-5paisa-app-key"]);
        return { status: "success", broker: "fivepaisa", message: "5paisa API connected", hasData: !!result?.data };
      }
      case "motilal": {
        const result = await handleMotilalProxy(params, headers["x-motilal-api-key"], headers["x-motilal-auth-token"]);
        return { status: "success", broker: "motilal", message: "Motilal Oswal API connected", hasData: !!result?.data };
      }
      case "samco": {
        const result = await handleSamcoProxy(params, headers["x-samco-user-id"], headers["x-samco-password"], headers["x-samco-year-of-birth"]);
        return { status: "success", broker: "samco", message: "Samco StockNote API connected", hasData: !!result?.data };
      }
      default:
        throw new Error(`Unknown broker: ${brokerId}`);
    }
  } catch (err) {
    return { status: "error", broker: brokerId, message: err.message };
  }
}

// ══════════════════════════════════════════════
// ── SECTION 3: NSE API ──
// ══════════════════════════════════════════════

let nseSessionCookies = "";
let nseSessionExpiry = 0;

async function getNSESession() {
  if (nseSessionCookies && Date.now() < nseSessionExpiry) return nseSessionCookies;

  try {
    const res = await fetch(NSE_BASE, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });
    
    // Extract ALL set-cookie headers
    const rawHeaders = res.headers.raw ? res.headers.raw() : {};
    const setCookieHeaders = rawHeaders["set-cookie"] || [];
    
    // Fallback: try standard getSetCookie()
    let cookies = [];
    if (setCookieHeaders.length > 0) {
      cookies = setCookieHeaders.map(c => c.split(";")[0].trim()).filter(Boolean);
    } else {
      // Node 18+ approach
      const setCookie = res.headers.get("set-cookie") || "";
      cookies = setCookie
        .split(",")
        .map(c => c.split(";")[0].trim())
        .filter(c => c.includes("="));
    }
    
    nseSessionCookies = cookies.join("; ");
    nseSessionExpiry = Date.now() + 90000; // 90s session
    await res.text(); // Consume response body
    
    if (nseSessionCookies) {
      console.log(`  🍪 NSE session established (${cookies.length} cookies)`);
    } else {
      console.warn("  ⚠️ NSE session: no cookies received");
    }
    
    return nseSessionCookies;
  } catch (e) {
    console.error(`  ❌ NSE session error: ${e.message}`);
    return "";
  }
}

async function handleNSEProxy(params) {
  const endpoint = params.get("endpoint");
  const symbol = params.get("symbol");
  const cacheKey = `nse:${endpoint}:${symbol || ""}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

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

  const lastGoodKey = `lastgood:nse:${endpoint}:${symbol || ""}`;
  
  // Try NSE with session retry
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cookies = await getNSESession();
      const nseRes = await fetch(`${NSE_BASE}${apiPath}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          Referer: "https://www.nseindia.com/option-chain",
          Cookie: cookies,
        },
      });

      if (!nseRes.ok) {
        throw new Error(`NSE HTTP ${nseRes.status}`);
      }

      const contentType = nseRes.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        // NSE returned HTML (likely a captcha or redirect) — invalidate session
        nseSessionCookies = "";
        nseSessionExpiry = 0;
        if (attempt === 0) {
          console.log(`  🔄 NSE returned non-JSON for ${endpoint}, retrying with fresh session...`);
          continue; // retry
        }
        throw new Error("NSE returned non-JSON response (possible captcha)");
      }

      const data = await nseRes.json();
      
      // Validate the data is not empty/malformed
      const isValidOC = endpoint === "option-chain" ? (data?.records?.data?.length > 0) : true;
      const isValidData = data && Object.keys(data).length > 0 && isValidOC;
      
      if (isValidData) {
        setLastGood(lastGoodKey, data);
      }
      
      const ttl = endpoint === "fii-dii" ? 300000 : 30000;
      setCache(cacheKey, data, ttl);
      return { data, cacheHit: false };
    } catch (nseErr) {
      if (attempt === 0) {
        // Invalidate session and retry
        nseSessionCookies = "";
        nseSessionExpiry = 0;
        console.log(`  ⚠️ NSE fetch failed for ${endpoint} (attempt ${attempt + 1}): ${nseErr.message}`);
        continue;
      }
      console.warn(`  ❌ NSE fetch failed for ${endpoint}: ${nseErr.message}`);
    }
  }
  
  // Both attempts failed — try last-good cache
  const lastGood = getLastGood(lastGoodKey);
  if (lastGood) {
    console.log(`  📦 Serving last-good NSE data for ${endpoint}:${symbol || ""}`);
    setCache(cacheKey, lastGood.data, 60000);
    return { data: lastGood.data, cacheHit: false };
  }
  
  // No cache — return empty object
  return { data: {}, cacheHit: false };
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
// ── SECTION 3c: Yahoo Finance Historical Charts ──
// ══════════════════════════════════════════════

// Yahoo symbol mapping for Indian stocks & indices
const YAHOO_SYMBOL_MAP = {
  // Indices
  "NIFTY": "^NSEI",
  "BANKNIFTY": "^NSEBANK",
  "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
  "MIDCPNIFTY": "NIFTY_MID_SELECT.NS",
  "INDIAVIX": "^INDIAVIX",
  "SENSEX": "^BSESN",
  // F&O Stocks — append .NS for NSE
};

function toYahooSymbol(symbol) {
  if (YAHOO_SYMBOL_MAP[symbol]) return YAHOO_SYMBOL_MAP[symbol];
  // Default: append .NS for NSE equities
  return `${symbol}.NS`;
}

// Yahoo Finance interval mapping
function toYahooInterval(interval) {
  switch (interval) {
    case "1": return "1m";
    case "5": return "5m";
    case "15": return "15m";
    case "60": return "1h";
    case "D": return "1d";
    default: return "1d";
  }
}

async function handleYahooChart(params) {
  const symbol = params.get("symbol");
  const interval = params.get("interval") || "D";
  const fromDate = params.get("fromDate");
  const toDate = params.get("toDate");

  if (!symbol) throw new Error("Missing symbol parameter");

  const yahooSymbol = toYahooSymbol(symbol.toUpperCase());
  const yahooInterval = toYahooInterval(interval);

  const cacheKey = `yahoo:chart:${yahooSymbol}:${yahooInterval}:${fromDate}:${toDate}`;
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  // Build Yahoo Finance chart URL
  const now = Math.floor(Date.now() / 1000);
  let period1, period2;

  if (fromDate) {
    period1 = Math.floor(new Date(fromDate).getTime() / 1000);
  } else {
    period1 = now - (365 * 24 * 60 * 60); // Default 1 year
  }
  period2 = toDate ? Math.floor(new Date(toDate).getTime() / 1000) : now;

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=${period1}&period2=${period2}&interval=${yahooInterval}&includePrePost=false`;

  console.log(`  📈 Yahoo Finance: ${symbol} → ${yahooSymbol} (${yahooInterval}, ${fromDate || "1y"} → ${toDate || "now"})`);

  const res = await fetch(yahooUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Yahoo Finance error [${res.status}]: ${errText.substring(0, 200)}`);
  }

  const raw = await res.json();
  const result = raw?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo Finance returned empty result");

  const timestamps = result.timestamp || [];
  const quotes = result.indicators?.quote?.[0] || {};

  // Convert to our standard format (matching Dhan's structure)
  const data = {
    status: "success",
    source: "yahoo",
    data: {
      open: quotes.open || [],
      high: quotes.high || [],
      low: quotes.low || [],
      close: quotes.close || [],
      volume: quotes.volume || [],
      timestamp: timestamps,
    },
  };

  const ttl = interval === "D" ? 300000 : 60000; // 5min for daily, 1min for intraday
  setCache(cacheKey, data, ttl);
  console.log(`  ✅ Yahoo Finance: ${symbol} — ${timestamps.length} candles fetched`);
  return { data, cacheHit: false };
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
    // If rate-limited (429), use longer backoff
    if (err.message && err.message.includes("429")) {
      dhanWSReconnectDelay = 120000; // 2 minutes
      console.log("  ⏳ Rate-limited by Dhan. Will retry in 120s...");
    }
  });

  // Respond to server pings automatically (ws library handles this by default)
}

function scheduleDhanReconnect() {
  if (dhanWSReconnectTimer) clearTimeout(dhanWSReconnectTimer);
  // Only double the delay if not already set higher (e.g. by rate-limit handler)
  const doubled = Math.min(dhanWSReconnectDelay * 2, 30000);
  dhanWSReconnectDelay = Math.max(dhanWSReconnectDelay, doubled);
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
  "Access-Control-Allow-Headers": [
    "Content-Type",
    "x-dhan-client-id", "x-dhan-access-token",
    "x-zerodha-api-key", "x-zerodha-access-token",
    "x-upstox-access-token",
    "x-angel-api-key", "x-angel-jwt-token",
    "x-fyers-app-id", "x-fyers-access-token",
    "x-groww-access-token",
    "x-shoonya-user-id", "x-shoonya-session-token",
    "x-icici-api-key", "x-icici-api-secret", "x-icici-session-token",
    "x-kotak-api-key", "x-kotak-access-token", "x-kotak-sid", "x-kotak-auth",
    "x-aliceblue-user-id", "x-aliceblue-session-id",
    "x-5paisa-jwt-token", "x-5paisa-client-code", "x-5paisa-app-key",
    "x-motilal-api-key", "x-motilal-auth-token",
    "x-samco-user-id", "x-samco-password", "x-samco-year-of-birth",
  ].join(", "),
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
    } else if (url.pathname === "/api/yahoo-chart") {
      const { data, cacheHit } = await handleYahooChart(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/zerodha-proxy") {
      const data = await handleZerodhaProxy(params, req.headers["x-zerodha-api-key"], req.headers["x-zerodha-access-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/upstox-proxy") {
      const data = await handleUpstoxProxy(params, req.headers["x-upstox-access-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/angel-proxy") {
      const data = await handleAngelProxy(params, req.headers["x-angel-api-key"], req.headers["x-angel-jwt-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/fyers-proxy") {
      const data = await handleFyersProxy(params, req.headers["x-fyers-app-id"], req.headers["x-fyers-access-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/groww-proxy") {
      const data = await handleGrowwProxy(params, req.headers["x-groww-access-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/shoonya-proxy") {
      const data = await handleShoonyaProxy(params, req.headers["x-shoonya-user-id"], req.headers["x-shoonya-session-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/icicibreeze-proxy") {
      const data = await handleBreezeProxy(params, req.headers["x-icici-api-key"], req.headers["x-icici-session-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/kotakneo-proxy") {
      const data = await handleKotakProxy(params, req.headers["x-kotak-api-key"], req.headers["x-kotak-access-token"], req.headers["x-kotak-sid"], req.headers["x-kotak-auth"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/aliceblue-proxy") {
      const data = await handleAliceBlueProxy(params, req.headers["x-aliceblue-user-id"], req.headers["x-aliceblue-session-id"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/fivepaisa-proxy") {
      const data = await handleFivePaisaProxy(params, req.headers["x-5paisa-jwt-token"], req.headers["x-5paisa-client-code"], req.headers["x-5paisa-app-key"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/motilal-proxy") {
      const data = await handleMotilalProxy(params, req.headers["x-motilal-api-key"], req.headers["x-motilal-auth-token"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/samco-proxy") {
      const data = await handleSamcoProxy(params, req.headers["x-samco-user-id"], req.headers["x-samco-password"], req.headers["x-samco-year-of-birth"]);
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/test-connection") {
      // Universal broker test — brokerId comes from ?broker= query param
      const brokerId = params.get("broker") || "dhan";
      const result = await handleTestBrokerConnection(brokerId, req);
      res.writeHead(200);
      res.end(JSON.stringify(result));
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
          zerodha: true,
          upstox: true,
          angelone: true,
          fyers: true,
          groww: true,
          shoonya: true,
          icicibreeze: true,
          kotakneo: true,
          aliceblue: true,
          fivepaisa: true,
          motilal: true,
          samco: true,
          tradingview: true,
          nse: true,
          yahoo: true,
        },
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found. Use /api/dhan-proxy, /api/nse-proxy, /api/tv-scan, /api/yahoo-chart, or /ws" }));
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
