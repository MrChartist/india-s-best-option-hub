/**
 * mStock (Mirae Asset) — Type B authentication.
 *
 * mStock's "Type B" API is a near-identical clone of Angel One SmartAPI: the
 * master-contract endpoint is even literally named OpenAPIScripMaster, index
 * spot tokens match Angel's numbering (NIFTY 26000, BANKNIFTY 26009,
 * FINNIFTY 26037, MIDCPNIFTY 26074 on NSE — confirmed against mStock's own
 * docs at tradingapi.mstock.com/docs/v1/Annexure/), and auth uses the same
 * X-PrivateKey + Bearer-JWT shape. Login is TOTP-based (no paste-a-token
 * model) and is a two-call handshake per mStock's own SDK reference
 * (marketcalls/openalgo, broker/mstock/api/auth_api.py — no first-party
 * broker-api-docs mirror exists for this broker):
 *
 *   1. POST /connect/login       { clientcode, password, totp, state:"" } -> refreshToken
 *   2. POST /session/verifytotp  { refreshToken, totp }                  -> jwtToken, feedToken
 *
 * Per mStock's public docs (mstock.com/trading-api), access tokens expire
 * "within 12 hours or on the same day, whichever occurs first" — the session
 * cache below expires at whichever of those comes first, so we don't
 * re-login (and burn a fresh TOTP) on every request.
 *
 * mStock's own quote endpoint is documented as a GET request carrying a JSON
 * body (mirrored from the openalgo reference, which calls it exactly that
 * way via httpx). Node's built-in fetch() throws a hard TypeError for any
 * GET/HEAD request with a body (WHATWG fetch spec), so that one call is sent
 * with node:https directly instead of fetch — everything else uses fetch.
 */

import { request as httpsRequest } from "node:https";
import { generateTOTP } from "../lib/totp.mjs";

const API_BASE = "https://api.mstock.trade/openapi/typeb";
const LOGIN_PATH = "/connect/login";
const VERIFY_PATH = "/session/verifytotp";

// In-memory only — never persisted to disk, never logged.
const sessionCache = new Map();

function baseHeaders(extra = {}) {
  return { "X-Mirae-Version": "1", "Content-Type": "application/json", ...extra };
}

/** Cache key only — field VALUES never get logged anywhere in this module. */
function credsKey(creds) {
  return JSON.stringify({ c: creds?.clientId, p: creds?.password, t: creds?.totpSecret, a: creds?.apiKey });
}

/** Access-token lifetime per mStock docs: 12h from issue, or same-day, whichever first. */
function computeExpiry(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  istShifted.setUTCHours(0, 0, 0, 0);
  const nextIstMidnight = istShifted.getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS;
  const twelveHoursOut = now + 12 * 60 * 60 * 1000;
  return Math.min(nextIstMidnight, twelveHoursOut);
}

async function postJson(path, headers, body) {
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { res, text, json };
}

function isSuccessStatus(v) {
  return v === true || v === "true";
}

async function loginFresh(creds) {
  const totp = generateTOTP(creds.totpSecret);

  const step1 = await postJson(LOGIN_PATH, baseHeaders(), {
    clientcode: creds.clientId,
    password: creds.password,
    totp,
    state: "",
  });
  if (!step1.res.ok || !isSuccessStatus(step1.json?.status) || !step1.json?.data) {
    const msg = step1.json?.message || `HTTP ${step1.res.status}`;
    console.log(`[mstock] connect/login failed (status ${step1.res.status})`);
    throw new Error(`mStock login failed: ${msg}`);
  }
  const refreshToken = step1.json.data.refreshToken || step1.json.data.jwtToken;
  if (!refreshToken) throw new Error("mStock login: no refreshToken/jwtToken in response");

  const step2 = await postJson(VERIFY_PATH, baseHeaders({ "X-PrivateKey": creds.apiKey }), {
    refreshToken,
    totp,
  });
  if (!step2.res.ok || !isSuccessStatus(step2.json?.status) || !step2.json?.data) {
    const msg = step2.json?.message || `HTTP ${step2.res.status}`;
    console.log(`[mstock] session/verifytotp failed (status ${step2.res.status})`);
    throw new Error(`mStock TOTP verification failed: ${msg}`);
  }
  const jwtToken = step2.json.data.jwtToken;
  if (!jwtToken) throw new Error("mStock TOTP verification: no jwtToken in response");

  const session = { jwtToken, feedToken: step2.json.data.feedToken || null, expiresAt: computeExpiry() };
  sessionCache.set(credsKey(creds), session);
  return session;
}

/** Returns a valid cached session, logging in fresh (new TOTP) if missing/expired. */
export async function getSession(creds) {
  if (!creds?.clientId || !creds?.apiKey || !creds?.password || !creds?.totpSecret) {
    throw new Error("mStock credentials incomplete — need clientId, apiKey, password, totpSecret");
  }
  const key = credsKey(creds);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

/** GET or POST against api.mstock.trade with a JSON body, authenticated. Retries once on auth rejection. */
export async function authRequest(creds, path, { method = "GET", payload = null } = {}) {
  let session = await getSession(creds);

  const doCall = async (sess) => {
    const headers = {
      "X-Mirae-Version": "1",
      "Authorization": `Bearer ${sess.jwtToken}`,
      "X-PrivateKey": creds.apiKey,
      "Accept": "application/json",
    };
    if (method === "GET" && payload) {
      // fetch() cannot send a body on GET — use raw https instead (see file header).
      return httpGetWithBody(`${API_BASE}${path}`, headers, payload);
    }
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: payload ? { ...headers, "Content-Type": "application/json" } : headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
    return { status: res.status, text, json };
  };

  let { status, text, json } = await doCall(session);

  if (status === 401 || status === 403) {
    console.log(`[mstock] token rejected on ${path} (status ${status}) — re-logging in`);
    sessionCache.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ status, text, json } = await doCall(session));
  }

  if (status < 200 || status >= 300) {
    throw new Error(`mStock API error [${status}] on ${path}: ${json?.message || text.slice(0, 200)}`);
  }
  if (json && !isSuccessStatus(json.status) && json.status !== undefined) {
    throw new Error(`mStock API error on ${path}: ${json.message || json.errorcode || "unknown"}`);
  }
  return json;
}

/**
 * Raw HTTPS GET carrying a JSON body — Node's fetch() refuses this (spec
 * disallows a body on GET/HEAD), but mStock's quote endpoint requires it
 * (confirmed via the openalgo reference implementation, which sends it this
 * way successfully through Python's httpx). node:https has no such
 * restriction, so we drop to it for this one call.
 */
function httpGetWithBody(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = null;
          try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
