/**
 * Rupeezy (Vortex API, Astha Credit & Securities) session and paced, authenticated client.
 *
 * Official docs: https://vortex.rupeezy.in/docs/latest/ (authentication, usage), checked 2026-10:
 *  - Login: the user opens https://flow.rupeezy.in?applicationId=<application_id>, signs in on Rupeezy's own page
 *    and gives consent; the registered callback URL receives `?auth=<token>`. Only users whitelisted on the app
 *    can sign in.
 *  - POST https://vortex-api.rupeezy.in/v2/user/session with header `x-api-key` and JSON
 *    { checksum: SHA-256(application_id + auth + x-api-key), applicationId, token: auth }
 *    -> { status: "success", data: { access_token, user_name, user_id, exchanges, ... } }. 1 request/s.
 *  - Every other call sends `x-api-key` and `Authorization: Bearer <access_token>`.
 *  - HTTP 401: wrong x-api-key / Authorization (or endpoint not allowed); 429: rate limit for that endpoint.
 *    Error bodies: { status: "error", code: "e-103", message }.
 *  - Rate limits are per endpoint (1/s for session, funds, quotes, history, option chain; 10/s for orders,
 *    positions, holdings, trades) with a hard cap of 50,000 requests a day.
 *  - The legacy password + TOTP login (POST /user/login) is marked "deprecating soon"; it is not used here, so
 *    no password or TOTP ever reaches this app.
 * The docs do not state how long an access token lives. It is cached until the next 05:00 IST (the usual daily
 * reset for Indian broker sessions) and dropped at once when Rupeezy answers 401.
 *
 * Contract auth kind: requestTokenExchange. The user pastes the day's `auth` value; the session manager swaps it
 * once (it is single use) and caches the access token in memory under a hash of the inputs. A pasted
 * `accessToken` skips the exchange.
 */

import { BrokerError, SessionRequiredError, brokerFetch, normaliseError as baseNormalise, redactSecrets } from "./contract.mjs";
import { createSessionManager, nextIstFiveAmMs, sha256Hex } from "./shoonyaNorenCore.mjs";

export const BASE_URL = "https://vortex-api.rupeezy.in/v2";
export const LOGIN_URL = "https://flow.rupeezy.in";
const LABEL = "Rupeezy";

/** Documented checksum: SHA-256 of application_id + auth + x-api-key, concatenated in that order. */
export function checksumFor(applicationId, authToken, apiKey) {
  return sha256Hex(`${applicationId}${authToken}${apiKey}`);
}

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());
const HINT = `Open ${LOGIN_URL}?applicationId=YOUR_APPLICATION_ID, log in, and paste the new "auth" value from the callback URL in Broker Settings (it works once).`;

export function secretsOf(creds, extra = []) {
  return [creds?.apiKey, creds?.authToken, creds?.accessToken, ...extra].filter((s) => typeof s === "string" && s.length >= 4);
}

// ── pacing: one queue per documented limit, a little under each cap ──
const MIN_GAP_MS = { slow: 1050, fast: 110 };
const nextFree = new Map();
let pacingOn = true;

