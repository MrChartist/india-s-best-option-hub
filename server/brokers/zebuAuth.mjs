/**
 * Zebu (MYNT) OAuth session + the authenticated Noren request helper.
 *
 * Official docs (https://zebumyntapi.web.app/OAuth/Authentication/, checked 2026-10):
 *  1. The user opens https://go.mynt.in/OAuthlogin/authorize/oauth?client_id=<Client ID>, logs in, and is
 *     redirected to the app's registered URL with ?code=<authorisation code>.
 *  2. POST https://go.mynt.in/NorenWClientAPI/GenAcsTok, body `jData={"code","checksum"}` (text/plain),
 *     checksum = SHA-256(client_id + secret_key + code) -> { stat: "Ok", access_token, refresh_token,
 *     expires_in (seconds, "3600" in the sample) }.
 *  3. POST .../RefreshToken `jData={"refresh_token"}` -> { stat, access_token, expires_in } renews the
 *     access token without a new login.
 *  4. Every API call: POST https://go.mynt.in/NorenWClientAPI/<Endpoint>, `Authorization: Bearer
 *     <access_token>`, body `jData=<json>` with uid (and actid where documented).
 * Failures are HTTP 200 { stat: "Not_Ok", emsg }; "Session Expired : Invalid Session Key" means the token is
 * dead. Rate limit: 10 requests/second per user (observed figure; Zebu's OAuth pages do not state one:
 * needs live verification).
 *
 * The code is single-use. This module exchanges it once per credential set, keeps the access and refresh
 * tokens in process memory only (keyed by a hash of the credentials, never logged), refreshes before
 * expiry, and de-duplicates concurrent exchanges so parallel chain requests cannot burn the code twice
 * (the earlier version could fire one exchange per parallel quote). When the code is spent and no refresh
 * is possible, calls throw SessionRequiredError asking for a fresh code.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { createSessionCache } from "../lib/boundedCache.mjs";

export const HOST = "https://go.mynt.in";
export const API_BASE = `${HOST}/NorenWClientAPI`;
export const OAUTH_LOGIN_URL = `${HOST}/OAuthlogin/authorize/oauth`;
const REQUIRED = ["userId", "clientId", "apiSecret", "authCode"];
const EXPIRY_MARGIN_MS = 60_000;
const FALLBACK_TTL_MS = 60 * 60 * 1000; // the documented sample's expires_in is 3600 s

const LOGIN_HELP = "Open go.mynt.in/OAuthlogin/authorize/oauth?client_id=<your Client ID>, log in, and paste the new ?code= value into Broker Settings.";

// credential hash -> { accessToken, refreshToken, expiresAt } | { dead: true }. Size-bounded only: an expired entry
// still holds the refresh token, so it must not be dropped on expiry.
const sessions = createSessionCache({ expiryOf: () => null });
const inflight = new Map(); // credential hash -> Promise<session>

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** jData value. "&" is sent as the JSON escape & so symbols like M&M-EQ cannot cut the form body. */
export function encodeJData(data) {
  return JSON.stringify(data).replace(/&/g, "\\u0026");
}

const credKey = (creds) => sha256Hex(REQUIRED.map((k) => String(creds?.[k] ?? "")).join("\u0000"));

