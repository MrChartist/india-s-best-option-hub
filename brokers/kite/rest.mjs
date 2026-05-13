/**
 * Zerodha Kite Connect v3 — REST adapter.
 *
 * Notable differences from Dhan handled here:
 *   - No native option-chain endpoint → composed from instruments dump + /quote
 *   - No native Greeks/IV → computed via BSM (brokers/shared/greeks.mjs)
 *   - Access token expires daily → upstream errors surface 403/TokenException
 */
import { fetchInstrumentsDump, filterOptionLegs, listExpiries, resolveIndex } from "./instruments.mjs";
import { computeLegMetrics } from "../shared/greeks.mjs";

const KITE_BASE = "https://api.kite.trade";
const RISK_FREE_RATE = parseFloat(process.env.KITE_RISK_FREE_RATE || "0.065");

function resolveCredentials(credentials) {
  const apiKey = credentials?.apiKey || process.env.KITE_API_KEY;
  const accessToken = credentials?.accessToken || process.env.KITE_ACCESS_TOKEN;
  if (!apiKey || !accessToken) {
    throw new Error("KITE_API_KEY or KITE_ACCESS_TOKEN not configured. Add them to .env or pass via Broker Settings.");
  }
  return { apiKey, accessToken };
}

async function kiteFetch(path, credentials, init = {}) {
  const { apiKey, accessToken } = resolveCredentials(credentials);
  const res = await fetch(`${KITE_BASE}${path}`, {
    ...init,
    headers: {
      "X-Kite-Version": "3",
      "Authorization": `token ${apiKey}:${accessToken}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Kite API error [${res.status}]: ${errText}`);
  }
  return res.json();
}

// ── Option Chain (composed from /quote across all option legs for an expiry) ──

function emptyLeg() {
  return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
}

async function fetchSpot(symbol, credentials) {
  const idx = resolveIndex(symbol);
  if (!idx) return 0;
  // Kite indices live under NSE: prefix with full tradingsymbol
  const key = `${idx.exchange}:${idx.tradingSymbol}`;
  try {
    const res = await kiteFetch(`/quote/ltp?i=${encodeURIComponent(key)}`, credentials);
    const v = res?.data?.[key];
    return v?.last_price || 0;
  } catch {
    return 0;
  }
}

async function batchQuote(legs, credentials) {
  // Kite /quote allows up to 500 instruments per call. Build "NFO:NIFTY25NOV24500CE" style keys.
  const out = {};
  if (legs.length === 0) return out;

  const BATCH = 400; // leave headroom
  for (let i = 0; i < legs.length; i += BATCH) {
    const slice = legs.slice(i, i + BATCH);
    const params = slice.map((l) => `i=${encodeURIComponent(`${l._kiteExchange}:${l.tradingSymbol}`)}`).join("&");
    const res = await kiteFetch(`/quote?${params}`, credentials);
    Object.assign(out, res?.data || {});
  }
  return out;
}

async function handleOptionChain(params, credentials, ctx) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiryParam = params.get("expiry");

  const cacheKey = `kite:oc:${credentials?.apiKey || "env"}:${symbol}:${expiryParam || ""}`;
  const lastGoodKey = `lastgood:kite:oc:${symbol}:${expiryParam || "nearest"}`;
  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return cached;

  try {
    const dump = await fetchInstrumentsDump(credentials?.apiKey || process.env.KITE_API_KEY, credentials?.accessToken || process.env.KITE_ACCESS_TOKEN);

    // Resolve expiry
    const allExpiries = listExpiries(dump, symbol);
    if (allExpiries.length === 0) throw new Error(`No option contracts found for ${symbol}`);
    const expiry = expiryParam && allExpiries.includes(expiryParam) ? expiryParam : allExpiries[0];

    const legs = filterOptionLegs(dump, symbol, expiry);
    if (legs.length === 0) throw new Error(`No legs for ${symbol} expiry ${expiry}`);

    // Fetch spot + all leg quotes in parallel
    const [spotPrice, quotes] = await Promise.all([
      fetchSpot(symbol, credentials),
      batchQuote(legs, credentials),
    ]);

    // Group by strike
    const byStrike = new Map();
    for (const leg of legs) {
      const key = `${leg._kiteExchange}:${leg.tradingSymbol}`;
      const q = quotes[key];
      if (!q) continue;
      const ltp = q.last_price || 0;
      const oi = q.oi || 0;
      const prevDayOI = q.oi_day_high && q.oi_day_low ? (q.oi_day_high + q.oi_day_low) / 2 : oi;
      const bidPrice = q.depth?.buy?.[0]?.price || 0;
      const askPrice = q.depth?.sell?.[0]?.price || 0;
      const mid = bidPrice && askPrice ? (bidPrice + askPrice) / 2 : ltp;

      // Compute IV + Greeks via BSM
      const metrics = spotPrice > 0
        ? computeLegMetrics(leg.optionType, mid, spotPrice, leg.strikePrice, leg.expiryDate, RISK_FREE_RATE)
        : { iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };

      const legData = {
        ltp,
        oi,
        oiChange: oi - prevDayOI,
        volume: q.volume || 0,
        iv: metrics.iv,
        delta: metrics.delta,
        gamma: metrics.gamma,
        theta: metrics.theta,
        vega: metrics.vega,
        bidPrice,
        askPrice,
      };

      if (!byStrike.has(leg.strikePrice)) {
        byStrike.set(leg.strikePrice, { strikePrice: leg.strikePrice, ce: emptyLeg(), pe: emptyLeg() });
      }
      const slot = byStrike.get(leg.strikePrice);
      if (leg.optionType === "CE") slot.ce = legData;
      else if (leg.optionType === "PE") slot.pe = legData;
    }

    const chain = Array.from(byStrike.values()).sort((a, b) => a.strikePrice - b.strikePrice);
    let totalCEOI = 0, totalPEOI = 0;
    for (const row of chain) { totalCEOI += row.ce.oi; totalPEOI += row.pe.oi; }

    const normalized = {
      source: "kite",
      symbol,
      expiry,
      spotPrice,
      chain,
      totalCEOI,
      totalPEOI,
      afterHours: false,
      cachedAt: null,
    };

    if (chain.length > 0) {
      ctx.cache.setLastGood(lastGoodKey, normalized);
      ctx.cache.setCache(cacheKey, normalized, 5000);
    }
    return normalized;
  } catch (e) {
    const lastGood = ctx.cache.getLastGood(lastGoodKey);
    if (lastGood) {
      console.log(`  📦 Kite error, serving last-good OC for ${symbol}: ${e.message}`);
      return { ...lastGood.data, afterHours: true, cachedAt: lastGood.timestamp };
    }
    throw e;
  }
}

