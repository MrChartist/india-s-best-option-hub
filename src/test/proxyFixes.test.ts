// @vitest-environment node
/**
 * Regression tests for proxy-server.mjs fixes. No real network calls: upstream fetch is stubbed and
 * the only sockets are loopback servers created here.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import net from "node:net";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The parts of a `ws` client socket the test uses (the package ships no types here). */
interface WsSocket {
  readonly readyState: number;
  on(event: "error", cb: () => void): void;
}
type WsCtor = (new (url: string) => WsSocket) & { CONNECTING: number };
const WS_MODULE = "ws";

interface ProxyModule {
  closeUpstream: (socket: WsSocket) => void;
  server: http.Server;
  isTrustedClient: (addr: string, nets?: unknown[]) => boolean;
  parseTrustedNets: (value: string) => unknown[];
  isWalkBackFatal: (e: unknown) => boolean;
  latestParticipant: (kind: string, dateIso: string) => Promise<unknown>;
  participantHistory: (days: number) => Promise<unknown[]>;
  yahooCacheKey: (ySym: string, yInt: string, fromIso: string | undefined, toIso: string | undefined, nowMs?: number) => string;
  requireList: (value: unknown, what: string) => unknown[];
  retryAfterMsFor: (status: number, header: string | null) => number;
  upstreamFetch: (source: string, url: string, init?: RequestInit, timeoutMs?: number, blockKey?: string) => Promise<Response>;
  UpstreamError: new (source: string, status: number, message: string) => Error & { status: number };
  parseSnapshotQuery: (params: URLSearchParams, now?: number) => unknown;
  readRecordedSnapshots: (dir: string, q: unknown) => Promise<{ snapshots: Array<{ ts: number }>; truncated: boolean }>;
}

const PROXY_SERVER = "../../proxy-server.mjs";
let proxy: ProxyModule;

beforeAll(async () => {
  proxy = (await import(/* @vite-ignore */ PROXY_SERVER)) as ProxyModule;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upstream feed replacement", () => {
  it("closing a socket that is still CONNECTING does not raise an unhandled 'error'", async () => {
    // A TCP server that accepts but never completes the WebSocket upgrade.
    const conns = new Set<net.Socket>();
    const tcp = net.createServer((c) => { conns.add(c); c.on("error", () => undefined); });
    await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r));
    const port = (tcp.address() as net.AddressInfo).port;
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on("uncaughtException", onUncaught);
    try {
      const { WebSocket } = (await import(/* @vite-ignore */ WS_MODULE)) as { WebSocket: WsCtor };
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("error", () => undefined);
      await new Promise((r) => setTimeout(r, 30));
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      proxy.closeUpstream(ws);
      await new Promise((r) => setTimeout(r, 50));
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      for (const c of conns) c.destroy();
      await new Promise((r) => tcp.close(r));
    }
  });
});

describe("HTTP envelope routes and Dhan headers", () => {
  let port = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => proxy.server.listen(0, "127.0.0.1", r));
    port = (proxy.server.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => proxy.server.close(r));
  });

  const get = (path: string, headers: Record<string, string>) =>
    new Promise<{ status: number; body: { meta?: { reason?: string } } }>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: JSON.parse(text) }));
      });
      req.on("error", reject);
    });

  it("a malformed saved Dhan key does not break routes that never use Dhan", async () => {
    const r = await get("/api/x/snapshots/status", { Origin: "http://localhost:8080", "x-dhan-client-id": "12", "x-dhan-access-token": "x" });
    expect(r.status).toBe(200);
    expect(r.body.meta?.reason).toBeUndefined();
  });
});

