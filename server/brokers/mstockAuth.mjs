/**
 * mStock (Mirae Asset) Type B API: session login + the one authenticated request helper.
 *
 * Official docs (checked 2026-10): https://tradingapi.mstock.com/docs/v1/typeB/User/ and
 * https://tradingapi.mstock.com/docs/v1/Introduction/ , error codes at .../typeB/error-codes/.
 *  - Root: https://api.mstock.trade/openapi/typeb ; every call sends `X-Mirae-Version: 1`.
 *  - Login step 1: POST /connect/login { clientcode, password, totp: "", state: "" }. With TOTP enabled
 *    the reply's data.jwtToken (data.refreshToken is "") is the token step 2 needs.
 *  - Login step 2: POST /session/verifytotp { refreshToken, totp } with header X-PrivateKey: <api key>
 *    -> data { jwtToken, refreshToken, feedToken }.
 *  - Data calls: `Authorization: Bearer <jwtToken>` + `X-PrivateKey: <api key>`.
 *  - Token life: "valid till 12:00 AM of generated day" / "within 12 hours or on the same day, whichever
 *    occurs first" (Introduction). expiresAt follows the earlier of the two.
 *  - Errors: IA401 (HTTP 401) = missing/expired JWT -> SessionRequiredError; IA403 (HTTP 403) = API key
 *    suspended/expired -> UPSTREAM_AUTH (a new login does not fix it); IA400/IA404/IA500 and MA<xxx>
 *    (mStock OMS) -> UPSTREAM_ERROR with the broker's message.
 *  - Rate limits (Introduction): orders 30/s, quotes 20/s, data APIs (historical) 1/s.
 *
 * Some clients send the typed TOTP in step 1 as well; the official docs say `totp: ""`,
 * which is followed here.
 *
 * Several documented reads (quote, historical, trades) are GET requests that carry a JSON body. Node's
 * fetch() refuses a body on GET, so those go through node:https (getWithBody below); everything else uses
 * fetch(). The password and the code are never stored, cached, logged or echoed.
 */

import { request as httpsRequest } from "node:https";
import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields, sessionFromCreds, nextIstMidnightMs } from "./sessionLogin.mjs";

export const API_BASE = "https://api.mstock.trade/openapi/typeb";
const API_HOST = "api.mstock.trade";

export const LOGIN_FIELDS = [
  { key: "password", label: "mStock password", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken", "feedToken"];

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/** Access-token expiry: next IST midnight or 12 hours from now, whichever is earlier. */
export function sessionExpiry(now = Date.now()) {
  return Math.min(nextIstMidnightMs(now), now + TWELVE_HOURS_MS);
}

const isOk = (v) => v === true || v === "true";

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Map a non-success mStock reply to the contract error classes. Never includes request data. */
export function classifyError(status, json, text, path) {
  const code = String(json?.errorcode ?? json?.error_type ?? "").toUpperCase();
  const msg = String(json?.message || text || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (status === 401 || code === "IA401") {
    return new SessionRequiredError("mStock rejected the session. Log in again from Broker Settings.");
  }
  if (status === 403 || code === "IA403") {
    return new BrokerError(`mStock refused the API key (${msg || "suspended or expired"}). Check your Trading API subscription.`, { code: "UPSTREAM_AUTH" });
  }
  if (status === 429) return new BrokerError(`mStock rate limit hit on ${path}.`, { code: "UPSTREAM_RATE_LIMIT" });
  return new BrokerError(`mStock ${path} failed${status ? ` (HTTP ${status})` : ""}: ${msg || "unknown error"}${code ? ` [${code}]` : ""}`);
}

async function postLogin(path, headers, body) {
  const res = await brokerFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "X-Mirae-Version": "1", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: parseJson(text), text };
}

/** Session login with the user-typed password and current TOTP code. Returns only session tokens. */
export async function login(creds) {
  requireFields(creds, ["clientId", "apiKey", "password"], "mStock");
  const totp = readTotpCode(creds);

  const step1 = await postLogin("/connect/login", {}, { clientcode: creds.clientId, password: creds.password, totp: "", state: "" });
  if (step1.status !== 200 || !isOk(step1.json?.status) || !step1.json?.data) {
    throw new BrokerError(`mStock login failed: ${String(step1.json?.message || `HTTP ${step1.status}`).slice(0, 160)}`, { code: "UPSTREAM_AUTH" });
  }
  const refreshToken = step1.json.data.refreshToken || step1.json.data.jwtToken;
  if (!refreshToken) throw new BrokerError("mStock login returned no token for the TOTP step.", { code: "UPSTREAM_AUTH" });

  const step2 = await postLogin("/session/verifytotp", { "X-PrivateKey": creds.apiKey }, { refreshToken, totp });
  if (step2.status !== 200 || !isOk(step2.json?.status) || !step2.json?.data?.jwtToken) {
    throw new BrokerError(`mStock TOTP check failed: ${String(step2.json?.message || `HTTP ${step2.status}`).slice(0, 160)}`, { code: "UPSTREAM_AUTH" });
  }
  const session = { sessionToken: String(step2.json.data.jwtToken) };
  if (step2.json.data.feedToken) session.feedToken = String(step2.json.data.feedToken);
  return { session, expiresAt: sessionExpiry() };
}

/** The stored session. Throws SessionRequiredError (before any network call) when absent or expired. */
export function getSession(creds) {
  requireFields(creds, ["clientId", "apiKey"], "mStock");
  const s = sessionFromCreds(creds, SESSION_FIELDS, "mStock");
  return { jwtToken: s.sessionToken, feedToken: s.feedToken || null };
}

/** GET with a JSON body over node:https (fetch() cannot send one). Resolves { status, text }. */
export function getWithBody(url, headers, payload) {
  const u = new URL(url);
  if (u.hostname !== API_HOST) return Promise.reject(new Error(`mStock: refusing request to ${u.hostname}`));
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 20_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf-8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("mStock request timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Authenticated call. `body` on a GET goes through getWithBody(); on POST/PUT/DELETE it is JSON.
 * Returns the parsed JSON (bare arrays are returned as-is); throws contract errors otherwise.
 */
export async function authRequest(creds, path, { method = "GET", body } = {}) {
  const { jwtToken } = getSession(creds);
  const headers = { "X-Mirae-Version": "1", Authorization: `Bearer ${jwtToken}`, "X-PrivateKey": creds.apiKey, Accept: "application/json" };
  const url = `${API_BASE}${path}`;
  let status;
  let text;
  if (method === "GET" && body !== undefined) {
    ({ status, text } = await getWithBody(url, headers, body));
  } else {
    const init = { method, headers: body !== undefined ? { ...headers, "Content-Type": "application/json" } : headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await brokerFetch(url, init);
    status = res.status;
    text = await res.text();
  }
  const json = parseJson(text);
  if (status < 200 || status >= 300) throw classifyError(status, json, text, path);
  if (json === null) throw new BrokerError(`mStock ${path} returned a non-JSON reply (HTTP ${status}).`);
  if (!Array.isArray(json) && json.status !== undefined && !isOk(json.status)) throw classifyError(status, json, "", path);
  return json;
}
