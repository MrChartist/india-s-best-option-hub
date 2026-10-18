/**
 * Proxy client: the single place the browser talks to proxy-server.mjs.
 *
 * - PROXY_BASE comes from VITE_PROXY_URL (default http://localhost:4002).
 * - Browser-stored Dhan credentials are injected as x-dhan-* headers.
 * - proxyGet() never throws: network errors, timeouts and bad JSON come back as
 *   { data: null, meta: { reason } } so callers can fall back to sample data.
 * - A shared reachability gate (a small circuit breaker) stops the app from hammering a proxy that
 *   is not running: after a network failure every request short-circuits until an exponential
 *   backoff (30 s, 60 s, 2 min, 4 min, capped at 5 min) elapses, then a single /health probe
 *   decides. The first success, or a good /health, resets it. See "Reachability gate" below.
 */
import { useSyncExternalStore } from "react";
import { getDhanCredentials } from "@/lib/brokerConfig";

export type ProxySource = "dhan" | "nse" | "bse" | "yahoo" | "cache" | "sample";

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

const SOURCES: ReadonlySet<string> = new Set(["dhan", "nse", "bse", "yahoo", "cache", "sample"]);

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

// ── Reachability gate ─────────────────────────────────────────────────────
//
// States: "unknown" (nothing tried yet), "online" (the proxy answered) and "offline" (a network
// failure; requests short-circuit until nextRetryAt). While unknown, or once the backoff has
// elapsed, the first caller starts one quick /health probe and every concurrent caller awaits it,
// so a dead proxy costs one failed request per backoff window instead of one per query.
//
// Other streams' fetchers can adopt the gate with shouldTryProxy() / markProxyOnline() /
// markProxyOffline(), or simply by calling proxyGet() / proxyFetchJSON(), which are gated.

export type ProxyGateStatus = "unknown" | "online" | "offline";

export interface ProxyGateSnapshot {
  status: ProxyGateStatus;
  /** Consecutive failed windows (0 while online/unknown). Drives the backoff. */
  failures: number;
  /** Epoch ms of the last status change. */
  since: number;
  /** Epoch ms when the next probe is allowed (offline only). */
  nextRetryAt: number | null;
  /** Epoch ms the proxy last answered, or null if it never has this session. */
  lastOnlineAt: number | null;
  /** Short machine reason for the last failure ("offline", "timeout", "sample-mode" …). */
  reason?: string;
  /** A /health probe is in flight. */
  probing: boolean;
  /** VITE_DATA_MODE=sample: the proxy is never contacted. */
  sampleMode: boolean;
}

export const PROXY_BACKOFF_BASE_MS = 30_000;
export const PROXY_BACKOFF_MAX_MS = 300_000;
const HEALTH_PROBE_TIMEOUT_MS = 4_000;

/** Backoff after `failures` consecutive failed windows: 30 s, 60 s, 2 min, 4 min, then 5 min. */
export function proxyBackoffMs(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return 0;
  const exp = Math.min(Math.floor(failures) - 1, 10);
  return Math.min(PROXY_BACKOFF_BASE_MS * 2 ** exp, PROXY_BACKOFF_MAX_MS);
}

function readGateDefault(): boolean {
  try {
    // Unit tests mock fetch call-by-call; the gate is opt-in there (setProxyGateEnabled(true)).
    return import.meta.env?.MODE !== "test";
  } catch {
    return true;
  }
}

let gateEnabled = readGateDefault();

function initialSnapshot(): ProxyGateSnapshot {
  return SAMPLE_DATA_MODE
    ? { status: "offline", failures: 0, since: Date.now(), nextRetryAt: null, lastOnlineAt: null, reason: "sample-mode", probing: false, sampleMode: true }
    : { status: "unknown", failures: 0, since: Date.now(), nextRetryAt: null, lastOnlineAt: null, probing: false, sampleMode: false };
}

let gate: ProxyGateSnapshot = initialSnapshot();
const gateListeners = new Set<(s: ProxyGateSnapshot) => void>();
let probePromise: Promise<boolean> | null = null;