describe(".env credential trust", () => {
  it("is decided by the socket address, not by headers", () => {
    expect(proxy.isTrustedClient("127.0.0.1")).toBe(true);
    expect(proxy.isTrustedClient("::1")).toBe(true);
    expect(proxy.isTrustedClient("::ffff:127.0.0.1")).toBe(true);
    expect(proxy.isTrustedClient("192.168.1.20")).toBe(false);
    expect(proxy.isTrustedClient("172.17.0.1")).toBe(false);
  });

  it("accepts addresses listed in PROXY_TRUSTED_NETS", () => {
    const nets = proxy.parseTrustedNets("172.16.0.0/12, 10.1.2.3, fd00::1, junk, 1.2.3.4/40");
    expect(proxy.isTrustedClient("172.17.0.1", nets)).toBe(true);
    expect(proxy.isTrustedClient("::ffff:172.31.255.254", nets)).toBe(true);
    expect(proxy.isTrustedClient("172.32.0.1", nets)).toBe(false);
    expect(proxy.isTrustedClient("10.1.2.3", nets)).toBe(true);
    expect(proxy.isTrustedClient("10.1.2.4", nets)).toBe(false);
    expect(proxy.isTrustedClient("fd00::1", nets)).toBe(true);
    expect(proxy.isTrustedClient("1.2.3.4", nets)).toBe(false);
  });
});

describe("archive walk-back", () => {
  it("stops on network failures and server errors, moves on for missing files", () => {
    const E = proxy.UpstreamError;
    expect(proxy.isWalkBackFatal(new E("nse", 0, "timed out"))).toBe(true);
    expect(proxy.isWalkBackFatal(new E("nse", 429, "rate"))).toBe(true);
    expect(proxy.isWalkBackFatal(new E("nse", 503, "down"))).toBe(true);
    expect(proxy.isWalkBackFatal(new E("nse", 404, "missing"))).toBe(false);
    expect(proxy.isWalkBackFatal(new E("nse", 403, "missing"))).toBe(false);
    expect(proxy.isWalkBackFatal(new Error("Participant file has no header row"))).toBe(false);
  });

  it("latestParticipant tries one date when the archive host is unreachable", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", fetchMock);
    await expect(proxy.latestParticipant("oi", "2025-01-10")).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("participantHistory stops at the first network failure", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("fetch failed"); });
    vi.stubGlobal("fetch", fetchMock);
    await proxy.participantHistory(20);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
  }, 8000);
});

describe("Yahoo chart cache key", () => {
  const now = Date.parse("2026-10-16T06:00:00Z"); // 11:30 IST
  it("is stable for open-ended ranges", () => {
    expect(proxy.yahooCacheKey("^NSEI", "1d", undefined, undefined, now)).toBe(proxy.yahooCacheKey("^NSEI", "1d", undefined, undefined, now + 2000));
    expect(proxy.yahooCacheKey("^NSEI", "1d", undefined, "2026-10-16", now)).toBe(proxy.yahooCacheKey("^NSEI", "1d", undefined, "2026-10-16", now + 30_000));
    expect(proxy.yahooCacheKey("^NSEI", "1d", "2026-01-01", "2026-10-20", now)).toBe(proxy.yahooCacheKey("^NSEI", "1d", "2026-01-01", undefined, now));
  });
  it("still separates different ranges and intervals", () => {
    const a = proxy.yahooCacheKey("^NSEI", "1d", "2026-01-01", "2026-03-31", now);
    expect(a).not.toBe(proxy.yahooCacheKey("^NSEI", "1d", "2026-01-01", "2026-04-01", now));
    expect(a).not.toBe(proxy.yahooCacheKey("^NSEI", "5m", "2026-01-01", "2026-03-31", now));
    expect(a).not.toBe(proxy.yahooCacheKey("^NSEBANK", "1d", "2026-01-01", "2026-03-31", now));
  });
});

describe("envelope list payloads", () => {
  it("rejects a missing or non-array field and accepts a real empty list", () => {
    expect(() => proxy.requireList(undefined, "most-active")).toThrow(/unexpected most-active/);
    expect(() => proxy.requireList({}, "deals")).toThrow();
    expect(() => proxy.requireList(null, "deals")).toThrow();
    expect(proxy.requireList([], "deals")).toEqual([]);
    expect(proxy.requireList([1], "deals")).toEqual([1]);
  });
});

