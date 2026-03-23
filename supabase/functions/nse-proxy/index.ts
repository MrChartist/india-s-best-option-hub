import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NSE_BASE = "https://www.nseindia.com";

// NSE requires browser-like headers and a session cookie
async function getNSESession(): Promise<{ cookies: string }> {
  const res = await fetch(NSE_BASE, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });
  const setCookie = res.headers.get("set-cookie") || "";
  // Extract cookies
  const cookies = setCookie
    .split(",")
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  // Consume response body
  await res.text();
  return { cookies };
}

async function fetchNSE(path: string, cookies: string): Promise<Response> {
  const url = `${NSE_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": "https://www.nseindia.com/option-chain",
      "Cookie": cookies,
    },
  });
  return res;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint");

    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: "Missing 'endpoint' query parameter. Use: option-chain, indices, market-status" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get NSE session cookies
    const { cookies } = await getNSESession();

    let apiPath: string;
    const symbol = url.searchParams.get("symbol");

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
        apiPath = "/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O";
        break;

      case "market-data-pre-open":
        apiPath = "/api/market-data-pre-open?key=FO";
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown endpoint: ${endpoint}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    const nseRes = await fetchNSE(apiPath, cookies);
    const data = await nseRes.text();

    return new Response(data, {
      status: nseRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (error) {
    console.error("NSE Proxy Error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to fetch from NSE", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
