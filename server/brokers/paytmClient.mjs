/**
 * Paytm Money (developer.paytmmoney.com) — shared low-level HTTP client.
 *
 * Auth model: paste-token, same UX as Zerodha/Upstox. Paytm's login is a
 * browser-redirect OAuth flow —
 *   https://login.paytmmoney.com/merchant-login?apiKey=<apiKey>&state=<state>
 * — that requires a redirect URL registered on the user's own Paytm Money
 * developer app; there is no way for this server to complete it. The user
 * runs that flow externally, receives a `request_token` on the redirect,
 * and exchanges it themselves for an `access_token` at
 * POST https://developer.paytmmoney.com/accounts/v2/gettoken
 * (body: { api_key, api_secret_key, request_token }), then pastes
 * apiKey + apiSecret + the resulting `access_token` into Broker Settings.
 * (Paytm also returns a `public_access_token` for WebSocket streaming and a
 * `read_access_token` for read-only endpoints — this module only needs the
 * plain `access_token`.) Every call here just sends
 * `x-jwt-token: <accessToken>` — apiKey/apiSecret are collected for
 * completeness (mirrors Zerodha/Upstox's apiKey/apiSecret fields) but are
 * unused at request time since we never perform the token exchange
 * ourselves. accessToken lifetime is not publicly documented by Paytm;
 * treat a 401/403 as "expired, generate a fresh one" rather than guessing a
 * TTL to pre-empt it.
 */

export const PAYTM_BASE = "https://developer.paytmmoney.com";

// NSE/BSE index security_id for /data/v1/price/live (scripType=INDEX).
// NIFTY (13) and BANKNIFTY (25) are confirmed against the Paytm Money forum:
// https://forum.paytmmoney.com/t/using-which-api-can-i-get-the-latest-price-of-nifty-50-and-niftybank/239
// FINNIFTY/MIDCPNIFTY/SENSEX are unverified — inferred from the fact that
// Dhan's independently-sourced INDEX_SECURITY_IDS (see dhan.mjs) use the
// exact same ids (13/25) for NIFTY/BANKNIFTY, suggesting both platforms
// consume the same NSE/BSE-issued index token numbering rather than minting
// their own. fetchLTP() falls back to a live option-chain's spot_price if
// the id here turns out to be wrong for a given symbol — see paytm.mjs.
export const INDEX_IDS = {
  NIFTY: { exch: "NSE", id: 13 },
  BANKNIFTY: { exch: "NSE", id: 25 },
  FINNIFTY: { exch: "NSE", id: 27 }, // unverified
  MIDCPNIFTY: { exch: "NSE", id: 442 }, // unverified
  SENSEX: { exch: "BSE", id: 1 }, // unverified
};

function authHeaders(creds) {
  if (!creds?.accessToken) {
    throw new Error("Paytm Money accessToken missing — paste a fresh one in Broker Settings.");
  }
  return {
    "x-jwt-token": creds.accessToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** GET a Paytm Money endpoint. `path` must already include its query string. Never logs the token. */
export async function paytmGet(path, creds) {
  const res = await fetch(`${PAYTM_BASE}${path}`, { headers: authHeaders(creds) });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* fall through to the !json check below */
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Paytm Money accessToken expired or invalid — generate a fresh one via the login flow and paste it in Broker Settings."
    );
  }
  if (!res.ok || !json) {
    throw new Error(`Paytm Money API error [${res.status}] on ${path.split("?")[0]}`);
  }
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const msg = json.errors.map((e) => e.message).filter(Boolean).join("; ") || "Unknown Paytm Money error";
    throw new Error(`Paytm Money API error: ${msg}`);
  }
  return json;
}

/** "YYYY-MM-DD" -> "DD-MM-YYYY" (the expiry param format documented by Paytm's own SDKs). */
export function isoToPaytmDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/**
 * Normalizes the several expiry-date shapes seen across Paytm's endpoints to
 * "YYYY-MM-DD" in IST (matches the app's reference schema):
 *   - epoch milliseconds (number) from /fno/v1/option-chain/config's `expires`
 *   - "DD-MM-YYYY" strings
 *   - "YYYY-MM-DD HH:MM:SS" strings from the security_master.csv `expiry_date` column
 */
export function toIsoDate(value) {
  if (typeof value === "number") {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    return new Date(value + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  const s = String(value ?? "").trim();
  const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  return s.slice(0, 10);
}
