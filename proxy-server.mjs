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
import { INDEX_SECURITY_IDS, UNDERLYING_MAP, dhanFetch, fetchFuturesQuotes as dhanFetchFuturesQuotes, fetchRolloverData as dhanFetchRolloverData, fetchMCXExpiryList } from "./server/brokers/dhan.mjs";
import { createBrokerRegistry } from "./server/brokers/registry.mjs";
import { computeBasis } from "./server/lib/futuresUtils.mjs";
import { placeOrder as dhanPlaceOrder, getOrders as dhanGetOrders, getOrderStatus as dhanGetOrderStatus, cancelOrder as dhanCancelOrder } from "./server/lib/dhanOrders.mjs";
import { getPositions as dhanGetPositions, getHoldings as dhanGetHoldings, getFunds as dhanGetFunds, getTrades as dhanGetTrades, modifyOrder as dhanModifyOrder } from "./server/lib/dhanPortfolio.mjs";
import { recordSnapshot, getSeries } from "./server/lib/dailySnapshotStore.mjs";
import { parseDhanFrame, tickKey } from "./server/lib/dhanPacketParser.mjs";
import { createSubscriptionManager } from "./server/lib/feedSubscriptions.mjs";
import { validateOrder, recordOrder } from "./server/lib/orderGuard.mjs";
import { marketSession } from "./server/lib/marketHours.mjs";
import * as tickBus from "./server/lib/tickBus.mjs";
import * as riskEngine from "./server/lib/riskEngine.mjs";
import * as panicLayer from "./server/lib/panicLayer.mjs";
import * as panicGate from "./server/lib/panicGate.mjs";
import * as tradingLockState from "./server/lib/tradingLockState.mjs";
import * as auditLog from "./server/lib/auditLog.mjs";
import * as basketEngine from "./server/lib/basketEngine.mjs";

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

// Every existing route is GET + query params — fine for read-only data, but
// order details (symbol, qty, price, side) must never ride in a URL query
// string for something this sensitive (browser history, server access logs,
// any intermediate proxy would otherwise see it in plaintext). Order routes
// are the first callers of this.
function readJsonBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) { // 1MB guard — no order body is ever this large
        rejectPromise(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolvePromise({});
      try { resolvePromise(JSON.parse(raw)); } catch { rejectPromise(new Error("Invalid JSON body")); }
    });
    req.on("error", rejectPromise);
  });
}

