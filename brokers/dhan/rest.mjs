/**
 * Dhan REST adapter — wraps Dhan API v2 endpoints and normalizes responses
 * into the UnifiedChainResponse / UnifiedExpiry / UnifiedCandleSeries shapes.
 */

const DHAN_BASE = "https://api.dhan.co/v2";

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

function resolveCredentials(credentials) {
  const clientId = credentials?.clientId || process.env.DHAN_CLIENT_ID;
  const accessToken = credentials?.accessToken || process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !accessToken) {
    throw new Error("DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via Broker Settings.");
  }
  return { clientId, accessToken };
}

async function dhanFetch(path, body, method = "POST", credentials) {
  const { clientId, accessToken } = resolveCredentials(credentials);
  const res = await fetch(`${DHAN_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
    body: body && method === "POST" ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dhan API error [${res.status}]: ${errText}`);
  }
  return res.json();
}

// ── Normalizers (Dhan native → unified) ──

function normalizeOptionLeg(leg) {
  if (!leg) return emptyLeg();
  const greeks = leg.greeks || {};
  const oi = leg.oi || 0;
  return {
    ltp: leg.last_price ?? leg.ltp ?? 0,
    oi,
    oiChange: leg.oi_chg ?? (oi - (leg.previous_oi ?? oi)),
    volume: leg.volume ?? 0,
    iv: leg.implied_volatility ?? leg.iv ?? 0,
    delta: greeks.delta ?? leg.delta ?? 0,
    gamma: greeks.gamma ?? leg.gamma ?? 0,
    theta: greeks.theta ?? leg.theta ?? 0,
    vega: greeks.vega ?? leg.vega ?? 0,
    bidPrice: leg.top_bid_price ?? leg.best_bid_price ?? leg.bid_price ?? 0,
    askPrice: leg.top_ask_price ?? leg.best_ask_price ?? leg.ask_price ?? 0,
  };
}

function emptyLeg() {
  return { ltp: 0, oi: 0, oiChange: 0, volume: 0, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: 0, askPrice: 0 };
}

function normalizeChain(raw, symbol, resolvedExpiry, afterHours = false, cachedAt = null) {
  const oc = raw?.data?.oc || {};
  const spotPrice = raw?.data?.last_price || 0;
  let totalCEOI = 0;
  let totalPEOI = 0;

  const chain = Object.keys(oc)
    .map((strikeStr) => {
      const legs = oc[strikeStr];
      const ce = normalizeOptionLeg(legs.ce);
      const pe = normalizeOptionLeg(legs.pe);
      totalCEOI += ce.oi;
      totalPEOI += pe.oi;
      return { strikePrice: parseFloat(strikeStr), ce, pe };
    })
    .sort((a, b) => a.strikePrice - b.strikePrice);

  return {
    source: "dhan",
    symbol,
    expiry: resolvedExpiry || null,
    spotPrice,
    chain,
    totalCEOI,
    totalPEOI,
    afterHours,
    cachedAt,
  };
}

function normalizeExpiryList(raw) {
  if (!raw?.data?.length) return [];
  return raw.data.map((dateStr) => {
    const d = new Date(dateStr);
    const days = Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    return {
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      value: dateStr,
      daysToExpiry: days,
    };
  });
}

// ── Endpoint handlers ──

