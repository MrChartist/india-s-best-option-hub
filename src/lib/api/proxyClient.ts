/**
 * Proxy client: the single place the browser talks to proxy-server.mjs.
 *
 * - PROXY_BASE comes from VITE_PROXY_URL (default http://localhost:4002).
 * - Browser-stored Dhan credentials are injected as x-dhan-* headers.
 * - proxyGet() never throws: network errors, timeouts and bad JSON come back as
 *   { data: null, meta: { reason } } so callers can fall back to sample data.
 */
import { getDhanCredentials } from "@/lib/brokerConfig";

export type ProxySource = "dhan" | "nse" | "bse" | "yahoo" | "tv" | "cache" | "sample";

export interface ProxyMeta {
  source: ProxySource;
  asOf: number;
  stale: boolean;
  reason?: string;
}

export interface ProxyEnvelope<T> {
  data: T | null;
  meta: ProxyMeta;
}

function readProxyBase(): string {
  let env: string | undefined;
  try {
    env = import.meta.env?.VITE_PROXY_URL as string | undefined;
  } catch {
    env = undefined;
  }
  return (env && env.trim() ? env.trim() : "http://localhost:4002").replace(/\/+$/, "");
}

export const PROXY_BASE: string = readProxyBase();

function readSampleMode(): boolean {
  try {
    return String(import.meta.env?.VITE_DATA_MODE ?? "").trim().toLowerCase() === "sample";
  } catch {
    return false;
  }
}

/**
 * VITE_DATA_MODE=sample: never contact the proxy; every request resolves as offline so
 * the data layer falls back to clearly labelled sample data (used by Playwright and demos).
 */
export const SAMPLE_DATA_MODE: boolean = readSampleMode();

/** ws:// or wss:// URL of the proxy's live feed relay. */
export function proxyWsUrl(base: string = PROXY_BASE): string {
  try {
    const u = new URL(base);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = `${u.pathname.replace(/\/+$/, "")}/ws`;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "ws://localhost:4002/ws";
  }
}

/** Headers carrying the browser-stored Dhan credentials (empty object when none are set). */
export function dhanHeaders(): Record<string, string> {
  const creds = getDhanCredentials();
  if (!creds) return {};
  return { "x-dhan-client-id": creds.clientId, "x-dhan-access-token": creds.accessToken };
}

/** Build an absolute proxy URL from a path and optional query params (undefined/empty values dropped). */
export function buildProxyUrl(path: string, params?: Record<string, string | number | undefined>, base: string = PROXY_BASE): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    qp.set(k, String(v));
  }
  const qs = qp.toString();
  return `${base}${cleanPath}${qs ? `?${qs}` : ""}`;
}

const SOURCES: ReadonlySet<string> = new Set(["dhan", "nse", "bse", "yahoo", "tv", "cache", "sample"]);

function offlineMeta(reason: string): ProxyMeta {
  return { source: "cache", asOf: Date.now(), stale: true, reason };
}

/**
 * Validate and normalise anything the proxy returned into a ProxyEnvelope.
 * Accepts the envelope shape; anything else is treated as a protocol error.
 */
export function normaliseEnvelope<T>(body: unknown, httpStatus = 200): ProxyEnvelope<T> {
  if (!body || typeof body !== "object" || !("meta" in body)) {
    return { data: null, meta: offlineMeta(httpStatus >= 400 ? `http-${httpStatus}` : "bad-envelope") };
  }
  const b = body as { data?: unknown; meta?: Partial<ProxyMeta> | null };
  const m = b.meta ?? {};
  const source = typeof m.source === "string" && SOURCES.has(m.source) ? (m.source as ProxySource) : "cache";
  const asOf = typeof m.asOf === "number" && Number.isFinite(m.asOf) ? m.asOf : Date.now();
  const meta: ProxyMeta = { source, asOf, stale: !!m.stale };
  if (typeof m.reason === "string" && m.reason) meta.reason = m.reason.slice(0, 300);
  else if (httpStatus >= 400) meta.reason = `http-${httpStatus}`;
  const data = b.data === undefined ? null : (b.data as T | null);
  return { data, meta };
}

function linkSignals(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ctrl = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
    timedOut: () => didTimeout,
  };
}

/** GET an envelope route (/api/x/*). Never throws. */
export async function proxyGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ProxyEnvelope<T>> {
  if (SAMPLE_DATA_MODE) return { data: null, meta: offlineMeta("sample-mode") };
  const url = buildProxyUrl(path, params);
  const { signal, cleanup, timedOut } = linkSignals(opts?.timeoutMs ?? 15000, opts?.signal);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...dhanHeaders() }, signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return { data: null, meta: offlineMeta(res.ok ? "bad-json" : `http-${res.status}`) };
    }
    return normaliseEnvelope<T>(body, res.status);
  } catch {
    if (opts?.signal?.aborted) return { data: null, meta: offlineMeta("aborted") };
    return { data: null, meta: offlineMeta(timedOut() ? "timeout" : "offline") };
  } finally {
    cleanup();
  }
}

export class ProxyHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ProxyHttpError";
  }
}

/**
 * Fetch a legacy (non-envelope) proxy route and return parsed JSON. Throws ProxyHttpError on
 * HTTP errors and a plain Error on network failure / timeout. Used by the older /api/*-proxy routes.
 */
export async function proxyFetchJSON<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  opts?: { timeoutMs?: number; signal?: AbortSignal; withDhan?: boolean },
): Promise<T> {
  if (SAMPLE_DATA_MODE) throw new Error("Sample data mode: proxy disabled");
  const url = buildProxyUrl(path, params);
  const { signal, cleanup, timedOut } = linkSignals(opts?.timeoutMs ?? 15000, opts?.signal);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts?.withDhan !== false) Object.assign(headers, dhanHeaders());
    const res = await fetch(url, { headers, signal });
    if (!res.ok) {
      let detail = "";
      try {
        const body = (await res.json()) as { reason?: string; error?: string; message?: string };
        detail = body.reason || body.error || body.message || "";
      } catch {
        /* ignore */
      }
      throw new ProxyHttpError(res.status, `Proxy ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ProxyHttpError) throw e;
    throw new Error(timedOut() ? "Proxy request timed out" : "Proxy unreachable");
  } finally {
    cleanup();
  }
}
