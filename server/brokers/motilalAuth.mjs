/**
 * Motilal Oswal (MOFSL) authentication.
 *
 * Source: marketcalls/openalgo's production `broker/motilal/api/auth_api.py` +
 * `broker/motilal/api/baseurl.py` (no public broker-api-docs mirror exists for
 * this broker — openalgo's adapter is the primary reference, cross-checked
 * against its own inline citations of Motilal's official doc numbers).
 *
 * Login is a two-step, always-active handshake (never a paste-a-token model):
 *   1. POST /rest/login/v7/authdirectapi — body is
 *      { userid, password: SHA256(password + apiKey), "2FA": DD/MM/YYYY, totp }.
 *      Returns an `AuthToken`. `isAuthTokenVerified` must be "TRUE" — anything
 *      else means Motilal wants an SMS/Email OTP instead of TOTP, which this
 *      module (like openalgo's) does not implement.
 *   2. POST /rest/login/v1/getaccesstoken (optional, needs an `apisecretkey`
 *      header) — exchanges the AuthToken for an `accesstoken`. Skipped
 *      whenever the user hasn't supplied an API secret; login still succeeds
 *      on the bare AuthToken alone.
 *
 * The resulting token is cached in-memory (never persisted) and re-used until
 * Motilal's documented daily reset at 6 AM IST — logging in fresh every call
 * would burn through the login rate limit and TOTP codes are single-use per
 * 30s window anyway.
 */

import { createHash } from "node:crypto";
import { generateTOTP } from "../lib/totp.mjs";

export const BASE_URL = "https://openapi.motilaloswal.com";

export const ENDPOINTS = {
  authdirectapi: "/rest/login/v7/authdirectapi",
  getaccesstoken: "/rest/login/v1/getaccesstoken",
  getltpdata: "/rest/report/v3/getltpdata",
  getindexltpdata: "/rest/report/v3/getindexltpdata",
};

// key -> { authToken, accessToken, apiKey, apiSecret, clientId, expiresAt }
const SESSION_CACHE = new Map();

/** In-process cache key only — never persisted, never logged. */
function sessionCacheKey(creds) {
  return JSON.stringify(creds || {});
}

