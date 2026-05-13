/**
 * Local CORS Proxy Server for Mr. Chartist Options Terminal.
 *
 * Architecture:
 *   - Broker REST/WS logic lives in brokers/<id>/ — see brokers/types.mjs for the contract.
 *   - This file is a thin HTTP+WS router: it picks an adapter via x-broker-id (or ?broker=)
 *     and delegates. Vendor-neutral helpers (NSE, TradingView, Yahoo) stay here.
 *
 * Endpoints:
 *   GET  /api/broker-proxy?broker=<id>&endpoint=<...>   broker-agnostic, normalized response
 *   GET  /api/dhan-proxy?endpoint=<...>                 legacy alias → broker=dhan
 *   GET  /api/nse-proxy                                 NSE India fallback
 *   GET  /api/tv-scan                                   TradingView Scanner
 *   GET  /api/yahoo-chart                               Yahoo Finance candles
 *   GET  /api/test-connection                           tests broker auth (uses x-broker-id header)
 *   GET  /api/kite/login                                Kite OAuth-ish login redirect
 *   GET  /api/kite/callback                             handles Kite request_token → access_token
 *   GET  /health
 *   WS   /ws                                            unified live ticks (broker selected per-client)
 *
 * @port 4002 (configurable via PROXY_PORT env var)
 */

import http from "node:http";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

import { initCacheDir, cacheCtx, getCached, setCache, getLastGood, setLastGood } from "./brokers/shared/cache.mjs";
import { getAdapter, hasAdapter, listAdapters, extractCredentials } from "./brokers/registry.mjs";
import { buildLoginUrl, exchangeRequestToken } from "./brokers/kite/auth.mjs";

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
const NSE_BASE = "https://www.nseindia.com";

initCacheDir(__dirname);

const REST_CTX = { cache: cacheCtx };

// ══════════════════════════════════════════════
// ── Broker REST router ──
// ══════════════════════════════════════════════

async function handleBrokerProxy(params, headers) {
  const queryBroker = params.get("broker");
  const { brokerId: headerBroker, credentials } = extractCredentials(headers);
  const brokerId = (queryBroker || headerBroker || "dhan").toLowerCase();
  const endpoint = params.get("endpoint");
  if (!endpoint) throw new Error("Missing 'endpoint' query parameter");

  const adapter = getAdapter(brokerId);
  const data = await adapter.handleRequest(endpoint, params, credentials, REST_CTX);
  return { data };
}

// ══════════════════════════════════════════════
// ── NSE API (broker-agnostic fallback) ──
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

    const rawHeaders = res.headers.raw ? res.headers.raw() : {};
    const setCookieHeaders = rawHeaders["set-cookie"] || [];
    let cookies = [];
    if (setCookieHeaders.length > 0) {
      cookies = setCookieHeaders.map((c) => c.split(";")[0].trim()).filter(Boolean);
    } else {
      const setCookie = res.headers.get("set-cookie") || "";
      cookies = setCookie.split(",").map((c) => c.split(";")[0].trim()).filter((c) => c.includes("="));
    }

    nseSessionCookies = cookies.join("; ");
    nseSessionExpiry = Date.now() + 90000;
    await res.text();

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
    case "indices": apiPath = "/api/allIndices"; break;
    case "market-status": apiPath = "/api/marketStatus"; break;
    case "equity-derivatives": apiPath = `/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O`; break;
    case "market-data-pre-open": apiPath = "/api/market-data-pre-open?key=FO"; break;
    case "fii-dii": apiPath = "/api/fiidiiTradeReact"; break;
    default: throw new Error(`Unknown NSE endpoint: ${endpoint}`);
  }

  const lastGoodKey = `lastgood:nse:${endpoint}:${symbol || ""}`;

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

      if (!nseRes.ok) throw new Error(`NSE HTTP ${nseRes.status}`);
      const contentType = nseRes.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        nseSessionCookies = "";
        nseSessionExpiry = 0;
        if (attempt === 0) {
          console.log(`  🔄 NSE returned non-JSON for ${endpoint}, retrying with fresh session...`);
          continue;
        }
        throw new Error("NSE returned non-JSON response (possible captcha)");
      }
      const data = await nseRes.json();

      const isValidOC = endpoint === "option-chain" ? (data?.records?.data?.length > 0) : true;
      const isValidData = data && Object.keys(data).length > 0 && isValidOC;
      if (isValidData) setLastGood(lastGoodKey, data);

      const ttl = endpoint === "fii-dii" ? 300000 : 30000;
      setCache(cacheKey, data, ttl);
      return { data, cacheHit: false };
    } catch (nseErr) {
      if (attempt === 0) {
        nseSessionCookies = "";
        nseSessionExpiry = 0;
        console.log(`  ⚠️ NSE fetch failed for ${endpoint} (attempt ${attempt + 1}): ${nseErr.message}`);
        continue;
      }
      console.warn(`  ❌ NSE fetch failed for ${endpoint}: ${nseErr.message}`);
    }
  }

  const lastGood = getLastGood(lastGoodKey);
  if (lastGood) {
    console.log(`  📦 Serving last-good NSE data for ${endpoint}:${symbol || ""}`);
    setCache(cacheKey, lastGood.data, 60000);
    return { data: lastGood.data, cacheHit: false };
  }
  return { data: {}, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── TradingView Scanner ──
// ══════════════════════════════════════════════

const TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/india/scan";

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
].map((s) => `NSE:${s}`);

