/**
 * Alice Blue "ANT" Open API (V2, base https://a3.aliceblueonline.com) — session exchange + HTTP client.
 *
 * Official docs: https://ant.aliceblueonline.com/productdocumentation/ (Introduction, Authentication, Error Code,
 * Rates Limits; checked 2026-10). Contract auth kind: "requestTokenExchange".
 *  1. The user opens https://ant.aliceblueonline.com/?appcode=<App Code> and logs in on Alice Blue's own page.
 *  2. Alice Blue redirects to the app's registered URL with `authCode` and `userId`.
 *  3. This server sends POST /open-api/od/v1/vendor/getUserDetails { checkSum: SHA-256(userId + authCode + apiSecret) }
 *     and receives { stat: "Ok", clientId, userSession }. userSession authorises every later call.
 * The authCode is single-use, so the session is cached in memory (keyed by a hash of the credentials, never
 * logged or persisted) until the JWT's own `exp` (or the next IST midnight if it has none). When it expires or
 * Alice Blue rejects it (HTTP 401, "Session Expired" / EC087) the user must log in again and paste a fresh
 * authCode: SessionRequiredError. The legacy SHA-256 userId+apiKey handshake on ant.aliceblueonline.com/rest/
 * AliceBlueAPIService and its socket-session endpoints are not used any more.
 *
 * Header: the docs do not name the header; OpenAlgo (factual reference) and the V2 SDK send
 * `Authorization: Bearer <userSession>`, which is what this client does (flagged for live verification).
 * Rate limits: Order API 10/s; Data API 20/s; Quote API 5/s; non-trading APIs 30/s.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { nextIstMidnightMs } from "./sessionLogin.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";
import { jwtExpiryMs } from "../lib/jwt.mjs";

export const AB_HOST = "https://a3.aliceblueonline.com";
const SESSION_PATH = "/open-api/od/v1/vendor/getUserDetails";
export const LOGIN_PAGE = "https://ant.aliceblueonline.com/?appcode=";

// sha256(userId|authCode|apiSecret) -> { userSession, clientId, expiresAt }; bounded, expired entries dropped.
const sessionCache = createSessionCache();

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

function credKey(creds) {
  return sha256Hex(`${creds.userId}|${creds.authCode}|${creds.apiSecret}`);
}

function requireCreds(creds) {
  const userId = String(creds?.userId ?? "").trim().toUpperCase();
  const authCode = String(creds?.authCode ?? "").trim();
  const apiSecret = String(creds?.apiSecret ?? "").trim();
  if (!userId || !apiSecret) throw new BrokerInputError("Alice Blue: missing userId or apiSecret.");
  if (!authCode) throw new SessionRequiredError("Alice Blue: not logged in. Open the Alice Blue login link, then paste the authCode from the redirect URL.");
  return { userId, authCode, apiSecret };
}

/** The documented checksum. Exported for tests. */
export function checksumFor({ userId, authCode, apiSecret }) {
  return sha256Hex(`${userId}${authCode}${apiSecret}`);
}

/** Cached session, or one getUserDetails exchange. */
export async function getSession(creds) {
  const c = requireCreds(creds);
  const key = credKey(c);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  sessionCache.delete(key);

  const res = await brokerFetch(`${AB_HOST}${SESSION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ checkSum: checksumFor(c) }),
  });
  const json = await res.json().catch(() => null);
  if (json?.stat !== "Ok" || !json?.userSession) {
    // An authCode is single-use: a rejected exchange always means "log in again".
    throw new SessionRequiredError(`Alice Blue login failed (${String(json?.emsg || `HTTP ${res.status}`).slice(0, 120)}). Open the Alice Blue login link again and paste the new authCode.`);
  }
  const userSession = String(json.userSession);
  const exp = jwtExpiryMs(userSession);
  // Trust the token's own expiry (capped at a week); without one, assume the trading day.
  const expiresAt = exp && exp > Date.now() ? Math.min(exp, Date.now() + 7 * 86_400_000) : nextIstMidnightMs();
  const session = { userSession, clientId: String(json.clientId ?? c.userId), expiresAt };
  sessionCache.set(key, session);
  return session;
}

/** Test hook: forget cached sessions. */
export function clearSessions() {
  sessionCache.clear();
}

function isSessionFailure(status, json) {
  const text = `${json?.message ?? ""} ${json?.emsg ?? ""} ${json?.reason ?? ""}`.toLowerCase();
  return status === 401 || /ec087|session expired|invalid session|user does not login|not logged in/.test(text);
}

/**
 * One authenticated call. Success envelopes are { status: "Ok", result } (most APIs) or { stat: "Ok", result }
 * (chart history). Anything else throws: 422 SessionRequiredError for a dead session, 502 otherwise.
 */
export async function abRequest(creds, path, { method = "GET", body } = {}) {
  const session = await getSession(creds);
  const res = await brokerFetch(`${AB_HOST}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${session.userSession}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (isSessionFailure(res.status, json)) {
    sessionCache.delete(credKey(requireCreds(creds)));
    throw new SessionRequiredError("Alice Blue session expired. Open the Alice Blue login link again and paste the new authCode in Broker Settings.");
  }
  const okStatus = json && (json.status === "Ok" || json.stat === "Ok");
  if (res.status === 429) throw new BrokerError(`Alice Blue rate limit reached on ${path}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (!res.ok || !okStatus) {
    const msg = String(json?.message || json?.emsg || json?.reason || `HTTP ${res.status}`).slice(0, 200);
    throw new BrokerError(`Alice Blue API error on ${path}: ${msg}`);
  }
  return json;
}
