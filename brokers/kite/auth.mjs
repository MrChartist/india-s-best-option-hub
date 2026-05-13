/**
 * Kite Connect login handshake.
 *
 * Flow:
 *   1. User clicks "Login with Kite" → redirect to https://kite.zerodha.com/connect/login?api_key=...
 *   2. Zerodha redirects back to our callback with ?request_token=...&action=login&status=success
 *   3. We POST to /session/token with checksum=SHA256(api_key + request_token + api_secret)
 *      → returns { access_token, public_token, ... } valid until next 06:00 IST
 */
import { createHash } from "node:crypto";

const KITE_LOGIN_URL = "https://kite.zerodha.com/connect/login";
const KITE_BASE = "https://api.kite.trade";

export function buildLoginUrl(apiKey, redirectParams = "") {
  const url = new URL(KITE_LOGIN_URL);
  url.searchParams.set("v", "3");
  url.searchParams.set("api_key", apiKey);
  if (redirectParams) url.searchParams.set("redirect_params", redirectParams);
  return url.toString();
}

export async function exchangeRequestToken(apiKey, apiSecret, requestToken) {
  if (!apiKey || !apiSecret || !requestToken) {
    throw new Error("apiKey, apiSecret and requestToken are all required");
  }
  const checksum = createHash("sha256")
    .update(`${apiKey}${requestToken}${apiSecret}`)
    .digest("hex");

  const body = new URLSearchParams({
    api_key: apiKey,
    request_token: requestToken,
    checksum,
  });

  const res = await fetch(`${KITE_BASE}/session/token`, {
    method: "POST",
    headers: {
      "X-Kite-Version": "3",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await res.json();
  if (!res.ok || data.status === "error") {
    throw new Error(`Kite session/token failed: ${data?.message || res.statusText}`);
  }
  return data.data; // { user_id, access_token, public_token, ... }
}

export async function invalidateSession(apiKey, accessToken) {
  await fetch(`${KITE_BASE}/session/token?api_key=${apiKey}&access_token=${accessToken}`, {
    method: "DELETE",
    headers: { "X-Kite-Version": "3" },
  });
}