const INDEX_TICKERS = ["NSE:NIFTY", "NSE:BANKNIFTY", "NSE:CNXFINANCE", "BSE:SENSEX"];

async function handleTradingViewScan(params) {
  const scanType = params.get("type") || "stocks";
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
  const stocks = (rawData.data || []).map((item) => {
    const d = item.d || [];
    const cols = body.columns;
    const obj = {};
    cols.forEach((col, i) => { obj[col] = d[i]; });
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
  setCache(cacheKey, { stocks, totalCount: rawData.totalCount, timestamp: Date.now() }, 15000);
  return { data: { stocks, totalCount: rawData.totalCount, timestamp: Date.now() }, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── Yahoo Finance Historical Charts ──
// ══════════════════════════════════════════════

const YAHOO_SYMBOL_MAP = {
  "NIFTY": "^NSEI",
  "BANKNIFTY": "^NSEBANK",
  "FINNIFTY": "NIFTY_FIN_SERVICE.NS",
  "MIDCPNIFTY": "NIFTY_MID_SELECT.NS",
  "INDIAVIX": "^INDIAVIX",
  "SENSEX": "^BSESN",
};

function toYahooSymbol(symbol) {
  if (YAHOO_SYMBOL_MAP[symbol]) return YAHOO_SYMBOL_MAP[symbol];
  return `${symbol}.NS`;
}

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

  const now = Math.floor(Date.now() / 1000);
  const period1 = fromDate ? Math.floor(new Date(fromDate).getTime() / 1000) : now - 365 * 24 * 60 * 60;
  const period2 = toDate ? Math.floor(new Date(toDate).getTime() / 1000) : now;

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

  const ttl = interval === "D" ? 300000 : 60000;
  setCache(cacheKey, data, ttl);
  console.log(`  ✅ Yahoo Finance: ${symbol} — ${timestamps.length} candles fetched`);
  return { data, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── Live tick relay (broker-agnostic) ──
// ══════════════════════════════════════════════
//
// One upstream broker WS per active brokerId. Browser clients tell us which broker
// to use via `{ type: "configure", brokerId, credentials }`. We open the matching
// adapter's WS once and broadcast unified ticks to every connected browser.
//
// `latestTicks` is keyed by `${brokerId}:${instrumentId}` to avoid collisions when
// two adapters happen to use the same numeric token.

const upstreamConnections = new Map(); // brokerId → WSConnection
const latestTicks = new Map(); // `${brokerId}:${instrumentId}` → tick

const localWSS = new WebSocketServer({ noServer: true });

function broadcastToClients(data) {
  const json = JSON.stringify(data);
  localWSS.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(json);
  });
}

function ensureUpstream(brokerId, credentials) {
  if (upstreamConnections.has(brokerId)) return upstreamConnections.get(brokerId);

  const adapter = getAdapter(brokerId);
  if (!adapter.openWebSocket || !adapter.capabilities.hasWebSocket) {
    throw new Error(`Broker ${brokerId} does not support WebSocket`);
  }

  const conn = adapter.openWebSocket(credentials, {
    onTick: (tick) => {
      const key = `${tick.brokerId}:${tick.instrumentId}`;
      const existing = latestTicks.get(key) || {};
      const merged = { ...existing, ...tick, timestamp: Date.now() };
      if (merged.prevClose && merged.ltp) {
        merged.change = merged.ltp - merged.prevClose;
        merged.changePercent = (merged.change / merged.prevClose) * 100;
      }
      latestTicks.set(key, merged);
      broadcastToClients(merged);
    },
    onStatus: (connected, info) => {
      broadcastToClients({ type: "status", brokerId, connected, ...(info || {}) });
    },
    onError: (err) => {
      console.error(`  ❌ [${brokerId}] WS error:`, err.message);
    },
  });

  if (conn) upstreamConnections.set(brokerId, conn);
  return conn;
}

localWSS.on("connection", (ws) => {
  console.log("  🌐 Browser WebSocket client connected");

  // Send aggregate status (any upstream connected?)
  const anyConnected = Array.from(upstreamConnections.values()).some((c) => c.isConnected());
  ws.send(JSON.stringify({ type: "status", connected: anyConnected }));

  // Replay all cached latest ticks immediately
  for (const [, tick] of latestTicks) {
    ws.send(JSON.stringify(tick));
  }

  ws.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());

      if (parsed.type === "configure") {
        // New broker-agnostic shape: { brokerId, credentials }
        // Legacy Dhan shape:        { clientId, accessToken }
        const brokerId = (parsed.brokerId || "dhan").toLowerCase();
        const credentials = parsed.credentials
          || (parsed.clientId && parsed.accessToken ? { clientId: parsed.clientId, accessToken: parsed.accessToken } : {});

        if (!hasAdapter(brokerId)) {
          ws.send(JSON.stringify({ type: "status", connected: false, error: `Unknown broker: ${brokerId}` }));
          return;
        }
        try {
          ensureUpstream(brokerId, credentials);
        } catch (err) {
          ws.send(JSON.stringify({ type: "status", brokerId, connected: false, error: err.message }));
        }
      }

      if (parsed.type === "subscribe" && parsed.instruments) {
        const brokerId = (parsed.brokerId || "dhan").toLowerCase();
        const conn = upstreamConnections.get(brokerId);
        if (conn) conn.subscribe(parsed.instruments);
      }
    } catch { /* ignore */ }
  });

  ws.on("close", () => {
    console.log("  🔌 Browser WebSocket client disconnected");
  });
});

