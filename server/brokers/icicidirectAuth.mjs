/**
 * ICICI Direct (Breeze API) session and signed, paced client.
 *
 * Official docs: https://api.icicidirect.com/breezeapi/documents/index.html (Introduction, Regulatory Changes,
 * Checksum Computation & Login, Request Headers, Errors, CustomerDetails), checked 2026-10:
 *  - Register an app on the Breeze portal to get an AppKey and secret_key. The user logs in at
 *    https://api.icicidirect.com/apiuser/login?api_key=<URL-encoded AppKey> and gets an API_Session value.
 *  - GET /breezeapi/api/v1/customerdetails with JSON body { SessionToken: <API_Session>, AppKey } (no auth headers)
 *    -> { Success: { idirect_userid, session_token, idirect_user_name, ... }, Status: 200, Error: null }.
 *  - Every other call sends X-AppKey, X-SessionToken (the session_token above), X-Timestamp (ISO-8601 UTC with
 *    ".000Z"; honoured only within 60 s of server time) and X-Checksum = "token " + SHA-256(timestamp + JSON body
 *    + secret_key). The body is the exact JSON string sent ("{}" when there are no parameters).
 *  - Envelope { Success, Status, Error }. 100 calls a minute and 5000 a day. Orders only from the static IP
 *    registered with ICICI Direct, at most 10 a second, and no market orders.
 *  - Securities listed on BSE and MCX are not available on Breeze API (NSE cash and NSE F&O only).
 * The docs do not state a session lifetime; the login is daily, so the session is cached until the next IST
 * midnight and dropped at once on 401 or a session error.
 *
 * Contract auth kind: requestTokenExchange. The user pastes the day's API_Session; the shared session manager swaps
 * it once and caches the session_token in memory under a hash of the inputs. A pasted session token
 * (`accessToken`) skips the exchange. No password or OTP reaches this app.
 */

import { BrokerError, SessionRequiredError, brokerFetch, normaliseError as baseNormalise, redactSecrets } from "./contract.mjs";
import { createSessionManager, sha256Hex } from "./shoonyaNorenCore.mjs";
import { getWithBody } from "./icicidirectHttp.mjs";

export const BASE_URL = "https://api.icicidirect.com/breezeapi/api/v1";
export const LOGIN_URL = "https://api.icicidirect.com/apiuser/login";
const LABEL = "ICICI Direct";
const HINT = `Open ${LOGIN_URL}?api_key=YOUR_APP_KEY (URL-encoded), log in, and paste the new API_Session value in Broker Settings (it works for today only).`;

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** "2026-10-19T04:12:33.000Z": ISO-8601 UTC with the milliseconds zeroed, as the docs require. */
export function breezeTimestamp(now = Date.now()) {
  return `${new Date(now).toISOString().slice(0, 19)}.000Z`;
}

/** Documented checksum: SHA-256(timestamp + JSON body + secret_key), sent as "token <hex>". */
export function checksumFor(timestamp, bodyJson, secretKey) {
  return sha256Hex(`${timestamp}${bodyJson}${secretKey}`);
}

export function secretsOf(creds, extra = []) {
  return [creds?.secretKey, creds?.apiSession, creds?.accessToken, creds?.appKey, ...extra].filter((s) => typeof s === "string" && s.length >= 4);
}

