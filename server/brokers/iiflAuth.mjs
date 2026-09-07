/**
 * IIFL Securities — XTS (Symphony Fintech) Market Data API authentication.
 *
 * IIFL Securities' API (ttblaze.iifl.com) is a white-labelled deployment of
 * Symphony Fintech's "XTS" trading front-end API — the same backend used by
 * several other Indian discount brokers (openalgo's broker/compositedge and
 * broker/jainamxts plugins are near byte-for-byte identical to broker/iifl:
 * same /interactive + /apimarketdata roots, same appKey/secretKey/source
 * login payload, same pipe-delimited instrument master, same xtsMessageCode
 * quote scheme). Anything learned here about the request/response shapes
 * carries over almost directly to those brokers.
 *
 * Two independent credential pairs exist on a real IIFL developer account:
 * an "Interactive" (trading) app and a "Market Data" app. This module (and
 * this integration) only ever needs the Market Data pair — every endpoint
 * we call (instrument master, quotes, index list) lives under
 * /apimarketdata and authenticates with the market-data login's token, never
 * the interactive/trading token. Login: POST /apimarketdata/auth/login with
 * {appKey, secretKey, source:"WebAPI"} returns {result:{token, userID}}.
 * The token is not documented with a fixed TTL by IIFL; XTS-based brokers
 * generally treat it as valid for the trading session, so it's cached
 * in-memory for 8 hours and reactively refreshed on any "Invalid Token"
 * response, mirroring openalgo's own retry-once-on-expiry behaviour.
 */

export const BASE_URL = "https://ttblaze.iifl.com";
export const MARKET_DATA_URL = `${BASE_URL}/apimarketdata`;

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // conservative — undocumented exact TTL
const sessionCache = new Map();

function credsKey(creds) {
  // Never logs raw values — cache key only, discarded on process restart.
  return JSON.stringify({ k: creds?.apiKey, s: creds?.apiSecret });
}

async function loginFresh(creds) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error("IIFL Securities credentials missing apiKey/apiSecret — paste both (Market Data App Key/Secret) in Broker Settings.");
  }
  const res = await fetch(`${MARKET_DATA_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: creds.apiKey, secretKey: creds.apiSecret, source: "WebAPI" }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.type !== "success" || !json?.result?.token) {
    const msg = json?.description || `HTTP ${res.status}`;
    console.log(`[iifl] market-data login failed: ${msg}`);
    throw new Error(`IIFL Securities login failed: ${msg}`);
  }
  const session = {
    token: json.result.token,
    userID: json.result.userID || null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a cached market-data session, logging in fresh if missing/expired. */
export async function getSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

function isInvalidTokenBody(json) {
  const desc = (json?.description || "").toLowerCase();
  return json?.type === "error" && desc.includes("invalid token");
}

/**
 * Authenticated call against the XTS market-data API. Retries exactly once
 * on an "Invalid Token" response (HTTP 200 with type:"error" — XTS's way of
 * signalling an expired feed token) after forcing a fresh login.
 */
async function xtsCall(creds, path, { method = "GET", body, params, _retried = false } = {}) {
  const session = await getSession(creds);
  const url = new URL(`${MARKET_DATA_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: session.token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);

  if (!_retried && isInvalidTokenBody(json)) {
    console.log(`[iifl] feed token expired on ${path}; refreshing and retrying once`);
    sessionCache.delete(credsKey(creds));
    return xtsCall(creds, path, { method, body, params, _retried: true });
  }

  if (!res.ok || json?.type !== "success") {
    const msg = json?.description || `HTTP ${res.status}`;
    throw new Error(`IIFL Securities API error on ${path}: ${msg}`);
  }
  return json;
}

export function xtsGet(creds, path, params) {
  return xtsCall(creds, path, { method: "GET", params });
}

export function xtsPost(creds, path, body) {
  return xtsCall(creds, path, { method: "POST", body });
}
