/**
 * Definedge Securities (INTEGRATE API) — authenticated REST calls.
 *
 * Auth model: paste-a-session-key, NOT an automatable TOTP/handshake login.
 * Definedge's 2-step login (see docs 02-authentication.md) sends a REAL OTP
 * to the user's registered mobile/email each time — it is not a TOTP-app
 * seed the server can compute on its own like Angel One/5paisa/Alice Blue.
 * So this module never logs in: the user completes both steps themselves
 * (GET /login/{api_token} with header api_secret to trigger the OTP, then
 * POST /token with {otp_token, otp, ac: sha256(otp_token+otp+api_secret)})
 * and pastes the resulting `api_session_key` into Broker Settings. There is
 * no documented session lifetime — treat it like Zerodha's ~1-trading-day
 * token and re-paste a fresh one whenever calls start 401ing.
 *
 * No bulk-quote endpoint exists at all — every quote is one
 * GET /quotes/{exchange}/{token} call. The quotes response also carries NO
 * open-interest field (confirmed against both the docs and openalgo's
 * production adapter); OI is backfilled from the last 1-minute candle's OI
 * column via the separate historical-data host. Trading calls
 * (integrate.definedgesecurities.com) and historical-data calls
 * (data.definedgesecurities.com) are different hosts with independent
 * throttles, so quote and OI batches run concurrently without contention.
 *
 * Rate limit is not officially published — openalgo's production adapter
 * empirically paces at ~10 req/sec per host with 1s/2s/4s backoff on 429
 * (honoring Retry-After when present). Mirrored here.
 */

import { batchWithDelay, sleep } from "../lib/batch.mjs";

const TRADE_BASE = "https://integrate.definedgesecurities.com/dart/v1";
const DATA_BASE = "https://data.definedgesecurities.com/sds";

const QUOTE_BATCH_SIZE = 10;
const QUOTE_BATCH_DELAY_MS = 1000;
const OI_BATCH_SIZE = 10;
const OI_BATCH_DELAY_MS = 1000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_RETRIES = 2;

function authHeaders(creds) {
  if (!creds?.apiSessionKey) {
    throw new Error(
      "Definedge credentials missing apiSessionKey — complete the 2-step OTP login " +
        "(see Broker Settings help text) and paste the resulting api_session_key."
    );
  }
  return { Authorization: creds.apiSessionKey };
}

/** GET with 429 retry (Retry-After honored, else 1/2/4s backoff). Never logs credential values. */
async function definedgeGet(base, path, creds) {
  const headers = authHeaders(creds);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${path}`, { headers });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (res.status === 401) {
      throw new Error("Definedge session key expired or invalid — generate a fresh api_session_key and paste it in Broker Settings.");
    }
    if (!res.ok) {
      throw new Error(`Definedge API error [${res.status}] on ${path}: ${text.slice(0, 200)}`);
    }
    return text;
  }
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Definedge ${context} returned non-JSON response`);
  }
}

/** GET /quotes/{exchange}/{token} — single-instrument quote (no OI, no greeks). */
export async function fetchQuoteRaw(creds, exchange, token) {
  const text = await definedgeGet(TRADE_BASE, `/quotes/${exchange}/${token}`, creds);
  return parseJson(text, `quotes [${exchange}/${token}]`);
}

/** GET /limits — used by testConnection as a lightweight authenticated ping. */
export async function getLimits(creds) {
  const text = await definedgeGet(TRADE_BASE, "/limits", creds);
  return parseJson(text, "limits");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** `d` must already be IST-wall-clock-shifted (see istNow()) — reads UTC getters as IST fields. */
function formatDateIST(d) {
  return `${pad2(d.getUTCDate())}${pad2(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
}
function formatDateTimeIST(d) {
  return `${formatDateIST(d)}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}`;
}
function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Backfills OI for one derivative token from the last row of its 1-minute
 * history (CSV: Dateandtime,Open,High,Low,Close,Volume,OpenInterest). Best-
 * effort — returns 0 (not a throw) on any failure so one bad leg's OI lookup
 * never fails the whole chain.
 */
async function fetchLatestOI(creds, exchange, token) {
  try {
    const now = istNow();
    const from = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000); // 4 days survives weekends/holidays
    const fromStr = `${formatDateIST(from)}0915`;
    const toStr = formatDateTimeIST(now);
    const text = await definedgeGet(DATA_BASE, `/history/${exchange}/${token}/minute/${fromStr}/${toStr}`, creds);
    const trimmed = text.trim();
    if (!trimmed) return 0;
    const lastLine = trimmed.split("\n").pop();
    const fields = lastLine.split(",");
    if (fields.length < 7) return 0;
    const oi = Number(fields[6]);
    return Number.isFinite(oi) ? oi : 0;
  } catch {
    return 0;
  }
}

/** legs: [{ exchange, token, ... }] -> Map<token, rawQuoteJson> (SUCCESS quotes only). */
export async function fetchQuotesBatched(creds, legs) {
  const map = new Map();
  await batchWithDelay(legs, QUOTE_BATCH_SIZE, QUOTE_BATCH_DELAY_MS, async (chunk) => {
    await Promise.all(
      chunk.map(async (leg) => {
        try {
          const json = await fetchQuoteRaw(creds, leg.exchange, leg.token);
          if (json?.status === "SUCCESS") map.set(leg.token, json);
        } catch {
          // one bad leg shouldn't fail the whole chain
        }
      })
    );
  });
  return map;
}

/** legs: [{ exchange, token, ... }] -> Map<token, oi:number>. Runs on the DATA host, independent of quotes. */
export async function fetchOIBatched(creds, legs) {
  const map = new Map();
  await batchWithDelay(legs, OI_BATCH_SIZE, OI_BATCH_DELAY_MS, async (chunk) => {
    await Promise.all(
      chunk.map(async (leg) => {
        map.set(leg.token, await fetchLatestOI(creds, leg.exchange, leg.token));
      })
    );
  });
  return map;
}
