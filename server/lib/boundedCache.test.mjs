import { describe, expect, it } from "vitest";
import { createBoundedSet, createSessionCache } from "./boundedCache.mjs";
import { decodeJwtPayload, jwtExpiryMs } from "./jwt.mjs";

describe("createSessionCache", () => {
  it("drops entries past expiresAt and evicts the least recently used past the cap", () => {
    let t = 1_000;
    const c = createSessionCache({ maxEntries: 2, now: () => t });
    c.set("a", { expiresAt: 5_000 });
    c.set("b", { expiresAt: 5_000 });
    expect(c.get("a")).toBeTruthy(); // a is now most recent
    c.set("c", { expiresAt: 5_000 });
    expect(c.has("b")).toBe(false);
    expect(c.size).toBe(2);
    t = 6_000;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(1);
  });

  it("can be size-bounded only", () => {
    const c = createSessionCache({ maxEntries: 1, expiryOf: () => null, now: () => 10 });
    c.set("a", { expiresAt: 1, refreshToken: "r" });
    expect(c.get("a")).toEqual({ expiresAt: 1, refreshToken: "r" });
    c.set("b", { dead: true });
    expect(c.get("a")).toBeUndefined();
  });

  it("never grows past the cap under many credential sets", () => {
    const c = createSessionCache({ maxEntries: 8 });
    for (let i = 0; i < 1000; i++) c.set(`k${i}`, { expiresAt: Date.now() + 60_000 });
    expect(c.size).toBe(8);
    const s = createBoundedSet({ maxEntries: 4 });
    for (let i = 0; i < 100; i++) s.add(i);
    expect([...s]).toEqual([96, 97, 98, 99]);
  });
});

describe("jwt helpers", () => {
  const tok = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
  it("reads claims without verifying and rejects non-JWTs", () => {
    expect(decodeJwtPayload(tok({ sub: "DEMO1" }))).toEqual({ sub: "DEMO1" });
    expect(jwtExpiryMs(tok({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("a.!!!.c")).toBeNull();
    expect(jwtExpiryMs(tok({}))).toBeNull();
  });
});
