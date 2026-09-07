import { describe, it, expect } from "vitest";
import { createRateLimiter, rateLimitMessage, isDenied, DEFAULT_RATE_LIMIT } from "@/features/one-cliq/lib/rateLimiter";

const T0 = 1_700_000_000_000;

describe("per-second cap — the held-arrow-key case", () => {
  it("allows up to the cap in one second", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) {
      expect(rl.tryConsume(T0 + i).allowed).toBe(true);
    }
  });

  it("blocks the next order in the same second", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) rl.tryConsume(T0 + i);
    const v = rl.tryConsume(T0 + 10);
    expect(v.allowed).toBe(false);
    if (isDenied(v)) expect(v.reason).toBe("PER_SECOND");
  });

  it("does NOT consume a slot when it refuses", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) rl.tryConsume(T0 + i);
    rl.tryConsume(T0 + 10);
    // A refused attempt must not count toward the minute cap; only real orders do.
    expect(rl.recentCount(T0 + 10)).toBe(DEFAULT_RATE_LIMIT.perSecond);
  });

  it("recovers once the second has passed and the lockout has expired", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) rl.tryConsume(T0 + i);
    rl.tryConsume(T0 + 10); // triggers lockout
    expect(rl.tryConsume(T0 + 1500 + DEFAULT_RATE_LIMIT.lockoutMs).allowed).toBe(true);
  });
});

describe("lockout", () => {
  it("refuses everything during the lockout, even when the window has cleared", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) rl.tryConsume(T0 + i);
    rl.tryConsume(T0 + 10);
    const during = rl.tryConsume(T0 + 1200);
    expect(during.allowed).toBe(false);
    if (isDenied(during)) expect(during.reason).toBe("LOCKED_OUT");
  });

  it("reports how long is left", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) rl.tryConsume(T0 + i);
    rl.tryConsume(T0 + 10);
    const v = rl.tryConsume(T0 + 1000);
    if (isDenied(v)) expect(v.retryInMs).toBeGreaterThan(0);
  });
});

describe("per-minute cap", () => {
  it("blocks past the minute cap even when spread out", () => {
    const rl = createRateLimiter({ perSecond: 100, perMinute: 5, lockoutMs: 0 });
    for (let i = 0; i < 5; i++) expect(rl.tryConsume(T0 + i * 1000).allowed).toBe(true);
    const v = rl.tryConsume(T0 + 6000);
    expect(v.allowed).toBe(false);
    if (isDenied(v)) expect(v.reason).toBe("PER_MINUTE");
  });

  it("forgets orders older than a minute", () => {
    const rl = createRateLimiter({ perSecond: 100, perMinute: 5, lockoutMs: 0 });
    for (let i = 0; i < 5; i++) rl.tryConsume(T0 + i);
    expect(rl.tryConsume(T0 + 61_000).allowed).toBe(true);
  });
});

describe("peek does not consume", () => {
  it("can be called repeatedly without using the budget", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 20; i++) expect(rl.peek(T0).allowed).toBe(true);
    expect(rl.recentCount(T0)).toBe(0);
  });
});

describe("reset", () => {
  it("clears both the window and the lockout", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < DEFAULT_RATE_LIMIT.perSecond; i++) rl.tryConsume(T0 + i);
    rl.tryConsume(T0 + 10);
    rl.reset();
    expect(rl.tryConsume(T0 + 11).allowed).toBe(true);
  });
});

describe("rateLimitMessage", () => {
  it("always says nothing was sent, so the user is never left guessing", () => {
    expect(rateLimitMessage({ allowed: false, reason: "PER_SECOND", retryInMs: 800 })).toMatch(/nothing was sent/i);
    expect(rateLimitMessage({ allowed: false, reason: "PER_MINUTE", retryInMs: 800 })).toMatch(/nothing was sent/i);
  });

  it("rounds the retry hint up to at least one second", () => {
    expect(rateLimitMessage({ allowed: false, reason: "LOCKED_OUT", retryInMs: 10 })).toMatch(/1s/);
  });
});
