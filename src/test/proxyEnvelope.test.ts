import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { buildProxyUrl, dhanHeaders, normaliseEnvelope, proxyFetchJSON, proxyGet, proxyWsUrl, ProxyHttpError } from "@/lib/api/proxyClient";
import { decryptJSON, encryptJSON, getActiveBroker, getSavedBrokers, getStorageState, sanitizeCredentials, saveBrokerCredentials, wipeAllCredentials } from "@/lib/brokerConfig";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("normaliseEnvelope", () => {
  it("passes a valid envelope through", () => {
    const env = normaliseEnvelope<{ symbols: string[] }>({ data: { symbols: ["SAIL"] }, meta: { source: "nse", asOf: 123, stale: false } });
    expect(env).toEqual({ data: { symbols: ["SAIL"] }, meta: { source: "nse", asOf: 123, stale: false } });
  });

  it("coerces unknown sources and missing fields", () => {
    const env = normaliseEnvelope({ data: [1], meta: { source: "evil", stale: 1 } });
    expect(env.meta.source).toBe("cache");
    expect(env.meta.stale).toBe(true);
    expect(typeof env.meta.asOf).toBe("number");
  });

  it("treats non-envelope bodies as protocol errors", () => {
    expect(normaliseEnvelope({ foo: 1 }).meta.reason).toBe("bad-envelope");
    expect(normaliseEnvelope(null, 502)).toMatchObject({ data: null, meta: { reason: "http-502", stale: true } });
  });

  it("keeps the upstream reason and truncates it", () => {
    const env = normaliseEnvelope({ data: null, meta: { source: "nse", asOf: 1, stale: true, reason: "x".repeat(500) } }, 502);
    expect(env.meta.reason?.length).toBe(300);
  });
});

describe("URL helpers", () => {
  it("builds URLs and drops empty params", () => {
    expect(buildProxyUrl("/api/x/mwpl", { a: "1", b: undefined, c: "", d: 5, e: Number.NaN }, "http://h:1")).toBe("http://h:1/api/x/mwpl?a=1&d=5");
    expect(buildProxyUrl("api/x/ban-list", undefined, "http://h:1")).toBe("http://h:1/api/x/ban-list");
  });

  it("derives the WebSocket URL from the proxy base", () => {
    expect(proxyWsUrl("http://localhost:4002")).toBe("ws://localhost:4002/ws");
    expect(proxyWsUrl("https://proxy.example.com/base/")).toBe("wss://proxy.example.com/base/ws");
    expect(proxyWsUrl("not a url")).toBe("ws://localhost:4002/ws");
  });
});

describe("proxyGet", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the envelope on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [{ date: "2026-10-16", close: 12 }], meta: { source: "yahoo", asOf: 5, stale: false } })));
    const env = await proxyGet<Array<{ date: string; close: number }>>("/api/x/vix-history", { days: 30 });
    expect(env.data?.[0].close).toBe(12);
    expect(env.meta.source).toBe("yahoo");
  });

  it("returns the server envelope for an upstream failure (502)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: null, meta: { source: "nse", asOf: 1, stale: true, reason: "blocked" } }, 502)));
    const env = await proxyGet("/api/x/oi-spurts");
    expect(env.data).toBeNull();
    expect(env.meta.reason).toBe("blocked");
  });

  it("never throws on network errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const env = await proxyGet("/api/x/ban-list");
    expect(env).toMatchObject({ data: null, meta: { reason: "offline", stale: true } });
  });

  it("reports bad JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect((await proxyGet("/api/x/ban-list")).meta.reason).toBe("bad-json");
  });

  it("times out and reports it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    const env = await proxyGet("/api/x/mwpl", undefined, { timeoutMs: 20 });
    expect(env.meta.reason).toBe("timeout");
  });

  it("reports caller aborts separately", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))),
    );
    const p = proxyGet("/api/x/mwpl", undefined, { signal: ctrl.signal });
    ctrl.abort();
    expect((await p).meta.reason).toBe("aborted");
  });
});

describe("proxyFetchJSON", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("throws ProxyHttpError with the server reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "error", reason: "Dhan credentials not configured" }, 502)));
    await expect(proxyFetchJSON("/api/dhan-proxy", { endpoint: "option-chain" })).rejects.toBeInstanceOf(ProxyHttpError);
    await expect(proxyFetchJSON("/api/dhan-proxy")).rejects.toThrow(/Dhan credentials/);
  });

  it("maps network failures to a plain error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(proxyFetchJSON("/health")).rejects.toThrow("Proxy unreachable");
  });
});

describe("Dhan header injection and credential storage", () => {
  beforeEach(() => {
    wipeAllCredentials();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends no headers without keys", () => {
    expect(dhanHeaders()).toEqual({});
  });

  it("stores keys session-only by default and injects them as headers", async () => {
    await saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1000000001", accessToken: "tok_abcdefghijklmnopqrstuvwxyz" }, addedAt: "2026-10-17T00:00:00Z" });
    expect(getStorageState()).toBe("session");
    expect(localStorage.getItem("optionsdesk_broker_keys")).toBeNull();
    expect(dhanHeaders()).toEqual({ "x-dhan-client-id": "1000000001", "x-dhan-access-token": "tok_abcdefghijklmnopqrstuvwxyz" });

    const fetchMock = vi.fn(async () => json({ data: null, meta: { source: "nse", asOf: 1, stale: true } }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyGet("/api/x/chain-multi", { symbol: "NIFTY" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-dhan-client-id"]).toBe("1000000001");
  });

  it("keeps isActive when a broker is edited", async () => {
    await saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "1", accessToken: "a".repeat(30) }, addedAt: "x" });
    expect(getActiveBroker()?.isActive).toBe(true);
    await saveBrokerCredentials({ brokerId: "dhan", values: { clientId: "2", accessToken: "b".repeat(30) }, addedAt: "y" });
    expect(getSavedBrokers()).toHaveLength(1);
    expect(getActiveBroker()).toMatchObject({ isActive: true, addedAt: "x", values: { clientId: "2" } });
  });

  it("strips passwords, MPIN and TOTP fields", () => {
    const clean = sanitizeCredentials([{ brokerId: "angelone", values: { clientId: "A1", password: "p", mpin: "1234", totpSecret: "S", apiKey: " k " }, addedAt: "t", isActive: true }]);
    expect(clean[0].values).toEqual({ clientId: "A1", apiKey: "k" });
    expect(sanitizeCredentials("nope")).toEqual([]);
  });

  it("reads legacy plaintext keys but reports them as legacy", () => {
    localStorage.setItem("optionsdesk_broker_keys", JSON.stringify([{ brokerId: "dhan", values: { clientId: "9", accessToken: "c".repeat(30), password: "x" }, addedAt: "t", isActive: true }]));
    expect(getStorageState()).toBe("legacy");
    expect(getActiveBroker()?.values).toEqual({ clientId: "9", accessToken: "c".repeat(30) });
  });

  const hasSubtle = typeof globalThis.crypto?.subtle?.deriveKey === "function";
  it.runIf(hasSubtle)("encrypts and decrypts with AES-GCM, rejecting a wrong passphrase", async () => {
    const secret = { token: "PLAINTEXT_MARKER_12345" };
    const blob = await encryptJSON(secret, "correct horse");
    expect(atob(blob.ct)).not.toContain("PLAINTEXT_MARKER");
    expect(JSON.stringify(blob)).not.toContain("PLAINTEXT_MARKER");
    expect(await decryptJSON<typeof secret>(blob, "correct horse")).toEqual(secret);
    await expect(decryptJSON(blob, "wrong")).rejects.toBeTruthy();
  }, 20000);
});
