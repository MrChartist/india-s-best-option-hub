import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  armLive, armOneClick, disarmOneClick, isOneClickArmed, touchOneClick,
  oneClickRemainingMs, tokenSessionId, ONE_CLICK_TIMEOUT_MS, __resetArmStateForTests,
} from "@/lib/liveArm";
import { setLiveTradingEnabled } from "@/lib/brokerConfig";

beforeEach(() => {
  localStorage.clear();
  __resetArmStateForTests();
});
afterEach(() => vi.useRealTimers());

describe("armLive — the live-trading gate", () => {
  it("refuses a token while Live Trading is off", () => {
    setLiveTradingEnabled(false);
    const { token, reason } = armLive(false);
    expect(token).toBeNull();
    expect(reason).toBe("LIVE_TRADING_OFF");
  });

  it("explains itself rather than failing silently", () => {
    setLiveTradingEnabled(false);
    expect(armLive(false).message).toMatch(/paper trade/i);
  });

  it("issues a token for a confirmed order once Live Trading is on", () => {
    setLiveTradingEnabled(true);
    const { token, reason } = armLive(false);
    expect(token).not.toBeNull();
    expect(reason).toBeNull();
    expect(tokenSessionId(token!)).toMatch(/^s/);
  });

  it("refuses one-click execution until one-click is explicitly armed", () => {
    setLiveTradingEnabled(true);
    const { token, reason } = armLive(true);
    expect(token).toBeNull();
    expect(reason).toBe("ONE_CLICK_NOT_ARMED");
  });

  it("issues a token for one-click only after arming", () => {
    setLiveTradingEnabled(true);
    armOneClick();
    expect(armLive(true).token).not.toBeNull();
  });

  it("still refuses one-click when Live Trading is off, even if one-click was armed", () => {
    // Both gates must hold. Arming one-click is not a way around the master switch.
    setLiveTradingEnabled(true);
    armOneClick();
    setLiveTradingEnabled(false);
    expect(armLive(true).reason).toBe("LIVE_TRADING_OFF");
  });
});

describe("one-click arming is session-scoped", () => {
  it("starts disarmed", () => {
    expect(isOneClickArmed()).toBe(false);
  });

  it("disarms on request", () => {
    armOneClick();
    expect(isOneClickArmed()).toBe(true);
    disarmOneClick();
    expect(isOneClickArmed()).toBe(false);
  });

  it("does NOT persist to localStorage — a reload must never come back hot", () => {
    armOneClick();
    const persisted = Object.keys(localStorage).some((k) => {
      const v = localStorage.getItem(k) || "";
      return /arm/i.test(k) || /armedAt/i.test(v);
    });
    expect(persisted).toBe(false);
  });

  it("auto-disarms after the idle timeout", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    armOneClick();
    expect(isOneClickArmed(t0 + ONE_CLICK_TIMEOUT_MS - 1000)).toBe(true);
    expect(isOneClickArmed(t0 + ONE_CLICK_TIMEOUT_MS + 1)).toBe(false);
  });

  it("extends the timeout on deliberate activity", () => {
    vi.useFakeTimers();
    const t0 = new Date(2026, 8, 7, 11, 0, 0);
    vi.setSystemTime(t0);
    armOneClick();

    vi.setSystemTime(new Date(t0.getTime() + ONE_CLICK_TIMEOUT_MS - 5000));
    touchOneClick();

    // Past the ORIGINAL expiry, but within the window from the touch.
    vi.setSystemTime(new Date(t0.getTime() + ONE_CLICK_TIMEOUT_MS + 5000));
    expect(isOneClickArmed()).toBe(true);
  });

  it("reports remaining time for the UI countdown, and zero when disarmed", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    expect(oneClickRemainingMs()).toBe(0);
    armOneClick();
    expect(oneClickRemainingMs(t0 + 30_000)).toBeLessThanOrEqual(ONE_CLICK_TIMEOUT_MS - 30_000 + 5);
    expect(oneClickRemainingMs(t0 + ONE_CLICK_TIMEOUT_MS + 1000)).toBe(0);
  });

  it("issuing a token counts as activity, so an active scalper does not get disarmed mid-run", () => {
    vi.useFakeTimers();
    const t0 = new Date(2026, 8, 7, 11, 0, 0);
    vi.setSystemTime(t0);
    setLiveTradingEnabled(true);
    armOneClick();

    vi.setSystemTime(new Date(t0.getTime() + ONE_CLICK_TIMEOUT_MS - 2000));
    expect(armLive(true).token).not.toBeNull();

    vi.setSystemTime(new Date(t0.getTime() + ONE_CLICK_TIMEOUT_MS + 2000));
    expect(isOneClickArmed()).toBe(true);
  });
});