// ══════════════════════════════════════════════
// ── Kite OAuth-ish callback ──
// ══════════════════════════════════════════════
//
// On successful Kite login, Zerodha redirects to:
//   <our redirect>?action=login&type=login&status=success&request_token=<...>
// We exchange the request_token for an access_token here and then redirect back
// to the frontend with the access_token in a fragment so it can be saved.

async function handleKiteCallback(params, res) {
  const requestToken = params.get("request_token");
  const apiKey = params.get("api_key") || process.env.KITE_API_KEY;
  const apiSecret = params.get("api_secret") || process.env.KITE_API_SECRET;
  const returnTo = params.get("return_to") || "/broker-settings";

  if (!requestToken) {
    res.writeHead(400);
    res.end(JSON.stringify({ status: "error", message: "Missing request_token" }));
    return;
  }
  if (!apiKey || !apiSecret) {
    res.writeHead(400);
    res.end(JSON.stringify({
      status: "error",
      message: "apiKey and apiSecret are required (pass via query or set KITE_API_KEY / KITE_API_SECRET).",
    }));
    return;
  }

  try {
    const session = await exchangeRequestToken(apiKey, apiSecret, requestToken);
    // Redirect back with access_token in fragment (never logged in server access logs)
    const targetUrl = `${returnTo}#kite_access_token=${encodeURIComponent(session.access_token)}&kite_user_id=${encodeURIComponent(session.user_id || "")}`;
    res.writeHead(302, { Location: targetUrl });
    res.end();
  } catch (err) {
    res.writeHead(500);
    res.end(JSON.stringify({ status: "error", message: err.message }));
  }
}

