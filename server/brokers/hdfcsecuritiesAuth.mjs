/**
 * HDFC Securities (InvestRight) — REST plumbing: headers, base params, fetch-ltp.
 *
 * Auth model: paste-token, same UX as Dhan/Fyers. InvestRight's real login is a
 * browser-redirect OAuth flow (GET /oapi/v1/login?api_key=... -> HDFC's own
 * login+2FA pages -> redirect back with a one-shot request_token that must be
 * exchanged server-side for an accessToken using the app's apiSecret). That
 * exchange needs a live callback host this app does not run, and the
 * request_token is single-use/short-lived so it cannot usefully be "saved" in
 * Broker Settings. So — like this app's Zerodha/Fyers modules — the user
 * completes that OAuth dance once externally (their own script/Postman/the
 * docs' worked curl example) and pastes the resulting accessToken here.
 *
 * Every authenticated request needs:
 *   - header  Authorization: <accessToken>   (NO "Bearer " prefix)
 *   - header  User-Agent: <non-empty string> (InvestRight rejects requests without one)
 *   - query   api_key=<apiKey>
 * accessToken lifetime is not documented publicly; treated as valid for the
 * rest of the trading day (matches Zerodha/Fyers convention for this broker
 * family) — a 401/403 is surfaced as "token expired" so the user knows to
 * re-paste rather than seeing an opaque failure.
 *
 * NEVER log apiKey/accessToken values — field names / HTTP status only.
 */

export const ROOT_URL = "https://developer.hdfcsec.com";
export const WS_PATH = "/wsapi/v1/session";
export const SECURITY_MASTER_URL = `${ROOT_URL}/oapi/v1/security-master`;

// InvestRight's own docs sample User-Agent; requests without one are rejected.
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export function requireCreds(creds) {
  const apiKey = creds?.apiKey;
  const accessToken = creds?.accessToken;
  if (!apiKey || !accessToken) {
    throw new Error("HDFC Securities apiKey/accessToken missing — add credentials in Broker Settings.");
  }
  return { apiKey, accessToken };
}

export function authHeaders(creds, withJson = false) {
  const { accessToken } = requireCreds(creds);
  const headers = {
    Authorization: accessToken,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

export function withApiKey(creds, path) {
  const { apiKey } = requireCreds(creds);
  const url = new URL(`${ROOT_URL}${path}`);
  url.searchParams.set("api_key", apiKey);
  return url;
}

/** WS URL: token/api_key travel on the query string (the gateway does not accept custom headers over the standard WebSocket API). */
export function wsUrl(creds) {
  const { apiKey, accessToken } = requireCreds(creds);
  const url = new URL(`${ROOT_URL.replace("https://", "wss://")}${WS_PATH}`);
  url.searchParams.set("token", accessToken);
  url.searchParams.set("api_key", apiKey);
  return url.toString();
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function throwForStatus(res, json, context) {
  if (res.status === 401 || res.status === 403) {
    throw new Error(`HDFC Securities session expired or invalid (HTTP ${res.status}) — re-paste a fresh accessToken from InvestRight login. [${context}]`);
  }
  const message = json?.message || json?.error || `HTTP ${res.status}`;
  throw new Error(`HDFC Securities API error on ${context}: ${message}`);
}

/** PUT /oapi/v1/fetch-ltp — the ONLY REST quote endpoint InvestRight publishes.
 * Returns [{last_price, prev_close}] per token or {} entries omitted for tokens that errored. */
export async function fetchLtpBatch(creds, instruments) {
  if (!instruments.length) return new Map();
  const url = withApiKey(creds, "/oapi/v1/fetch-ltp");
  const res = await fetch(url, {
    method: "PUT",
    headers: authHeaders(creds, true),
    body: JSON.stringify({ data: instruments }),
  });
  const json = await parseJsonSafe(res);
  if (!res.ok) throwForStatus(res, json, "fetch-ltp");

  const rows = Array.isArray(json?.data) ? json.data : [];
  const out = new Map();
  for (const row of rows) {
    const key = `${String(row.exchange || "").toUpperCase()}|${String(row.token || "")}`;
    out.set(key, {
      ltp: Number(row.ltp) || 0,
      prevClose: Number(row.prev_close) || 0,
    });
  }
  return out;
}

export async function testConnection(creds = {}) {
  try {
    requireCreds(creds);
    // A tiny fetch-ltp probe against a well-known NSE index token band member
    // (26000 = the first NSE_INDEX-band token) is enough to prove the
    // apiKey/accessToken pair is accepted without needing the full CSV master.
    await fetchLtpBatch(creds, [{ exchange: "NSE_INDEX", token: "26000" }]);
    return { status: "success", message: "HDFC Securities (InvestRight) connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}
