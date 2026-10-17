/**
 * Samco Securities (StockNote Trade API v3.2) authentication.
 *
 * Server-to-server flow: POST /session/token with the OAuth app's apiKey +
 * apiSecret (issued in the Samco Web Dashboard, tradeapi.samco.in/app/login)
 * returns a JWT sessionToken that is sent as the `x-session-token` header on
 * every subsequent call. Samco documents this token as valid until 08:00 IST
 * the next day, so it is cached in memory keyed by the raw creds and only
 * regenerated when missing/expired, or when the broker rejects it with a 403.
 *
 * The legacy 4-step OTP flow and password-based IP-registration endpoints
 * that older Samco integrations use are deprecated in v3.2 and intentionally
 * not implemented here.
 */

const BASE_URL = "https://tradeapi.samco.in";

// In-memory only — never persisted to disk, never logged.
// key -> { sessionToken, expiresAt }
const SESSION_CACHE = new Map();

function credsKey(creds) {
  return JSON.stringify({ k: creds?.apiKey, s: creds?.apiSecret });
}

/**
 * Epoch ms of 08:00 IST on the calendar day *after* `now`'s IST day —
 * matches Samco's documented "valid until 08:00 IST the next day" cutoff.
 */
function next8AmIstNextDay(now = Date.now()) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istShifted = new Date(now + IST_OFFSET_MS);
  const todayMidnightShifted = new Date(istShifted);
  todayMidnightShifted.setUTCHours(0, 0, 0, 0);
  const tomorrowAt8Shifted = todayMidnightShifted.getTime() + 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000;
  return tomorrowAt8Shifted - IST_OFFSET_MS;
}

function requireCreds(creds) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error("Samco credentials missing apiKey/apiSecret — paste both in Broker Settings.");
  }
}

async function loginFresh(creds) {
  requireCreds(creds);
  console.log("[samco] generating session token");
  const res = await fetch(`${BASE_URL}/session/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ apiKey: creds.apiKey, apiSecret: creds.apiSecret }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Samco session/token returned a non-JSON response (HTTP ${res.status})`);
  }
  if (json?.status !== "Success" || !json?.sessionToken) {
    const msg = json?.statusMessage || `HTTP ${res.status}`;
    console.log(`[samco] login failed: ${msg}`);
    throw new Error(`Samco login failed: ${msg}`);
  }
  const session = { sessionToken: json.sessionToken, expiresAt: next8AmIstNextDay() };
  SESSION_CACHE.set(credsKey(creds), session);
  return session;
}

/** Returns a cached, still-valid session or performs a fresh login. Throws on any auth failure. */
export async function getSession(creds) {
  requireCreds(creds);
  const key = credsKey(creds);
  const cached = SESSION_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  return loginFresh(creds);
}

/**
 * Authenticated call against tradeapi.samco.in. On HTTP 403 (session token
 * rejected — order-placement endpoints also use 403 for unregistered-IP
 * errors, but that does not apply to the read-only quote/session endpoints
 * used by this module) forces a fresh login and retries exactly once.
 */
export async function samcoRequest(creds, path, { method = "GET", body } = {}) {
  let session = await getSession(creds);

  const doCall = async (sess) => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-session-token": sess.sessionToken,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body — handled below via res.ok */
    }
    return { res, text, json };
  };

  let { res, text, json } = await doCall(session);

  if (res.status === 403) {
    console.log(`[samco] session rejected on ${path} (HTTP 403) — re-logging in`);
    SESSION_CACHE.delete(credsKey(creds));
    session = await loginFresh(creds);
    ({ res, text, json } = await doCall(session));
  }

  if (res.status === 429) {
    throw new Error(`Samco API rate limit exceeded on ${path}`);
  }
  if (!res.ok) {
    throw new Error(`Samco API error [${res.status}] on ${path}: ${json?.statusMessage || text.slice(0, 200)}`);
  }
  if (json?.status && json.status !== "Success") {
    throw new Error(`Samco API error on ${path}: ${json.statusMessage || "unknown error"}`);
  }
  return json;
}

export { BASE_URL };