function setGate(patch: Partial<ProxyGateSnapshot>): void {
  const next = { ...gate, ...patch };
  const changed = (Object.keys(next) as (keyof ProxyGateSnapshot)[]).some((k) => next[k] !== gate[k]);
  if (!changed) return;
  gate = next;
  gateListeners.forEach((cb) => {
    try {
      cb(gate);
    } catch {
      /* a broken listener must not break the gate */
    }
  });
}

/** Current gate state (immutable snapshot; a new object on every change). */
export function getProxyStatus(): ProxyGateSnapshot {
  return gate;
}

/** True when a request may be sent now: not in sample mode, and online, unknown or past the backoff. */
export function shouldTryProxy(now: number = Date.now()): boolean {
  if (gate.sampleMode) return false;
  if (!gateEnabled) return true;
  if (gate.status !== "offline") return true;
  return gate.nextRetryAt === null || now >= gate.nextRetryAt;
}

/** The proxy answered (any HTTP response counts): reset the backoff. */
export function markProxyOnline(now: number = Date.now()): void {
  if (gate.sampleMode) return;
  setGate({
    status: "online",
    failures: 0,
    nextRetryAt: null,
    lastOnlineAt: now,
    reason: undefined,
    since: gate.status === "online" ? gate.since : now,
  });
}

/**
 * The proxy could not be reached. Failures that land inside the current backoff window (a burst of
 * concurrent requests failing together) do not escalate the backoff; only a failed probe does.
 */
export function markProxyOffline(reason: string = "offline", now: number = Date.now()): void {
  if (gate.sampleMode) return;
  const inWindow = gate.status === "offline" && gate.nextRetryAt !== null && now < gate.nextRetryAt;
  const failures = inWindow ? gate.failures : gate.failures + 1;
  setGate({
    status: "offline",
    failures,
    nextRetryAt: inWindow ? gate.nextRetryAt : now + proxyBackoffMs(failures),
    reason: reason.slice(0, 120),
    since: gate.status === "offline" ? gate.since : now,
  });
}

/** Subscribe to gate changes. Returns an unsubscribe function. */
export function subscribeProxyStatus(cb: (s: ProxyGateSnapshot) => void): () => void {
  gateListeners.add(cb);
  return () => {
    gateListeners.delete(cb);
  };
}

/** React hook over the gate (re-renders on every status change). */
export function useProxyStatus(): ProxyGateSnapshot {
  return useSyncExternalStore(subscribeProxyStatus, getProxyStatus, getProxyStatus);
}

/** Back to "unknown" with no backoff (tests, and after the proxy URL or credentials change). */
export function resetProxyGate(): void {
  probePromise = null;
  gate = initialSnapshot();
  gateListeners.forEach((cb) => cb(gate));
}

/** Enable or disable gating (it is off by default under Vitest so fetch mocks stay one-to-one). */
export function setProxyGateEnabled(enabled: boolean): void {
  gateEnabled = enabled;
}

/**
 * Run (or join) one /health probe. Resolves true when the proxy answered. Without `force` it
 * respects the backoff and resolves false immediately inside a closed window.
 */
export function probeProxy(opts?: { force?: boolean }): Promise<boolean> {
  if (gate.sampleMode) return Promise.resolve(false);
  if (probePromise) return probePromise;
  if (!opts?.force && !shouldTryProxy()) return Promise.resolve(false);
  setGate({ probing: true });
  probePromise = (async () => {
    const { signal, cleanup, timedOut } = linkSignals(HEALTH_PROBE_TIMEOUT_MS);
    try {
      await fetch(`${PROXY_BASE}/health`, { headers: { Accept: "application/json" }, signal, cache: "no-store" });
      // Any HTTP answer proves the proxy process is up (a degraded /health is still reachable).
      markProxyOnline();
      return true;
    } catch {
      if (opts?.force && gate.status === "offline") {
        // A manual retry that fails restarts the current step instead of escalating it.
        setGate({ nextRetryAt: Date.now() + proxyBackoffMs(Math.max(1, gate.failures)), reason: timedOut() ? "timeout" : "offline" });
      } else {
        markProxyOffline(timedOut() ? "timeout" : "offline");
      }
      return false;
    } finally {
      cleanup();
      probePromise = null;
      setGate({ probing: false });
    }
  })();
  return probePromise;
}

