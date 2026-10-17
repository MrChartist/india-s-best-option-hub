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

// ── Server snapshot recorder (proxy-server.mjs) ──

interface RecorderModule {
  parseRecordConfig: (env: Record<string, string | undefined>, baseDir?: string) => { enabled: boolean; symbols: string[]; intervalSec: number; expiries: number; retentionDays: number; dir: string };
  isRecordingWindow: (now?: Date) => boolean;
  chainToSnapshotLine: (o: { ts: number; symbol: string; expiry: string; spot: number; source: string; chain: unknown[] }) => { v: 1; ts: number; symbol: string; expiry: string; spot: number; source: string; rows: unknown[][] };
  decodeSnapshotLine: (text: string) => { id: string; symbol: string; expiry: string; ts: number; spot: number; rows: Array<Record<string, unknown>> } | null;
  snapshotFingerprint: (line: unknown) => string;
  parseSnapshotQuery: (params: URLSearchParams, now?: number) => { symbol: string; expiry: string; from: number; to: number; limit: number; strike: number | null; type: string | null };
  istDaysInRange: (from: number, to: number) => string[];
  filterSnapshots: <T extends { ts: number; expiry: string; rows: Array<{ strike: number; side: string }> }>(snaps: T[], q: { from: number; to: number; expiry: string; strike: number | null; type: string | null }) => T[];
  readRecordedSnapshots: (dir: string, q: ReturnType<RecorderModule["parseSnapshotQuery"]>) => Promise<{ snapshots: Array<{ ts: number; rows: unknown[] }>; truncated: boolean }>;
  appendSnapshotLine: (dir: string, line: unknown) => Promise<string>;
  pruneSnapshotFiles: (dir: string, keepDays: number, now?: number) => Promise<number>;
  snapshotsToCsvText: (snaps: unknown[]) => string;
  SERVER_SNAPSHOT_CSV_HEADER: string;
}

const PROXY_SERVER = "../../proxy-server.mjs";