// ══════════════════════════════════════════════
// ── HTTP server ──
// ══════════════════════════════════════════════

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-broker-id, x-broker-credentials, x-dhan-client-id, x-dhan-access-token",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = url.searchParams;
  const headers = req.headers;

  // Default JSON content type; redirects override it
  res.setHeader("Content-Type", "application/json");
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (url.pathname === "/api/broker-proxy" || url.pathname === "/api/dhan-proxy") {
      // /api/dhan-proxy is a legacy alias — force broker=dhan for it
      if (url.pathname === "/api/dhan-proxy" && !params.get("broker")) {
        params.set("broker", "dhan");
      }
      const { data } = await handleBrokerProxy(params, headers);
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
    } else if (url.pathname === "/api/test-connection") {
      const { brokerId, credentials } = extractCredentials(headers);
      const adapter = getAdapter(brokerId);
      const result = await adapter.handleRequest("test-connection", params, credentials, REST_CTX);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } else if (url.pathname === "/api/kite/login") {
      const apiKey = params.get("api_key") || process.env.KITE_API_KEY;
      if (!apiKey) {
        res.writeHead(400);
        res.end(JSON.stringify({ status: "error", message: "Missing api_key" }));
        return;
      }
      const loginUrl = buildLoginUrl(apiKey, params.get("redirect_params") || "");
      res.writeHead(302, { Location: loginUrl });
      res.end();
    } else if (url.pathname === "/api/kite/callback") {
      await handleKiteCallback(params, res);
    } else if (url.pathname === "/health") {
      const upstreamStatus = {};
      for (const [id, conn] of upstreamConnections) {
        upstreamStatus[id] = conn.isConnected();
      }
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        adapters: listAdapters().map((a) => ({ id: a.id, name: a.name })),
        websocket: {
          upstreams: upstreamStatus,
          browserClients: localWSS.clients.size,
          cachedTicks: latestTicks.size,
        },
        sources: {
          dhan: !!process.env.DHAN_CLIENT_ID,
          kite: !!process.env.KITE_API_KEY,
          tradingview: true,
          nse: true,
          yahoo: true,
        },
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found. Use /api/broker-proxy, /api/nse-proxy, /api/tv-scan, /api/yahoo-chart, /api/kite/login, or /ws" }));
    }
  } catch (err) {
    console.error(`[Proxy Error] ${url.pathname}:`, err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (url.pathname === "/ws") {
    localWSS.handleUpgrade(request, socket, head, (ws) => localWSS.emit("connection", ws, request));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  🚀 Mr. Chartist Proxy Server");
  console.log(`  ├─ HTTP:        http://localhost:${PORT}`);
  console.log(`  ├─ WebSocket:   ws://localhost:${PORT}/ws`);
  console.log(`  ├─ Health:      http://localhost:${PORT}/health`);
  console.log(`  ├─ Broker:      http://localhost:${PORT}/api/broker-proxy?broker=<id>&endpoint=...`);
  console.log(`  ├─ NSE  (2°):   http://localhost:${PORT}/api/nse-proxy?endpoint=indices`);
  console.log(`  ├─ TV Scanner:  http://localhost:${PORT}/api/tv-scan?type=stocks`);
  console.log(`  └─ Kite login:  http://localhost:${PORT}/api/kite/login`);
  console.log("");
  console.log("  Adapters registered:", listAdapters().map((a) => a.id).join(", "));
  console.log("  Dhan creds:", process.env.DHAN_CLIENT_ID ? "✅ from .env" : "⚠️  not set");
  console.log("  Kite creds:", process.env.KITE_API_KEY ? "✅ from .env" : "⚠️  not set");
  console.log("");

  // Auto-connect Dhan WebSocket if .env has credentials (preserves prior behavior)
  if (process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN) {
    try {
      ensureUpstream("dhan", { clientId: process.env.DHAN_CLIENT_ID, accessToken: process.env.DHAN_ACCESS_TOKEN });
    } catch (err) {
      console.error("  ❌ Failed to auto-connect Dhan:", err.message);
    }
  }
  if (process.env.KITE_API_KEY && process.env.KITE_ACCESS_TOKEN) {
    try {
      ensureUpstream("kite", { apiKey: process.env.KITE_API_KEY, accessToken: process.env.KITE_ACCESS_TOKEN });
    } catch (err) {
      console.error("  ❌ Failed to auto-connect Kite:", err.message);
    }
  }
});