async function handleOptionChain(params, credentials, ctx) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const expiry = params.get("expiry");
  const underlying = UNDERLYING_MAP[symbol];
  if (!underlying) throw new Error(`Unknown symbol: ${symbol}. Supported: ${Object.keys(UNDERLYING_MAP).join(", ")}`);

  const cacheKey = `dhan:oc:${credentials?.clientId || "env"}:${symbol}:${expiry || ""}`;
  const lastGoodKey = `lastgood:dhan:oc:${symbol}:${expiry || "nearest"}`;

  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return cached;

  try {
    let expiryDate = expiry;
    if (!expiryDate) {
      try {
        const expiryListKey = `dhan:expiry-list:${symbol}:`;
        let expiryList = ctx.cache.getCached(expiryListKey);
        if (!expiryList) {
          expiryList = await dhanFetch("/optionchain/expirylist", {
            UnderlyingScrip: underlying.underlyingScrip,
            UnderlyingSeg: underlying.expirySegment,
          }, "POST", credentials);
          ctx.cache.setCache(expiryListKey, expiryList, 300000);
        }
        if (expiryList?.data?.length > 0) expiryDate = expiryList.data[0];
      } catch (expiryErr) {
        console.log(`  ⚠️ Expiry list fetch failed for ${symbol}: ${expiryErr.message}`);
      }
    }

    const body = { UnderlyingScrip: underlying.underlyingScrip, UnderlyingSeg: underlying.ocSegment };
    if (expiryDate) body.Expiry = expiryDate;

    let result;
    try {
      result = await dhanFetch("/optionchain", body, "POST", credentials);
    } catch (ocErr) {
      if (ocErr.message.includes("Invalid Expiry") && expiryDate) {
        console.log(`  🔄 Retrying OC for ${symbol} without expiry date...`);
        result = await dhanFetch("/optionchain", { UnderlyingScrip: underlying.underlyingScrip, UnderlyingSeg: underlying.ocSegment }, "POST", credentials);
      } else {
        throw ocErr;
      }
    }

    const hasData = result?.data?.oc && Object.keys(result.data.oc).length > 0;
    if (hasData) {
      ctx.cache.setLastGood(lastGoodKey, result);
      const normalized = normalizeChain(result, symbol, expiryDate);
      ctx.cache.setCache(cacheKey, normalized, 5000);
      return normalized;
    }

    // Empty — try last-good
    const lastGood = ctx.cache.getLastGood(lastGoodKey);
    if (lastGood) {
      console.log(`  📦 Serving last-good OC for ${symbol} (cached ${Math.round((Date.now() - lastGood.timestamp) / 60000)}min ago)`);
      const normalized = normalizeChain(lastGood.data, symbol, expiryDate, true, lastGood.timestamp);
      ctx.cache.setCache(cacheKey, normalized, 30000);
      return normalized;
    }

    const empty = normalizeChain({ data: { oc: {} } }, symbol, expiryDate, true);
    ctx.cache.setCache(cacheKey, empty, 30000);
    return empty;
  } catch (e) {
    const lastGood = ctx.cache.getLastGood(lastGoodKey);
    if (lastGood) {
      console.log(`  📦 Dhan error, serving last-good OC for ${symbol}: ${e.message}`);
      return normalizeChain(lastGood.data, symbol, null, true, lastGood.timestamp);
    }
    const is429 = e.message.includes("429") || e.message.includes("Too many");
    const cacheTTL = is429 ? 120000 : 60000;
    console.log(`  ⚠️ OC unavailable for ${symbol} (no cache): ${e.message}${is429 ? " [rate-limited, backing off 2min]" : ""}`);
    const empty = normalizeChain({ data: { oc: {} } }, symbol, null, true);
    ctx.cache.setCache(cacheKey, empty, cacheTTL);
    return empty;
  }
}

async function handleExpiryList(params, credentials, ctx) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const underlying = UNDERLYING_MAP[symbol];
  if (!underlying) throw new Error(`Unknown symbol: ${symbol}`);

  const cacheKey = `dhan:expiry-list:${symbol}:`;
  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return normalizeExpiryList(cached);

  const lastGoodKey = `lastgood:dhan:expiry:${symbol}`;
  try {
    const result = await dhanFetch("/optionchain/expirylist", {
      UnderlyingScrip: underlying.underlyingScrip,
      UnderlyingSeg: underlying.expirySegment,
    }, "POST", credentials);
    if (result?.data?.length > 0) ctx.cache.setLastGood(lastGoodKey, result);
    ctx.cache.setCache(cacheKey, result, 300000);
    return normalizeExpiryList(result);
  } catch (e) {
    const lastGood = ctx.cache.getLastGood(lastGoodKey);
    if (lastGood) {
      console.log(`  📦 Serving last-good expiry list for ${symbol}: ${e.message}`);
      return normalizeExpiryList(lastGood.data);
    }
    throw e;
  }
}

async function handleLTP(params, credentials, ctx) {
  const symbol = (params.get("symbol") || "NIFTY").toUpperCase();
  const secInfo = INDEX_SECURITY_IDS[symbol];
  if (!secInfo) throw new Error(`Unknown index: ${symbol}`);

  const cacheKey = `dhan:ltp:${symbol}`;
  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return cached;

  const result = await dhanFetch("/marketfeed/ltp", { NSE_FNO: [secInfo.secId] }, "POST", credentials);
  // Pass-through: legacy callers consume this raw shape
  ctx.cache.setCache(cacheKey, result, 2000);
  return result;
}

