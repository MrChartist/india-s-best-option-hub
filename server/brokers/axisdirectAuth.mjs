/**
 * Axis Direct (Axis Securities) RAPID APIs: SSO session, token refresh and the encrypted REST transport.
 *
 * Official source: "RAPID APIs by Axis Direct" Postman collection,
 * https://documenter.getpostman.com/view/33771924/2sA3BkasEf (linked from simplehai.axisdirect.in/RapidAPI).
 *  - Keys: Axis onboards the developer as an API client and issues X-API-CLIENT-ID and AUTHORIZATION_KEY.
 *  - Hosts (production): welcome-api.axisdirect.in (handshake, SSO, token refresh),
 *    invest-api.axisdirect.in (trading, quotes, books), funds-api.axisdirect.in (limits).
 *  - Handshake: POST /handshake with Authorization + x-api-client-id -> { data: { publicKey } } (plain JSON).
 *  - SSO Initiate: POST /sso/initiate, encrypted { type: "LOGIN", redirectURL, metadata } -> data.redirectURL,
 *    the login microsite URL carrying `ssoId`. The client logs in there (credentials + access code / TOTP) and is
 *    sent to the redirect URL with the same ssoId.
 *  - SSO Authenticate: POST /sso/authenticate, encrypted { ssoId } -> authToken { token, expireAt },
 *    refreshToken { token, expireAt } and accounts[].subAccountId.
 *  - Refresh: "The authToken expires every 15 mins"; POST /v1/handshake/get-auth-token with x-subAccountID and
 *    encrypted { refreshToken } -> data.token (+ expireAt). The refresh token lasts until 23:59:59 IST.
 *  - Every other call: headers Authorization, x-api-client-id, x-subAccountID, x-authtoken, x-api-encryption-key;
 *    body { "payload": <encrypted JSON> }; response { statusCode, status, data: { payload } } whose decrypted
 *    payload is { statusCode, status, message, data }. 206 "Partial Content" with data [] means an empty book.
 *
 * Auth kind requestTokenExchange: the user saves the API client ID, the authorisation key and the ssoId from
 * the login redirect; the first data call runs SSO Authenticate and the session (tokens, sub-account, the
 * per-session AES key) stays in this process only. An ssoId the broker refused, or whose session ended, is
 * never sent again. Getting the login microsite URL needs a server call (initiateLogin below); wiring it to a
 * proxy route is a registry/proxy change that is reported, not made here.
 *
 * Not confirmed by the docs (needs a live account): the error envelope for a rejected call (handled as a
 * non-2xx statusCode with `message`), and whether the refresh response carries expireAt (15 minutes assumed).
 */

import { BrokerError, BrokerInputError, SessionRequiredError, brokerFetch } from "./contract.mjs";
import { decryptPayload, encryptPayload, encryptSecretKey, newSecretKey } from "./axisdirectCrypto.mjs";
import { sha256Hex } from "./shoonyaNorenCore.mjs";

export const AUTH_HOST = "https://welcome-api.axisdirect.in";
export const TRADING_HOST = "https://invest-api.axisdirect.in";
export const FUNDS_HOST = "https://funds-api.axisdirect.in";

const LABEL = "Axis Direct";
const AUTH_TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const EARLY_REFRESH_MS = 60 * 1000;
const KEY_FIELDS = ["apiClientId", "authorizationKey", "ssoId"];
const REGENERATE = "Start a new Axis Direct login, then save the new ssoId from the redirect address in Broker Settings.";

let makeSecretKey = newSecretKey;
/** Tests only: make the per-session AES key deterministic so recorded encrypted fixtures can be replayed. */
export function __setSecretKeyFactoryForTests(fn) {
  makeSecretKey = typeof fn === "function" ? fn : newSecretKey;
}

const str = (v) => (v === undefined || v === null ? "" : String(v));

/** Parse an ISO timestamp ("2024-03-21T15:50:10.940184129+05:30"; nanoseconds trimmed) to epoch ms, or null. */
export function parseExpireAt(raw) {
  const s = str(raw).trim().replace(/(\.\d{3})\d+/, "$1");
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function requireKeys(creds, fields) {
  const missing = fields.filter((f) => !str(creds?.[f]).trim());
  if (missing.length) throw new BrokerInputError(`${LABEL}: missing ${missing.join(", ")}.`);
}

const baseHeaders = (creds) => ({
  "Content-Type": "application/json",
  Authorization: str(creds.authorizationKey),
  "x-api-client-id": str(creds.apiClientId),
});

async function readJson(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return undefined; }
}

/**
 * Decrypt one RAPID response. Returns the inner { statusCode, status, message, data }.
 * HTTP 401/403 (or an inner 401/403) -> SessionRequiredError; other failures -> BrokerError 502.
 */