async function handleExpiryList(params, credentials, _ctx) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const dump = await fetchInstrumentsDump(credentials?.apiKey || process.env.KITE_API_KEY, credentials?.accessToken || process.env.KITE_ACCESS_TOKEN);
  const expiries = listExpiries(dump, symbol);
  return expiries.map((dateStr) => {
    const d = new Date(dateStr);
    const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return {
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      value: dateStr,
      daysToExpiry: days,
    };
  });
}

async function handleLTP(params, credentials, ctx) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const idx = resolveIndex(symbol);
  if (!idx) throw new Error(`Unknown index for Kite: ${symbol}`);

  const cacheKey = `kite:ltp:${symbol}`;
  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return cached;

  const key = `${idx.exchange}:${idx.tradingSymbol}`;
  const res = await kiteFetch(`/quote/ltp?i=${encodeURIComponent(key)}`, credentials);
  const ltp = res?.data?.[key]?.last_price || 0;

  // Match the Dhan-shaped response so legacy frontend code is happy
  const result = { NSE_FNO: { [idx.instrumentToken]: ltp } };
  ctx.cache.setCache(cacheKey, result, 2000);
  return result;
}

async function handleInstruments(_params, credentials, ctx) {
  const cacheKey = "kite:instruments-master";
  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return cached;

  const dump = await fetchInstrumentsDump(credentials?.apiKey || process.env.KITE_API_KEY, credentials?.accessToken || process.env.KITE_ACCESS_TOKEN);
  // Strip Kite-specific helpers before exposing to frontend
  const cleaned = {
    instruments: dump.instruments.map(({ _kiteExchange: _kx, ...rest }) => rest),
    count: dump.count,
  };
  ctx.cache.setCache(cacheKey, cleaned, 3600000);
  return cleaned;
}

