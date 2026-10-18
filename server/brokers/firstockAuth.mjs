/**
 * Firstock: session login (contract auth.kind "sessionLogin") + the authenticated POST helper.
 *
 * Official docs (https://firstock.in/api/docs/, checked 2026-10):
 *  - login/ : POST https://api.firstock.in/V1/login { userId, password: SHA-256(password), TOTP, vendorCode,
 *    apiKey } -> { status: "success", data: { actid, userName, susertoken, email } }. The susertoken is the
 *    `jKey` every later call sends in its JSON body together with `userId`.
 *  - request-responses/ and exception-errors/ : failures are { status: "failed", code, name, error: { field,
 *    message } }. code 401 / INVALID_JKEY (or INVALID_USERID) means the session is gone; 429 /
 *    RATE_LIMIT_EXCEEDED means slow down.
 *  - Rate limits (exception-errors/): quotes 1 req/s (reduced from 4), historical 3 req/s, everything else
 *    10 req/s.
 * No session lifetime is documented; a fresh login is expected each trading day, so expiresAt is the next
 * IST midnight and any INVALID_JKEY reply throws SessionRequiredError before then.
 *
 * The user types the password and the current 6-digit code in Broker Settings; login() runs once and
 * returns only { sessionToken } (the susertoken). The password and code are never stored, cached or logged.
 */

import { createHash } from "node:crypto";
import { BrokerError, brokerFetch, SessionRequiredError } from "./contract.mjs";
import { readTotpCode, requireFields, sessionFromCreds, nextIstMidnightMs } from "./sessionLogin.mjs";
import { sleep } from "../lib/batch.mjs";

export const BASE = "https://api.firstock.in/V1";

export const LOGIN_FIELDS = [
  { key: "password", label: "Firstock password", kind: "secret" },
  { key: "totpCode", label: "6-digit TOTP code", kind: "totp" },
];
export const SESSION_FIELDS = ["sessionToken"];

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const errorText = (json) => String(json?.error?.message || json?.message || "").replace(/\s+/g, " ").trim().slice(0, 200);

/** Map a failed Firstock reply to the contract error classes. */
export function classifyError(httpStatus, json, endpoint) {
  const code = String(json?.code ?? "");
  const name = String(json?.name ?? "").toUpperCase().replace(/_/g, "");
  const field = String(json?.error?.field ?? "");
  if (httpStatus === 401 || code === "401" || name === "INVALIDJKEY" || name === "UNAUTHORIZED" || field === "jKey") {
    return new SessionRequiredError("Firstock rejected the session. Log in again from Broker Settings.");
  }
  if (httpStatus === 429 || code === "429" || name === "RATELIMITEXCEEDED" || name === "TOOMANYREQUESTS") {
    return new BrokerError(`Firstock rate limit hit on ${endpoint}.`, { code: "UPSTREAM_RATE_LIMIT" });
  }
  const msg = errorText(json) || `HTTP ${httpStatus}`;
  return new BrokerError(`Firstock ${endpoint} failed: ${msg}${json?.name ? ` [${json.name}]` : ""}`);
}

/** One login with the user-typed password + TOTP code. Returns only the session token. */
export async function login(creds) {
  requireFields(creds, ["userId", "password", "vendorCode", "apiKey"], "Firstock");
  const totp = readTotpCode(creds);
  const res = await brokerFetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ userId: creds.userId, password: sha256Hex(creds.password), TOTP: totp, vendorCode: creds.vendorCode, apiKey: creds.apiKey }),
  });
  const json = parseJson(await res.text());
  if (!json || json.status !== "success") {
    throw new BrokerError(`Firstock login failed: ${errorText(json) || `HTTP ${res.status}`}`, { code: "UPSTREAM_AUTH" });
  }
  const jKey = json?.data?.susertoken || json?.data?.jKey;
  if (!jKey) throw new BrokerError("Firstock login succeeded but returned no session token.", { code: "UPSTREAM_AUTH" });
  return { session: { sessionToken: String(jKey) }, expiresAt: nextIstMidnightMs() };
}

/** The stored session { jKey, userId }. Throws SessionRequiredError (no network) when absent or expired. */
export function ensureSession(creds) {
  requireFields(creds, ["userId"], "Firstock");
  return { jKey: sessionFromCreds(creds, SESSION_FIELDS, "Firstock").sessionToken, userId: String(creds.userId) };
}

/**
 * POST { userId, jKey, ...payload } to api.firstock.in/V1<endpoint>. Retries once after a second on a
 * documented rate-limit reply. Returns the parsed success JSON; throws contract errors otherwise.
 */
export async function callApi(creds, endpoint, payload = {}) {
  const { jKey, userId } = ensureSession(creds);
  const body = JSON.stringify({ userId, ...payload, jKey });
  const once = async () => {
    const res = await brokerFetch(`${BASE}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body });
    const text = await res.text();
    return { status: res.status, json: parseJson(text), text };
  };
  let r = await once();
  const limited = (x) => x.status === 429 || String(x.json?.code ?? "") === "429" || /rate.?limit/i.test(x.json ? `${x.json.name ?? ""} ${errorText(x.json)}` : x.text);
  if (limited(r)) {
    await sleep(1000);
    r = await once();
  }
  if (!r.json) {
    if (limited(r)) throw new BrokerError(`Firstock rate limit hit on ${endpoint}.`, { code: "UPSTREAM_RATE_LIMIT" });
    throw new BrokerError(`Firstock ${endpoint} returned a non-JSON reply (HTTP ${r.status}).`);
  }
  if (r.json.status !== "success") throw classifyError(r.status, r.json, endpoint);
  return r.json;
}