function requireFields(creds, fields) {
  const missing = fields.filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Motilal Oswal credentials missing required field(s): ${missing.join(", ")}`);
  }
}

/** Next 6:00 AM IST strictly after `now` — the daily reset Motilal's AuthToken is documented to hit. */
function nextIst6amMs(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  const istMidnightShifted = new Date(istShifted);
  istMidnightShifted.setUTCHours(0, 0, 0, 0);
  const today6amReal = istMidnightShifted.getTime() + 6 * 60 * 60 * 1000 - IST_OFFSET_MS;
  return now < today6amReal ? today6amReal : today6amReal + 24 * 60 * 60 * 1000;
}

/** Doc 05's mandatory common header set. Never logs `headers.ApiKey`/`Authorization`/`accesstoken` values. */
function buildHeaders({ apiKey, apiSecret, vendorInfo, authToken, accessToken, includeAuth }) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "MOSL/V.1.1.0",
    "ApiKey": apiKey || "",
    "ClientLocalIp": "127.0.0.1",
    "ClientPublicIp": "127.0.0.1",
    "MacAddress": "00:00:00:00:00:00",
    "SourceId": "WEB",
    "vendorinfo": vendorInfo || "",
    "osname": "Windows 10",
    "osversion": "10.0.19041",
    "devicemodel": "AHV",
    "manufacturer": "DELL",
    "productname": "OptionsDesk",
    "productversion": "1.0.0",
    // Mandatory whenever SourceId=WEB per doc 05.
    "browsername": "Chrome",
    "browserversion": "120.0",
  };
  if (apiSecret) headers.apisecretkey = apiSecret;
  if (includeAuth) {
    if (authToken) headers.Authorization = authToken;
    if (accessToken) headers.accesstoken = accessToken;
  }
  return headers;
}

function formatError(json, fallback) {
  const message = json?.message || fallback;
  return json?.errorcode ? `${message} (errorcode: ${json.errorcode})` : message;
}

/** Optional getaccesstoken step. Never throws — a failure here falls back to the bare AuthToken. */
async function getAccessToken({ apiKey, apiSecret, clientId, authToken }) {
  try {
    const headers = buildHeaders({ apiKey, apiSecret, vendorInfo: clientId, authToken, includeAuth: true });
    const res = await fetch(`${BASE_URL}${ENDPOINTS.getaccesstoken}`, { method: "POST", headers });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.status === "SUCCESS" && json?.accesstoken) return json.accesstoken;
    console.log(`[motilal] getaccesstoken did not return a token (HTTP ${res.status})`);
    return null;
  } catch (e) {
    console.log(`[motilal] getaccesstoken call failed: ${e.message}`);
    return null;
  }
}

async function loginFresh(creds) {
  requireFields(creds, ["apiKey", "clientId", "password", "dob", "totpSecret"]);

  const passwordHash = createHash("sha256").update(`${creds.password}${creds.apiKey}`).digest("hex");
  const totp = generateTOTP(creds.totpSecret);
  const payload = { userid: creds.clientId, password: passwordHash, "2FA": creds.dob, totp };

  // Doc 05: "Authorization ... Used in all API's excluding login API".
  const headers = buildHeaders({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, vendorInfo: creds.clientId, includeAuth: false });

  const res = await fetch(`${BASE_URL}${ENDPOINTS.authdirectapi}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Motilal Oswal login returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok || json?.status !== "SUCCESS" || !json?.AuthToken) {
    throw new Error(`Motilal Oswal login failed: ${formatError(json, "authentication rejected")}`);
  }

  // isAuthTokenVerified != "TRUE" means Motilal wants SMS/Email OTP verification
  // instead — an unimplemented flow (see module docstring). Fail closed only on
  // an explicit negative so a missing/unrecognised value doesn't block a good login.
  const verified = String(json.isAuthTokenVerified ?? "").trim().toUpperCase();
  if (["FALSE", "0", "NO", "N"].includes(verified)) {
    throw new Error(
      "Motilal Oswal login requires OTP verification, which this app does not support. " +
      "Enable an authenticator app (TOTP) on your Motilal Oswal account and use the TOTP Secret field instead."
    );
  }

  const authToken = json.AuthToken;
  let accessToken = null;
  if (creds.apiSecret) {
    accessToken = await getAccessToken({ apiKey: creds.apiKey, apiSecret: creds.apiSecret, clientId: creds.clientId, authToken });
  }

  return {
    authToken,
    accessToken,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret || null,
    clientId: creds.clientId,
    expiresAt: nextIst6amMs(),
  };
}

/** Returns a cached, still-valid session or performs a fresh login. Throws on any auth failure. */
export async function ensureSession(creds) {
  const key = sessionCacheKey(creds);
  const cached = SESSION_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const session = await loginFresh(creds);
  SESSION_CACHE.set(key, session);
  return session;
}

function invalidateSession(creds) {
  SESSION_CACHE.delete(sessionCacheKey(creds));
}

/**
 * Authenticated POST against an ENDPOINTS key. Ensures a session first; on a
 * response that looks like a rejected/expired token, forces one fresh login
 * and retries once (mirrors angelone.mjs's retry-on-auth-failure shape).
 */
export async function authPost(creds, endpointKey, payload) {
  let session = await ensureSession(creds);

  const doCall = async (sess) => {
    const headers = buildHeaders({
      apiKey: sess.apiKey,
      apiSecret: sess.apiSecret,
      vendorInfo: sess.clientId,
      authToken: sess.authToken,
      accessToken: sess.accessToken,
      includeAuth: true,
    });
    const res = await fetch(`${BASE_URL}${ENDPOINTS[endpointKey]}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { res, text, json };
  };

  let { res, text, json } = await doCall(session);

  const looksLikeAuthFailure =
    res.status === 401 ||
    res.status === 403 ||
    (json?.status !== "SUCCESS" && /token|auth|session/i.test(json?.message || ""));

  if (looksLikeAuthFailure) {
    console.log(`[motilal] auth-looking failure on ${endpointKey} (HTTP ${res.status}) — re-logging in`);
    invalidateSession(creds);
    session = await ensureSession(creds);
    ({ res, text, json } = await doCall(session));
  }

  if (!res.ok) {
    throw new Error(`Motilal Oswal API error on ${endpointKey} [HTTP ${res.status}]: ${text.slice(0, 200)}`);
  }
  if (!json) {
    throw new Error(`Motilal Oswal API [${endpointKey}] returned a non-JSON response`);
  }
  return json;
}
