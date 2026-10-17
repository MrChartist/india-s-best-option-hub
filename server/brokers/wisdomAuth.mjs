/**
 * Wisdom Capital (XTS) market-data session login + in-memory session cache.
 *
 * Wisdom Capital runs on Symphony Fintech's white-label "XTS" trading
 * backend — confirmed by openalgo's `broker/wisdom` adapter, whose base URLs
 * (https://trade.wisdomcapital.in/interactive, /apimarketdata), endpoint
 * paths (/user/session, /auth/login, /instruments/quotes,
 * /instruments/master, /instruments/indexlist), payload shapes
 * ({appKey, secretKey, source:"WebAPI"}), and 23-column pipe-delimited F&O
 * master layout are byte-for-byte identical to Jainam's `broker/jainamxts`
 * adapter in the same repo — i.e. this is the same XTS deployment family
 * already implemented in this registry as jainamxts.mjs, just under a
 * different broker's brand/host. See jainamxtsAuth.mjs for the sibling
 * writeup; this module mirrors it against Wisdom's own host.
 *
 * Auth model: server-side handshake, no TOTP — a direct appKey + secretKey
 * exchange against XTS's *market-data* login (openalgo's `get_feed_token`),
 * cached in-memory for the documented 24h session lifetime. XTS's separate
 * "Interactive" (order-placement) login needs a 3-legged OAuth-style
 * handshake with a broker-hosted redirect, which this module intentionally
 * skips — this contract only needs market data (chain/expiries/LTP), and the
 * market-data login is fully server-automatable with just appKey + secretKey.
 */

const BASE_URL = "https://trade.wisdomcapital.in";
export const MARKET_DATA_URL = `${BASE_URL}/apimarketdata`;

const SESSION_TTL_MS = 23 * 60 * 60 * 1000; // documented 24h validity; refresh 1h early

// JSON.stringify(creds) -> { token, userID, expiresAt }
const SESSION_CACHE = new Map();

function sessionCacheKey(creds) {
  // In-process cache key only — never persisted, never logged.
  return JSON.stringify(creds || {});
}

function requireFields(creds) {
  const missing = ["apiKey", "apiSecret"].filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Wisdom Capital credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function login(creds) {
  requireFields(creds);

  const res = await fetch(`${MARKET_DATA_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secretKey: creds.apiSecret, appKey: creds.apiKey, source: "WebAPI" }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Wisdom Capital login returned a non-JSON response (HTTP ${res.status})`);
  }

  if (json?.type !== "success" || !json?.result?.token) {
    throw new Error(`Wisdom Capital login failed: ${json?.description || json?.message || `HTTP ${res.status}`}`);
  }

  return {
    token: json.result.token,
    userID: json.result.userID ?? json.result.userId ?? null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

/** Returns a cached, still-valid session or performs a fresh login. Throws on any auth failure. */
export async function ensureSession(creds) {
  const key = sessionCacheKey(creds);
  const cached = SESSION_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const session = await login(creds);
  SESSION_CACHE.set(key, session);
  return session;
}

function invalidateSession(creds) {
  SESSION_CACHE.delete(sessionCacheKey(creds));
}

async function doFetch(path, { method, body, params, token }) {
  let url = `${MARKET_DATA_URL}${path}`;
  if (params) url += `?${new URLSearchParams(params).toString()}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.authorization = token; // XTS wants the raw token, no "Bearer " prefix

  const res = await fetch(url, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Wisdom Capital API [${path}] returned a non-JSON response (HTTP ${res.status})`);
  }
  return { res, json };
}

/**
 * Authenticated (or anonymous, with `auth:false`) request against the market-data API.
 * On an "Invalid Token" response, transparently re-logs-in once and retries.
 */
export async function xtsRequest(creds, path, opts = {}) {
  const { method = "GET", body, params, auth = true } = opts;

  let token = null;
  if (auth) token = (await ensureSession(creds)).token;

  let { res, json } = await doFetch(path, { method, body, params, token });

  if (auth && json?.type !== "success" && /invalid token/i.test(json?.description || "")) {
    invalidateSession(creds);
    token = (await ensureSession(creds)).token;
    ({ res, json } = await doFetch(path, { method, body, params, token }));
  }

  if (json?.type !== "success") {
    throw new Error(`Wisdom Capital API [${path}] error: ${json?.description || json?.message || `HTTP ${res.status}`}`);
  }
  return json.result;
}
