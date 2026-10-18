/**
 * HTTP-level checks for the 1Cliq trading endpoints in proxy-server.mjs: they sit behind the same
 * Host/Origin allowlists as every other route, state-changing calls are POST + JSON only, and no
 * Dhan call is attempted without credentials. Spawns the real proxy on a spare port; no network
 * access is needed (nothing here reaches Dhan).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { request } from "node:http";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

let proc;
let base;
let recordDir;

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  recordDir = mkdtempSync(join(tmpdir(), "proxy-trade-test-"));
  const env = { ...process.env, PROXY_PORT: String(port), PROXY_HOST: "127.0.0.1", RECORD_DIR: recordDir };
  delete env.DHAN_CLIENT_ID;
  delete env.DHAN_ACCESS_TOKEN;
  delete env.RECORD_SYMBOLS;
  proc = spawn(process.execPath, ["proxy-server.mjs"], { cwd: ROOT, env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("proxy did not start");
}, 20000);

afterAll(() => {
  proc?.kill();
  if (recordDir) rmSync(recordDir, { recursive: true, force: true });
});

const post = (endpoint, body, headers = {}) =>
  fetch(`${base}/api/dhan-proxy?endpoint=${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  });

describe("trading endpoints on /api/dhan-proxy", () => {
  it("reports the risk engine and broker list in /health", async () => {
    const h = await (await fetch(`${base}/health`)).json();
    expect(h.status).toBe("ok");
    expect(Array.isArray(h.brokers)).toBe(true);
    expect(h.brokers).toContain("dhan");
    expect(h.riskEngine).toHaveProperty("armedCount");
  });

  it("refuses GET for state-changing endpoints", async () => {
    for (const e of ["place-order", "panic-close-all", "panic-cancel-all", "risk-arm", "basket-deploy"]) {
      const r = await fetch(`${base}/api/dhan-proxy?endpoint=${e}`);
      expect(r.status, e).toBe(405);
    }
  });

  it("refuses POST for every non-trading route", async () => {
    expect((await post("option-chain", {})).status).toBe(405);
    const r = await fetch(`${base}/api/nse-proxy?endpoint=indices`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(405);
  });

  it("requires a JSON body", async () => {
    const r = await post("place-order", "{}", { "Content-Type": "text/plain" });
    expect(r.status).toBe(415);
    expect((await post("place-order", "not json")).status).toBe(400);
  });

  it("never calls Dhan without credentials (no implicit .env fallback)", async () => {
    for (const e of ["place-order", "panic-close-all", "panic-cancel-all", "cancel-order"]) {
      const r = await post(e, { orderId: "123" });
      expect(r.status, e).toBe(401);
      expect((await r.json()).code).toBe("NO_CREDENTIALS");
    }
    const g = await fetch(`${base}/api/dhan-proxy?endpoint=positions`);
    expect(g.status).toBe(401);
  });

  it("applies the Origin allowlist and the Host allowlist", async () => {
    expect((await post("panic-cancel-all", {}, { Origin: "https://evil.example" })).status).toBe(403);
    // fetch() will not send a spoofed Host header, so use node:http directly (DNS-rebinding case).
    const status = await new Promise((res, rej) => {
      const u = new URL(`${base}/api/dhan-proxy?endpoint=panic-cancel-all`);
      const req = request(
        { host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method: "POST", headers: { Host: "evil.example", "Content-Type": "application/json" } },
        (r) => {
          r.resume();
          res(r.statusCode);
        },
      );
      req.on("error", rej);
      req.end("{}");
    });
    expect(status).toBe(403);
  });

  it("answers the never-cached status endpoints", async () => {
    const s = await (await fetch(`${base}/api/dhan-proxy?endpoint=risk-status`)).json();
    expect(s).toMatchObject({ armedCount: 0, dhanConnected: false });
    const lock = await (await fetch(`${base}/api/dhan-proxy?endpoint=panic-lock-state`)).json();
    expect(typeof lock.state).toBe("string");
  });

  it("only lets a client set locked-by-user or unlocked", async () => {
    const r = await post("panic-set-lock", { state: "locked-by-mtm-loss" }, { Origin: "http://localhost:8080" });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("BAD_LOCK_STATE");
  });

  it("rejects a risk-arm request that fails validation, arming nothing", async () => {
    const r = await post("risk-arm", { securityId: "13" });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("RISK_ARM_REJECTED");
    const s = await (await fetch(`${base}/api/dhan-proxy?endpoint=risk-status`)).json();
    expect(s.armedCount).toBe(0);
  });

  it("validates broker ids and needs credentials on /api/broker-proxy", async () => {
    expect((await fetch(`${base}/api/broker-proxy?broker=nope&endpoint=option-chain`)).status).toBe(400);
    expect((await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=option-chain`)).status).toBe(401);
    expect((await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=nope`)).status).toBe(400);
  });

  it("never places, modifies or cancels an order through /api/broker-proxy, on any method", async () => {
    const creds = Buffer.from(JSON.stringify({ apiKey: "k", accessToken: "t" })).toString("base64");
    for (const e of ["place-order", "modify-order", "cancel-order"]) {
      const g = await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=${e}`, { headers: { "x-broker-credentials": creds } });
      expect(g.status, e).toBe(403);
      expect((await g.json()).code).toBe("ORDER_PATH_BLOCKED");
      const p = await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=${e}`, { method: "POST", headers: { "Content-Type": "application/json", "x-broker-credentials": creds }, body: "{}" });
      expect(p.status, e).toBe(405);
    }
  });

  it("dispatches read capabilities, refusing undeclared ones and bad input before any broker call", async () => {
    const creds = Buffer.from(JSON.stringify({ apiKey: "k", accessToken: "t" })).toString("base64");
    const h = { "x-broker-credentials": creds };
    // Kotak declares no historical capability; Motilal no depth.
    const k = await fetch(`${base}/api/broker-proxy?broker=kotak&endpoint=historical`, { headers: h });
    expect(k.status).toBe(422);
    expect((await k.json()).code).toBe("CAPABILITY_UNSUPPORTED");
    const bad = await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=quotes&refs=nope`, { headers: h });
    expect(bad.status).toBe(422);
    expect((await bad.json()).code).toBe("BROKER_INPUT_INVALID");
    const badInterval = await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=historical&token=1&exchange=NSE&interval=2h&from=2026-10-01&to=2026-10-02`, { headers: h });
    expect(badInterval.status).toBe(422);
    expect((await fetch(`${base}/api/broker-proxy?broker=zerodha&endpoint=positions`)).status).toBe(401);
  });

  it("describes every adapter's capabilities without credentials", async () => {
    const all = await (await fetch(`${base}/api/broker-capabilities`)).json();
    expect(all.brokers).toHaveLength(33);
    for (const b of all.brokers) {
      expect(b.ordersEnabled).toBe(false);
      expect(b.capabilities).toContain("optionChain");
    }
    const one = await (await fetch(`${base}/api/broker-capabilities?broker=upstox`)).json();
    expect(one).toMatchObject({ id: "upstox", authKind: "oauthRedirect" });
    expect(one.endpoints).toContain("positions");
    expect((await fetch(`${base}/api/broker-capabilities?broker=nope`)).status).toBe(400);
  });
});

describe("session login on /api/broker-session-login", () => {
  const login = (broker, body, headers = {}) =>
    fetch(`${base}/api/broker-session-login?broker=${broker}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
    });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

  it("is POST + JSON only, with a small body cap and the Origin allowlist", async () => {
    expect((await fetch(`${base}/api/broker-session-login?broker=angelone`)).status).toBe(405);
    expect((await login("angelone", "{}", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await login("angelone", { values: { x: "y".repeat(5000) } })).status).toBe(413);
    expect((await login("angelone", {}, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await login("nope", {})).status).toBe(400);
  });

  it("refuses brokers without a session login and malformed codes, before any broker call", async () => {
    expect((await (await login("dhan", {})).json()).code).toBe("SESSION_LOGIN_UNSUPPORTED");
    const r = await login("angelone", { values: { apiKey: "k", clientId: "c" }, secrets: { password: "1234", totpCode: "12" } });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.code).toBe("BROKER_INPUT_INVALID");
    expect(JSON.stringify(body)).not.toContain("1234");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("rate-limits repeated attempts per caller and broker", async () => {
    const bad = { values: { userId: "u" }, secrets: { password: "pw12", totpCode: "x" } };
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await login("firstock", bad)).status);
    expect(statuses.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(statuses[5]).toBe(429);
  });

  it("drops password/PIN/TOTP keys from x-broker-credentials and answers 422 until logged in", async () => {
    const creds = b64({ apiKey: "k", clientId: "c", password: "pw", totpSecret: "JBSWY3DPEHPK3PXP" });
    const t = await (await fetch(`${base}/api/broker-test-connection?broker=angelone`, { headers: { "x-broker-credentials": creds } })).json();
    expect(t.status).toBe("error");
    expect(t.message).toMatch(/not logged in/i);
    const r = await fetch(`${base}/api/broker-proxy?broker=angelone&endpoint=ltp`, { headers: { "x-broker-credentials": creds } });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("SESSION_LOGIN_REQUIRED");
  });

  it("decodeBrokerCreds never keeps secret-looking keys (so they cannot reach a cache key)", async () => {
    const { decodeBrokerCreds } = await import("../proxy-server.mjs");
    expect(decodeBrokerCreds(b64({ apiKey: "k", password: "p", mpin: "1", pin: "2", totpSecret: "s", totpCode: "123456", sessionToken: "t" }))).toEqual({ apiKey: "k", sessionToken: "t" });
  }, 30000);
});
