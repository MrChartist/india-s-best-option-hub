/**
 * Order rate limiter — a pure, time-injected token bucket.
 *
 * A held arrow key must not machine-gun twenty market orders. The keyboard layer
 * also rejects `event.repeat`, but that only covers OS key-repeat; it does not
 * cover a fast human, a stuck key that generates discrete events, or a render
 * loop calling the handler. This is the backstop that bounds actual orders.
 *
 * Pure and clock-injected so the limits are unit-testable without waiting.
 */

export interface RateLimitConfig {
  /** Orders allowed in any rolling one-second window. */
  perSecond: number;
  /** Orders allowed in any rolling one-minute window. */
  perMinute: number;
  /** After a breach, refuse everything for this long. */
  lockoutMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  perSecond: 3,
  perMinute: 20,
  lockoutMs: 2000,
};

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; reason: "PER_SECOND" | "PER_MINUTE" | "LOCKED_OUT"; retryInMs: number };

export type RateDenied = Extract<RateVerdict, { allowed: false }>;

/**
 * Type guard for a refusal.
 *
 * This project compiles with `strict: false`, which disables narrowing on
 * boolean-literal discriminants — so `if (!v.allowed)` does not give callers
 * access to `reason`/`retryInMs`. An explicit guard restores it without every
 * call site casting.
 */
export function isDenied(v: RateVerdict): v is RateDenied {
  return v.allowed !== true;
}

export interface RateLimiter {
  /** Check AND consume a slot when allowed. */
  tryConsume(now?: number): RateVerdict;
  /** Read-only check, for disabling a button without consuming a slot. */
  peek(now?: number): RateVerdict;
  reset(): void;
  /** Orders in the last minute — for the HUD. */
  recentCount(now?: number): number;
}

export function createRateLimiter(config: RateLimitConfig = DEFAULT_RATE_LIMIT): RateLimiter {
  let stamps: number[] = [];
  let lockedUntil = 0;

  const prune = (now: number) => {
    stamps = stamps.filter((t) => now - t < 60_000);
  };

  const check = (now: number): RateVerdict => {
    if (now < lockedUntil) {
      return { allowed: false, reason: "LOCKED_OUT", retryInMs: lockedUntil - now };
    }
    prune(now);

    const inLastSecond = stamps.filter((t) => now - t < 1000);
    if (inLastSecond.length >= config.perSecond) {
      return { allowed: false, reason: "PER_SECOND", retryInMs: 1000 - (now - inLastSecond[0]) };
    }
    if (stamps.length >= config.perMinute) {
      return { allowed: false, reason: "PER_MINUTE", retryInMs: 60_000 - (now - stamps[0]) };
    }
    return { allowed: true };
  };

  return {
    peek: (now = Date.now()) => check(now),

    tryConsume(now = Date.now()): RateVerdict {
      const verdict = check(now);
      if (verdict.allowed === true) {
        stamps.push(now);
        return verdict;
      }
      const denied = verdict as RateDenied;
      // A breach starts a lockout, so hammering the key does not just keep
      // returning "denied" at full speed — the user gets a hard, visible stop.
      if (denied.reason !== "LOCKED_OUT") lockedUntil = now + config.lockoutMs;
      return denied;
    },

    reset() {
      stamps = [];
      lockedUntil = 0;
    },

    recentCount(now = Date.now()) {
      prune(now);
      return stamps.length;
    },
  };
}

/** User-facing copy for a refusal. Kept here so the message matches the rule. */
export function rateLimitMessage(v: RateDenied): string {
  const secs = Math.max(1, Math.ceil(v.retryInMs / 1000));
  switch (v.reason) {
    case "PER_SECOND": return `Too fast — order rate limit hit. Nothing was sent. Retry in ${secs}s.`;
    case "PER_MINUTE": return `Minute order cap reached. Nothing was sent. Retry in ${secs}s.`;
    case "LOCKED_OUT": return `Rate limited — keys are ignored for ${secs}s.`;
  }
}