describe("proxy server snapshot recorder", async () => {
  const rec = (await import(/* @vite-ignore */ PROXY_SERVER)) as RecorderModule;
  const { SNAPSHOT_CSV_HEADER } = await import("@/lib/snapshotStore");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const leg = (ltp: number, oi: number, extra: Record<string, number> = {}) => ({ ltp, oi, oiChange: 0, volume: oi * 2, iv: 12.345, delta: 0, gamma: 0, theta: 0, vega: 0, bidPrice: ltp - 0.5, askPrice: ltp + 0.5, ...extra });
  const chain = [
    { strikePrice: 25100, ce: leg(40.123, 900), pe: leg(0, 0, { volume: 0, bidPrice: 0, askPrice: 0 }) },
    { strikePrice: 25000, ce: leg(90, 500, { bidQty: 75, askQty: 150 }), pe: leg(60, 700) },
  ];
  const T = Date.UTC(2026, 9, 16, 5, 0); // Fri 10:30 IST

  it("parses the opt-in configuration and clamps the interval", () => {
    expect(rec.parseRecordConfig({}).enabled).toBe(false);
    const c = rec.parseRecordConfig({ RECORD_SYMBOLS: " nifty, BANKNIFTY ,bad sym,NIFTY", RECORD_INTERVAL_SEC: "10", RECORD_EXPIRIES: "9" }, "/srv");
    expect(c).toEqual({ enabled: true, symbols: ["NIFTY", "BANKNIFTY"], intervalSec: 60, expiries: 3, retentionDays: 30, dir: "/srv/data/snapshots" });
    expect(rec.parseRecordConfig({ RECORD_SYMBOLS: "NIFTY", RECORD_INTERVAL_SEC: "999" }).intervalSec).toBe(180);
    expect(rec.parseRecordConfig({ RECORD_SYMBOLS: "NIFTY", RECORD_INTERVAL_SEC: "abc" }).intervalSec).toBe(60);
  });

  it("records only during market hours on weekdays", () => {
    expect(rec.isRecordingWindow(new Date("2026-10-16T03:44:00Z"))).toBe(false); // 09:14 IST
    expect(rec.isRecordingWindow(new Date("2026-10-16T03:45:00Z"))).toBe(true); // 09:15 IST
    expect(rec.isRecordingWindow(new Date("2026-10-16T10:00:00Z"))).toBe(true); // 15:30 IST
    expect(rec.isRecordingWindow(new Date("2026-10-16T10:01:00Z"))).toBe(false);
    expect(rec.isRecordingWindow(new Date("2026-10-17T05:00:00Z"))).toBe(false); // Saturday
  });

  it("encodes compact NDJSON lines and decodes them to the browser snapshot shape", () => {
    const line = rec.chainToSnapshotLine({ ts: T, symbol: "NIFTY", expiry: "2026-10-20", spot: 25012.345, source: "nse", chain });
    expect(line.rows).toHaveLength(3); // the empty 25100 PE is dropped
    expect(line.rows[0]).toEqual([25000, 0, 90, 500, 1000, 12.35, 89.5, 90.5, 75, 150]);
    const back = rec.decodeSnapshotLine(JSON.stringify(line));
    expect(back).toMatchObject({ id: `NIFTY|2026-10-20|${T}`, symbol: "NIFTY", expiry: "2026-10-20", ts: T, spot: 25012.35 });
    expect(back?.rows[0]).toEqual({ strike: 25000, side: "CE", ltp: 90, oi: 500, vol: 1000, iv: 12.35, bid: 89.5, ask: 90.5, bidQty: 75, askQty: 150 });
    expect(back?.rows[1]).toEqual({ strike: 25000, side: "PE", ltp: 60, oi: 700, vol: 1400, iv: 12.35, bid: 59.5, ask: 60.5 });
    expect(rec.decodeSnapshotLine("{bad json")).toBeNull();
    expect(rec.decodeSnapshotLine(JSON.stringify({ v: 2 }))).toBeNull();
    const same = rec.chainToSnapshotLine({ ts: T + 60_000, symbol: "NIFTY", expiry: "2026-10-20", spot: 25012.345, source: "nse", chain });
    expect(rec.snapshotFingerprint(same)).toBe(rec.snapshotFingerprint(line));
  });

  it("validates the query and defaults to today's IST session", () => {
    const q = rec.parseSnapshotQuery(new URLSearchParams("symbol=nifty&expiry=20-Oct-2026"), T);
    expect(q).toMatchObject({ symbol: "NIFTY", expiry: "2026-10-20", to: T, from: Date.UTC(2026, 9, 15, 18, 30), limit: 2000, strike: null, type: null });
    const d = rec.parseSnapshotQuery(new URLSearchParams("symbol=NIFTY&from=2026-10-14&to=2026-10-15&strike=25000&type=pe"), T);
    expect(d).toMatchObject({ from: Date.UTC(2026, 9, 13, 18, 30), to: Date.UTC(2026, 9, 15, 18, 30) - 1, strike: 25000, type: "PE" });
    expect(rec.istDaysInRange(d.from, d.to)).toEqual(["2026-10-14", "2026-10-15"]);
    for (const bad of ["", "symbol=NIFTY&from=abc", "symbol=NIFTY&from=2026-10-01&to=2026-12-31", "symbol=NIFTY&type=FUT", "symbol=NIFTY&strike=-1", `symbol=NIFTY&from=${T}&to=${T - 1}`]) {
      expect(() => rec.parseSnapshotQuery(new URLSearchParams(bad), T)).toThrow();
    }
  });

  it("appends, reads back, filters, exports CSV and prunes day files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-snapshots-"));
    try {
      const l1 = rec.chainToSnapshotLine({ ts: T, symbol: "NIFTY", expiry: "2026-10-20", spot: 25000, source: "nse", chain });
      const l2 = rec.chainToSnapshotLine({ ts: T + 60_000, symbol: "NIFTY", expiry: "2026-10-27", spot: 25010, source: "nse", chain });
      const file = await rec.appendSnapshotLine(dir, l1);
      await rec.appendSnapshotLine(dir, l2);
      expect(file.endsWith(path.join("NIFTY", "2026-10-16.ndjson"))).toBe(true);
      await fs.appendFile(file, "not json\n");
      const all = await rec.readRecordedSnapshots(dir, rec.parseSnapshotQuery(new URLSearchParams("symbol=NIFTY"), T + 120_000));
      expect(all.snapshots.map((s) => s.ts)).toEqual([T, T + 60_000]);
      const one = await rec.readRecordedSnapshots(dir, rec.parseSnapshotQuery(new URLSearchParams("symbol=NIFTY&expiry=2026-10-27&strike=25000&type=CE&limit=1"), T + 120_000));
      expect(one.snapshots).toHaveLength(1);
      expect(one.snapshots[0].rows).toHaveLength(1);
      const capped = await rec.readRecordedSnapshots(dir, rec.parseSnapshotQuery(new URLSearchParams("symbol=NIFTY&limit=1"), T + 120_000));
      expect(capped).toMatchObject({ truncated: true });
      const csv = rec.snapshotsToCsvText(all.snapshots).trim().split("\n");
      expect(rec.SERVER_SNAPSHOT_CSV_HEADER).toBe(SNAPSHOT_CSV_HEADER);
      expect(csv[0]).toBe(SNAPSHOT_CSV_HEADER);
      expect(csv[1].startsWith("2026-10-16 10:30:00,")).toBe(true);
      expect(csv).toHaveLength(1 + 3 + 3);

      await fs.mkdir(path.join(dir, "NIFTY"), { recursive: true });
      await fs.writeFile(path.join(dir, "NIFTY", "2026-08-01.ndjson"), "");
      expect(await rec.pruneSnapshotFiles(dir, 30, T)).toBe(1);
      expect(await rec.pruneSnapshotFiles(path.join(dir, "missing"), 30, T)).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
