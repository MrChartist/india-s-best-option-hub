import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProxyClient = typeof import("@/lib/api/proxyClient");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function freshClient(): Promise<ProxyClient> {
  vi.resetModules();
  const mod = await import("@/lib/api/proxyClient");
  mod.setProxyGateEnabled(true);
  mod.resetProxyGate();
  return mod;
}

describe("proxyBackoffMs", () => {
  it("doubles from 30 s and caps at 5 min", async () => {
    const { proxyBackoffMs } = await import("@/lib/api/proxyClient");
    expect([0, 1, 2, 3, 4, 5, 9].map(proxyBackoffMs)).toEqual([0, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(proxyBackoffMs(Number.NaN)).toBe(0);
    expect(proxyBackoffMs(-3)).toBe(0);
  });
});

describe("reachability gate", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T05:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts unknown, goes offline on a failure and escalates only on later failed windows", async () => {
    const c = await freshClient();
    expect(c.getProxyStatus().status).toBe("unknown");
    expect(c.shouldTryProxy()).toBe(true);

    const t0 = Date.now();
    c.markProxyOffline("offline");
    expect(c.getProxyStatus()).toMatchObject({ status: "offline", failures: 1, nextRetryAt: t0 + 30_000 });
    expect(c.shouldTryProxy()).toBe(false);

    // A burst of failures inside the window does not escalate.
    c.markProxyOffline("offline");
    expect(c.getProxyStatus().failures).toBe(1);

    vi.setSystemTime(t0 + 30_001);
    expect(c.shouldTryProxy()).toBe(true);
    c.markProxyOffline("timeout");
    expect(c.getProxyStatus()).toMatchObject({ failures: 2, reason: "timeout", nextRetryAt: t0 + 30_001 + 60_000 });
  });

  it("resets on the first success and notifies subscribers", async () => {
    const c = await freshClient();
    const seen: string[] = [];
    const unsub = c.subscribeProxyStatus((s) => seen.push(s.status));
    c.markProxyOffline();
    c.markProxyOnline();
    expect(c.getProxyStatus()).toMatchObject({ status: "online", failures: 0, nextRetryAt: null });
    expect(c.getProxyStatus().lastOnlineAt).toBe(Date.now());
    unsub();
    c.markProxyOffline();
    expect(seen).toEqual(["offline", "online"]);
  });

  it("probes /health once for concurrent callers and short-circuits while offline", async () => {
    const c = await freshClient();
    const fetchMock = vi.fn(async (_url: string) => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([
      c.proxyGet("/api/x/a"),
      c.proxyGet("/api/x/b"),
      c.proxyFetchJSON("/api/nse-proxy").catch((e: Error) => e.message),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/health$/);
    expect(results[0]).toMatchObject({ data: null, meta: { stale: true, reason: "proxy-offline" } });
    expect(results[2]).toBe("Proxy unreachable");
    expect(c.getProxyStatus()).toMatchObject({ status: "offline", failures: 1, probing: false });

    // Inside the backoff window nothing touches the network.
    await c.proxyGet("/api/x/c");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a good /health after the backoff lets requests through and resets", async () => {
    const c = await freshClient();
    c.markProxyOffline();
    vi.setSystemTime(Date.now() + 31_000);
    const fetchMock = vi.fn(async (url: string) => (url.endsWith("/health") ? json({ status: "ok" }) : json({ data: [1], meta: { source: "nse", asOf: 1, stale: false } })));
    vi.stubGlobal("fetch", fetchMock);
    const env = await c.proxyGet<number[]>("/api/x/a");
    expect(env.data).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(c.getProxyStatus()).toMatchObject({ status: "online", failures: 0 });
  });

  it("marks the proxy offline when a request fails at the network level, not on HTTP errors", async () => {
    const c = await freshClient();
    c.markProxyOnline();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "upstream" }, 502)));
    await expect(c.proxyFetchJSON("/api/nse-proxy")).rejects.toBeInstanceOf(c.ProxyHttpError);
    expect(c.getProxyStatus().status).toBe("online");

    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(c.proxyFetchJSON("/api/nse-proxy")).rejects.toThrow("Proxy unreachable");
    expect(c.getProxyStatus().status).toBe("offline");
  });

  it("a 2xx with a malformed body is reported as invalid JSON, not as the proxy being unreachable", async () => {
    const c = await freshClient();
    c.markProxyOnline();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway page</html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    await expect(c.proxyFetchJSON("/api/nse-proxy")).rejects.toThrow("Proxy returned invalid JSON");
    expect(c.getProxyStatus().status).toBe("online");
  });

  it("a forced probe ignores the backoff and a failed manual retry does not escalate", async () => {
    const c = await freshClient();
    c.markProxyOffline();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await c.probeProxy()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await c.probeProxy({ force: true })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c.getProxyStatus().failures).toBe(1);

    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "ok" })));
    expect(await c.probeProxy({ force: true })).toBe(true);
    expect(c.getProxyStatus().status).toBe("online");
  });

  it("admits everything when the gate is disabled", async () => {
    const c = await freshClient();
    c.setProxyGateEnabled(false);
    c.markProxyOffline();
    expect(c.shouldTryProxy()).toBe(true);
    expect(await c.admitProxyRequest()).toBe(true);
  });

  it("does not let a throwing listener break the gate", async () => {
    const c = await freshClient();
    c.subscribeProxyStatus(() => {
      throw new Error("boom");
    });
    expect(() => c.markProxyOffline()).not.toThrow();
    expect(c.getProxyStatus().status).toBe("offline");
  });
});
