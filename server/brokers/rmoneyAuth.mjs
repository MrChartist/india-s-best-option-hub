/**
 * RMoney (XTS Market Data API) session auth.
 *
 * RMoney's broker stack lives at xts.rmoneyindia.co.in — a Symphony Fintech "XTS"
 * white-label deployment. This module only needs read-only market data (no order
 * placement), so it authenticates straight against the Market Data API with a
 * paste-once (appKey, secretKey) pair rather than the Interactive/trading API's
 * OAuth-redirect login flow (which needs a browser round-trip and isn't usable
 * headlessly).
 *
 * POST {MARKET_DATA_BASE}/auth/login with {appKey, secretKey, source:"WebAPI"}
 * returns a feed token. XTS deployments don't document an exact feed-token TTL in
 * public material, so this caches for a conservative 8 hours AND reactively
 * re-logs in (once) whenever a call comes back with an "Invalid Token"-shaped
 * error — matching the retry-on-expiry pattern openalgo's production RMoney
 * adapter uses for the same API.
 *
 * NEVER log creds or the raw token — field names / broker status text only.
 */

export const MARKET_DATA_BASE = "https://xts.rmoneyindia.co.in:3000/apibinarymarketdata";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // conservative; reactive refresh below covers the rest

const sessionCache = new Map(); // credsKey -> { token, userId, expiresAt }

function credsKey(creds) {
  return JSON.stringify({ k: creds?.apiKey, s: creds?.apiSecret });
}

async function loginFresh(creds) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error("RMoney credentials missing apiKey/apiSecret — paste both in Broker Settings.");
  }
  const res = await fetch(`${MARKET_DATA_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secretKey: creds.apiSecret, appKey: creds.apiKey, source: "WebAPI" }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.type !== "success" || !json?.result?.token) {
    const msg = json?.description || `HTTP ${res.status}`;
    console.log(`[rmoney] login failed: ${msg}`);
    throw new Error(`RMoney login failed: ${msg}`);
  }
  const session = {
    token: json.result.token,
    userId: json.result.userID || null,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a valid cached feed-token session, logging in fresh if missing/expired. */
export async function getSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

function looksLikeInvalidToken(json, text) {
  const desc = (json?.description || text || "").toLowerCase();
  return desc.includes("invalid token") || desc.includes("token expired") || desc.includes("session expired") || desc.includes("not logged in");
}

/**
 * Authenticated call against the Market Data API (feed-token in the `authorization`
 * header, per the reference adapter). On an "Invalid Token"-shaped error, clears the
 * cached session, re-logs in once, and retries — never retries a second time.
 */
export async function marketDataAuthFetch(creds, path, { method = "GET", body, params } = {}) {
  let session = await getSession(creds);

  const doCall = async (token) => {
    const url = new URL(`${MARKET_DATA_BASE}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { authorization: token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, json };
  };

  let { res, text, json } = await doCall(session.token);

  if (json?.type !== "success" && looksLikeInvalidToken(json, text)) {
    console.log(`[rmoney] feed token rejected on ${path} — re-logging in`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ res, text, json } = await doCall(session.token));
  }

  if (!res.ok || json?.type !== "success") {
    const msg = json?.description || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(`RMoney API error on ${path}: ${msg}`);
  }
  return json;
}

/**
 * Unauthenticated market-reference call (instrument master / index list) — the
 * reference adapter never sends an Authorization header for either endpoint, so
 * neither does this (they're public reference data, not account-scoped).
 */
export async function marketDataPublicFetch(path, { method = "GET", body, params } = {}) {
  const url = new URL(`${MARKET_DATA_BASE}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.type !== "success") {
    const msg = json?.description || `HTTP ${res.status}`;
    throw new Error(`RMoney API error on ${path}: ${msg}`);
  }
  return json;
}