export async function unwrapResponse(res, secretKey, what) {
  const outer = await readJson(res);
  if (res.status === 401 || res.status === 403) throw new SessionRequiredError(`${LABEL}: the broker rejected the session (HTTP ${res.status}). ${REGENERATE}`);
  if (res.status === 429) throw new BrokerError(`${LABEL} ${what}: rate limited`, { code: "UPSTREAM_RATE_LIMIT" });
  if (outer === undefined) throw new BrokerError(`${LABEL} ${what}: non-JSON response (HTTP ${res.status})`);
  const enc = outer?.data?.payload;
  let inner = outer;
  if (typeof enc === "string") {
    try { inner = JSON.parse(decryptPayload(enc, secretKey)); } catch (e) {
      if (e instanceof BrokerError) throw e;
      throw new BrokerError(`${LABEL} ${what}: the decrypted response is not JSON.`);
    }
  }
  const code = Number(inner?.statusCode ?? res.status);
  if (code === 401 || code === 403) throw new SessionRequiredError(`${LABEL}: session expired or invalid (${str(inner?.message) || code}). ${REGENERATE}`);
  if (code === 429) throw new BrokerError(`${LABEL} ${what}: rate limited`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok || !(code >= 200 && code < 300)) {
    const err = new BrokerError(`${LABEL} ${what}: ${str(inner?.message || inner?.status) || `HTTP ${res.status}`}`);
    err.upstreamStatus = res.ok ? code : res.status;
    throw err;
  }
  return inner;
}

// ── handshake (public key), cached per API client for the process ──

const publicKeys = new Map(); // sha256(apiClientId|authorizationKey) -> Promise<string>

async function publicKeyFor(creds) {
  const key = sha256Hex(`${str(creds.apiClientId)}|${str(creds.authorizationKey)}`);
  let p = publicKeys.get(key);
  if (!p) {
    p = (async () => {
      const res = await brokerFetch(`${AUTH_HOST}/handshake`, { method: "POST", headers: baseHeaders(creds) }, { kind: "login", label: LABEL });
      const json = await readJson(res);
      if (res.status === 401 || res.status === 403) throw new SessionRequiredError(`${LABEL} refused the API client ID or authorisation key (HTTP ${res.status}). Check them in Broker Settings.`);
      const pk = json?.data?.publicKey;
      if (!res.ok || typeof pk !== "string" || !pk) throw new BrokerError(`${LABEL} handshake failed (HTTP ${res.status}).`);
      return pk;
    })();
    publicKeys.set(key, p);
    p.catch(() => publicKeys.delete(key));
  }
  return p;
}

/** A fresh AES key and its RSA-wrapped header value. */
async function newCipherKeys(creds) {
  const secretKey = makeSecretKey();
  return { secretKey, encryptionKey: encryptSecretKey(secretKey, await publicKeyFor(creds)) };
}

async function postEncrypted(url, headers, body, keys, what, kind = "write") {
  const res = await brokerFetch(url, {
    method: "POST",
    headers: { ...headers, "x-api-encryption-key": keys.encryptionKey },
    body: JSON.stringify({ payload: encryptPayload(JSON.stringify(body), keys.secretKey) }),
  }, { kind, label: LABEL });
  return unwrapResponse(res, keys.secretKey, what);
}

/**
 * SSO Initiate: returns { loginUrl, ssoId } for the login microsite. Needs a proxy route to be usable from the
 * app (reported). `redirectURL` must be the address registered with Axis for this API client.
 */
export async function initiateLogin(creds, { redirectURL } = {}) {
  requireKeys(creds, ["apiClientId", "authorizationKey"]);
  if (!/^https:\/\/[^\s]+$/i.test(str(redirectURL))) throw new BrokerInputError(`${LABEL}: redirectURL must be an https address.`);
  const keys = await newCipherKeys(creds);
  const inner = await postEncrypted(`${AUTH_HOST}/sso/initiate`, baseHeaders(creds), { type: "LOGIN", redirectURL, metadata: { name: "option-chain" } }, keys, "SSO initiate", "login");
  const loginUrl = str(inner?.data?.redirectURL);
  let ssoId = "";
  try { ssoId = new URL(loginUrl).searchParams.get("ssoId") || ""; } catch { /* reported below */ }
  if (!loginUrl.startsWith("https://") || !ssoId) throw new BrokerError(`${LABEL} SSO initiate returned no login address.`);
  return { loginUrl, ssoId };
}

// ── session cache ──

const sessions = new Map(); // sha256(key fields) -> session
const inflight = new Map();
const deadCodes = new Set();
const keyOf = (creds) => sha256Hex(JSON.stringify(KEY_FIELDS.map((f) => str(creds?.[f]))));

