/**
 * Thin fetch helper for the /api/dhan-proxy endpoints that don't yet have a
 * dedicated client function in marketApi.ts (risk engine, panic layer,
 * basket resolve — 1CLIQ-TRADE-SPEC.md §3/§5/§9).
 *
 * marketApi.ts already has an equivalent PROXY_BASE/credential-header pair,
 * but keeps them module-private, and that file is owned by another agent in
 * this build — duplicating the ~15 lines here is cheaper and safer than
 * editing it out of scope. If the two ever drift, this is the file to fold
 * back into marketApi.ts's shared helper.
 *
 * Every proxy error path (see proxy-server.mjs's outer catch) replies with
 * `{ error, message, code }` — errors here surface that verbatim `message`
 * so a broker rejection or a guard refusal reads the same everywhere in the
 * app, never a generic "request failed".
 */

import { getActiveBroker } from "./brokerConfig";

const PROXY_BASE = import.meta.env.VITE_PROXY_URL || "http://localhost:4002";

export class DhanProxyError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "DhanProxyError";
    this.status = status;
    this.code = code;
  }
}

function dhanCredHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const activeBroker = getActiveBroker();
  if (activeBroker?.brokerId === "dhan" && activeBroker.values.clientId && activeBroker.values.accessToken) {
    headers["x-dhan-client-id"] = activeBroker.values.clientId;
    headers["x-dhan-access-token"] = activeBroker.values.accessToken;
  }
  return headers;
}

async function toResult<T>(res: Response): Promise<T> {
  // The proxy always replies JSON, success or failure (see proxy-server.mjs) —
  // a parse failure here means the proxy itself is unreachable/misconfigured,
  // which is worth its own message rather than a cryptic SyntaxError.
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new DhanProxyError(`Proxy returned a non-JSON response [${res.status}]`, res.status, null);
  }
  if (!res.ok) {
    const d = data as { message?: string; error?: string; code?: string } | null;
    throw new DhanProxyError(d?.message || d?.error || `Request failed [${res.status}]`, res.status, d?.code ?? null);
  }
  return data as T;
}

/** GET a dhan-proxy endpoint, with the active Dhan account's credentials attached. */
export async function getDhanEndpoint<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const qp = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?${qp.toString()}`, { headers: dhanCredHeaders() });
  return toResult<T>(res);
}

/** POST a dhan-proxy endpoint with a JSON body, with the active Dhan account's credentials attached. */
export async function postDhanEndpoint<T>(endpoint: string, body: unknown, params: Record<string, string> = {}): Promise<T> {
  const qp = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?${qp.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...dhanCredHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  return toResult<T>(res);
}
