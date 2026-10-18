/**
 * Goodwill Wealth Management (Goodwill API v1) session and authenticated client.
 *
 * Official docs: https://developer.gwcindia.in/api/ (introduction, login, appendix) and the official Postman
 * collection linked from /api/appendix, checked 2026-10:
 *  - Login flow: the user opens https://api.gwcindia.in/v1/login?api_key=<api_key>, signs in on Goodwill's page
 *    and is sent to the registered redirect URL with `?request_token=...`.
 *  - POST https://api.gwcindia.in/v1/login-response { api_key, request_token, signature } where
 *    signature = SHA-256(api_key + request_token + api_secret)
 *    -> { status: "success", data: { clnt_id, name, email, exarr, prarr, orarr, exchDetail, usersessionid,
 *    access_token } }. Errors: { status: "error", error_msg ("Invalid API key or API key expired", "Invalid
 *    Signature", "Invalid Request Token"), error_type }.
 *  - Every REST call: https://api.gwcindia.in/v1/<api_name> with headers `x-api-key: <api_key>` and
 *    `Authorization: Bearer <access_token>`. Success { status: "success", data }, error { status: "error",
 *    error_msg, error_type }.
 *  - `usersessionid` is the `susertoken` for the WebSocket (goodwillFeed.mjs).
 * The docs give no token lifetime or rate limits. Goodwill runs a Noren backend, whose sessions are cleared
 * between 5 and 6 AM IST, so the token is cached until the next 05:00 IST; data calls are paced at about 8/s.
 *
 * Contract auth kind: requestTokenExchange. The user pastes the one-time request_token; the shared session
 * manager swaps it once and caches the token in memory under a hash of the inputs. A pasted `accessToken` skips
 * the exchange. No password or second factor reaches this app.
 */

import { BrokerError, SessionRequiredError, brokerFetch, normaliseError as baseNormalise, redactSecrets } from "./contract.mjs";
import { createSessionManager, nextIstFiveAmMs, sha256Hex } from "./shoonyaNorenCore.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";

export const BASE_URL = "https://api.gwcindia.in/v1";
export const LOGIN_URL = "https://api.gwcindia.in/v1/login";
const LABEL = "Goodwill";
const HINT = `Open ${LOGIN_URL}?api_key=YOUR_API_KEY, log in, and paste the new request_token from the redirect URL in Broker Settings (it works once).`;

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** Documented signature: SHA-256 of api_key + request_token + api_secret. */
export function signatureFor(apiKey, requestToken, apiSecret) {
  return sha256Hex(`${apiKey}${requestToken}${apiSecret}`);
}

export function secretsOf(creds, extra = []) {
  return [creds?.apiKey, creds?.apiSecret, creds?.requestToken, creds?.accessToken, creds?.userSessionId, ...extra].filter((s) => typeof s === "string" && s.length >= 4);
}

/** access_token -> { userSessionId, clientId } from the login response, for the WebSocket. Never persisted. */
const feedIds = createSessionCache({ maxEntries: 64 });

async function readJson(res) {
  const text = await res.text();
  try { return { json: text ? JSON.parse(text) : null, text }; } catch { return { json: undefined, text }; }
}

async function exchangeRequestToken(creds) {
  const apiKey = str(creds.apiKey);
  const requestToken = str(creds.requestToken);
  let res;
  try {
    res = await brokerFetch(`${BASE_URL}/login-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ api_key: apiKey, request_token: requestToken, signature: signatureFor(apiKey, requestToken, str(creds.apiSecret)) }),
    }, { kind: "login", label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} login: network error (${redactSecrets(e?.message || e, secretsOf(creds))})`);
  }
  const { json } = await readJson(res);
  const data = json?.data ?? {};
  if (res.ok && str(json?.status).toLowerCase() === "success" && str(data.access_token)) {
    const expiresAt = nextIstFiveAmMs();
    feedIds.set(str(data.access_token), { userSessionId: str(data.usersessionid), clientId: str(data.clnt_id ?? data.client_id), expiresAt });
    return { token: str(data.access_token), expiresAt };
  }
  if (res.status >= 500 || res.status === 429) throw new BrokerError(`${LABEL} login: HTTP ${res.status}. Please try again in a moment.`);
  const why = redactSecrets(str(json?.error_msg) || `HTTP ${res.status}`, secretsOf(creds));
  throw new SessionRequiredError(`${LABEL} did not accept the request token (${why}). ${HINT}`);
}

