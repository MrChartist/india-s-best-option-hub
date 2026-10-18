/**
 * Kotak Securities (Neo Trade API v2) session login and authenticated request helpers.
 *
 * Official source: Kotak's own SDK + docs, https://github.com/Kotak-Neo/Kotak-neo-api-v2
 * (docs/Totp_login.md, docs/Totp_validate.md, neo_api_client/settings.py, api/totp_api.py, rest.py; checked 2026-10).
 *
 *   1. POST https://mis.kotaksecurities.com/login/1.0/tradeApiLogin
 *      headers { Authorization: <app access token>, neo-fin-key: "neotradeapi" }, JSON { mobileNumber, ucc, totp }
 *      -> data { token (View), sid }
 *   2. POST https://mis.kotaksecurities.com/login/1.0/tradeApiValidate
 *      headers { Authorization, neo-fin-key, sid, Auth: <view token> }, JSON { mpin }
 *      -> data { token (Trade), sid, hsServerId, baseUrl, dataCenter, kType: "Trade", status: "success" }
 *   Trade calls then go to <baseUrl>/<path>?sId=<hsServerId> with headers { Sid, Auth } and, for POSTs, a
 *   form body `jData=<JSON>` (rest.py). Market data (quotes, scrip-master paths) use only `Authorization:
 *   <app access token>` (docs/Quotes.md: "can be accessed by access token without completing login").
 *   HTTP 403 = "Invalid session, please re-login to continue"; 429 = too many requests (every docs/*.md).
 *
 * login() returns only { sessionToken (trade token), sessionSid, sessionBaseUrl, sessionServerId? }. The MPIN and
 * code are never stored, cached or logged. `baseUrl` comes from Kotak but is later sent back by the browser, so the
 * proxy remembers the login-returned value server-side (keyed by a SHA-256 of the trade token) and uses that,
 * ignoring whatever the browser sends. Only when the proxy has no record (for example after a restart) does it fall
 * back to the browser's copy, and then only for an https host that is a single label directly under
 * kotaksecurities.com (not the apex or www), on the default port, with no credentials, query or fragment. Kotak's
 * SDK takes baseUrl from the validate response and does not publish a fixed host list, so an exact allowlist is not
 * possible. Kotak publishes no session TTL; we treat a session as valid until 23:59 IST and rely on the 403 signal
 * before that.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, BrokerInputError, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields as requireCreds, sessionFromCreds } from "./sessionLogin.mjs";

const LOGIN_BASE = "https://mis.kotaksecurities.com";
const LOGIN_PATH = "/login/1.0/tradeApiLogin";
const VALIDATE_PATH = "/login/1.0/tradeApiValidate";
export const NEO_FIN_KEY = "neotradeapi";
/** Order source tag the official SDK sends with every order call (settings.ORDER_SOURCE). */
export const ORDER_SOURCE = "NEOTRADEAPI";

/** Stored (non-secret) fields. */
const REQUIRED_FIELDS = ["accessToken", "mobileNumber", "ucc"];