async function handleHistorical(params, credentials, ctx) {
  const secId = params.get("securityId");
  const interval = params.get("interval") || "5";
  const fromDate = params.get("fromDate");
  const toDate = params.get("toDate");
  const exchSeg = params.get("exchangeSegment") || "IDX_I";

  if (!secId) throw new Error("Missing securityId parameter");

  // Map our interval shorthand → Kite interval
  const KITE_INTERVAL = {
    "1": "minute", "3": "3minute", "5": "5minute", "10": "10minute",
    "15": "15minute", "30": "30minute", "60": "60minute", "D": "day",
  };
  const kiteInterval = KITE_INTERVAL[interval];
  if (!kiteInterval) throw new Error(`Kite does not support interval: ${interval}`);

  const isDaily = interval === "D";
  const now = new Date();
  const defaultDaysBack = isDaily ? 365 : 3;
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - defaultDaysBack);

  const fmt = (d) => {
    if (typeof d === "string") return d.split(" ")[0];
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const from = fromDate ? fmt(fromDate) : fmt(defaultFrom);
  const to = toDate ? fmt(toDate) : fmt(now);

  const cacheKey = `kite:hist:${secId}:${interval}:${from}:${to}`;
  const cachedHist = ctx.cache.getCached(cacheKey);
  if (cachedHist) return cachedHist;

  const oiFlag = exchSeg === "NSE_FNO" ? "1" : "0";
  const url = `/instruments/historical/${secId}/${kiteInterval}?from=${from}&to=${to}&oi=${oiFlag}`;
  console.log(`  📊 [Kite] Fetching ${kiteInterval} candles: ${secId} (${from} → ${to})`);

  const raw = await kiteFetch(url, credentials);
  const candles = raw?.data?.candles || [];

  // Kite candle format: [timestamp, open, high, low, close, volume, oi?]
  const result = {
    status: "success",
    data: {
      timestamp: candles.map((c) => Math.floor(new Date(c[0]).getTime() / 1000)),
      open: candles.map((c) => c[1]),
      high: candles.map((c) => c[2]),
      low: candles.map((c) => c[3]),
      close: candles.map((c) => c[4]),
      volume: candles.map((c) => c[5]),
      oi: oiFlag === "1" ? candles.map((c) => c[6] || 0) : undefined,
    },
  };

  ctx.cache.setCache(cacheKey, result, isDaily ? 300000 : 60000);
  return result;
}

async function handleTestConnection(_params, credentials) {
  try {
    const profile = await kiteFetch("/user/profile", credentials);
    return { status: "success", message: `Kite connected as ${profile?.data?.user_name || "unknown"}`, data: profile };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

export async function handleRequest(endpoint, params, credentials, ctx) {
  switch (endpoint) {
    case "option-chain": return handleOptionChain(params, credentials, ctx);
    case "expiry-list": return handleExpiryList(params, credentials, ctx);
    case "ltp": return handleLTP(params, credentials, ctx);
    case "instruments": return handleInstruments(params, credentials, ctx);
    case "historical": return handleHistorical(params, credentials, ctx);
    case "test-connection": return handleTestConnection(params, credentials);
    default:
      throw new Error(`Unknown Kite endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical, test-connection`);
  }
}
