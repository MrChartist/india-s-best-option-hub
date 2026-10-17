/**
 * CompositEdge (XTS market-data API) authentication.
 *
 * CompositEdge, like several other Indian discount brokers, runs on Symphony
 * Fintech's white-label "XTS" trading backend — same endpoint shapes
 * (/apimarketdata/*, /interactive/*, exchangeSegment/exchangeInstrumentID,
 * Touchline quote payloads) as other XTS-based brokers already in this app's
 * broker list (e.g. jainamxts). Confirmed by cross-referencing
 * marketcalls/openalgo's production compositedge adapter, which uses the
 * exact same URL/host pattern (xts.compositedge.com) and payload shapes as
 * XTS's public API. Worth knowing for whoever wires up the next XTS-family
 * broker — the request/response shapes here should transfer almost as-is.
 *
 * This module only implements the MARKET DATA half of CompositEdge's API
 * (read-only quotes/instruments). The INTERACTIVE (order-placing) half
 * needs an OAuth-style browser-redirect login (an app-level appKey/secretKey
 * exchanged for a "request token" via a broker login page, then exchanged
 * again for a session) which has no server-side equivalent for a
 * paste-your-credentials flow. The market-data API, by contrast, logs in
 * directly from an appKey/secretKey pair with a single POST and no
 * redirect — exactly what this app's model needs, and all that's required
 * for option-chain data.
 *
 * The public source doesn't document an exact session TTL for the resulting
 * token; it's conservatively cached until the next IST midnight, with a
 * reactive re-login on any "invalid/expired token" response (mirrors
 * openalgo's own defensive refresh-on-401 behavior for this broker).
 */

const BASE_URL = "https://xts.compositedge.com";
export const MARKET_DATA_URL = `${BASE_URL}/apimarketdata`;

// key -> { token, userId, expiresAt } — in-memory only, never persisted, never logged.
const sessionCache = new Map();

function credsKey(creds) {
  return JSON.stringify({ k: creds?.apiKey, s: creds?.apiSecret });
}

/** Epoch ms of the next IST midnight from `now`. */
function nextIstMidnightMs(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  istShifted.setUTCHours(0, 0, 0, 0);
  return istShifted.getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS;
}

async function loginFresh(creds) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error("CompositEdge credentials incomplete — need apiKey and apiSecret");
  }

  const res = await fetch(`${MARKET_DATA_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secretKey: creds.apiSecret, appKey: creds.apiKey, source: "WebAPI" }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok || json?.type !== "success" || !json?.result?.token) {
    const msg = json?.description || json?.message || `HTTP ${res.status}`;
    console.log(`[compositedge] market-data login failed: ${msg}`);
    throw new Error(`CompositEdge login failed: ${msg}`);
  }

  const session = {
    token: json.result.token,
    userId: json.result.userID || null,
    expiresAt: nextIstMidnightMs(),
  };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a valid cached session, logging in fresh if missing/expired. */
export async function getSession(creds) {
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

function looksLikeInvalidToken(json, text) {
  const msg = (json?.description || json?.message || text || "").toLowerCase();
  return msg.includes("invalid token") || msg.includes("token expired") || msg.includes("session expired") || msg.includes("token is not valid");
}

/**
 * Authenticated call against CompositEdge's market-data API. On a token
 * rejection, forces a fresh login and retries once — the same reactive
 * pattern openalgo's own adapter uses when the feed token expires mid-day.
 * Returns the response's `result` payload; throws on any other error.
 */
export async function authFetch(creds, path, { method = "POST", body, params } = {}) {
  let session = await getSession(creds);

  const doCall = async (sess) => {
    let url = `${MARKET_DATA_URL}${path}`;
    if (params) url += `?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", authorization: sess.token },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, json };
  };

  let { res, text, json } = await doCall(session);

  if (json?.type !== "success" && looksLikeInvalidToken(json, text)) {
    console.log(`[compositedge] token rejected on ${path} — re-logging in`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ res, text, json } = await doCall(session));
  }

  if (!res.ok || json?.type !== "success") {
    const msg = json?.description || json?.message || text.slice(0, 200);
    throw new Error(`CompositEdge API error [${res.status}] on ${path}: ${msg}`);
  }
  return json.result;
}
