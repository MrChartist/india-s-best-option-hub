/**
 * Dhan API v2 — reference broker module (see registry.mjs for the shared contract).
 * `dhanFetch` + the index/underlying maps are also imported directly by
 * proxy-server.mjs's existing /api/dhan-proxy handler, which predates the
 * generic registry and keeps its own richer caching/retry/after-hours logic.
 */

const DHAN_BASE = "https://api.dhan.co/v2";

export const id = "dhan";
export const credentialFields = ["clientId", "accessToken"];

export const INDEX_SECURITY_IDS = {
  NIFTY: { secId: 13, exchSeg: "IDX_I" },
  BANKNIFTY: { secId: 25, exchSeg: "IDX_I" },
  FINNIFTY: { secId: 27, exchSeg: "IDX_I" },
  MIDCPNIFTY: { secId: 442, exchSeg: "IDX_I" },
  SENSEX: { secId: 1, exchSeg: "IDX_I" },
};

export const UNDERLYING_MAP = {
  NIFTY: { underlyingScrip: 13, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
  BANKNIFTY: { underlyingScrip: 25, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
  FINNIFTY: { underlyingScrip: 27, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
  MIDCPNIFTY: { underlyingScrip: 442, expirySegment: "NSE_FNO", ocSegment: "IDX_I" },
};

export async function dhanFetch(path, body, method = "POST", customClientId, customAccessToken) {
  const clientId = customClientId || process.env.DHAN_CLIENT_ID;
  const accessToken = customAccessToken || process.env.DHAN_ACCESS_TOKEN;

  if (!clientId || !accessToken) {
    throw new Error("DHAN_CLIENT_ID or DHAN_ACCESS_TOKEN not configured. Add them to .env or pass via headers.");
  }

  const url = `${DHAN_BASE}${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "access-token": accessToken,
      "client-id": clientId,
    },
  };
  if (body && method === "POST") options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Dhan API error [${res.status}]: ${errText}`);
  }
  return res.json();
}

// ── Registry-contract wrappers (used by the generic /api/broker-proxy path) ──

export async function testConnection(creds = {}) {
  try {
    await dhanFetch("/optionchain/expirylist", { UnderlyingScrip: 13, UnderlyingSeg: "NSE_FNO" }, "POST", creds.clientId, creds.accessToken);
    return { status: "success", message: "Dhan API connected" };
  } catch (e) {
    return { status: "error", message: e.message };
  }
}

export async function fetchExpiryList(creds, symbol) {
  const underlying = UNDERLYING_MAP[symbol];
  if (!underlying) throw new Error(`Unknown symbol: ${symbol}`);
  return dhanFetch("/optionchain/expirylist", {
    UnderlyingScrip: underlying.underlyingScrip,
    UnderlyingSeg: underlying.expirySegment,
  }, "POST", creds?.clientId, creds?.accessToken);
}

/** Already matches the app's normalized option-chain schema — Dhan IS the reference shape. */
export async function fetchOptionChain(creds, symbol, expiry) {
  const underlying = UNDERLYING_MAP[symbol];
  if (!underlying) throw new Error(`Unknown symbol: ${symbol}`);
  const body = { UnderlyingScrip: underlying.underlyingScrip, UnderlyingSeg: underlying.ocSegment };
  if (expiry) body.Expiry = expiry;
  return dhanFetch("/optionchain", body, "POST", creds?.clientId, creds?.accessToken);
}

export async function fetchLTP(creds, symbol) {
  const secInfo = INDEX_SECURITY_IDS[symbol];
  if (!secInfo) throw new Error(`Unknown index: ${symbol}`);
  return dhanFetch("/marketfeed/ltp", { [secInfo.exchSeg]: [secInfo.secId] }, "POST", creds?.clientId, creds?.accessToken);
}
