import { describe, expect, it } from "vitest";
import { bannerState, formatCountdown } from "@/lib/marketData/banner";

const base = { status: "online" as const, nextRetryAt: null, lastOnlineAt: null, probing: false, sampleMode: false };

describe("formatCountdown", () => {
  it("rounds to seconds under a minute and minutes above", () => {
    expect(formatCountdown(0)).toBe("0 s");
    expect(formatCountdown(-5)).toBe("0 s");
    expect(formatCountdown(44_100)).toBe("45 s");
    expect(formatCountdown(90_000)).toBe("2 min");
    expect(formatCountdown(300_000)).toBe("5 min");
  });
});

describe("bannerState", () => {
  it("is hidden while the proxy is online or still being checked", () => {
    expect(bannerState(base, true)).toBeNull();
    expect(bannerState({ ...base, status: "unknown" }, true)).toBeNull();
  });

  it("shows the sample-data bar with a countdown when the proxy is offline", () => {
    const s = bannerState({ ...base, status: "offline", nextRetryAt: 1_000 + 45_000 }, true, 1_000);
    expect(s).toMatchObject({ kind: "sample", badge: "Sample data", message: "Proxy offline", showStartProxy: true, detail: "Next check in 45 s" });
  });

  it("says when a probe is running or due", () => {
    expect(bannerState({ ...base, status: "offline", nextRetryAt: 10, probing: true }, true, 0)?.detail).toBe("Checking…");
    expect(bannerState({ ...base, status: "offline", nextRetryAt: 10 }, true, 20)?.detail).toBe("Checking soon");
    expect(bannerState({ ...base, status: "offline" }, true, 20)?.detail).toBeNull();
  });

  it("labels demo mode without a start-proxy action", () => {
    const s = bannerState({ ...base, status: "offline", sampleMode: true }, true);
    expect(s).toMatchObject({ kind: "demo", badge: "Sample data", showStartProxy: false });
  });

  it("switches to 'Cached' with the last live time when the device is offline", () => {
    const at = Date.UTC(2026, 9, 16, 9, 2); // 14:32 IST
    const s = bannerState({ ...base, lastOnlineAt: at }, false);
    expect(s).toMatchObject({ kind: "cached", badge: "Cached", message: "You're offline", showStartProxy: false });
    expect(s?.detail).toBe("Last live data 14:32 IST");
    expect(bannerState({ ...base, sampleMode: true }, false)?.detail).toBe("No live data this session");
  });
});
