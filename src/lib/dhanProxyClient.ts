/**
 * Fetch helper for the 1Cliq trading endpoints on /api/dhan-proxy (orders, portfolio, risk engine,
 * panic layer, basket resolve; 1CLIQ-TRADE-SPEC.md §3/§5/§9).
 *
 * Uses the shared proxy base and Dhan credential headers from src/lib/api/proxyClient.ts, but
 * deliberately NOT its reachability gate: a panic Close All / Cancel All must always be attempted,
 * even when the gate currently believes the proxy is down. In sample-data mode (VITE_DATA_MODE=sample)
 * nothing is sent at all.
 *
 * Every proxy error path replies with `{ error, message, code }`; errors here surface that verbatim
 * `message`, so a broker rejection or a guard refusal reads the same everywhere in the app.
 */

import { PROXY_BASE, SAMPLE_DATA_MODE, dhanHeaders } from "./api/proxyClient";

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
  return dhanHeaders();
}

function assertProxyEnabled(): void {
  if (SAMPLE_DATA_MODE) throw new DhanProxyError("Sample data mode: the trading proxy is disabled", 0, "SAMPLE_MODE");
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
  assertProxyEnabled();
  const qp = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?${qp.toString()}`, { headers: dhanCredHeaders() });
  return toResult<T>(res);
}

/** POST a dhan-proxy endpoint with a JSON body, with the active Dhan account's credentials attached. */
export async function postDhanEndpoint<T>(endpoint: string, body: unknown, params: Record<string, string> = {}): Promise<T> {
  assertProxyEnabled();
  const qp = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${PROXY_BASE}/api/dhan-proxy?${qp.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...dhanCredHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  return toResult<T>(res);
}
