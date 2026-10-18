/**
 * Generic session login (capabilities.auth.kind === "sessionLogin").
 *
 * Brokers like Angel One, 5paisa, Firstock, Kotak Neo, Motilal Oswal, mStock, Nubra and Tradejini
 * cannot be used with a pasted token: their API needs the account password/PIN and a fresh TOTP code
 * to open a session. This terminal never stores those. Instead the user types them, plus the CURRENT
 * 6-digit code from their authenticator app, in the Broker Settings "Log in" dialog; the browser POSTs
 * them once to /api/broker-session-login; the proxy calls adapter.login() and returns only the session
 * token(s). The browser saves those in its normal credential store (session-only or encrypted vault)
 * and sends them back in x-broker-credentials like any other key. When the session dies the adapter
 * throws SessionRequiredError and the user logs in again. Nothing here retains the password, PIN or
 * code: they are not logged, not cached, not part of any cache key and not echoed in errors.
 */

import { BrokerInputError, FORBIDDEN_SECRET_KEY, SessionRequiredError, normaliseError, redactSecrets } from "./contract.mjs";
import { checkLoginResult } from "./contractShapes.mjs";

export const TOTP_CODE_RE = /^\d{6}$/;
export const SESSION_LOGIN_BODY_LIMIT = 4 * 1024;
const MAX_SECRET_LEN = 256;
const MAX_VALUE_LEN = 4096;
const KEY_RE = /^[A-Za-z0-9_]{1,40}$/;

// ── helpers for adapters ──

/** The 6-digit code the user typed (creds.totpCode). Throws BrokerInputError otherwise. */
export function readTotpCode(creds) {
  const code = String(creds?.totpCode ?? "").trim();
  if (!TOTP_CODE_RE.test(code)) throw new BrokerInputError("Enter the current 6-digit code from your authenticator app.");
  return code;
}

/** Throw a BrokerInputError naming (by key only) any missing creds fields. Never echoes values. */
export function requireFields(creds, keys, brokerName) {
  const missing = keys.filter((k) => !String(creds?.[k] ?? "").trim());
  if (missing.length) throw new BrokerInputError(`${brokerName}: missing ${missing.join(", ")}.`);
}

/**
 * Read the stored session fields from creds. Throws SessionRequiredError when the primary field is
 * absent or creds.sessionExpiresAt (epoch ms, saved by the browser) has passed.
 */
export function sessionFromCreds(creds, fields, brokerName, now = Date.now()) {
  const [primary] = fields;
  if (!String(creds?.[primary] ?? "")) throw new SessionRequiredError(`${brokerName}: not logged in. Use "Log in" in Broker Settings.`);
  const exp = Number(creds?.sessionExpiresAt);
  if (Number.isFinite(exp) && exp > 0 && exp <= now) throw new SessionRequiredError(`${brokerName}: your session has expired. Log in again from Broker Settings.`);
  const out = {};
  for (const f of fields) if (creds?.[f]) out[f] = String(creds[f]);
  return out;
}

/** Copy of `obj` without any key that looks like a secret (password, PIN, MPIN, TOTP). */
export function stripSecrets(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (!FORBIDDEN_SECRET_KEY.test(k)) out[k] = v;
  return out;
}

/** Epoch ms of the next IST midnight after `now` (most broker sessions die there). */
export function nextIstMidnightMs(now = Date.now()) {
  const IST = 5.5 * 60 * 60 * 1000;
  const d = new Date(now + IST);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() + 24 * 60 * 60 * 1000 - IST;
}

// ── rate limiting (login is the brute-force surface: much stricter than the global bucket) ──

/** Fixed-window limiter: at most `max` attempts per key per `windowMs`. */
export function createLoginRateLimiter({ max = 5, windowMs = 60_000 } = {}) {
  const hits = new Map();
  return {
    take(key, now = Date.now()) {
      for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      const rec = hits.get(key);
      if (!rec) { hits.set(key, { start: now, count: 1 }); return true; }
      if (rec.count >= max) return false;
      rec.count += 1;
      return true;
    },
  };
}

