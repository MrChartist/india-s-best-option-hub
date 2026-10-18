import { describe, expect, it } from "vitest";
import { BROKERS as CATALOG } from "./brokerCatalog";
import { BROKER_ADAPTER_META } from "./brokerCapabilities.generated";
import { BROKERS, SESSION_LOGIN_BROKER_IDS, VERIFIED_BROKER_IDS, clearSession, getBrokerSessionState, isForbiddenFieldKey, sessionKeysFor } from "./brokerConfig";

const FORBIDDEN = { test: isForbiddenFieldKey };

const SECRET_KEYS = ["password", "passwd", "pin", "mpin", "loginPin", "tradingPin", "pinCode", "userPin", "trading_pin", "totp", "totpCode", "otp", "twoFA", "factor2", "dob", "userDob", "pan", "panNumber", "securityAnswer"];
const SAFE_KEYS = ["apiKey", "apiSecret", "clientId", "clientCode", "userId", "vendorCode", "accessToken", "sessionToken", "feedToken", "encryptionKey", "mobileNumber", "requestCode", "appCode", "userKey", "spinner", "company", "optionChain", "sessionServerId"];

describe("isForbiddenFieldKey", () => {
  it("catches camelCase and snake_case second factors", () => {
    expect(SECRET_KEYS.filter((k) => !isForbiddenFieldKey(k))).toEqual([]);
  });
  it("leaves ordinary credential keys alone", () => {
    expect(SAFE_KEYS.filter((k) => isForbiddenFieldKey(k))).toEqual([]);
  });
});

describe("broker catalogue", () => {
  it("lists all 41 adapters exactly once", () => {
    const ids = CATALOG.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(BROKER_ADAPTER_META).sort());
    expect(BROKERS).toHaveLength(41);
  });

  it("offers for saving exactly the adapter's credential fields, and never a secret", () => {
    for (const b of BROKERS) {
      const meta = BROKER_ADAPTER_META[b.id];
      expect(b.fields.map((f) => f.key).sort(), b.id).toEqual([...meta.credentialFields].sort());
      expect(b.fields.filter((f) => FORBIDDEN.test(f.key)), b.id).toEqual([]);
      for (const f of b.fields) expect(f.label.trim(), `${b.id}.${f.key}`).not.toBe("");
    }
    for (const b of CATALOG) expect(b.fields.filter((f) => FORBIDDEN.test(f.key)), b.id).toEqual([]);
  });

  it("only names fields that exist in its alternatives", () => {
    for (const b of BROKERS) {
      for (const group of b.alternatives ?? []) {
        for (const k of group) expect(b.fields.some((f) => f.key === k && !f.required), `${b.id}.${k}`).toBe(true);
      }
    }
  });

  it("links to official https docs, not to third-party mirrors", () => {
    for (const b of BROKERS) {
      expect(b.docsUrl, b.id).toMatch(/^https:\/\//);
      expect(b.docsUrl, b.id).not.toMatch(/openalgo|marketcalls/i);
    }
  });

  it("takes auth, capabilities and login prompts from the adapter; only Dhan is verified", () => {
    expect([...VERIFIED_BROKER_IDS]).toEqual(["dhan"]);
    for (const b of BROKERS) {
      const meta = BROKER_ADAPTER_META[b.id];
      expect(b.authKind, b.id).toBe(meta.authKind);
      expect(b.capabilities, b.id).toEqual(meta.capabilities);
      expect(b.verified, b.id).toBe(b.id === "dhan");
      expect(b.integrated, b.id).toBe(true);
      if (meta.authKind === "sessionLogin") {
        expect(SESSION_LOGIN_BROKER_IDS.has(b.id), b.id).toBe(true);
        expect(b.sessionLogin?.prompts.map((p) => p.key), b.id).toEqual(meta.loginFields.map((f) => f.key));
      } else {
        expect(b.sessionLogin, b.id).toBeUndefined();
      }
    }
    expect(SESSION_LOGIN_BROKER_IDS.has("definedge")).toBe(true);
    expect(SESSION_LOGIN_BROKER_IDS.has("indmoney")).toBe(true);
  });
});

describe("session keys", () => {
  it("reads and clears each broker's own session fields", () => {
    const at = String(Date.now() + 60_000);
    const definedge = { brokerId: "definedge", values: { apiToken: "t", apiSessionKey: "s", wsSessionKey: "w", uid: "u", actid: "a", sessionExpiresAt: at }, addedAt: "x", isActive: true };
    expect(getBrokerSessionState(definedge).state).toBe("active");
    expect(sessionKeysFor("definedge")).toEqual(expect.arrayContaining(["apiSessionKey", "wsSessionKey", "uid", "actid"]));
    expect(clearSession("definedge", definedge.values)).toEqual({ apiToken: "t" });
    expect(clearSession("angelone", { apiKey: "k", sessionToken: "s", feedToken: "f", sessionExpiresAt: at })).toEqual({ apiKey: "k" });
    expect(sessionKeysFor("nope")).toContain("sessionToken");
  });
});

describe("docs/BROKERS.md", () => {
  it("lists every broker with its auth kind, docs link and verification status, plus the attribution note", async () => {
    const { readFileSync } = await import("node:fs");
    const md = readFileSync(new URL("../../docs/BROKERS.md", import.meta.url), "utf-8");
    for (const b of BROKERS) {
      const row = md.split("\n").find((l) => l.includes(`| \`${b.id}\` |`));
      expect(row, b.id).toBeTruthy();
      expect(row, b.id).toContain(`\`${b.authKind}\``);
      expect(row, b.id).toContain(`(${b.docsUrl})`);
      expect(row, b.id).toContain(b.verified ? "Verified with a live account" : "Beta: not yet verified with a live account");
    }
    expect(md).toContain("AGPL-3.0");
    expect(md).toContain("github.com/marketcalls/openalgo");
    expect(md).toMatch(/No OpenAlgo code is included/);
  });
});
