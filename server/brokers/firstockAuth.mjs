/**
 * Firstock authentication + generic authenticated POST helper.
 *
 * Firstock's login handshake — userId/password(SHA256)/TOTP/vendorCode/apiKey
 * -> a "susertoken" session key used as "jKey" on every subsequent call — is
 * near byte-for-byte the same shape as the Omnesys/Trustline "NorenAPI"
 * white-label backend used by Shoonya, Flattrade, and Zebu (uid/pwd/factor2/vc/
 * appkey -> susertoken, "jKey"/"uid" field naming throughout). Strong signal
 * this runs on the same third-party backend under renamed fields — worth
 * reusing this module's request/response shapes as a starting point if/when
 * those three get implemented.
 *
 * No documented session TTL was found for Firstock specifically; like the
 * rest of the NorenAPI family, a fresh TOTP login is expected once per
 * trading day, so sessions are cached until IST end-of-day (mirrors the
 * 5paisa module's approach) and re-established transparently after that or
 * on any "session/token/login" style error from the API.
 */

import { createHash } from "node:crypto";
import { generateTOTP } from "../lib/totp.mjs";

export const BASE = "https://api.firstock.in/V1";

// key -> { jKey, userId, expiresAt } — in-memory only, never persisted/logged.
const SESSION_CACHE = new Map();

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** In-process cache key only. Never logged, never persisted. */
function sessionKey(creds) {
  return JSON.stringify({
    u: creds?.userId,
    p: creds?.password,
    t: creds?.totpSecret,
    v: creds?.vendorCode,
    a: creds?.apiKey,
  });
}

/** Today's 23:59 IST as an epoch ms timestamp, regardless of the host server's own timezone. */
function istEndOfDay(now = new Date()) {
  const istDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"
  return new Date(`${istDateStr}T23:59:00+05:30`).getTime();
}

function requireFields(creds) {
  const required = ["userId", "password", "totpSecret", "vendorCode", "apiKey"];
  const missing = required.filter((f) => !creds?.[f]);
  if (missing.length) {
    throw new Error(`Firstock credentials missing required field(s): ${missing.join(", ")}`);
  }
}

async function loginFresh(creds) {
  requireFields(creds);

  const body = {
    userId: creds.userId,
    password: sha256Hex(creds.password),
    TOTP: generateTOTP(creds.totpSecret),
    vendorCode: creds.vendorCode,
    apiKey: creds.apiKey,
  };

  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Firstock login returned non-JSON response (HTTP ${res.status})`);
  }

  if (json?.status !== "success") {
    const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    console.log(`[firstock] login failed: ${msg}`);
    throw new Error(`Firstock login failed: ${msg}`);
  }

  const jKey = json?.data?.susertoken || json?.data?.jKey;
  if (!jKey) throw new Error("Firstock login succeeded but no session token (susertoken) was returned");

  const session = { jKey, userId: creds.userId, expiresAt: istEndOfDay() };
  SESSION_CACHE.set(sessionKey(creds), session);
  return session;
}

/** Returns a cached, still-valid session or performs a fresh TOTP login. Throws on any auth failure. */
export async function ensureSession(creds) {
  const key = sessionKey(creds);
  const cached = SESSION_CACHE.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;
  return loginFresh(creds);
}

/**
 * POST helper against api.firstock.in/V1. Attaches `userId` (and `jKey` once
 * authenticated) per Firstock's flat-JSON-payload convention shared across
 * every endpoint. Retries once on Firstock's documented plain-text
 * "rate limit" response body (not a normal JSON error shape).
 */
export async function callApi(creds, endpoint, extraPayload = {}, { auth = true } = {}) {
  let session = null;
  if (auth) session = await ensureSession(creds);

  const payload = { userId: creds.userId, ...extraPayload };
  if (auth) payload.jKey = session.jKey;

  const doCall = async () => {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    return { res, text: await res.text() };
  };

  let { res, text } = await doCall();
  if (text && text.toLowerCase().includes("rate limit")) {
    console.log(`[firstock] rate limited on ${endpoint} — retrying after 1s`);
    await new Promise((r) => setTimeout(r, 1000));
    ({ res, text } = await doCall());
  }
  if (!text) throw new Error(`Firstock API [${endpoint}] returned an empty response`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Firstock API [${endpoint}] returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (json.status !== "success") {
    const msg = json?.error?.message || json?.message || "unknown error";
    if (auth && /session|token|login|auth/i.test(msg)) SESSION_CACHE.delete(sessionKey(creds));
    throw new Error(`Firstock API [${endpoint}] error: ${msg}`);
  }
  return json;
}
