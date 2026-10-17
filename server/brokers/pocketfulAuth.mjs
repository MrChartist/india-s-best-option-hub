/**
 * Pocketful session helper — resolves the trading client_id that the
 * WebSocket feed URL requires, from a user-pasted OAuth2 access token.
 *
 * Pocketful's auth is a full OAuth2 authorization-code flow (browser consent
 * screen + a registered redirect_uri + a client_secret exchange — see
 * OpenAlgo's broker/pocketful/api/auth_api.py). This server has no redirect
 * endpoint to receive that callback, so — same pattern as Upstox/Fyers in
 * this codebase — the user completes that flow themselves (Pocketful's
 * developer console / Postman) and pastes the resulting long-lived
 * `access_token` here. Every REST/WS call then only needs
 * `Authorization: Bearer <accessToken>`; client_id is auto-derived from the
 * token via /api/v1/user/trading_info (auth_api.py's own flow) and cached
 * in-memory for the life of the process — this call costs nothing to redo,
 * but there is no documented reason to repeat it every request.
 *
 * NEVER log accessToken — only field names / presence / HTTP status codes.
 */

const TRADE_BASE = "https://trade.pocketful.in";

const clientIdCache = new Map(); // credKey -> clientId

function credKey(creds) {
  return JSON.stringify(creds || {});
}

/** Throws with a clear message on missing/invalid/expired tokens. Never logs the token itself. */
export async function resolveClientId(creds) {
  const accessToken = creds?.accessToken;
  if (!accessToken) throw new Error("Pocketful accessToken is not configured — paste it in Broker Settings.");

  const key = credKey(creds);
  const cached = clientIdCache.get(key);
  if (cached) return cached;

  const res = await fetch(`${TRADE_BASE}/api/v1/user/trading_info`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("Pocketful accessToken is invalid or expired — generate a fresh one and paste it in Broker Settings.");
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.status !== "success") {
    throw new Error(`Pocketful trading_info error [${res.status}]: ${body?.message || "unknown error"}`);
  }

  const clientId = body.data?.client_id;
  if (!clientId) throw new Error("Pocketful trading_info response did not include a client_id.");

  clientIdCache.set(key, clientId);
  return clientId;
}

export { credKey };