export const LOGIN_FIELDS = [
  { key: "mpin", label: "MPIN", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken", "sessionSid", "sessionBaseUrl", "sessionServerId"];

const KOTAK_HOST_RE = /(^|\.)kotaksecurities\.com$/i;
// Session API hosts: exactly one label under kotaksecurities.com (gw-napi, mis, cis, e21 ...), never nested.
const KOTAK_SESSION_HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kotaksecurities\.com$/i;
const NON_API_LABELS = new Set(["www"]);

/** Kotak's per-session API base: https on a single-label kotaksecurities.com host. Returns the base or null. */
export function safeKotakBaseUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
    if (!KOTAK_SESSION_HOST_RE.test(u.hostname) || NON_API_LABELS.has(u.hostname.split(".")[0].toLowerCase())) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

// Login-returned baseUrl per session, so the browser cannot redirect where the trade token is sent.
const MAX_BOUND_SESSIONS = 500;
const boundBaseUrls = new Map(); // sha256(tradeToken) -> { baseUrl, expiresAt }
const tokenKey = (token) => createHash("sha256").update(String(token)).digest("hex");

function bindBaseUrl(token, baseUrl, expiresAt) {
  const now = Date.now();
  for (const [k, v] of boundBaseUrls) if (v.expiresAt <= now) boundBaseUrls.delete(k);
  while (boundBaseUrls.size >= MAX_BOUND_SESSIONS) boundBaseUrls.delete(boundBaseUrls.keys().next().value);
  boundBaseUrls.set(tokenKey(token), { baseUrl, expiresAt });
}

/** The baseUrl Kotak returned at login for this trade token, or null when this proxy has no record. */
export function boundKotakBaseUrl(token) {
  const rec = boundBaseUrls.get(tokenKey(token));
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) {
    boundBaseUrls.delete(tokenKey(token));
    return null;
  }
  return rec.baseUrl;
}

/** Any Kotak-returned download URL (scrip-master CSVs): https on a kotaksecurities.com host, or null. */
export function safeKotakFileUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:" || !KOTAK_HOST_RE.test(u.hostname) || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Kotak expects "+91XXXXXXXXXX" regardless of how the user typed it. */
function normalizeMobile(raw) {
  const n = String(raw).trim().replace(/\s+/g, "").replace(/^\+?91/, "");
  return `+91${n}`;
}

function istEndOfDay(now = new Date()) {
  const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${istDate}T23:59:00+05:30`).getTime();
}

async function readBody(res) {
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { json, text };
}

async function postLogin(path, headers, body) {
  const res = await brokerFetch(`${LOGIN_BASE}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { res, ...(await readBody(res)) };
}

/** One TOTP + MPIN login with the user-typed values. Returns only the session fields. */
export async function login(creds) {
  requireCreds(creds, [...REQUIRED_FIELDS, "mpin"], "Kotak Neo");
  const totp = readTotpCode(creds);
  const mobileNumber = normalizeMobile(creds.mobileNumber);

  const step1 = await postLogin(LOGIN_PATH, { Authorization: creds.accessToken, "neo-fin-key": NEO_FIN_KEY }, { mobileNumber, ucc: creds.ucc, totp });
  const view = step1.json?.data;
  if (!step1.res.ok || view?.status !== "success" || !view?.token || !view?.sid) {
    const msg = step1.json?.errMsg || step1.json?.emsg || step1.json?.message || `HTTP ${step1.res.status}`;
    throw new BrokerError(`Kotak Neo TOTP login failed: ${msg}`, { code: "UPSTREAM_AUTH" });
  }

  const step2 = await postLogin(
    VALIDATE_PATH,
    { Authorization: creds.accessToken, "neo-fin-key": NEO_FIN_KEY, sid: view.sid, Auth: view.token },
    { mpin: creds.mpin }
  );
  const trade = step2.json?.data;
  if (!step2.res.ok || trade?.status !== "success" || !trade?.token || !trade?.sid) {
    const msg = step2.json?.errMsg || step2.json?.emsg || step2.json?.message || `HTTP ${step2.res.status}`;
    throw new BrokerError(`Kotak Neo MPIN validation failed: ${msg}`, { code: "UPSTREAM_AUTH" });
  }
  const baseUrl = safeKotakBaseUrl(trade.baseUrl);
  if (!baseUrl) throw new BrokerError("Kotak Neo login succeeded but returned no usable baseUrl.");
  const session = { sessionToken: String(trade.token), sessionSid: String(trade.sid), sessionBaseUrl: baseUrl };
  if (trade.hsServerId) session.sessionServerId = String(trade.hsServerId);
  const expiresAt = istEndOfDay();
  bindBaseUrl(session.sessionToken, baseUrl, expiresAt);
  return { session, expiresAt };
}

/** The stored session. Throws SessionRequiredError when absent/expired, BrokerInputError on a foreign baseUrl. */
export function getSession(creds) {
  requireCreds(creds, REQUIRED_FIELDS, "Kotak Neo");
  const s = sessionFromCreds(creds, SESSION_FIELDS, "Kotak Neo");
  // Prefer the login-time value this proxy recorded; the browser's copy is a fallback only.
  const baseUrl = boundKotakBaseUrl(s.sessionToken) ?? safeKotakBaseUrl(s.sessionBaseUrl);
  if (!baseUrl) throw new BrokerInputError("Kotak Neo session has an invalid baseUrl. Log in again from Broker Settings.");
  return {
    baseUrl,
    accessToken: creds.accessToken, // market-data calls authenticate with the app token, not the trade token
    tradeToken: s.sessionToken,
    tradeSid: s.sessionSid,
    serverId: s.sessionServerId || null,
  };
}

const SESSION_DEAD_RE = /invalid session|session expired|re-?login|invalid token|token expired|unauthori[sz]ed/i;

/** Throw the contract error for a failed Kotak response (403/401 -> session, 429 -> rate limit). */
export function throwForResponse(res, json, text, label, { sessionCall = true } = {}) {
  const msg = json?.emsg || json?.errMsg || json?.message || text.slice(0, 160) || `HTTP ${res.status}`;
  if (res.status === 429 || Number(json?.stCode) === 429) throw new BrokerError(`Kotak Neo ${label}: too many requests (HTTP 429)`, { code: "UPSTREAM_RATE_LIMIT" });
  if (res.status === 401 || res.status === 403 || [401, 403].includes(Number(json?.stCode)) || SESSION_DEAD_RE.test(String(msg))) {
    if (sessionCall) throw new SessionRequiredError("Kotak Neo rejected the session. Log in again from Broker Settings.");
    throw new BrokerError(`Kotak Neo ${label}: the access token was refused (check the access token in Broker Settings).`, { code: "UPSTREAM_AUTH" });
  }
  throw new BrokerError(`Kotak Neo ${label} error [HTTP ${res.status}]: ${msg}`);
}

/**
 * Trade-session request (orders, books, limits, holdings). `form` (an object) is sent as `jData=<JSON>`.
 * Returns the parsed JSON; anything but a 2xx JSON answer throws the contract error. The SDK sends ?sId= on every
 * trade call except holdings, so `withServerId: false` mirrors that.
 */
export async function tradeRequest(session, method, path, form, { withServerId = true } = {}) {
  const qs = withServerId && session.serverId ? `?sId=${encodeURIComponent(session.serverId)}` : "";
  const headers = { accept: "application/json", Sid: session.tradeSid, Auth: session.tradeToken, "neo-fin-key": NEO_FIN_KEY };
  const init = { method, headers };
  if (form !== undefined) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams({ jData: JSON.stringify(form) }).toString();
  }
  const res = await brokerFetch(`${session.baseUrl}${path}${qs}`, init);
  const { json, text } = await readBody(res);
  if (!res.ok || !json) throwForResponse(res, json, text, path);
  return json;
}

export { REQUIRED_FIELDS };