// ── request handling ──

function err(status, code, message) {
  return { status, body: { status: "error", code, message } };
}

function readStringMap(raw, { allow, maxLen }) {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KEY_RE.test(k) || typeof v !== "string" || v.length > maxLen) return null;
    if (allow && !allow(k)) return null;
    out[k] = v;
  }
  return out;
}

/**
 * Handle POST /api/broker-session-login?broker=<id>. Body: { values: {stored fields}, secrets: {password|pin|mpin, totpCode} }.
 * The caller (proxy-server.mjs) has already enforced Host/Origin allowlists, loopback-only for Origin-less callers,
 * POST + JSON + body cap. Returns { status, body } where a success body is { status, session, expiresAt }.
 */
export async function handleSessionLogin({ registry, brokerId, body, rateKey, limiter, ipLimiter }) {
  if (!registry.has(brokerId)) return err(400, "UNKNOWN_BROKER", "Unknown broker.");
  const adapter = registry.get(brokerId);
  const auth = adapter.capabilities?.auth;
  if (auth?.kind !== "sessionLogin" || typeof adapter.login !== "function") {
    return err(422, "SESSION_LOGIN_UNSUPPORTED", "This broker does not use a password + TOTP login.");
  }
  // Two budgets: one per caller and broker, and one per caller across ALL brokers, so a single IP cannot
  // multiply its guesses by cycling through the session-login brokers.
  if (ipLimiter && !ipLimiter.take(String(rateKey))) {
    return err(429, "RATE_LIMITED", "Too many login attempts. Wait a minute and try again.");
  }
  if (limiter && !limiter.take(`${rateKey}|${brokerId}`)) {
    return err(429, "RATE_LIMITED", "Too many login attempts. Wait a minute and try again.");
  }

  const loginKeys = new Set(auth.loginFields.map((f) => f.key));
  const credentialKeys = new Set(Array.isArray(adapter.credentialFields) ? adapter.credentialFields : []);
  // Stored values never carry secrets; anything secret-looking here is dropped, not forwarded.
  const values = readStringMap(body?.values, { maxLen: MAX_VALUE_LEN });
  const secrets = readStringMap(body?.secrets, { allow: (k) => loginKeys.has(k), maxLen: MAX_SECRET_LEN });
  if (!values || !secrets) return err(422, "BROKER_INPUT_INVALID", "Malformed login request.");
  const secretValues = Object.values(secrets);
  for (const f of auth.loginFields) {
    if (!String(secrets[f.key] ?? "").trim()) return err(422, "BROKER_INPUT_INVALID", `Enter your ${f.label}.`);
  }
  if (!TOTP_CODE_RE.test(String(secrets.totpCode).trim())) {
    return err(422, "BROKER_INPUT_INVALID", "Enter the current 6-digit code from your authenticator app.");
  }

  try {
    // Only the adapter's declared credential fields reach login(): a stale session (tokens from the last login)
    // or any other extra key in the saved values is dropped here, not forwarded.
    const stored = Object.fromEntries(Object.entries(stripSecrets(values)).filter(([k]) => credentialKeys.has(k)));
    const result = await adapter.login({ ...stored, ...secrets });
    const problems = checkLoginResult(result, { sessionFields: auth.sessionFields, secrets: secretValues });
    if (problems.length) return err(502, "UPSTREAM_ERROR", `${brokerId} login returned an unexpected session.`);
    return { status: 200, body: { status: "success", session: result.session, expiresAt: result.expiresAt } };
  } catch (e) {
    const n = (typeof adapter.normaliseError === "function" ? adapter.normaliseError : normaliseError)(e, { secrets: secretValues });
    // Redact again: an adapter-specific normaliser must not be able to leak a typed secret.
    return err(n.statusCode === 422 ? 422 : 502, n.code || "UPSTREAM_ERROR", redactSecrets(n.message, secretValues));
  }
}