// This proxy is meant to run unattended through the whole market session — a
// single unforeseen unhandled rejection/exception (e.g. from a code path that
// isn't wrapped in try/catch) would otherwise kill the entire process and cut
// off live data for everyone until someone notices and restarts it manually.
// Log and keep running instead.
process.on("unhandledRejection", (reason) => {
  console.error("  ❌ [Unhandled Rejection]", reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("  ❌ [Uncaught Exception]", err?.stack || err);
});

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

// ── Panic-layer wiring (1CLIQ-TRADE-SPEC.md §5) ──
// server/lib/panicLayer.mjs is broker-agnostic (injected executor/fetcher
// functions, no knowledge of Dhan's field names or REST paths). These
// functions are the translation layer that lets it act on this account's
// real book, and are the only place Dhan-specific position/order shapes are
// read for the panic path.

const DHAN_OPEN_ORDER_STATUSES = new Set(["TRANSIT", "PENDING", "PART_TRADED"]);

/** Dhan's own open-orders view — "open" here means still resting, not yet terminal. */
async function fetchDhanOpenOrders(creds) {
  const orders = await dhanGetOrders(creds);
  return (Array.isArray(orders) ? orders : []).filter((o) => DHAN_OPEN_ORDER_STATUSES.has(o?.orderStatus));
}

/**
 * Map one Dhan GET /positions record onto panicLayer's OpenPosition shape.
 * Field names verified against Dhan's live v2 docs (dhanhq.co/docs/v2/portfolio/,
 * checked this session, not assumed from memory — see dhanOrders.mjs's header
 * for why that verification matters here): `netQty` is signed exchange
 * quantity, `multiplier` is the contract's lot size, `drvOptionType`
 * ("CALL"/"PUT") is present only for option legs.
 */
function mapDhanPositionToOpenPosition(p) {
  const netQty = Number(p.netQty) || 0;
  const lotSize = Number(p.multiplier) > 0 ? Number(p.multiplier) : 1;
  const assetClass = p.drvOptionType === "CALL" || p.drvOptionType === "PUT"
    ? "OPTION"
    : String(p.exchangeSegment || "").includes("FNO") ? "FUTURE" : "EQUITY";
  return {
    id: `${p.exchangeSegment}:${p.securityId}`,
    securityId: p.securityId,
    exchangeSegment: p.exchangeSegment,
    productType: p.productType,
    assetClass,
    netQty,
    lotSize,
    lots: Math.max(1, Math.round(Math.abs(netQty) / lotSize)),
    unrealisedPnl: Number(p.unrealizedProfit) || 0,
  };
}

/** Every currently open (non-flat, non-CLOSED) position on this Dhan account. */
async function fetchDhanOpenPositions(creds) {
  const raw = await dhanFetch("/positions", null, "GET", creds.clientId, creds.accessToken);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return list
    .filter((p) => p?.positionType !== "CLOSED" && Number(p?.netQty) !== 0)
    .map(mapDhanPositionToOpenPosition);
}

/**
 * panicLayer's orderExecutor for real Dhan close orders. Reuses
 * dhanOrders.mjs's buildOrderBody()/placeOrder() — the exact code path
 * "place-order" already uses — instead of hand-rolling a second order-body
 * builder, so B1's "lot size only ever comes from a resolved value" property
 * holds here too. MARKET/IOC is the panic-specific override from spec §5
 * (unlike the DAY-validity default for ordinary order entry in spec §8).
 */
function makeDhanCloseExecutor(creds) {
  return async function dhanCloseExecutor(intent) {
    const order = {
      transactionType: intent.transactionType,
      exchangeSegment: intent.exchangeSegment,
      productType: intent.productType || "INTRADAY",
      orderType: "MARKET",
      validity: "IOC",
      securityId: intent.securityId,
      lots: intent.lots,
      correlationId: `panic-${intent.positionId}-w${intent.wave}`.slice(0, 40),
    };
    return dhanPlaceOrder(creds, order, intent.lotSize);
  };
}

function makeDhanCancelExecutor(creds) {
  return async function dhanCancelExecutor(order) {
    return dhanCancelOrder(creds, order?.orderId ?? order?.id);
  };
}

/** A stable intentId for the audit trail even when the client didn't send one. */
function panicIntentId(body, prefix) {
  if (body && typeof body.intentId === "string" && body.intentId) return body.intentId;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Basket deploy support (1CLIQ-TRADE-SPEC.md §9) ──

// Enough expiries to cover weeksOut 0/1/2 and a "monthly" spec (NSE's
// monthly is always one of the first handful of weeklies in the current
// calendar month) without fetching Dhan's entire listed expiry calendar on
// every basket resolve.
const BASKET_CHAIN_EXPIRY_LOOKAHEAD = 6;

/**
 * Minimal raw Dhan `oc` map -> basketEngine's ChainOptionRow[] adapter — only
 * the 3 fields resolveBasket() actually reads (securityId, exchangeSegment,
 * delta). src/lib/marketApi.ts's parseDhanOptionChain() does the fuller
 * UI-facing parse of this same raw shape; that file is TypeScript/browser-
 * facing so it can't be imported from this server module (one-purpose-per-
 * file — see CLAUDE.md), hence this deliberately minimal server-only
 * duplicate of just the fields basket resolution needs.
 */
function dhanOcToChainRows(oc) {
  if (!oc || typeof oc !== "object") return [];
  const toLeg = (l) => {
    if (!l) return { securityId: null, exchangeSegment: null, delta: undefined };
    const securityId = l.security_id !== undefined && l.security_id !== null ? String(l.security_id) : null;
    const delta = l.greeks?.delta ?? l.delta;
    return { securityId, exchangeSegment: securityId ? "NSE_FNO" : null, delta };
  };
  return Object.keys(oc).map((strikeStr) => ({
    strikePrice: parseFloat(strikeStr),
    ce: toLeg(oc[strikeStr]?.ce),
    pe: toLeg(oc[strikeStr]?.pe),
  }));
}

/** Strike step size derived from the chain's own listed strikes (e.g. 50 for
 * NIFTY, 100 for BANKNIFTY) — never hardcoded, so this never becomes a
 * second stale constant alongside the B1 lot-size bug fixed elsewhere in
 * this build. */
function inferStepSizeFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const strikes = [...new Set(rows.map((r) => r.strikePrice))].sort((a, b) => a - b);
  return strikes.length >= 2 ? strikes[1] - strikes[0] : null;
}

async function handleDhanProxy(params, userClientId, userAccessToken, body = null) {
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
      const lastGoodKey = `lastgood:expiry:${symbol}`;

      // MCX commodities (CRUDEOIL, GOLD, SILVER, NATURALGAS, ...) have no
      // "UnderlyingScrip" in Dhan's option-chain API — their real expiry
      // calendar comes from the public instrument master instead, and needs
      // no access token, so it isn't subject to the same auth failures.
      if (!underlying) {
        const result = await fetchMCXExpiryList(symbol);
        if (result?.data?.length > 0) setLastGood(lastGoodKey, result);
        setCache(cacheKey, result, 3600000); // 1hr — commodity expiries barely move intraday
        return { data: result, cacheHit: false };
      }

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

    case "futures-quotes": {
      // Real stock/index futures LTP, OI, OI-change and buildup signal — powers
      // the Scanner page. Always Dhan+NSE regardless of the user's active broker
      // (same as the rest of the dashboard-wide data), since it's a bulk-universe
      // scan rather than a single-symbol trade lookup.
      const symbolsParam = params.get("symbols");
      if (!symbolsParam) throw new Error("Missing symbols parameter");
      const symbols = [...new Set(symbolsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))];
      const futuresCacheKey = `dhan:futures-quotes:${symbols.slice().sort().join(",")}`;
      const cachedFutures = getCached(futuresCacheKey);
      if (cachedFutures) return { data: cachedFutures, cacheHit: true };
      const lastGoodKey = "lastgood:futures-quotes:all";

      try {
        const indexSymbols = symbols.filter(s => INDEX_SECURITY_IDS[s]);
        const [futuresResult, cashResult, indexLtpResult] = await Promise.all([
          dhanFetchFuturesQuotes({ clientId: userClientId, accessToken: userAccessToken }, symbols),
          handleNSEProxy(new URLSearchParams({ endpoint: "equity-derivatives" })).catch(() => null),
          indexSymbols.length > 0
            ? dhanFetch("/marketfeed/ltp", {
                IDX_I: indexSymbols.map(s => INDEX_SECURITY_IDS[s].secId),
              }, "POST", userClientId, userAccessToken).catch(() => null)
            : Promise.resolve(null),
        ]);

        const spotBySymbol = new Map();
        for (const row of cashResult?.data?.data || []) {
          if (row?.symbol && Number.isFinite(row.lastPrice)) spotBySymbol.set(row.symbol, row.lastPrice);
        }
        if (indexLtpResult?.data?.IDX_I) {
          for (const sym of indexSymbols) {
            const secId = String(INDEX_SECURITY_IDS[sym].secId);
            const ltp = indexLtpResult.data.IDX_I[secId]?.last_price;
            if (Number.isFinite(ltp)) spotBySymbol.set(sym, ltp);
          }
        }

        const enriched = (futuresResult?.data || []).map(row => {
          const spotLtp = spotBySymbol.get(row.symbol) ?? null;
          const { basis, basisPercent } = computeBasis(row.futuresLtp, spotLtp);
          return { ...row, spotLtp, basis, basisPercent };
        });

        if (enriched.length > 0) {
          setLastGood(lastGoodKey, enriched);
          setCache(futuresCacheKey, enriched, 15000);
          return { data: enriched, cacheHit: false };
        }

        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Serving last-good futures-quotes (empty live result)`);
          setCache(futuresCacheKey, lastGood.data, 30000);
          return { data: lastGood.data, cacheHit: false };
        }
        return { data: enriched, cacheHit: false };
      } catch (e) {
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 futures-quotes error, serving last-good: ${e.message}`);
          return { data: lastGood.data, cacheHit: false };
        }
        console.log(`  ⚠️ futures-quotes unavailable (no cache): ${e.message}`);
        setCache(futuresCacheKey, [], 30000);
        return { data: [], cacheHit: false };
      }
    }

    case "rollover": {
      // Near-month vs next-month OI split — how much of the market has
      // already shifted into the next series ahead of expiry.
      const symbolsParam = params.get("symbols");
      if (!symbolsParam) throw new Error("Missing symbols parameter");
      const symbols = [...new Set(symbolsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))];
      const rolloverCacheKey = `dhan:rollover:${symbols.slice().sort().join(",")}`;
      const cachedRollover = getCached(rolloverCacheKey);
      if (cachedRollover) return { data: cachedRollover, cacheHit: true };
      const lastGoodKey = "lastgood:rollover:all";

      try {
        const result = await dhanFetchRolloverData({ clientId: userClientId, accessToken: userAccessToken }, symbols);
        const data = result?.data || [];
        if (data.length > 0) {
          setLastGood(lastGoodKey, data);
          setCache(rolloverCacheKey, data, 60000); // OI shifts slowly — 1min is plenty
          return { data, cacheHit: false };
        }
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 Serving last-good rollover data (empty live result)`);
          return { data: lastGood.data, cacheHit: false };
        }
        return { data: [], cacheHit: false };
      } catch (e) {
        const lastGood = getLastGood(lastGoodKey);
        if (lastGood) {
          console.log(`  📦 rollover error, serving last-good: ${e.message}`);
          return { data: lastGood.data, cacheHit: false };
        }
        console.log(`  ⚠️ rollover unavailable (no cache): ${e.message}`);
        return { data: [], cacheHit: false };
      }
    }

    case "place-order": {
      // Real money. No caching, no retry, no last-good fallback — a failed
      // request must surface Dhan's real error (e.g. the static-IP rejection)
      // to the user verbatim, never silently retried or masked by stale data.
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const order = body || {};

      // The validation ladder runs HERE, on the server, not only in the UI.
      // It also resolves the authoritative lot size from the exchange
      // instrument master — the client's lotSize is ignored entirely.
      const key = tickKey(order.exchangeSegment || "NSE_FNO", order.securityId);
      const verdict = await validateOrder(order, {
        clientId: userClientId || "unknown",
        liveArmed: order.liveArmed === true,
        ltp: latestTicks.get(key)?.ltp ?? null,
        limits: order.limits || null,
      });

      if (!verdict.ok) {
        console.log(`  🛑 Order blocked [${verdict.code}]: ${verdict.message}`);
        const err = new Error(verdict.message);
        err.statusCode = 422;
        err.code = verdict.code;
        throw err;
      }

      recordOrder(userClientId || "unknown", order);
      const result = await dhanPlaceOrder(creds, order, verdict.lotSize);
      return {
        data: { ...result, resolvedLotSize: verdict.lotSize, quantity: verdict.quantity, warnings: verdict.warnings },
        cacheHit: false,
      };
    }

    case "orders": {
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanGetOrders(creds);
      return { data: result, cacheHit: false };
    }

    case "order-status": {
      const orderId = params.get("orderId");
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanGetOrderStatus(creds, orderId);
      return { data: result, cacheHit: false };
    }

    case "cancel-order": {
      const orderId = body?.orderId || params.get("orderId");
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanCancelOrder(creds, orderId);
      return { data: result, cacheHit: false };
    }

    // ── Portfolio reads (1CLIQ-TRADE-SPEC.md §B3/§11 Phase 3) — the four
    // tabs that previously had no backend at all. Thin pass-throughs to
    // dhanPortfolio.mjs; never cached, same reasoning as orders/order-status/
    // cancel-order above — a stale Funds or Positions figure in an execution
    // terminal is the worst available failure mode (spec §10).

    case "positions": {
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanGetPositions(creds);
      return { data: result, cacheHit: false };
    }

    case "holdings": {
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanGetHoldings(creds);
      return { data: result, cacheHit: false };
    }

    case "funds": {
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanGetFunds(creds);
      return { data: result, cacheHit: false };
    }

    case "trades": {
      const orderId = params.get("orderId");
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const result = await dhanGetTrades(creds, orderId);
      return { data: result, cacheHit: false };
    }

    case "modify-order": {
      const orderId = body?.orderId || params.get("orderId");
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      // orderId/dhanClientId are deliberately never read from the body's own
      // fields — dhanPortfolio.mjs's buildModifyOrderBody() always wins with
      // the authoritative orderId/clientId resolved above, so a caller can't
      // smuggle a different order or account in through the payload it's editing.
      const { orderId: _ignoredOrderId, dhanClientId: _ignoredClientId, ...changes } = body || {};
      const result = await dhanModifyOrder(creds, orderId, changes);
      return { data: result, cacheHit: false };
    }

    // ── Basket resolution (1CLIQ-TRADE-SPEC.md §9/§11 Phase 4) — resolve-and-
    // report ONLY; this never places an order. It exists so a trader (or a
    // future live-deploy button) can see exactly which legs would come back
    // paper-only before any money moves. Reuses THIS function's own
    // "expiry-list"/"option-chain" cases (recursive calls below) for the
    // fetch+cache+last-good machinery instead of a second Dhan call path.

    case "basket-deploy": {
      const basket = body?.basket;
      if (!basket || !Array.isArray(basket.legs) || basket.legs.length === 0) {
        const err = new Error("Missing basket.legs — nothing to resolve");
        err.statusCode = 422;
        err.code = "BASKET_INVALID";
        throw err;
      }

      const intentId = panicIntentId(body, "basket-resolve");

      const expiryListParams = new URLSearchParams(params);
      expiryListParams.set("endpoint", "expiry-list");
      const { data: expiryListResult } = await handleDhanProxy(expiryListParams, userClientId, userAccessToken, null);
      const allExpiries = Array.isArray(expiryListResult?.data) ? expiryListResult.data : [];

      const lookaheadExpiries = allExpiries.slice(0, BASKET_CHAIN_EXPIRY_LOOKAHEAD);
      // Also fetch any absolute expirySpec date a leg names explicitly, even
      // if it falls outside the lookahead window (e.g. a far-dated monthly).
      for (const leg of basket.legs) {
        const d = leg?.expirySpec?.kind === "absolute" ? leg.expirySpec.date : null;
        if (d && !lookaheadExpiries.includes(d)) lookaheadExpiries.push(d);
      }

      const byExpiry = {};
      let spot = null;
      await Promise.all(lookaheadExpiries.map(async (expiryDate) => {
        const chainParams = new URLSearchParams(params);
        chainParams.set("endpoint", "option-chain");
        chainParams.set("expiry", expiryDate);
        try {
          const { data: ocResult } = await handleDhanProxy(chainParams, userClientId, userAccessToken, null);
          byExpiry[expiryDate] = dhanOcToChainRows(ocResult?.data?.oc);
          if (spot == null && Number.isFinite(ocResult?.data?.last_price)) spot = ocResult.data.last_price;
        } catch (e) {
          // Leave this expiry empty rather than aborting the whole basket —
          // resolveBasket() will honestly report "strike not found" / block
          // whatever leg needed it, instead of the request failing outright.
          console.log(`  ⚠️ basket-deploy: chain fetch failed for ${symbol} ${expiryDate}: ${e.message}`);
          byExpiry[expiryDate] = [];
        }
      }));

      const chain = { expiries: allExpiries, byExpiry };
      const stepSize = Number.isFinite(body?.stepSize) && body.stepSize > 0
        ? body.stepSize
        : inferStepSizeFromRows(byExpiry[lookaheadExpiries[0]]) ?? 50;

      const resolved = basketEngine.resolveBasket(basket, chain, spot, stepSize);

      auditLog.appendAuditEvent({
        intentId,
        type: "BASKET_RESOLVE",
        payload: { symbol, spot, stepSize, blockedForLive: resolved.blockedForLive, blockedLegIds: resolved.blockedLegIds },
      });

      return { data: { ...resolved, spot, stepSize, symbol }, cacheHit: false };
    }

    // ── Server-side risk engine (1CLIQ-TRADE-SPEC.md §3/§4) ──
    // Paper-only so far — riskEngine.mjs's exitExecutor is an injectable stub;
    // no agent has wired real order placement into it yet (see its header).

    case "risk-status": {
      // Never cached (see the getCached() call above this switch) — the whole
      // point of the dead-man's switch is that the badge reflects THIS instant.
      const status = riskEngine.getStatus();
      return {
        data: {
          alive: status.alive,
          lastTickAgeMs: status.lastTickAgeMs,
          armedCount: status.armedCount,
          dhanConnected: dhanWSConnected,
        },
        cacheHit: false,
      };
    }

    case "risk-arm": {
      // riskEngine.armPosition() runs riskMath.validateArmConfig() (plus the
      // rest of its own ladder) before creating anything — a rejection here
      // means nothing was armed, and the reason is the message to show the user.
      const result = riskEngine.armPosition(body || {});
      if (!result.ok) {
        const err = new Error(result.reason);
        err.statusCode = 422;
        err.code = "RISK_ARM_REJECTED";
        throw err;
      }
      return { data: result, cacheHit: false };
    }

    case "risk-disarm": {
      const id = body?.id ?? params.get("id");
      const result = riskEngine.disarmPosition(id);
      if (!result.ok) {
        const err = new Error(result.reason);
        err.statusCode = 422;
        err.code = "RISK_DISARM_REJECTED";
        throw err;
      }
      return { data: result, cacheHit: false };
    }

    // ── Panic layer (1CLIQ-TRADE-SPEC.md §5) — Close All / Cancel All / the
    // trading lock. All four are callable regardless of tradingLockState: a
    // lock blocks getting INTO new positions, never getting OUT of existing
    // ones, so none of these cases consult tradingLockState before acting.

    case "panic-close-all": {
      // F6 is defined (spec §5) as the COMBINED panic action: cancel every
      // resting order first — so nothing can fill behind our back while
      // we're flattening — THEN close every position. That ordering is
      // enforced HERE, in the handler, not trusted from two separate client
      // requests: a client bug or a dropped request could otherwise reverse it.
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const intentId = panicIntentId(body, "panic-close");
      const onEvent = (evt) => auditLog.appendAuditEvent({ intentId, type: `PANIC_${evt.type}`, payload: evt });
      auditLog.appendAuditEvent({ intentId, type: "PANIC_CLOSE_ALL_REQUESTED", payload: { source: body?.source || "F6" } });

      // Fold in anything a racing order placement already flagged as stale
      // (see panicGate.mjs's header). These queues are empty in practice
      // today — no order-placement path calls incrementEpoch()/
      // recordStaleFill() yet — but the drain is wired here so a future one
      // can start using it without a second wiring pass through this file.
      const strayCancels = panicGate.drainPendingCancelQueue().filter((o) => o && (o.orderId || o.id));
      const strayCloses = panicGate.drainPendingCloseQueue();
      if (strayCancels.length || strayCloses.length) {
        // A stray TRADED fill is a real position now — fetchDhanOpenPositions()
        // below will pick it up on its own; this event just makes it visible
        // rather than silently relying on that.
        auditLog.appendAuditEvent({ intentId, type: "PANIC_STRAY_FILLS_DETECTED", payload: { strayCancels, strayCloses } });
      }

      // openOrders/openPositions are ALWAYS the fresh, authoritative broker
      // fetch — never taken from the client body. A client-supplied position
      // array would carry client-supplied lotSize/lots straight into
      // buildCloseIntent() and on into a real dhanPlaceOrder() call, bypassing
      // resolveLotSize()/orderGuard.validateOrder() entirely: the same B1
      // stale/forged-quantity failure mode the rest of this codebase was
      // hardened against, reopened through the panic path.
      const openOrders = await fetchDhanOpenOrders(creds);
      const cancelResult = await panicLayer.cancelAll(
        [...openOrders, ...strayCancels],
        makeDhanCancelExecutor(creds),
        () => fetchDhanOpenOrders(creds),
        { onEvent },
      );

      const openPositions = await fetchDhanOpenPositions(creds);
      const closeResult = await panicLayer.closeAll(
        openPositions,
        makeDhanCloseExecutor(creds),
        () => fetchDhanOpenPositions(creds),
        { onEvent },
      );

      auditLog.appendAuditEvent({
        intentId, type: "PANIC_CLOSE_ALL_COMPLETE",
        payload: { cancelSuccess: cancelResult.success, closeSuccess: closeResult.success },
      });
      return { data: { cancelAll: cancelResult, closeAll: closeResult }, cacheHit: false };
    }

    case "panic-cancel-all": {
      // F7 — cancel resting orders only; open positions are untouched.
      const creds = { clientId: userClientId, accessToken: userAccessToken };
      const intentId = panicIntentId(body, "panic-cancel");
      const onEvent = (evt) => auditLog.appendAuditEvent({ intentId, type: `PANIC_${evt.type}`, payload: evt });
      auditLog.appendAuditEvent({ intentId, type: "PANIC_CANCEL_ALL_REQUESTED", payload: { source: body?.source || "F7" } });

      const strayCancels = panicGate.drainPendingCancelQueue().filter((o) => o && (o.orderId || o.id));
      // Always the fresh broker fetch — see the panic-close-all case above for why.
      const openOrders = await fetchDhanOpenOrders(creds);
      const result = await panicLayer.cancelAll(
        [...openOrders, ...strayCancels],
        makeDhanCancelExecutor(creds),
        () => fetchDhanOpenOrders(creds),
        { onEvent },
      );

      auditLog.appendAuditEvent({ intentId, type: "PANIC_CANCEL_ALL_COMPLETE", payload: { success: result.success } });
      return { data: result, cacheHit: false };
    }

    case "panic-lock-state": {
      // Never cached (see the getCached() call above this switch) — same
      // reasoning as risk-status: the badge must reflect THIS instant.
      return { data: tradingLockState.getLockState(), cacheHit: false };
    }

    case "panic-set-lock": {
      // User-initiated only. Loss-triggered states (locked-by-mtm-loss,
      // locked-by-daily-loss-limit) are set by the risk engine itself, not
      // this endpoint, and cleared only through requestUnlock()'s cooling +
      // typed-figure ritual below — there is deliberately no bare
      // "set to unlocked" bypass for those two states.
      const desired = body?.state;
      const current = tradingLockState.getLockState();
      const intentId = panicIntentId(body, "lock");

      if (desired === tradingLockState.LOCK_STATES.LOCKED_BY_USER) {
        const record = tradingLockState.setLockState(desired, { by: userClientId || "unknown" });
        auditLog.appendAuditEvent({ intentId, type: "TRADING_LOCK_SET", payload: record });
        return { data: record, cacheHit: false };
      }

      if (desired === tradingLockState.LOCK_STATES.UNLOCKED) {
        const isLossTriggered =
          current.state === tradingLockState.LOCK_STATES.LOCKED_BY_MTM_LOSS ||
          current.state === tradingLockState.LOCK_STATES.LOCKED_BY_DAILY_LOSS_LIMIT;

        if (isLossTriggered) {
          // coolingElapsedMs and actualRealisedLoss are computed SERVER-side,
          // never taken from the request body — a scripted client could
          // otherwise send {coolingElapsedMs: 999999, actualRealisedLoss: 0}
          // and clear a loss-triggered lock instantly, defeating the whole
          // "friction is the product" cooling-off design (spec §5). Only
          // `typedFigure` (what the trader typed) is allowed to come from the
          // client — it's checked against the server's own recorded figure.
          // `current.meta.realisedLoss` must be set by whatever sets this
          // lock state (the risk engine's MTM/daily-loss monitor, not yet
          // wired); until it is, this fails closed — no meta figure means
          // requestUnlock's typed/actual comparison can never match.
          const coolingElapsedMs = Number.isFinite(current.since) ? Date.now() - current.since : 0;
          const actualRealisedLoss = current.meta?.realisedLoss;
          const check = tradingLockState.requestUnlock(current.state, body?.typedFigure, actualRealisedLoss, coolingElapsedMs);
          if (!check.ok) {
            const err = new Error(check.reason);
            err.statusCode = 422;
            err.code = "UNLOCK_REJECTED";
            throw err;
          }
        }

        const record = tradingLockState.setLockState(desired, { by: userClientId || "unknown" });
        auditLog.appendAuditEvent({ intentId, type: "TRADING_LOCK_CLEARED", payload: record });
        return { data: record, cacheHit: false };
      }

      const err = new Error(
        `panic-set-lock only accepts "${tradingLockState.LOCK_STATES.LOCKED_BY_USER}" or "${tradingLockState.LOCK_STATES.UNLOCKED}" from a client — the other states are engine-set.`,
      );
      err.statusCode = 422;
      err.code = "BAD_LOCK_STATE";
      throw err;
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
      throw new Error(`Unknown endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical, futures-quotes, rollover, place-order, orders, order-status, cancel-order, positions, holdings, funds, trades, modify-order, basket-deploy`);
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

// NSE quietly removed /api/equity-stockIndices (confirmed 404 as of this pass) —
// the closest still-working replacement is the gainers/losers "variations"
// endpoint, whose F&O-securities bucket ("FOSec") covers nearly the full F&O
// universe (any name with zero price movement on the day wouldn't appear in
// either bucket, a rare, acceptable gap). It carries no OI field at all, so
// openInterest/changeinOpenInterest are honestly reported as 0 rather than
// invented — callers already render 0/missing OI as "—".
async function fetchNSESecuritiesInFO() {
  const cookies = await getNSESession();
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.nseindia.com/market-data/live-equity-market",
    Cookie: cookies,
  };
  const [gainersRes, losersRes] = await Promise.all([
    fetch(`${NSE_BASE}/api/live-analysis-variations?index=gainers`, { headers }),
    fetch(`${NSE_BASE}/api/live-analysis-variations?index=loosers`, { headers }),
  ]);
  if (!gainersRes.ok || !losersRes.ok) {
    throw new Error(`NSE HTTP ${gainersRes.status}/${losersRes.status}`);
  }
  const [gainers, losers] = await Promise.all([gainersRes.json(), losersRes.json()]);

  const bySymbol = new Map();
  for (const bucket of [gainers?.FOSec?.data, losers?.FOSec?.data]) {
    for (const row of bucket || []) {
      if (!row?.symbol) continue;
      bySymbol.set(row.symbol, {
        symbol: row.symbol,
        lastPrice: row.ltp,
        change: row.net_price,
        pChange: row.perChange,
        open: row.open_price,
        dayHigh: row.high_price,
        dayLow: row.low_price,
        previousClose: row.prev_price,
        totalTradedVolume: row.trade_quantity,
        openInterest: 0,
        changeinOpenInterest: 0,
        meta: { industry: "" },
      });
    }
  }
  return { data: Array.from(bySymbol.values()) };
}

async function handleNSEProxy(params) {
  const endpoint = params.get("endpoint");
  const symbol = params.get("symbol");
  const cacheKey = `nse:${endpoint}:${symbol || ""}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  // Two-request merge (gainers+losers) doesn't fit the generic single-apiPath
  // retry loop below, so it's handled separately with the same cache/last-good pattern.
  if (endpoint === "equity-derivatives") {
    const lastGoodKey = `lastgood:nse:${endpoint}:`;
    try {
      const data = await fetchNSESecuritiesInFO();
      if (data.data.length > 0) setLastGood(lastGoodKey, data);
      setCache(cacheKey, data, 30000);
      return { data, cacheHit: false };
    } catch (e) {
      const lastGood = getLastGood(lastGoodKey);
      if (lastGood) {
        console.log(`  📦 Serving last-good equity-derivatives: ${e.message}`);
        return { data: lastGood.data, cacheHit: false };
      }
      console.log(`  ⚠️ equity-derivatives unavailable (no cache): ${e.message}`);
      return { data: { data: [] }, cacheHit: false };
    }
  }

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

// ── Global Market Cues — the pre-market ritual every Indian trader runs
// (US/Asian markets, crude, dollar index) before the NSE session opens.
// Reuses Yahoo's chart endpoint (already proven for candles above) purely for
// its `meta` block, which already carries regularMarketPrice/previousClose —
// no separate quote API needed.
const GLOBAL_CUES_SYMBOLS = {
  DOW: "^DJI",
  NASDAQ: "^IXIC",
  SPX500: "^GSPC",
  NIKKEI: "^N225",
  HANGSENG: "^HSI",
  CRUDE_WTI: "CL=F",
  DXY: "DX-Y.NYB",
};

async function fetchYahooQuoteMeta(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance error [${res.status}]`);
  const raw = await res.json();
  const meta = raw?.chart?.result?.[0]?.meta;
  if (!meta || !Number.isFinite(meta.regularMarketPrice)) throw new Error("Yahoo Finance returned no price");
  return {
    price: meta.regularMarketPrice,
    previousClose: Number.isFinite(meta.previousClose) ? meta.previousClose : meta.chartPreviousClose,
    marketTime: meta.regularMarketTime ?? null,
  };
}

async function handleGlobalCues() {
  const cacheKey = "yahoo:global-cues";
  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };
  const lastGoodKey = "lastgood:yahoo:global-cues";

  const entries = Object.entries(GLOBAL_CUES_SYMBOLS);
  const results = await Promise.allSettled(entries.map(([, sym]) => fetchYahooQuoteMeta(sym)));

  // Partial results are reported as-is — a name Yahoo failed to resolve is
  // simply absent from the response, never backfilled with a guess.
  const data = {};
  results.forEach((r, i) => {
    const [key] = entries[i];
    if (r.status !== "fulfilled") {
      console.log(`  ⚠️ Global cue ${key} failed: ${r.reason?.message}`);
      return;
    }
    const { price, previousClose, marketTime } = r.value;
    const hasPrevClose = Number.isFinite(previousClose) && previousClose !== 0;
    data[key] = {
      price,
      previousClose: hasPrevClose ? previousClose : null,
      change: hasPrevClose ? Math.round((price - previousClose) * 100) / 100 : null,
      changePercent: hasPrevClose ? Math.round(((price - previousClose) / previousClose) * 10000) / 100 : null,
      marketTime,
    };
  });

  if (Object.keys(data).length > 0) {
    setLastGood(lastGoodKey, data);
    setCache(cacheKey, data, 60000); // 1min — pre-market cues don't need tick-level freshness
    return { data, cacheHit: false };
  }

  const lastGood = getLastGood(lastGoodKey);
  if (lastGood) {
    console.log(`  📦 Serving last-good global cues`);
    return { data: lastGood.data, cacheHit: false };
  }
  return { data: {}, cacheHit: false };
}

// ══════════════════════════════════════════════
// ── SECTION 4: Dhan WebSocket Live Market Feed ──
// ══════════════════════════════════════════════

// Instruments to subscribe for real-time data. These are PINNED — they are never
// released by the subscription manager, so the index strip always has a feed even
// when no terminal component is mounted.
const WS_INSTRUMENTS = [
  { ExchangeSegment: "IDX_I", SecurityId: "13" },   // NIFTY 50
  { ExchangeSegment: "IDX_I", SecurityId: "25" },   // NIFTY BANK
  { ExchangeSegment: "IDX_I", SecurityId: "27" },   // NIFTY FIN SERVICE
  { ExchangeSegment: "IDX_I", SecurityId: "442" },  // MIDCAP NIFTY
  { ExchangeSegment: "IDX_I", SecurityId: "26" },   // INDIA VIX
];

// Latest tick cache, keyed "SEGMENT:securityId" — NOT by securityId alone.
// securityId is only unique within a segment, so the old key let an option
// contract overwrite an index spot price (the value a spot-referenced stop-loss
// reads). See server/lib/dhanPacketParser.mjs.
const latestTicks = new Map();

// ── Dhan WebSocket Connection Manager ──

let dhanWS = null;
let dhanWSReconnectTimer = null;
let dhanWSReconnectDelay = 1000;
let dhanWSConnected = false;
let dhanWSCredentials = { clientId: null, accessToken: null };

// Refcounted subscriptions, so the browser can watch arbitrary option strikes
// instead of only the five pinned indices. See server/lib/feedSubscriptions.mjs.
const feedSubs = createSubscriptionManager({
  isOpen: () => dhanWS?.readyState === WebSocket.OPEN,
  send: (msg) => { try { dhanWS.send(JSON.stringify(msg)); } catch { /* socket died mid-flush */ } },
  onCapacityExceeded: (count, key) => {
    console.warn(`  ⚠️  Feed subscription cap reached (${count}) — refused ${key}`);
    broadcastToClients({ type: "feedCapacity", subscribed: count, refused: key });
  },
});
feedSubs.pin(WS_INSTRUMENTS);

// In-process tick fan-out (server/lib/tickBus.mjs). riskEngine.mjs subscribes
// onto this directly so stop-loss evaluation never depends on a browser tab
// being open and unthrottled — see tickBus.mjs's header for why publish()
// runs before the browser WebSocket fan-out below, never after.

function connectDhanWebSocket(clientId, accessToken) {
  if (dhanWS && (dhanWS.readyState === WebSocket.OPEN || dhanWS.readyState === WebSocket.CONNECTING)) {
    console.log("  ℹ️  Dhan WebSocket already connected/connecting");
    return;
  }

  if (!clientId || !accessToken) {
    console.log("  ⚠️  No Dhan credentials for WebSocket — skipping");
    return;
  }

  // Tear down any stale socket (e.g. one still in CLOSING state) before
  // replacing the module-level reference. Without this, an orphaned socket
  // keeps its "open"/"message"/"close" listeners attached and can still fire
  // them against the shared dhanWS/dhanWSConnected globals later, fighting
  // with whatever connection `dhanWS` now actually points to.
  if (dhanWS) {
    dhanWS.removeAllListeners();
    try { dhanWS.terminate(); } catch { /* already closed */ }
  }

  // A fresh connect attempt (manual "configure" from the browser, or a retry)
  // supersedes any pending scheduled reconnect.
  if (dhanWSReconnectTimer) {
    clearTimeout(dhanWSReconnectTimer);
    dhanWSReconnectTimer = null;
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

    // Replay the whole desired set, not just the boot list — after a reconnect
    // the user may be watching option strikes that were subscribed at runtime.
    const replayed = feedSubs.replayAll();
    console.log(`  📡 Subscribed to ${replayed} instruments (full mode)`);

    broadcastToClients({ type: "status", connected: true, instrumentCount: replayed });
  });

  dhanWS.on("message", (data) => {
    try {
      // One frame can carry many instrument updates. Parsing only the first
      // packet (the old behaviour) silently dropped most ticks once more than a
      // handful of instruments were subscribed.
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const packets = parseDhanFrame(buf);

      for (const parsed of packets) {
        if (parsed.type === "disconnect") {
          console.warn(`  ⚠️  Dhan WebSocket disconnection packet, code: ${parsed.disconnectCode}`);
          continue;
        }

        // Composite key — securityId alone collides across segments.
        const existing = latestTicks.get(parsed.key) || {};
        const merged = { ...existing, ...parsed, timestamp: Date.now() };

        if (merged.prevClose && merged.ltp) {
          merged.change = merged.ltp - merged.prevClose;
          merged.changePercent = (merged.change / merged.prevClose) * 100;
        }

        latestTicks.set(parsed.key, merged);

        // In-process consumers (riskEngine, via tickBus) run BEFORE the
        // browser fan-out below, so an exit is never delayed by however many
        // browser clients are attached (1CLIQ-TRADE-SPEC.md §3 diagram).
        tickBus.publish(merged);

        broadcastToClients(merged);
      }
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

  // Every instrument this specific client holds a reference on, so a refresh or
  // a closed tab releases exactly what it took and nothing else.
  const held = new Map(); // "SEGMENT:id" -> {ExchangeSegment, SecurityId}

  ws.send(JSON.stringify({
    type: "status",
    connected: dhanWSConnected,
    instrumentCount: feedSubs.stats().subscribed,
  }));

  // Send all latest cached ticks immediately so browser has data instantly
  for (const [, tickData] of latestTicks) {
    ws.send(JSON.stringify(tickData));
  }

  ws.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());

      if (parsed.type === "configure") {
        const { clientId, accessToken } = parsed;
        if (clientId && accessToken) {
          console.log("  🔑 Received Dhan credentials from browser, connecting WebSocket...");
          connectDhanWebSocket(clientId, accessToken);
        }
      }

      // Dynamic subscription — this is what lets the terminal watch arbitrary
      // option strikes instead of polling them every few seconds.
      if (parsed.type === "subscribe" && Array.isArray(parsed.instruments)) {
        for (const inst of parsed.instruments) {
          const segment = inst.ExchangeSegment || inst.exchangeSegment;
          const secId = inst.SecurityId ?? inst.securityId;
          if (!segment || secId == null) continue;
          const key = tickKey(segment, secId);
          if (held.has(key)) continue; // this client already holds it
          if (feedSubs.acquire(segment, secId)) {
            held.set(key, { ExchangeSegment: segment, SecurityId: String(secId) });
            // Deliver whatever we already have so the UI is not blank until the
            // next tick — a far-OTM strike may not print for minutes.
            const cached = latestTicks.get(key);
            if (cached) ws.send(JSON.stringify(cached));
          }
        }
      }

      if (parsed.type === "unsubscribe" && Array.isArray(parsed.instruments)) {
        for (const inst of parsed.instruments) {
          const segment = inst.ExchangeSegment || inst.exchangeSegment;
          const secId = inst.SecurityId ?? inst.securityId;
          if (!segment || secId == null) continue;
          const key = tickKey(segment, secId);
          if (!held.delete(key)) continue;
          feedSubs.release(segment, secId);
        }
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on("close", () => {
    // Release this client's references so a closed tab does not leak
    // subscriptions against the feed's instrument budget.
    for (const inst of held.values()) feedSubs.release(inst.ExchangeSegment, inst.SecurityId);
    held.clear();
    console.log("  🔌 Browser WebSocket client disconnected");
  });
});

// ══════════════════════════════════════════════
// ── SECTION 4b: Generic Multi-Broker Proxy ──
// ══════════════════════════════════════════════
// Dispatches option-chain/expiry-list/ltp requests to whichever broker module
// the user has connected (see server/brokers/registry.mjs for the contract).
// /api/dhan-proxy above stays untouched as the original, richer Dhan-specific
// path; this generic path is what other brokers (and Dhan, via broker=dhan)
// use so newly-added brokers get the same cache/last-good-fallback treatment.

const brokerRegistry = createBrokerRegistry();

async function handleBrokerProxy(brokerId, params, creds) {
  const mod = brokerRegistry.get(brokerId);
  const endpoint = params.get("endpoint");
  // futures-quotes takes a batch of symbols, not one — keep its cache key distinct.
  const symbolsParam = params.get("symbols");
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry");
  const credsMarker = creds ? Object.values(creds).join("|").slice(0, 16) : "shared";
  const keySuffix = endpoint === "futures-quotes"
    ? (symbolsParam || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).sort().join(",")
    : `${symbol}:${expiry || ""}`;
  const cacheKey = `broker:${brokerId}:${credsMarker}:${endpoint}:${keySuffix}`;
  const lastGoodKey = `lastgood:broker:${brokerId}:${endpoint}:${keySuffix}`;

  const cached = getCached(cacheKey);
  if (cached) return { data: cached, cacheHit: true };

  try {
    let result;
    switch (endpoint) {
      case "expiry-list":
        result = await mod.fetchExpiryList(creds, symbol);
        break;
      case "option-chain": {
        let expiryDate = expiry;
        if (!expiryDate) {
          try {
            const expiryList = await mod.fetchExpiryList(creds, symbol);
            if (expiryList?.data?.length > 0) expiryDate = expiryList.data[0];
          } catch { /* proceed without a specific expiry — some brokers default to nearest */ }
        }
        result = await mod.fetchOptionChain(creds, symbol, expiryDate);
        break;
      }
      case "ltp":
        result = await mod.fetchLTP(creds, symbol);
        break;
      case "futures-quotes": {
        if (typeof mod.fetchFuturesQuotes !== "function") {
          throw new Error(`${brokerId} does not support futures quotes yet`);
        }
        const symbols = (symbolsParam || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        result = await mod.fetchFuturesQuotes(creds, symbols);
        break;
      }
      default:
        throw new Error(`Unknown endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, futures-quotes`);
    }

    const hasData = endpoint === "option-chain"
      ? !!(result?.data?.oc && Object.keys(result.data.oc).length > 0)
      : endpoint === "futures-quotes"
        ? Array.isArray(result?.data) && result.data.length > 0
        : true;

    if (hasData) {
      setLastGood(lastGoodKey, result);
      setCache(cacheKey, result, endpoint === "expiry-list" ? 300000 : 5000);
      return { data: result, cacheHit: false };
    }

    const lastGood = getLastGood(lastGoodKey);
    if (lastGood) {
      const afterHoursResult = { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
      setCache(cacheKey, afterHoursResult, 30000);
      return { data: afterHoursResult, cacheHit: false };
    }

    setCache(cacheKey, result, 30000);
    return { data: result, cacheHit: false };
  } catch (e) {
    const lastGood = getLastGood(lastGoodKey);
    if (lastGood) {
      console.log(`  📦 ${brokerId} error, serving last-good ${endpoint} for ${symbol}: ${e.message}`);
      const afterHoursResult = { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
      return { data: afterHoursResult, cacheHit: false };
    }
    console.log(`  ⚠️ ${brokerId} ${endpoint} unavailable for ${symbol} (no cache): ${e.message}`);
    const emptyResult = endpoint === "option-chain"
      ? { status: "error", data: { oc: {} }, message: e.message }
      : { status: "error", data: [], message: e.message };
    setCache(cacheKey, emptyResult, 60000);
    return { data: emptyResult, cacheHit: false };
  }
}

/** Decode the base64-JSON x-broker-credentials header into the raw `values` object, or null. */
function decodeBrokerCreds(req) {
  const header = req.headers["x-broker-credentials"];
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════
// ── SECTION 5: HTTP Server ──
// ══════════════════════════════════════════════

// Reflect the Origin only when it matches localhost/LAN (dev + Vite's `host:
// 0.0.0.0` LAN testing) or the production domain. A bare "*" here would let
// ANY webpage open in the user's browser call this proxy — which holds live
// broker sessions/credentials and forwards them to Dhan — from any tab, a
// classic "localhost drive-by" attack against locally-running dev servers.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https?:\/\/\[::1\](:\d+)?$/i,
  /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/i,
  /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/i,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/i,
  /^https:\/\/([a-z0-9-]+\.)*mrchartist\.com$/i,
];

function corsHeadersFor(req) {
  const origin = req.headers.origin;
  const allowed = !!origin && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-dhan-client-id, x-dhan-access-token, x-broker-credentials",
    Vary: "Origin",
  };
  // Non-browser clients (curl, health checks, server-to-server) send no Origin
  // header at all — CORS doesn't apply to them either way, so "*" is harmless.
  if (!origin || allowed) headers["Access-Control-Allow-Origin"] = origin || "*";
  return headers;
}