export const session = createSessionManager({
  label: LABEL,
  keyFields: ["apiKey", "apiSecret", "requestToken"],
  exchange: exchangeRequestToken,
});

/** WebSocket ids for a session: from the login response, else the pasted userSessionId / clientId fields. */
export function feedIdsFor(token, creds = {}) {
  const hit = feedIds.get(token);
  return { userSessionId: hit?.userSessionId || str(creds.userSessionId), clientId: hit?.clientId || str(creds.clientId) };
}

// ── pacing (no documented limit; stay well under the Noren-family norms) ──
const MIN_GAP_MS = 120;
let nextFree = 0;
let pacingOn = true;

async function pace() {
  if (!pacingOn) return;
  const now = Date.now();
  const at = Math.max(now, nextFree);
  nextFree = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const SESSION_DEAD = /invalid (session|access ?token|token)|session (expired|invalid)|token (is )?expired|unauthori[sz]ed|not logged in|login required/i;
const RATE_LIMIT = /rate limit|too many/i;
const EMPTY = /no data|no record|not found|no (orders?|trades?|positions?|holdings?)/i;

/**
 * Authenticated request. Returns `data` from the envelope ([] for a documented "no data" style error when
 * `list` is set). Throws SessionRequiredError when the session is rejected (and drops it), BrokerError otherwise.
 */
export async function gwRequest(creds, apiName, { method = "GET", body, list = false } = {}) {
  const apiKey = str(creds?.apiKey);
  if (!apiKey) throw new SessionRequiredError(`${LABEL}: the API key is missing. Add it in Broker Settings.`);
  const handle = await session.ensure(creds);
  await pace();
  const secrets = secretsOf(creds, [handle.token]);
  let res;
  try {
    res = await brokerFetch(`${BASE_URL}/${apiName}`, {
      method,
      headers: { Accept: "application/json", "x-api-key": apiKey, Authorization: `Bearer ${handle.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, { label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} ${apiName}: network error (${redactSecrets(e?.message || e, secrets)})`);
  }
  const { json, text } = await readJson(res);
  const msg = redactSecrets(str(json?.error_msg) || str(text).slice(0, 160) || `HTTP ${res.status}`, secrets);
  if (res.status === 401 || res.status === 403 || (str(json?.status).toLowerCase() === "error" && SESSION_DEAD.test(msg))) {
    session.invalidate(handle);
    throw new SessionRequiredError(`${LABEL} rejected the session (${msg}). ${HINT}`);
  }
  if (res.status === 429 || RATE_LIMIT.test(msg)) throw new BrokerError(`${LABEL} rate limit on ${apiName}: ${msg}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (json === undefined || json === null) throw new BrokerError(`${LABEL} ${apiName}: non-JSON response (HTTP ${res.status})`);
  if (!res.ok || str(json.status).toLowerCase() !== "success") {
    if (list && EMPTY.test(msg)) return [];
    throw new BrokerError(`${LABEL} API error on ${apiName}: ${msg}`);
  }
  if (list) return Array.isArray(json.data) ? json.data : [];
  return json.data ?? {};
}

export function normaliseError(err, { secrets = [] } = {}) {
  const out = baseNormalise(err, { secrets });
  if (out.code === "UPSTREAM_ERROR" && /\b429\b|too many requests|rate limit/i.test(out.message)) out.code = "UPSTREAM_RATE_LIMIT";
  return out;
}

/** Test helpers: forget sessions, feed ids and pacing; pacing can be switched off so fixture tests run fast. */
export function __resetGoodwill({ pacing = true } = {}) {
  session.reset();
  feedIds.clear();
  nextFree = 0;
  pacingOn = pacing;
}
