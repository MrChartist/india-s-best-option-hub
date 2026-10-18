/**
 * Axis Direct (RAPID APIs) adapter on the contract harness. No network: fetch is stubbed, the instrument cache is
 * an in-memory map, and the per-session AES key is fixed so the encrypted doc-sample fixtures can be replayed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/instrumentCache.mjs", () => {
  const mem = new Map();
  return {
    ONE_DAY_MS: 86_400_000,
    getCachedOrFetch: async (key, fn) => {
      if (!mem.has(key)) mem.set(key, await fn());
      return mem.get(key);
    },
    __clear: () => mem.clear(),
  };
});

import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import * as cache from "../lib/instrumentCache.mjs";
import * as adapter from "./axisdirect.mjs";
import { __setSecretKeyFactoryForTests, parseExpireAt, resetSessions } from "./axisdirectAuth.mjs";
import { decryptPayload, encryptPayload, encryptSecretKey, newSecretKey, toPem } from "./axisdirectCrypto.mjs";
import { parseMaster, splitCsvLine } from "./axisdirectInstruments.mjs";
import { BrokerError, BrokerInputError, SessionRequiredError, declaredCapabilities, validateAdapter } from "./contract.mjs";
import { createFetchStub, harnessFailures, loadFixtures, runContractHarness } from "./contractHarness.mjs";
import { toOptionData } from "./contractShapes.mjs";

const KEY = "00112233445566778899aabbccddeeff"; // the fixture generator's TEST_SECRET_KEY
const fx = loadFixtures("axisdirect");
const creds = { ...fx.manifest.creds };
const login = fx.byCapability.testConnection.responses.slice(0, 2);
const masterResp = fx.byCapability.instruments.responses[2];
const realFetch = globalThis.fetch;
const stub = (responses) => {
  const s = createFetchStub(responses);
  globalThis.fetch = s.fetch;
  return s;
};
const wrapped = (inner) => ({ statusCode: 200, status: "OK", data: { payload: encryptPayload(JSON.stringify(inner), KEY) } });
const bodyOf = (call) => JSON.parse(decryptPayload(JSON.parse(call.body).payload, KEY));
const dataCalls = (s) => s.calls.filter((c) => !/\/(handshake|sso\/authenticate)$/.test(c.url));

beforeEach(() => {
  cache.__clear();
  resetSessions();
  __setSecretKeyFactoryForTests(() => KEY);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T05:00:00Z")); // 10:30 IST
});
afterEach(() => {
  globalThis.fetch = realFetch;
  __setSecretKeyFactoryForTests(null);
  vi.useRealTimers();
});

describe("axisdirect contract", () => {
  it("is on the strict contract with no warnings and declares only what the docs support", () => {
    const v = validateAdapter(adapter);
    expect(v.mode).toBe("strict");
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(adapter.capabilities.auth.kind).toBe("requestTokenExchange");
    for (const cap of ["placeOrder", "modifyOrder", "cancelOrder", "orderBook", "tradeBook", "depth", "historical", "feed"]) expect(adapter.capabilities[cap]).toBeUndefined();
  });

  it("passes every declared capability against the official-doc fixtures", async () => {
    const report = await runContractHarness(adapter, fx);
    expect(harnessFailures(report)).toEqual([]);
    expect(report.results.map((r) => r.capability).sort()).toEqual(declaredCapabilities(adapter).filter((c) => c !== "auth").sort());
  });
});

describe("axisdirect encryption", () => {
  it("decrypts an AES-GCM vector made independently (Python cryptography) with the documented scheme", () => {
    const vector = "AAECAwQFBgcICQoLDA0ODw==.0XDH02HcyyOTql+rJliJKQ==.7qdVm7I5oR699uk4n3GrTQ==";
    expect(decryptPayload(vector, "0f1e2d3c4b5a69788796a5b4c3d2e1f0")).toBe("{\"segment\":\"EQ\"}");
  });

  it("round-trips, rejects tampering and bad keys", () => {
    const key = newSecretKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    const enc = encryptPayload("{\"a\":1}", key);
    expect(enc.split(".")).toHaveLength(3);
    expect(decryptPayload(enc, key)).toBe("{\"a\":1}");
    const [n, t, c] = enc.split(".");
    expect(() => decryptPayload(`${n}.${t}.${Buffer.from("x" + c).toString("base64")}`, key)).toThrow(BrokerError);
    expect(() => decryptPayload(enc, newSecretKey())).toThrow(BrokerError);
    expect(() => encryptPayload("x", "short")).toThrow(BrokerError);
  });

  it("wraps the secret key with RSA-OAEP SHA-256 under the handshake public key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const bare = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    expect(toPem(bare)).toMatch(/^-----BEGIN PUBLIC KEY-----\n/);
    const wrappedKey = encryptSecretKey(KEY, bare);
    const back = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(wrappedKey, "base64"));
    expect(back.toString("utf8")).toBe(KEY);
    expect(() => encryptSecretKey(KEY, "not a key!")).toThrow(BrokerError);
  });
});

describe("axisdirect session", () => {
  it("authenticates once with the ssoId, then sends the documented headers and an encrypted body", async () => {
    const s = stub(fx.byCapability.funds.responses);
    const r = await adapter.fetchFunds(creds);
    expect(r.data).toEqual({ availableCash: 180000, usedMargin: 70000, totalBalance: 250000, collateral: null, withdrawable: null });
    const auth = s.calls.find((c) => c.url.endsWith("/sso/authenticate"));
    expect(bodyOf(auth)).toEqual({ ssoId: creds.ssoId });
    const [call] = dataCalls(s);
    expect(call.url).toBe("https://funds-api.axisdirect.in/funds/inquiry/get-limits");
    expect(call.headers).toMatchObject({ Authorization: creds.authorizationKey, "x-api-client-id": creds.apiClientId, "x-subAccountID": "100006", "x-authtoken": "dummyAxisAuthToken" });
    expect(call.headers["x-api-encryption-key"]).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(bodyOf(call)).toEqual({ segment: "EQ" });
    expect(call.body).not.toContain("segment");
  });

  it("runs the handshake and SSO Authenticate once under concurrent calls", async () => {
    const s = stub([...fx.byCapability.funds.responses, fx.byCapability.holdings.responses[2]]);
    await Promise.all([adapter.fetchFunds(creds), adapter.fetchHoldings(creds), adapter.fetchFunds(creds)]);
    expect(s.calls.filter((c) => c.url.endsWith("/handshake"))).toHaveLength(1);
    expect(s.calls.filter((c) => c.url.endsWith("/sso/authenticate"))).toHaveLength(1);
  });

  it("renews the 15-minute auth token with the refresh token", async () => {
    stub(fx.byCapability.funds.responses);
    await adapter.fetchFunds(creds);
    vi.setSystemTime(new Date("2026-10-17T05:20:00Z")); // 10:50 IST, past the 10:45 expiry
    const renew = { method: "POST", url: "https://welcome-api.axisdirect.in/v1/handshake/get-auth-token", json: wrapped({ statusCode: 200, status: "OK", data: { token: "renewedToken", expireAt: "2026-10-17T11:05:00+05:30" } }) };
    const s = stub([renew, fx.byCapability.funds.responses[2]]);
    await adapter.fetchFunds(creds);
    const [r, call] = s.calls;
    expect(r.headers["x-subAccountID"]).toBe("100006");
    expect(bodyOf(r)).toEqual({ refreshToken: "dummyAxisRefreshToken" });
    expect(call.headers["x-authtoken"]).toBe("renewedToken");
  });

  it("never re-sends a refused ssoId, but keeps it after a server error", async () => {
    stub([login[0], { method: "POST", url: login[1].url, status: 500, json: { statusCode: 500, status: "Internal Server Error" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ statusCode: 502 });
    stub([login[0], { method: "POST", url: login[1].url, json: wrapped({ statusCode: 400, status: "Bad Request", message: "Invalid ssoId" }) }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    const s = stub(fx.byCapability.funds.responses);
    await expect(adapter.fetchFunds(creds)).rejects.toMatchObject({ statusCode: 422, code: "SESSION_LOGIN_REQUIRED" });
    expect(s.calls).toHaveLength(0);
  });

  it("drops the session when a data call answers 401", async () => {
    stub([...login, { method: "POST", url: "https://funds-api.axisdirect.in/funds/inquiry/get-limits", status: 401, json: { statusCode: 401, status: "Unauthorized" } }]);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    const s = stub(fx.byCapability.funds.responses);
    await expect(adapter.fetchFunds(creds)).rejects.toBeInstanceOf(SessionRequiredError);
    expect(s.calls).toHaveLength(0);
  });

  it("refuses before any network call when credentials are missing", async () => {
    const s = stub([]);
    await expect(adapter.fetchFunds({ apiClientId: "x" })).rejects.toBeInstanceOf(BrokerInputError);
    await expect(adapter.fetchExpiryList({}, "NIFTY")).rejects.toBeInstanceOf(BrokerInputError);
    expect((await adapter.testConnection({})).status).toBe("error");
    expect(s.calls).toHaveLength(0);
  });

  it("parses the documented nanosecond expireAt timestamps", () => {
    expect(parseExpireAt("2024-03-21T15:50:10.940184129+05:30")).toBe(Date.parse("2024-03-21T15:50:10.940+05:30"));
    expect(parseExpireAt("")).toBeNull();
  });
});

describe("axisdirect login start", () => {
  it("returns the microsite URL and its ssoId from SSO Initiate", async () => {
    const init = { method: "POST", url: "https://welcome-api.axisdirect.in/sso/initiate",
      json: wrapped({ statusCode: 200, status: "OK", data: { redirectURL: "https://auth.axisdirect.in/sso/validate?ssoId=4deefd47-cc46-4828-bc71-311f483162a4" } }) };
    const s = stub([login[0], init]);
    const r = await adapter.initiateLogin(creds, { redirectURL: "https://example.in/axis/callback" });
    expect(r).toEqual({ loginUrl: "https://auth.axisdirect.in/sso/validate?ssoId=4deefd47-cc46-4828-bc71-311f483162a4", ssoId: "4deefd47-cc46-4828-bc71-311f483162a4" });
    expect(bodyOf(s.calls[1])).toMatchObject({ type: "LOGIN", redirectURL: "https://example.in/axis/callback" });
    await expect(adapter.initiateLogin(creds, { redirectURL: "http://example.in" })).rejects.toBeInstanceOf(BrokerInputError);
  });
});

describe("axisdirect instruments and market data", () => {
  it("maps the live master layout: canonical indices only, spot ids from the underlying column", async () => {
    stub([...login, masterResp]);
    const rows = (await adapter.fetchInstruments(creds)).data;
    expect(rows.find((r) => r.token === "771125429")).toMatchObject({ exchange: "BFO", underlying: "SENSEX", strike: 82000, optionType: "CE", expiry: "2026-10-22", lotSize: 20 });
    expect(rows.find((r) => r.token === "3341459")).toMatchObject({ exchange: "NFO", instrumentType: "OPTSTK", underlying: "RELIANCE", lotSize: 500 });
    expect(rows.find((r) => r.token === "222885")).toMatchObject({ exchange: "NSE", instrumentType: "EQ", tickSize: 0.1 });
    expect(rows.filter((r) => r.instrumentType === "INDEX").map((r) => r.underlying).sort()).toEqual(["BANKEX", "BANKNIFTY", "NIFTY", "SENSEX"]);
    for (const t of ["771138870", "3340061", "11500325", "55578656"]) expect(rows.some((r) => r.token === t)).toBe(false);
    const { spot } = parseMaster(masterResp.text);
    expect(spot).toMatchObject({ NIFTY: "9926000", FINNIFTY: "9926037", SENSEX: "9919000", RELIANCE: "222885" });
  });

  it("splits quoted CSV fields", () => {
    expect(splitCsvLine("a,\"b, c\",\"d \"\"e\"\"\",f")).toEqual(["a", "b, c", "d \"e\"", "f"]);
    expect(splitCsvLine("1,2,,3")).toEqual(["1", "2", "", "3"]);
  });

  it("builds the option chain from multi-touch-line quotes with locally solved IV", async () => {
    const s = stub(fx.byCapability.optionChain.responses);
    const { spotPrice, chain } = toOptionData(await adapter.fetchOptionChain(creds, "NIFTY", "2026-10-20"));
    expect(spotPrice).toBe(25012.15);
    expect(chain.map((c) => c.strikePrice)).toEqual([24950, 25000, 25050]);
    expect(chain.find((c) => c.strikePrice === 25000).ce).toMatchObject({ ltp: 104.95, oi: 3165900, bidPrice: 104.85, askPrice: 105.05 });
    const quoteCalls = dataCalls(s).filter((c) => c.url.endsWith("/multi-touch-line"));
    expect(bodyOf(quoteCalls[0])).toEqual({ securities: [{ scriptId: "9926000" }] });
    expect(bodyOf(quoteCalls[1]).securities.map((x) => x.scriptId).sort()).toEqual(["3340001", "3340002", "3340003", "3340004", "3340005", "3340006"]);
  });

  it("reads expiries per underlying", async () => {
    stub([...login, masterResp]);
    expect((await adapter.fetchExpiryList(creds, "NIFTY")).data).toEqual(["2026-10-20", "2026-10-27"]);
    expect((await adapter.fetchExpiryList(creds, "SENSEX")).data).toEqual(["2026-10-22"]);
  });
});

describe("axisdirect portfolio", () => {
  it("maps equity (DELIVERY -> CNC) and F&O (NSE OPTIDX -> NFO, MARGIN) positions", async () => {
    stub([...login, fx.byCapability["positions-fo"].responses[0]]);
    const fo = (await adapter.fetchPositions(creds)).data[0];
    expect(fo).toMatchObject({ exchange: "NFO", product: "MARGIN", netQty: 130, avgPrice: 141.3, realisedPnl: -1077.1875, unrealisedPnl: 520, pnl: -557.1875, token: "3340001" });
    stub(fx.byCapability.positions.responses.slice(2));
    expect((await adapter.fetchPositions(creds)).data[0]).toMatchObject({ tradingSymbol: "ICICIBANK", exchange: "NSE", product: "CNC", netQty: -1, avgPrice: 1407.7 });
  });

  it("reads a 206 Partial Content empty book as no rows", async () => {
    stub([...login, { method: "POST", url: "https://invest-api.axisdirect.in/trading/portfolio/get-positions", json: wrapped({ statusCode: 206, status: "Partial Content", data: [] }) }]);
    expect((await adapter.fetchPositions(creds)).data).toEqual([]);
  });

  it("maps holdings from the v2 sample", async () => {
    stub(fx.byCapability.holdings.responses);
    expect((await adapter.fetchHoldings(creds)).data).toEqual([{ tradingSymbol: "AXISBNKETF", exchange: "NSE", token: "221044", isin: "INF846K01X63", qty: 5, avgPrice: 506.67, ltp: null, pnl: null }]);
  });

  it("normalises errors without leaking secrets", () => {
    expect(adapter.normaliseError(new Error("key dummyAxisAuthorisationKey"), { secrets: ["dummyAxisAuthorisationKey"] }).message).not.toContain("dummyAxisAuthorisationKey");
    expect(adapter.normaliseError(new SessionRequiredError())).toMatchObject({ statusCode: 422 });
    expect(adapter.normaliseError(new BrokerError("Axis Direct sent a response that could not be decrypted.", { code: "AXIS_CRYPTO" }))).toMatchObject({ statusCode: 502, code: "UPSTREAM_ERROR" });
  });
});
