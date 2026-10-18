/**
 * Session login for the brokers that need a password/PIN + the current TOTP code: every one of them
 * is on the strict contract, its login() passes its recorded fixture, and the password/PIN/code are
 * never returned, logged, cached or used after login. No network: fetch is stubbed throughout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrokerRegistry } from "./registry.mjs";
import { FORBIDDEN_SECRET_KEY, SessionRequiredError, validateAdapter } from "./contract.mjs";
import { createFetchStub, loadFixtures, runLoginContract } from "./contractHarness.mjs";
import { createLoginRateLimiter, handleSessionLogin, readTotpCode, sessionFromCreds } from "./sessionLogin.mjs";
import { authFetch } from "./angeloneAuth.mjs";
import { getSession as kotakSession, login as kotakLogin, safeKotakBaseUrl } from "./kotakAuth.mjs";
import { BROKERS } from "../../src/lib/brokerConfig.ts";

const SESSION_BROKERS = ["angelone", "definedge", "fivepaisa", "firstock", "indmoney", "kotak", "motilal", "mstock", "nubra", "tradejini"];
const registry = createBrokerRegistry();
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stub(responses) {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
}

describe.each(SESSION_BROKERS)("%s session login", (id) => {
  const adapter = registry.get(id);

  it("is on the strict contract with no secret credential fields", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("sessionLogin");
    expect(adapter.credentialFields.filter((f) => FORBIDDEN_SECRET_KEY.test(f))).toEqual([]);
  });

  it("logs in from its fixture, sends the typed code and returns only session fields", async () => {
    const { manifest, byCapability } = loadFixtures(id);
    const r = await runLoginContract(adapter, byCapability.login, manifest.creds);
    expect(r.problems).toEqual([]);
  });

  it("refuses data calls until logged in, without touching the network", async () => {
    const s = stub([]);
    const { manifest } = loadFixtures(id);
    const res = await adapter.testConnection({ ...manifest.creds });
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/log in/i);
    await expect(adapter.fetchLTP({ ...manifest.creds }, "NIFTY")).rejects.toBeInstanceOf(SessionRequiredError);
    await expect(adapter.fetchOptionChain({ ...manifest.creds }, "NIFTY", manifest.expiry)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("matches the Broker Settings login prompts", () => {
    const ui = BROKERS.find((b) => b.id === id);
    expect(ui?.integrated).toBe(true);
    expect(ui?.sessionLogin?.prompts.map((p) => p.key).sort()).toEqual(adapter.capabilities.auth.loginFields.map((f) => f.key).sort());
    // What the UI lets the user save is exactly the adapter's non-secret credential fields.
    expect(ui?.fields.map((f) => f.key).sort()).toEqual([...adapter.credentialFields].sort());
  });
});

describe("handleSessionLogin", () => {
  const { manifest, byCapability } = loadFixtures("angelone");
  const secrets = byCapability.login.secrets;
  const call = (body, limiter = createLoginRateLimiter()) =>
    handleSessionLogin({ registry, brokerId: "angelone", body, rateKey: "127.0.0.1", limiter });

  it("returns only the session, never the PIN or code, and logs nothing secret", async () => {
    stub(byCapability.login.responses);
    const logs = [];
    for (const k of ["log", "warn", "error", "info"]) vi.spyOn(console, k).mockImplementation((...a) => logs.push(a.join(" ")));
    const out = await call({ values: manifest.creds, secrets });
    expect(out.status).toBe(200);
    expect(Object.keys(out.body.session).sort()).toEqual(["feedToken", "refreshToken", "sessionToken"]);
    const blob = JSON.stringify(out) + logs.join("\n");
    expect(blob).not.toContain(secrets.password);
    expect(blob).not.toContain(secrets.totpCode);
  });

  it("refuses a malformed code, a missing PIN and unknown secret keys before any network call", async () => {
    const s = stub([]);
    expect((await call({ values: manifest.creds, secrets: { ...secrets, totpCode: "12345" } })).body.code).toBe("BROKER_INPUT_INVALID");
    expect((await call({ values: manifest.creds, secrets: { totpCode: "123456" } })).status).toBe(422);
    expect((await call({ values: manifest.creds, secrets: { ...secrets, totpSecret: "JBSWY3DPEHPK3PXP" } })).status).toBe(422);
    expect(s.calls).toHaveLength(0);
  });

  it("drops secret-looking keys smuggled into the stored values", async () => {
    const s = stub(byCapability.login.responses);
    await call({ values: { ...manifest.creds, totpSecret: "JBSWY3DPEHPK3PXP" }, secrets });
    expect(s.calls.map((c) => c.body).join("")).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("forwards only the adapter's credentialFields to login(), never the previous session's tokens", async () => {
    const adapter = registry.get("angelone");
    const seen = [];
    const realLogin = adapter.login;
    const spyRegistry = { has: (id) => id === "angelone", get: () => ({ ...adapter, login: async (c) => { seen.push(c); return realLogin(c); } }) };
    stub(byCapability.login.responses);
    const stale = { sessionToken: "old-jwt", refreshToken: "old-refresh", feedToken: "old-feed", sessionExpiresAt: "1", extra: "x" };
    const out = await handleSessionLogin({ registry: spyRegistry, brokerId: "angelone", body: { values: { ...manifest.creds, ...stale }, secrets }, rateKey: "127.0.0.1", limiter: createLoginRateLimiter() });
    expect(out.status).toBe(200);
    expect(Object.keys(seen[0]).sort()).toEqual([...new Set([...Object.keys(manifest.creds).filter((k) => adapter.credentialFields.includes(k)), ...Object.keys(secrets)])].sort());
  });

  it("redacts a secret the broker echoes back in its error", async () => {
    stub([{ method: "POST", urlPattern: "loginByPassword", status: 401, json: { status: false, message: `Invalid PIN ${secrets.password}` } }]);
    const out = await call({ values: manifest.creds, secrets });
    expect(out.status).toBe(502);
    expect(JSON.stringify(out.body)).not.toContain(secrets.password);
  });

  it("rate-limits per caller and broker", async () => {
    stub([]);
    const limiter = createLoginRateLimiter({ max: 2, windowMs: 60_000 });
    const bad = { values: manifest.creds, secrets: { ...secrets, totpCode: "x" } };
    await call(bad, limiter);
    await call(bad, limiter);
    expect((await call(bad, limiter)).status).toBe(429);
  });

  it("also caps attempts per caller across all brokers", async () => {
    stub([]);
    const ipLimiter = createLoginRateLimiter({ max: 3, windowMs: 60_000 });
    const perBroker = createLoginRateLimiter({ max: 5, windowMs: 60_000 });
    const bad = { values: {}, secrets: { totpCode: "x" } };
    const statuses = [];
    for (const brokerId of ["angelone", "firstock", "motilal", "tradejini"]) {
      statuses.push((await handleSessionLogin({ registry, brokerId, body: bad, rateKey: "1.2.3.4", limiter: perBroker, ipLimiter })).status);
    }
    expect(statuses.slice(0, 3).every((st) => st !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
    // Another caller still has its own budget.
    expect((await handleSessionLogin({ registry, brokerId: "angelone", body: bad, rateKey: "5.6.7.8", limiter: perBroker, ipLimiter })).status).not.toBe(429);
  });

  it("does not flag a short PIN that happens to appear in expiresAt's digits", async () => {
    const { checkLoginResult } = await import("./contractShapes.mjs");
    const expiresAt = 1_900_000_000_000;
    const ok = { session: { sessionToken: "tok-abc" }, expiresAt };
    expect(checkLoginResult(ok, { sessionFields: ["sessionToken"], secrets: ["0000", "1900"] })).toEqual([]);
    expect(checkLoginResult({ session: { sessionToken: "1900" }, expiresAt }, { sessionFields: ["sessionToken"], secrets: ["1900"] })).toContain("login() result contains a secret value");
    expect(checkLoginResult({ session: { sessionToken: "xx-hunter22-yy" }, expiresAt }, { sessionFields: ["sessionToken"], secrets: ["hunter22"] })).toContain("login() result contains a secret value");
  });

  it("refuses brokers that do not use a session login", async () => {
    const out = await handleSessionLogin({ registry, brokerId: "dhan", body: {}, rateKey: "x" });
    expect(out).toMatchObject({ status: 422, body: { code: "SESSION_LOGIN_UNSUPPORTED" } });
  });
});

describe("using a stored session", () => {
  const creds = { apiKey: "k", clientId: "A1", sessionToken: "jwt-abc" };

  it("sends the session token, and maps a rejected token to SessionRequiredError", async () => {
    const s = stub([{ method: "POST", urlPattern: "/quote/", status: 200, json: { status: true, data: { fetched: [] } } }]);
    await authFetch(creds, "/rest/secure/angelbroking/market/v1/quote/", { mode: "FULL" });
    expect(s.calls[0].headers.Authorization).toBe("Bearer jwt-abc");
    stub([{ method: "POST", urlPattern: "/quote/", status: 200, json: { status: false, errorcode: "AG8001", message: "Invalid Token" } }]);
    await expect(authFetch(creds, "/rest/secure/angelbroking/market/v1/quote/", {})).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it("treats an expired session as logged out", () => {
    expect(() => sessionFromCreds({ sessionToken: "t", sessionExpiresAt: String(Date.now() - 1) }, ["sessionToken"], "X")).toThrow(SessionRequiredError);
    expect(sessionFromCreds({ sessionToken: "t", sessionExpiresAt: String(Date.now() + 60_000) }, ["sessionToken"], "X")).toEqual({ sessionToken: "t" });
  });

  it("only accepts 6-digit codes", () => {
    expect(readTotpCode({ totpCode: " 012345 " })).toBe("012345");
    for (const bad of ["12345", "1234567", "12a456", "", undefined]) expect(() => readTotpCode({ totpCode: bad })).toThrow();
  });

  it("uses the Kotak baseUrl recorded at login, not the one the browser sends back", async () => {
    const kfx = loadFixtures("kotak");
    stub(kfx.byCapability.login.responses);
    const { session, expiresAt } = await kotakLogin({ ...kfx.manifest.creds, ...kfx.byCapability.login.secrets });
    const tampered = { ...kfx.manifest.creds, ...session, sessionExpiresAt: String(expiresAt), sessionBaseUrl: "https://other.kotaksecurities.com" };
    expect(kotakSession(tampered).baseUrl).toBe("https://cis.kotaksecurities.com");
    // With no record (a token this proxy never saw), the browser copy is used only if it passes the host check.
    const unknown = { ...tampered, sessionToken: "never-seen-token" };
    expect(kotakSession(unknown).baseUrl).toBe("https://other.kotaksecurities.com");
    expect(() => kotakSession({ ...unknown, sessionBaseUrl: "https://a.b.kotaksecurities.com" })).toThrow(/baseUrl/);
  });

  it("never lets a stored Kotak baseUrl point outside kotaksecurities.com", () => {
    expect(safeKotakBaseUrl("https://cis.kotaksecurities.com/")).toBe("https://cis.kotaksecurities.com");
    expect(safeKotakBaseUrl("https://gw-napi.kotaksecurities.com")).toBe("https://gw-napi.kotaksecurities.com");
    for (const bad of ["http://cis.kotaksecurities.com", "https://kotaksecurities.com.evil.example", "https://evil.example/kotaksecurities.com", "https://u:p@cis.kotaksecurities.com", "nonsense",
      "https://kotaksecurities.com", "https://www.kotaksecurities.com", "https://user.content.kotaksecurities.com", "https://cis.kotaksecurities.com:8443", "https://cis.kotaksecurities.com/?x=1"]) {
      expect(safeKotakBaseUrl(bad)).toBeNull();
    }
  });
});