async function authenticate(creds) {
  const keys = await newCipherKeys(creds);
  let inner;
  try {
    inner = await postEncrypted(`${AUTH_HOST}/sso/authenticate`, baseHeaders(creds), { ssoId: str(creds.ssoId) }, keys, "SSO authenticate", "login");
  } catch (e) {
    // A 4xx answer means the ssoId itself was refused; a 5xx or timeout leaves it usable for a retry.
    if (e instanceof BrokerError && e.upstreamStatus >= 400 && e.upstreamStatus < 500) {
      throw new SessionRequiredError(`${LABEL} did not accept this ssoId (${e.message.replace(/^Axis Direct SSO authenticate: /, "")}). ${REGENERATE}`);
    }
    throw e;
  }
  const d = inner?.data ?? {};
  const token = str(d.authToken?.token);
  const accounts = Array.isArray(d.accounts) ? d.accounts : Array.isArray(d.metadata?.accounts) ? d.metadata.accounts : [];
  const account = accounts.find((a) => a?.isPrimary) ?? accounts[0] ?? {};
  if (!token || !str(account.subAccountId)) throw new BrokerError(`${LABEL} SSO authenticate returned no session.`);
  const now = Date.now();
  return {
    ...keys,
    authToken: token,
    authExpiresAt: parseExpireAt(d.authToken?.expireAt) ?? now + AUTH_TOKEN_LIFETIME_MS,
    refreshToken: str(d.refreshToken?.token),
    refreshExpiresAt: parseExpireAt(d.refreshToken?.expireAt) ?? now + AUTH_TOKEN_LIFETIME_MS,
    subAccountId: str(account.subAccountId),
  };
}

async function refresh(creds, s) {
  const inner = await postEncrypted(`${AUTH_HOST}/v1/handshake/get-auth-token`, { ...baseHeaders(creds), "x-subAccountID": s.subAccountId },
    { refreshToken: s.refreshToken }, s, "token refresh", "login");
  const d = inner?.data ?? {};
  const token = str(d.token ?? d.authToken?.token);
  if (!token) throw new SessionRequiredError(`${LABEL}: the session could not be renewed. ${REGENERATE}`);
  s.authToken = token;
  s.authExpiresAt = parseExpireAt(d.expireAt ?? d.authToken?.expireAt) ?? Date.now() + AUTH_TOKEN_LIFETIME_MS;
  return s;
}

/** The live session for these credentials: authenticates on first use and refreshes the 15-minute token. */
export async function ensureSession(creds) {
  requireKeys(creds, KEY_FIELDS);
  const key = keyOf(creds);
  const now = Date.now();
  const hit = sessions.get(key);
  if (hit && now < hit.authExpiresAt - EARLY_REFRESH_MS) return { ...hit, key };
  if (!hit && deadCodes.has(key)) throw new SessionRequiredError(`${LABEL}: this ssoId has already been used or its session has ended. ${REGENERATE}`);
  if (hit && !(hit.refreshToken && now < hit.refreshExpiresAt)) {
    sessions.delete(key);
    deadCodes.add(key);
    throw new SessionRequiredError(`${LABEL}: the day's session has ended. ${REGENERATE}`);
  }
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const s = hit ? await refresh(creds, hit) : await authenticate(creds);
        sessions.set(key, s);
        return s;
      } catch (e) {
        if (e instanceof SessionRequiredError) { sessions.delete(key); deadCodes.add(key); }
        throw e;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return { ...(await p), key };
}

/** Drop a session the broker rejected; its ssoId is never sent again. */
export function invalidateSession(handle) {
  if (!handle?.key) return;
  sessions.delete(handle.key);
  deadCodes.add(handle.key);
}

/**
 * One authenticated RAPID call. `body` null sends a GET with no payload (Get Market Status).
 * Returns the decrypted inner response.
 */
export async function rapidCall(creds, host, path, body, { kind } = {}) {
  const s = await ensureSession(creds);
  const headers = { ...baseHeaders(creds), "x-subAccountID": s.subAccountId, "x-authtoken": s.authToken, "x-api-encryption-key": s.encryptionKey };
  const init = body === null
    ? { method: "GET", headers }
    : { method: "POST", headers, body: JSON.stringify({ payload: encryptPayload(JSON.stringify(body), s.secretKey) }) };
  let res;
  try {
    res = await brokerFetch(`${host}${path}`, init, { kind: kind ?? "read", label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} ${path}: network error (${e?.message || e})`);
  }
  try {
    return await unwrapResponse(res, s.secretKey, path);
  } catch (e) {
    if (e instanceof SessionRequiredError) invalidateSession(s);
    throw e;
  }
}

/** Test helper: forget sessions, used ssoIds and cached public keys. */
export function resetSessions() {
  sessions.clear();
  inflight.clear();
  deadCodes.clear();
  publicKeys.clear();
}