const server = http.createServer(async (req, res) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = url.searchParams;

  res.setHeader("Content-Type", "application/json");
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  try {
    if (url.pathname === "/api/dhan-proxy") {
      const userClientId = req.headers["x-dhan-client-id"];
      const userAccessToken = req.headers["x-dhan-access-token"];
      const body = (req.method === "POST" || req.method === "DELETE") ? await readJsonBody(req) : null;
      const { data, cacheHit } = await handleDhanProxy(params, userClientId, userAccessToken, body);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/nse-proxy") {
      const { data, cacheHit } = await handleNSEProxy(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/yahoo-chart") {
      const { data, cacheHit } = await handleYahooChart(params);
      res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
      res.writeHead(200);
      res.end(JSON.stringify(data));
    } else if (url.pathname === "/api/global-cues") {
      const { data, cacheHit } = await handleGlobalCues();
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
    } else if (url.pathname === "/api/broker-proxy") {
      const brokerId = params.get("broker") || "dhan";
      if (!brokerRegistry.has(brokerId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: `Unknown broker: ${brokerId}. Supported: ${brokerRegistry.list().join(", ")}` }));
      } else {
        const creds = decodeBrokerCreds(req);
        const { data, cacheHit } = await handleBrokerProxy(brokerId, params, creds);
        res.setHeader("X-Cache", cacheHit ? "HIT" : "MISS");
        res.writeHead(200);
        res.end(JSON.stringify(data));
      }
    } else if (url.pathname === "/api/broker-test-connection") {
      const brokerId = params.get("broker") || "dhan";
      if (!brokerRegistry.has(brokerId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: `Unknown broker: ${brokerId}. Supported: ${brokerRegistry.list().join(", ")}` }));
      } else {
        const creds = decodeBrokerCreds(req);
        const mod = brokerRegistry.get(brokerId);
        const result = await mod.testConnection(creds || {});
        res.writeHead(200);
        res.end(JSON.stringify(result));
      }
    } else if (url.pathname === "/api/delta-strike-snapshot" && req.method === "POST") {
      const body = await readJsonBody(req);
      const symbol = body?.symbol;
      const expiry = body?.expiry;
      const entries = body?.entries;
      if (typeof symbol !== "string" || !symbol || typeof expiry !== "string" || !expiry || !Array.isArray(entries) || entries.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "symbol, expiry (non-empty strings), and entries (non-empty array) are required" }));
      } else {
        let recorded = 0;
        for (const entry of entries) {
          if (!entry || typeof entry.label !== "string" || !entry.label || !Number.isFinite(entry.premium)) continue;
          recordSnapshot("deltaStrikePremium", symbol + "_" + expiry + "_" + entry.label, entry.premium);
          recorded++;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok", recorded }));
      }
    } else if (url.pathname === "/api/delta-strike-snapshot") {
      if (req.method !== "GET") {
        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed. Use GET or POST." }));
      } else {
        const symbol = params.get("symbol");
        const expiry = params.get("expiry");
        const label = params.get("label");
        if (!symbol || !expiry || !label) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "symbol, expiry, and label query params are required" }));
        } else {
          const series = getSeries("deltaStrikePremium", symbol + "_" + expiry + "_" + label);
          res.writeHead(200);
          res.end(JSON.stringify({ series }));
        }
      }
    } else if (url.pathname === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        marketSession: marketSession(),
        websocket: {
          dhanConnected: dhanWSConnected,
          browserClients: localWSS.clients.size,
          ...feedSubs.stats(),
          cachedTicks: latestTicks.size,
        },
        sources: {
          dhan: !!process.env.DHAN_CLIENT_ID,
          nse: true,
          yahoo: true,
        },
        brokers: brokerRegistry.list(),
      }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found. Use /api/dhan-proxy, /api/broker-proxy, /api/nse-proxy, /api/yahoo-chart, or /ws" }));
    }
  } catch (err) {
    console.error(`[Proxy Error] ${url.pathname}:`, err.message);
    // A guard rejection is a 422 with a machine-readable code, not a 500 — the
    // client needs to tell "we refused this" apart from "the upstream broke".
    const status = Number.isInteger(err.statusCode) ? err.statusCode : 500;
    res.writeHead(status);
    res.end(JSON.stringify({ error: err.message, message: err.message, code: err.code || null }));
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
  console.log(`  └─ NSE  (2°):  http://localhost:${PORT}/api/nse-proxy?endpoint=indices`);
  console.log("");
  console.log("  Data Priority: Dhan → NSE → Yahoo (15-min delayed)");
  console.log("  Dhan credentials:", process.env.DHAN_CLIENT_ID ? "✅ Loaded from .env" : "⚠️  Not set (configure in .env or Broker Settings)");
  console.log("");

  // Auto-connect Dhan WebSocket if credentials are in .env
  if (process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN) {
    connectDhanWebSocket(process.env.DHAN_CLIENT_ID, process.env.DHAN_ACCESS_TOKEN);
  }

  // Start the risk engine's dead-man's switch + tickBus subscription
  // unconditionally — /api/risk/status must be able to report "not alive"
  // truthfully, which requires the heartbeat to actually be running.
  riskEngine.startRiskEngine();
});