/** Epoch ms of the next IST midnight after `now`. */
export function nextIstMidnightMs(now = Date.now()) {
  const IST = 5.5 * 3600_000;
  const d = new Date(now + IST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - IST;
}

async function readJson(res) {
  const text = await res.text();
  try { return { json: text ? JSON.parse(text) : null, text }; } catch { return { json: undefined, text }; }
}

async function exchangeApiSession(creds) {
  const body = JSON.stringify({ SessionToken: str(creds.apiSession), AppKey: str(creds.appKey) });
  const res = await getWithBody(`${BASE_URL}/customerdetails`, { headers: { "Content-Type": "application/json" }, body, kind: "login" });
  const { json } = await readJson(res);
  const token = json?.Success?.session_token;
  if (res.ok && Number(json?.Status) === 200 && typeof token === "string" && token) {
    return { token, expiresAt: nextIstMidnightMs() };
  }
  if (res.status >= 500 || res.status === 429) throw new BrokerError(`${LABEL} login: HTTP ${res.status}. Please try again in a moment.`);
  const why = redactSecrets(str(json?.Error) || `HTTP ${res.status}`, secretsOf(creds));
  throw new SessionRequiredError(`${LABEL} did not accept the API_Session (${why}). ${HINT}`);
}

export const session = createSessionManager({
  label: LABEL,
  keyFields: ["appKey", "secretKey", "apiSession"],
  exchange: exchangeApiSession,
});

// ── pacing: 100 calls a minute ──
const MIN_GAP_MS = 620;
let nextFree = 0;
let pacingOn = true;

async function pace() {
  if (!pacingOn) return;
  const now = Date.now();
  const at = Math.max(now, nextFree);
  nextFree = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const SESSION_DEAD = /session|unauthori[sz]ed|invalid (user|token|app ?key)|not logged|login/i;
const RATE_LIMIT = /rate limit|too many|limit exceeded/i;
const EMPTY = /no data|no record|not found|no (order|trade|position|holding)/i;

function credsOk(creds) {
  if (!str(creds?.appKey) || !str(creds?.secretKey)) throw new SessionRequiredError(`${LABEL}: the AppKey and secret key are both needed. Add them in Broker Settings.`);
}

/**
 * Signed request to /breezeapi/api/v1/<path>. Returns `Success` ([] for a documented "no data" style error when
 * `list` is set). Throws SessionRequiredError when the session is rejected (and drops it), BrokerError otherwise.
 */
export async function breezeRequest(creds, path, { method = "GET", params = {}, list = false } = {}) {
  credsOk(creds);
  const handle = await session.ensure(creds);
  await pace();
  const body = JSON.stringify(params ?? {});
  const timestamp = breezeTimestamp();
  const headers = {
    "Content-Type": "application/json",
    "X-Checksum": `token ${checksumFor(timestamp, body, str(creds.secretKey))}`,
    "X-Timestamp": timestamp,
    "X-AppKey": str(creds.appKey),
    "X-SessionToken": handle.token,
  };
  const secrets = secretsOf(creds, [handle.token]);
  let res;
  try {
    res = method === "GET"
      ? await getWithBody(`${BASE_URL}/${path}`, { headers, body })
      : await brokerFetch(`${BASE_URL}/${path}`, { method, headers, body }, { label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} ${path}: network error (${redactSecrets(e?.message || e, secrets)})`);
  }
  return readEnvelope(res, { path, handle, secrets, list });
}

/** Breeze v2 historical charts: query-string GET with `apikey` + `X-SessionToken` headers (no checksum). */
export async function breezeV2Get(creds, url) {
  credsOk(creds);
  const handle = await session.ensure(creds);
  await pace();
  const secrets = secretsOf(creds, [handle.token]);
  let res;
  try {
    res = await brokerFetch(url, { headers: { "Content-Type": "application/json", apikey: str(creds.appKey), "X-SessionToken": handle.token } }, { label: LABEL });
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError(`${LABEL} historical: network error (${redactSecrets(e?.message || e, secrets)})`);
  }
  return readEnvelope(res, { path: "historicalcharts", handle, secrets, list: true });
}

async function readEnvelope(res, { path, handle, secrets, list }) {
  const { json, text } = await readJson(res);
  const msg = redactSecrets(str(json?.Error) || str(text).slice(0, 160) || `HTTP ${res.status}`, secrets);
  if (res.status === 401 || res.status === 403) {
    session.invalidate(handle);
    throw new SessionRequiredError(`${LABEL} rejected the session (${msg}). ${HINT}`);
  }
  if (res.status === 429 || RATE_LIMIT.test(msg)) throw new BrokerError(`${LABEL} rate limit on ${path}: ${msg}`, { code: "UPSTREAM_RATE_LIMIT" });
  if (json === undefined || json === null) throw new BrokerError(`${LABEL} ${path}: non-JSON response (HTTP ${res.status})`);
  const failed = !res.ok || (json.Status !== undefined && Number(json.Status) !== 200) || (json.Error !== null && json.Error !== undefined && str(json.Error) !== "");
  if (failed) {
    if (list && EMPTY.test(msg)) return [];
    if (SESSION_DEAD.test(msg)) {
      session.invalidate(handle);
      throw new SessionRequiredError(`${LABEL} rejected the session (${msg}). ${HINT}`);
    }
    throw new BrokerError(`${LABEL} API error on ${path}: ${msg}`);
  }
  if (list) return Array.isArray(json.Success) ? json.Success : [];
  return json.Success ?? {};
}

export function normaliseError(err, { secrets = [] } = {}) {
  const out = baseNormalise(err, { secrets });
  if (out.code === "UPSTREAM_ERROR" && /\b429\b|too many requests|rate limit/i.test(out.message)) out.code = "UPSTREAM_RATE_LIMIT";
  return out;
}

/** Test helpers: forget sessions and pacing; pacing can be switched off so fixture tests run fast. */
export function __resetIciciDirect({ pacing = true } = {}) {
  session.reset();
  nextFree = 0;
  pacingOn = pacing;
}