async function handleInstruments(_params, _credentials, ctx) {
  const cacheKey = "dhan:instruments-master";
  const cached = ctx.cache.getCached(cacheKey);
  if (cached) return cached;

  console.log("  📥 Downloading Dhan instrument master CSV...");
  const csvRes = await fetch("https://images.dhan.co/api-data/api-scrip-master.csv");
  if (!csvRes.ok) throw new Error(`Failed to download instrument master: ${csvRes.status}`);
  const csvText = await csvRes.text();

  const SEGMENT_MAP = {
    "NSE:E": "NSE_EQ", "NSE:D": "NSE_FNO", "NSE:I": "IDX_I", "NSE:C": "NSE_CUR", "NSE:M": "NSE_MF",
    "BSE:E": "BSE_EQ", "BSE:D": "BSE_FNO", "BSE:I": "BSE_IDX", "BSE:C": "BSE_CUR", "MCX:M": "MCX_COMM",
  };
  const ALLOWED_SEGMENTS = new Set(["NSE_EQ", "NSE_FNO", "IDX_I"]);

  const lines = csvText.split("\n");
  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (k) => header.indexOf(k);

  const instruments = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 8) continue;

    const exchId = cols[idx("SEM_EXM_EXCH_ID")]?.trim();
    const segCode = cols[idx("SEM_SEGMENT")]?.trim();
    const exchangeSegment = SEGMENT_MAP[`${exchId}:${segCode}`];
    if (!exchangeSegment || !ALLOWED_SEGMENTS.has(exchangeSegment)) continue;

    const tradingSymbol = cols[idx("SEM_TRADING_SYMBOL")]?.trim();
    const customSymbol = cols[idx("SEM_CUSTOM_SYMBOL")]?.trim();
    const baseSymbol = customSymbol?.split(" ")[0] || tradingSymbol?.split("-")[0] || tradingSymbol;
    const expiryDate = cols[idx("SEM_EXPIRY_DATE")]?.trim();
    const strikePrice = parseFloat(cols[idx("SEM_STRIKE_PRICE")]?.trim()) || 0;
    const optionType = cols[idx("SEM_OPTION_TYPE")]?.trim();
    const lotSize = parseInt(parseFloat(cols[idx("SEM_LOT_UNITS")]?.trim()) || 1);

    instruments.push({
      securityId: cols[idx("SEM_SMST_SECURITY_ID")]?.trim(),
      symbol: baseSymbol,
      tradingSymbol,
      exchangeSegment,
      instrumentType: cols[idx("SEM_INSTRUMENT_NAME")]?.trim(),
      lotSize,
      expiryDate: expiryDate && expiryDate !== "0001-01-01" ? expiryDate : undefined,
      strikePrice: strikePrice || undefined,
      optionType: optionType && optionType !== "XX" ? optionType : undefined,
    });
  }

  const result = { instruments, count: instruments.length };
  console.log(`  ✅ Parsed ${instruments.length} Dhan instruments from CSV`);
  ctx.cache.setCache(cacheKey, result, 3600000);
  return result;
}

async function handleHistorical(params, credentials, ctx) {
  const secId = params.get("securityId");
  const exchSeg = params.get("exchangeSegment") || "IDX_I";
  const instrument = params.get("instrument") || "INDEX";
  const interval = params.get("interval") || "5";
  const fromDate = params.get("fromDate");
  const toDate = params.get("toDate");

  if (!secId) throw new Error("Missing securityId parameter");

  const isDailyCandle = interval === "D";
  const now = new Date();
  const defaultDaysBack = isDailyCandle ? 365 : 3;
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - defaultDaysBack);

  let from = fromDate || `${defaultFrom.toISOString().split("T")[0]} 09:15`;
  const to = toDate || `${now.toISOString().split("T")[0]} 15:30`;

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

  const cacheKey = `dhan:hist:${secId}:${interval}:${from}:${to}`;
  const cachedHist = ctx.cache.getCached(cacheKey);
  if (cachedHist) return cachedHist;

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
  if (!isDailyCandle) body.interval = interval;

  console.log(`  📊 [Dhan] Fetching ${isDailyCandle ? "daily" : "intraday"} chart: ${secId} (${from} → ${to}), interval=${interval}`);
  const result = await dhanFetch(apiPath, body, "POST", credentials);
  ctx.cache.setCache(cacheKey, result, isDailyCandle ? 300000 : 60000);
  return result;
}

async function handleTestConnection(_params, credentials) {
  try {
    const result = await dhanFetch("/optionchain/expirylist", {
      UnderlyingScrip: 13, UnderlyingSeg: "NSE_FNO",
    }, "POST", credentials);
    return { status: "success", message: "Dhan API connected", data: result };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

// ── Public dispatcher ──

export async function handleRequest(endpoint, params, credentials, ctx) {
  switch (endpoint) {
    case "option-chain": return handleOptionChain(params, credentials, ctx);
    case "expiry-list": return handleExpiryList(params, credentials, ctx);
    case "ltp": return handleLTP(params, credentials, ctx);
    case "instruments": return handleInstruments(params, credentials, ctx);
    case "historical": return handleHistorical(params, credentials, ctx);
    case "test-connection": return handleTestConnection(params, credentials);
    default:
      throw new Error(`Unknown Dhan endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp, instruments, historical, test-connection`);
  }
}

export const INDEX_SECURITY_ID_MAP = INDEX_SECURITY_IDS;