describe("upstream 429 back-off", () => {
  const ok = () => new Response("{}", { status: 200 });
  const limited = (headers: Record<string, string> = {}) => new Response("slow down", { status: 429, headers });

  it("respects an explicit Retry-After: 0", () => {
    expect(proxy.retryAfterMsFor(429, "0")).toBe(0);
    expect(proxy.retryAfterMsFor(429, null)).toBe(60000);
    expect(proxy.retryAfterMsFor(429, "5")).toBe(5000);
    expect(proxy.retryAfterMsFor(500, null)).toBe(0);
  });

  it("blocks only the endpoint family and credential that was rate-limited", async () => {
    const fetchMock = vi.fn(async () => limited());
    vi.stubGlobal("fetch", fetchMock);
    await expect(proxy.upstreamFetch("dhan", "https://dhan.invalid/oc", {}, 1000, "dhan:oc:test-a")).rejects.toMatchObject({ status: 429 });
    fetchMock.mockImplementation(async () => ok());
    await expect(proxy.upstreamFetch("dhan", "https://dhan.invalid/ltp", {}, 1000, "dhan:api:test-a")).resolves.toBeInstanceOf(Response);
    await expect(proxy.upstreamFetch("dhan", "https://dhan.invalid/oc", {}, 1000, "dhan:oc:test-b")).resolves.toBeInstanceOf(Response);
    // The rate-limited key itself is still blocked, without another upstream call.
    const calls = fetchMock.mock.calls.length;
    await expect(proxy.upstreamFetch("dhan", "https://dhan.invalid/oc", {}, 1000, "dhan:oc:test-a")).rejects.toMatchObject({ status: 429 });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("does not block after a 429 that says Retry-After: 0", async () => {
    const fetchMock = vi.fn(async () => limited({ "Retry-After": "0" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(proxy.upstreamFetch("yahoo", "https://y.invalid/a", {}, 1000, "yahoo:test-zero")).rejects.toMatchObject({ status: 429 });
    fetchMock.mockImplementation(async () => ok());
    await expect(proxy.upstreamFetch("yahoo", "https://y.invalid/a", {}, 1000, "yahoo:test-zero")).resolves.toBeInstanceOf(Response);
  });
});

describe("recorded snapshot reads", () => {
  it.skipIf(process.platform === "win32")("stop reading once limit + 1 matches are collected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snaps-"));
    try {
      await mkdir(join(dir, "NIFTY"), { recursive: true });
      const T0 = Date.parse("2026-10-14T04:00:00Z");
      const line = (ts: number, expiry: string) => JSON.stringify({ v: 1, ts, symbol: "NIFTY", expiry, spot: 25000, source: "nse", rows: [[25000, 0, 90, 500, 1000, 12, 89, 91, null, null]] });
      await writeFile(join(dir, "NIFTY", "2026-10-14.ndjson"), [line(T0, "2026-10-27"), line(T0 + 1000, "2026-11-03"), line(T0 + 60_000, "2026-10-27"), line(T0 + 120_000, "2026-10-27")].join("\n") + "\n");
      // The next day's file is a FIFO with no writer: opening it would block forever, so the read
      // only finishes if it stops before touching that day.
      execFileSync("mkfifo", [join(dir, "NIFTY", "2026-10-15.ndjson")]);
      const q = proxy.parseSnapshotQuery(new URLSearchParams("symbol=NIFTY&expiry=2026-10-27&from=2026-10-14&to=2026-10-15&limit=2"), Date.parse("2026-10-16T06:00:00Z"));
      const out = await proxy.readRecordedSnapshots(dir, q);
      expect(out.truncated).toBe(true);
      expect(out.snapshots.map((s) => s.ts)).toEqual([T0, T0 + 60_000]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 5000);
});
