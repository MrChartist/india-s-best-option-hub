/**
 * Arrow (arrow.trade, iRage Broking) session exchange and REST transport.
 *
 * Official docs (checked 2026-10): https://docs.arrow.trade/rest-api/authentication/ ,
 * /rest-api/error-codes/ , /rest-api/response-structure/ , /rest-api/rate-limits/ .
 *  1. The user opens https://app.arrow.trade/app/login?appID=<appId>, signs in on Arrow's own page
 *     (user id, password and TOTP never touch this app) and is redirected with ?request-token=...
 *  2. POST https://edge.arrow.trade/auth/app/authenticate-token with JSON
 *     { appID, token: <request-token>, checkSum: SHA-256("appID:appSecret:request-token") }.
 *     Success: { status: "success", data: { name, token, userID } }. The token lasts 24 hours and there is
 *     no refresh token. The request-token is single use.
 *  3. Every call sends the custom headers `appID` and `token` (not `Authorization: Bearer`).
 *  Errors: { status: "error"|"failure", message, errorCode }, with HTTP 401 UNAUTHORIZED for an expired
 *  session and 429 TOO_MANY_REQUESTS. Rate limits: 10 requests/second per product (orders, positions,
 *  holdings, funds, historical, market data).
 *
 * Contract auth kind: "requestTokenExchange". The access token lives only in this process (keyed by a hash
 * of the saved fields) and is never logged; a used or rejected request-token is remembered so it is not
 * re-sent. Nothing secret is logged.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { createBoundedSet, createSessionCache } from "../lib/boundedCache.mjs";

export const ROOT_URL = "https://edge.arrow.trade";
export const HISTORICAL_URL = "https://historical-api.arrow.trade";
export const AUTH_TOKEN_URL = `${ROOT_URL}/auth/app/authenticate-token`;
export const LOGIN_URL = "https://app.arrow.trade/app/login";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // documented lifetime
const SAFETY_MARGIN_MS = 5 * 60 * 1000;
const KEY_FIELDS = ["appId", "appSecret", "requestToken"];

export const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");
const str = (v) => (v === undefined || v === null ? "" : String(v));
const keyOf = (creds) => sha256Hex(JSON.stringify(KEY_FIELDS.map((f) => str(creds?.[f]))));
const regenerate = (creds) =>
  `Open ${LOGIN_URL}?appID=${encodeURIComponent(str(creds?.appId) || "<App ID>")}, log in and save the new request-token in Broker Settings.`;

const sessions = createSessionCache(); // key -> { token, expiresAt }
const inflight = new Map(); // key -> Promise (one exchange per request-token even under concurrent calls)
const deadTokens = createBoundedSet();

async function exchangeRequestToken(creds) {
  const appId = str(creds.appId);
  const requestToken = str(creds.requestToken);
  let res;
  try {
    res = await brokerFetch(AUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appID: appId, token: requestToken, checkSum: sha256Hex(`${appId}:${str(creds.appSecret)}:${requestToken}`) }),
    });
  } catch (e) {
    throw new BrokerError(`Arrow login: network error (${e?.message || e})`);
  }
  const json = await res.json().catch(() => null);
  const token = json?.status === "success" ? str(json?.data?.token) : "";
  if (res.ok && token) return { token, expiresAt: Date.now() + SESSION_TTL_MS - SAFETY_MARGIN_MS };
  if (res.status >= 500 || !json) throw new BrokerError(`Arrow login: HTTP ${res.status}`);
  throw new SessionRequiredError(`Arrow did not accept the request-token (${json.message || `HTTP ${res.status}`}). Request-tokens are single use. ${regenerate(creds)}`);
}

/** A valid access token for these saved fields, exchanging the request-token once when needed. */
export async function getAccessToken(creds) {
  const missing = KEY_FIELDS.filter((f) => !str(creds?.[f]).trim());
  if (missing.length) throw new BrokerInputError(`Arrow: missing ${missing.join(", ")}.`);
  const key = keyOf(creds);
  const hit = sessions.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.token;
  if (hit) {
    sessions.delete(key);
    deadTokens.add(key);
  }
  if (deadTokens.has(key)) throw new SessionRequiredError(`Arrow: this request-token has already been used or has expired. ${regenerate(creds)}`);
  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      try {
        const s = await exchangeRequestToken(creds);
        sessions.set(key, s);
        return s;
      } catch (e) {
        if (e instanceof SessionRequiredError) deadTokens.add(key);
        throw e;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  return (await p).token;
}

/** Drop the cached access token after Arrow rejected it (401). The request-token cannot be reused. */
export function invalidateSession(creds) {
  const key = keyOf(creds);
  sessions.delete(key);
  deadTokens.add(key);
}

/** Test helper: forget every cached session and used request-token. */
export function resetSessions() {
  sessions.clear();
  inflight.clear();
  deadTokens.clear();
}

/** Arrow's custom auth headers. */
export function authHeaders(appId, token, withJson = false) {
  const headers = { appID: str(appId), token: str(token) };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

/**
 * Authenticated call. Returns the parsed JSON body (or { text } for non-JSON bodies when `raw` is set).
 * 401 -> SessionRequiredError (cached token dropped); 429 -> BrokerError UPSTREAM_RATE_LIMIT;
 * any other non-2xx or an error envelope -> BrokerError with Arrow's message.
 */
export async function arrowFetch(creds, path, { method = "GET", body, base = ROOT_URL, raw = false, what = path } = {}) {
  const token = await getAccessToken(creds);
  let res;
  try {
    res = await brokerFetch(`${base}${path}`, {
      method,
      headers: authHeaders(creds.appId, token, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new BrokerError(`Arrow ${what}: network error (${e?.message || e})`);
  }
  if (res.status === 401) {
    invalidateSession(creds);
    throw new SessionRequiredError(`Arrow rejected the session (HTTP 401). ${regenerate(creds)}`);
  }
  const text = await res.text();
  if (raw && res.ok) return { text };
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 429) throw new BrokerError(`Arrow ${what}: rate limit reached (10 requests a second). Try again shortly.`, { code: "UPSTREAM_RATE_LIMIT" });
  const envelopeFailed = json && typeof json === "object" && !Array.isArray(json) && json.status && json.status !== "success";
  if (!res.ok || envelopeFailed) {
    const msg = (json && (json.message || json.errorCode)) || text.slice(0, 160) || `HTTP ${res.status}`;
    throw new BrokerError(`Arrow ${what} failed (HTTP ${res.status}): ${msg}`);
  }
  if (json === null) throw new BrokerError(`Arrow ${what}: unexpected non-JSON response`);
  return json;
}