async function pace(bucket) {
  if (!pacingOn) return;
  const gap = MIN_GAP_MS[bucket] ?? MIN_GAP_MS.slow;
  const now = Date.now();
  const at = Math.max(now, nextFree.get(bucket) ?? 0);
  nextFree.set(bucket, at + gap);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** 10/s endpoints: orders, order history, positions, holdings, trades. Everything else is 1/s. */
function bucketOf(path) {
  return path.startsWith("/trading/") ? `fast:${path.split("/")[2]}` : `slow:${path.split("?")[0]}`;
}

async function readJson(res) {
  const text = await res.text();
  try { return { json: text ? JSON.parse(text) : null, text }; } catch { return { json: undefined, text }; }
}

async function exchangeAuthToken(creds) {
  const applicationId = str(creds.applicationId);
  const authToken = str(creds.authToken);
  const apiKey = str(creds.apiKey);
  await pace("slow:/user/session");
  let res;
  try {
    res = await brokerFetch(`${BASE_URL}/user/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ checksum: checksumFor(applicationId, authToken, apiKey), applicationId, token: authToken }),
    }, { kind: "login", label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} login: network error (${redactSecrets(e?.message || e, secretsOf(creds))})`);
  }
  const { json } = await readJson(res);
  const token = json?.data?.access_token;
  if (res.ok && str(json?.status).toLowerCase() === "success" && typeof token === "string" && token) {
    return { token, expiresAt: nextIstFiveAmMs() };
  }
  if (res.status >= 500 || res.status === 429) throw new BrokerError(`${LABEL} login: HTTP ${res.status}. Please try again in a moment.`);
  const why = redactSecrets(str(json?.message) || `HTTP ${res.status}`, secretsOf(creds));
  throw new SessionRequiredError(`${LABEL} did not accept the auth code (${why}). ${HINT}`);
}

export const session = createSessionManager({
  label: LABEL,
  keyFields: ["applicationId", "apiKey", "authToken"],
  exchange: exchangeAuthToken,
});

/** The access token: a pasted one, else the cached or freshly exchanged one. */
export async function accessTokenFor(creds = {}) {
  if (!str(creds.apiKey)) throw new SessionRequiredError(`${LABEL}: the API key (x-api-key) is missing. Add it in Broker Settings.`);
  return (await session.ensure(creds)).token;
}

const RATE_LIMIT = /rate limit|too many/i;

/**
 * Authenticated request. Returns the parsed JSON body. Throws SessionRequiredError on 401 (and drops the cached
 * session), BrokerError UPSTREAM_RATE_LIMIT on 429, BrokerError on any other failure.
 */
export async function vortexRequest(creds, path, { method = "GET", body } = {}) {
  const apiKey = str(creds?.apiKey);
  if (!apiKey) throw new SessionRequiredError(`${LABEL}: the API key (x-api-key) is missing. Add it in Broker Settings.`);
  const handle = await session.ensure(creds);
  await pace(bucketOf(path));
  const secrets = secretsOf(creds, [handle.token]);
  let res;
  try {
    res = await brokerFetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json", "x-api-key": apiKey, Authorization: `Bearer ${handle.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, { label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} ${path.split("?")[0]}: network error (${redactSecrets(e?.message || e, secrets)})`);
  }
  const { json, text } = await readJson(res);
  const msg = redactSecrets(str(json?.message) || str(text).slice(0, 160) || `HTTP ${res.status}`, secrets);
  if (res.status === 401) {
    session.invalidate(handle);
    throw new SessionRequiredError(`${LABEL} rejected the session (${msg}). ${HINT}`);
  }
  if (res.status === 429 || RATE_LIMIT.test(msg)) throw new BrokerError(`${LABEL} rate limit on ${path.split("?")[0]}: ${msg}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (json === undefined) throw new BrokerError(`${LABEL} ${path.split("?")[0]}: non-JSON response (HTTP ${res.status})`);
  if (!res.ok || str(json?.status).toLowerCase() === "error") {
    const code = str(json?.code);
    throw new BrokerError(`${LABEL} API error${code ? ` ${code}` : ""} on ${path.split("?")[0]}: ${msg}`);
  }
  return json ?? {};
}

export function normaliseError(err, { secrets = [] } = {}) {
  const out = baseNormalise(err, { secrets });
  if (out.code === "UPSTREAM_ERROR" && /\b429\b|too many requests|rate limit/i.test(out.message)) out.code = "UPSTREAM_RATE_LIMIT";
  return out;
}

/** Test helpers: forget sessions and pacing state; pacing can be switched off so fixture tests run fast. */
export function __resetRupeezy({ pacing = true } = {}) {
  session.reset();
  nextFree.clear();
  pacingOn = pacing;
}