/** Synchronous admission: true/false when decidable now, null when a /health probe must decide. */
function admitNow(): boolean | null {
  if (gate.sampleMode) return false;
  if (!gateEnabled || gate.status === "online") return true;
  if (!shouldTryProxy()) return false;
  return null;
}

/** Admission without an extra await on the fast path, so fetch starts in the caller's tick. */
function admit(): boolean | Promise<boolean> {
  const now = admitNow();
  return now !== null ? now : probeProxy();
}

/** Wait for the gate to admit a request: true = send it, false = short-circuit as offline. @public (tests) */
export async function admitProxyRequest(): Promise<boolean> {
  return admit();
}

/** Feed a request outcome back into the gate. */
function recordOutcome(kind: "http" | "network" | "timeout" | "aborted"): void {
  if (!gateEnabled) return;
  if (kind === "http") markProxyOnline();
  // A timeout on a proxied route usually means a slow upstream (NSE), not a dead proxy.
  else if (kind === "network") markProxyOffline("offline");
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  // Coming back online is a good moment to re-check immediately instead of waiting out the backoff.
  window.addEventListener("online", () => {
    if (gate.status === "offline" && !gate.sampleMode) void probeProxy({ force: true });
  });
}

/** GET an envelope route (/api/x/*). Never throws. */
export async function proxyGet<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ProxyEnvelope<T>> {
  if (SAMPLE_DATA_MODE) return { data: null, meta: offlineMeta("sample-mode") };
  const admitted = admit();
  if (!(admitted === true || (admitted !== false && (await admitted)))) return { data: null, meta: offlineMeta("proxy-offline") };
  if (opts?.signal?.aborted) return { data: null, meta: offlineMeta("aborted") };
  const url = buildProxyUrl(path, params);
  const { signal, cleanup, timedOut } = linkSignals(opts?.timeoutMs ?? 15000, opts?.signal);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...dhanHeaders() }, signal });
    recordOutcome("http");
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return { data: null, meta: offlineMeta(res.ok ? "bad-json" : `http-${res.status}`) };
    }
    return normaliseEnvelope<T>(body, res.status);
  } catch {
    if (opts?.signal?.aborted) return { data: null, meta: offlineMeta("aborted") };
    recordOutcome(timedOut() ? "timeout" : "network");
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
  opts?: { timeoutMs?: number; signal?: AbortSignal; withDhan?: boolean; bypassGate?: boolean },
): Promise<T> {
  if (SAMPLE_DATA_MODE) throw new Error("Sample data mode: proxy disabled");
  // bypassGate: the caller is itself a probe (/health); its outcome still updates the gate.
  if (!opts?.bypassGate) {
    const admitted = admit();
    if (!(admitted === true || (admitted !== false && (await admitted)))) throw new Error("Proxy unreachable");
  }
  if (opts?.signal?.aborted) throw new Error("Proxy request aborted");
  const url = buildProxyUrl(path, params);
  const { signal, cleanup, timedOut } = linkSignals(opts?.timeoutMs ?? 15000, opts?.signal);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts?.withDhan !== false) Object.assign(headers, dhanHeaders());
    const res = await fetch(url, { headers, signal });
    recordOutcome("http");
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
    if (opts?.signal?.aborted) throw new Error("Proxy request aborted");
    // The proxy answered (2xx) but the body was not JSON: it is online, so do not report it as unreachable.
    if (e instanceof SyntaxError) throw new Error("Proxy returned invalid JSON");
    recordOutcome(timedOut() && !opts?.bypassGate ? "timeout" : "network");
    throw new Error(timedOut() ? "Proxy request timed out" : "Proxy unreachable");
  } finally {
    cleanup();
  }
}