function requireCreds(creds) {
  const missing = REQUIRED.filter((k) => !String(creds?.[k] ?? "").trim());
  if (missing.length) throw new BrokerInputError(`Zebu: missing ${missing.join(", ")}.`);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function postForm(path, data, headers = {}) {
  const res = await brokerFetch(`${API_BASE}${path}`, { method: "POST", headers: { "Content-Type": "text/plain", ...headers }, body: `jData=${encodeJData(data)}` });
  const text = await res.text();
  return { status: res.status, json: parseJson(text), text };
}

function toSession(json, refreshToken) {
  const ttlSec = Number(json.expires_in);
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1000 : FALLBACK_TTL_MS;
  return { accessToken: String(json.access_token), refreshToken: json.refresh_token ? String(json.refresh_token) : refreshToken || null, expiresAt: Date.now() + Math.max(ttl - EXPIRY_MARGIN_MS, 30_000) };
}

async function exchangeCode(creds) {
  const checksum = sha256Hex(`${creds.clientId}${creds.apiSecret}${creds.authCode}`);
  const r = await postForm("/GenAcsTok", { code: String(creds.authCode), checksum });
  if (r.json?.stat !== "Ok" || !r.json?.access_token) {
    const why = String(r.json?.emsg || `HTTP ${r.status}`).slice(0, 120);
    throw new SessionRequiredError(`Zebu could not exchange the authorisation code (${why}). Codes are single-use and short-lived. ${LOGIN_HELP}`);
  }
  return toSession(r.json);
}

async function refresh(session) {
  const r = await postForm("/RefreshToken", { refresh_token: session.refreshToken });
  if (r.json?.stat !== "Ok" || !r.json?.access_token) {
    throw new SessionRequiredError(`Zebu could not renew the session (${String(r.json?.emsg || `HTTP ${r.status}`).slice(0, 120)}). ${LOGIN_HELP}`);
  }
  return toSession(r.json, session.refreshToken);
}

async function obtain(key, creds, { forceRefresh = false } = {}) {
  const cached = sessions.get(key);
  if (cached?.dead) throw new SessionRequiredError(`Zebu session has ended. ${LOGIN_HELP}`);
  if (cached && !forceRefresh && Date.now() < cached.expiresAt) return cached;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      let next;
      if (cached?.refreshToken) next = await refresh(cached);
      else if (cached) throw new SessionRequiredError(`Zebu session expired. ${LOGIN_HELP}`);
      else next = await exchangeCode(creds);
      sessions.set(key, next);
      return next;
    } catch (e) {
      // The code is single-use: remember that this credential set is spent instead of re-trying the
      // exchange on every request. Pasting a new code creates a new credential set.
      if (e instanceof SessionRequiredError) sessions.set(key, { dead: true });
      else sessions.delete(key);
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** A valid access token for these credentials (exchanging the code or refreshing as needed). */
export async function ensureSession(creds) {
  requireCreds(creds);
  return obtain(credKey(creds), creds);
}

/** Forget every cached session (tests). */
export function resetSessions() {
  sessions.clear();
  inflight.clear();
}

const isSessionMessage = (emsg) => /session expired|invalid session|invalid access token|token expired|unauthori[sz]ed/i.test(String(emsg ?? ""));

/**
 * POST jData to a NorenWClientAPI endpoint with the Bearer token. `uid` (and `actid` unless the endpoint
 * is given `{ actid: false }`) are filled from creds.userId. Returns the parsed JSON (bare arrays as-is,
 * Not_Ok objects included so callers can read "no data"); throws on session, rate-limit and HTTP failures.
 */
export async function postJData(creds, endpoint, payload = {}, { actid = true } = {}) {
  requireCreds(creds);
  const key = credKey(creds);
  const data = { uid: String(creds.userId), ...(actid ? { actid: String(creds.userId) } : {}), ...payload };
  const send = (session) => postForm(endpoint, data, { Authorization: `Bearer ${session.accessToken}` });
  let session = await obtain(key, creds);
  let r = await send(session);
  const sessionDead = (x) => x.status === 401 || (x.json && !Array.isArray(x.json) && x.json.stat === "Not_Ok" && isSessionMessage(x.json.emsg));
  if (sessionDead(r) && session.refreshToken) {
    session = await obtain(key, creds, { forceRefresh: true });
    r = await send(session);
  }
  if (sessionDead(r)) {
    sessions.set(key, { dead: true });
    throw new SessionRequiredError(`Zebu rejected the session. ${LOGIN_HELP}`);
  }
  if (r.status === 429 || /rate limit|too many/i.test(String(r.json?.emsg ?? ""))) throw new BrokerError(`Zebu rate limit hit on ${endpoint}.`, { code: "UPSTREAM_RATE_LIMIT" });
  if (r.json === null) throw new BrokerError(`Zebu ${endpoint} returned a non-JSON reply (HTTP ${r.status}).`);
  if (r.status < 200 || r.status >= 300) throw new BrokerError(`Zebu ${endpoint} failed (HTTP ${r.status}): ${String(r.json?.emsg ?? "").slice(0, 160)}`);
  return r.json;
}

/** True for Noren's "no data" reply (empty books). */
export const isNoData = (json) => json && !Array.isArray(json) && json.stat === "Not_Ok" && /no data/i.test(String(json.emsg ?? ""));

/** Throw a BrokerError for a Not_Ok reply; return the JSON otherwise. */
export function expectOk(json, what) {
  if (json && !Array.isArray(json) && json.stat === "Not_Ok") throw new BrokerError(`Zebu ${what} failed: ${String(json.emsg || "unknown error").slice(0, 160)}`);
  return json;
}
