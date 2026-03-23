import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const DHAN_BASE = "https://api.dhan.co/v2";

// Simple in-memory cache with TTL
const cache = new Map<string, { data: any; expiry: number }>();

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
  // Evict old entries if cache grows too large
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

async function dhanFetch(path: string, body?: any, method = "POST"): Promise<any> {
  const clientId = Deno.env.get("DHAN_CLIENT_ID");
  const accessToken = Deno.env.get("DHAN_ACCESS_TOKEN");

  if (!clientId || !accessToken) {
    throw new Error("DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured");
  }

  const url = `${DHAN_BASE}${path}`;
  const options: RequestInit = {
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

// Dhan security ID mapping for indices
const INDEX_SECURITY_IDS: Record<string, { secId: number; exchSeg: string }> = {
  "NIFTY": { secId: 13, exchSeg: "IDX_I" },
  "BANKNIFTY": { secId: 25, exchSeg: "IDX_I" },
  "FINNIFTY": { secId: 27, exchSeg: "IDX_I" },
  "MIDCPNIFTY": { secId: 442, exchSeg: "IDX_I" },
  "SENSEX": { secId: 1, exchSeg: "IDX_I" },
};

// Underlying entity IDs for option chain
const UNDERLYING_MAP: Record<string, { underlyingScrip: number; expirySegment: string }> = {
  "NIFTY": { underlyingScrip: 13, expirySegment: "NSE_FNO" },
  "BANKNIFTY": { underlyingScrip: 25, expirySegment: "NSE_FNO" },
  "FINNIFTY": { underlyingScrip: 27, expirySegment: "NSE_FNO" },
  "MIDCPNIFTY": { underlyingScrip: 442, expirySegment: "NSE_FNO" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint");

    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: "Missing 'endpoint' param. Use: option-chain, expiry-list, ltp, market-feed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const symbol = url.searchParams.get("symbol") || "NIFTY";
    const expiry = url.searchParams.get("expiry");
    const cacheKey = `${endpoint}:${symbol}:${expiry || ""}`;

    // Check cache first (3s TTL for option chain per Dhan rate limit)
    const cached = getCached(cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
      });
    }

    let result: any;

    switch (endpoint) {
      case "option-chain": {
        const underlying = UNDERLYING_MAP[symbol.toUpperCase()];
        if (!underlying) {
          return new Response(
            JSON.stringify({ error: `Unknown symbol: ${symbol}. Supported: ${Object.keys(UNDERLYING_MAP).join(", ")}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const body: any = {
          UnderlyingScrip: underlying.underlyingScrip,
          UnderlyingSeg: underlying.expirySegment,
        };
        if (expiry) {
          body.ExpiryDate = expiry;
        }

        result = await dhanFetch("/optionchain", body);
        setCache(cacheKey, result, 3500); // 3.5s cache (Dhan rate limit = 3s)
        break;
      }

      case "expiry-list": {
        const underlying = UNDERLYING_MAP[symbol.toUpperCase()];
        if (!underlying) {
          return new Response(
            JSON.stringify({ error: `Unknown symbol: ${symbol}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        result = await dhanFetch("/optionchain/expirylist", {
          UnderlyingScrip: underlying.underlyingScrip,
          UnderlyingSeg: underlying.expirySegment,
        });
        setCache(cacheKey, result, 60000); // 1 min cache for expiry list
        break;
      }

      case "ltp": {
        // Market quote - LTP for indices
        const secInfo = INDEX_SECURITY_IDS[symbol.toUpperCase()];
        if (!secInfo) {
          return new Response(
            JSON.stringify({ error: `Unknown index: ${symbol}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        result = await dhanFetch("/marketfeed/ltp", {
          NSE_FNO: [secInfo.secId],
        });
        setCache(cacheKey, result, 2000); // 2s cache for LTP
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown endpoint: ${endpoint}. Use: option-chain, expiry-list, ltp` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
    });
  } catch (error) {
    console.error("Dhan Proxy Error:", error);
    return new Response(
      JSON.stringify({ error: "Dhan API request failed", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
