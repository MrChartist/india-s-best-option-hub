import { describe, it, expect, beforeEach } from "vitest";
import {
  marketSession, isTradeable, minutesToClose, requireFreshTick, istParts, setSpecialSessions,
} from "./marketHours.mjs";

/** A UTC instant for a given IST wall-clock time. IST is UTC+5:30. */
function ist(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - (5 * 60 + 30) * 60000);
}

beforeEach(() => setSpecialSessions({}));

describe("istParts — timezone independence", () => {
  it("reports IST wall-clock regardless of the host timezone", () => {
    // 2026-09-07 is a Monday. 09:15 IST = 03:45 UTC.
    const p = istParts(ist(2026, 9, 7, 9, 15));
    expect(p.hour).toBe(9);
    expect(p.minute).toBe(15);
    expect(p.weekday).toBe("Mon");
    expect(p.minutesOfDay).toBe(555);
  });

  it("puts a late-UTC-evening instant on the NEXT IST day", () => {
    // 2026-09-07 20:00 UTC = 2026-09-08 01:30 IST
    const p = istParts(new Date(Date.UTC(2026, 8, 7, 20, 0)));
    expect(p.day).toBe(8);
  });
});

describe("marketSession", () => {
  it("is CLOSED before 09:00", () => {
    expect(marketSession(ist(2026, 9, 7, 8, 59)).state).toBe("CLOSED");
  });

  it("is PRE_OPEN from 09:00 to 09:14", () => {
    expect(marketSession(ist(2026, 9, 7, 9, 0)).state).toBe("PRE_OPEN");
    expect(marketSession(ist(2026, 9, 7, 9, 14)).state).toBe("PRE_OPEN");
  });

  it("is OPEN from 09:15 through 15:29", () => {
    expect(marketSession(ist(2026, 9, 7, 9, 15)).state).toBe("OPEN");
    expect(marketSession(ist(2026, 9, 7, 15, 29)).state).toBe("OPEN");
  });

  it("is CLOSED at 15:30 exactly — the session end is exclusive", () => {
    expect(marketSession(ist(2026, 9, 7, 15, 30)).state).toBe("CLOSED");
  });

  it("is CLOSED all weekend even during regular hours", () => {
    // 2026-09-05 is a Saturday, 2026-09-06 a Sunday.
    expect(marketSession(ist(2026, 9, 5, 11, 0)).state).toBe("CLOSED");
    expect(marketSession(ist(2026, 9, 6, 11, 0)).state).toBe("CLOSED");
  });
});

describe("isTradeable — pre-open is not tradeable", () => {
  it("refuses pre-open, allows regular hours", () => {
    expect(isTradeable(ist(2026, 9, 7, 9, 5))).toBe(false);
    expect(isTradeable(ist(2026, 9, 7, 10, 0))).toBe(true);
    expect(isTradeable(ist(2026, 9, 7, 16, 0))).toBe(false);
  });
});

describe("special sessions (Muhurat) — configured, never guessed", () => {
  it("opens only inside the configured window, on a day that would be a weekend", () => {
    setSpecialSessions({ "2026-11-08": { startMinute: 1110, endMinute: 1170, label: "Muhurat" } });
    // 2026-11-08 is a Sunday; the special window must still trade.
    expect(marketSession(ist(2026, 11, 8, 18, 45)).state).toBe("SPECIAL");
    expect(isTradeable(ist(2026, 11, 8, 18, 45))).toBe(true);
    expect(marketSession(ist(2026, 11, 8, 12, 0)).state).toBe("CLOSED");
  });
});

describe("minutesToClose", () => {
  it("counts down to 15:30 and goes negative afterwards", () => {
    expect(minutesToClose(ist(2026, 9, 7, 15, 20))).toBe(10);
    expect(minutesToClose(ist(2026, 9, 7, 15, 45))).toBeLessThan(0);
  });
});

describe("requireFreshTick — the 09:14 stale-price guard", () => {
  const openNow = ist(2026, 9, 7, 10, 0).getTime();

  it("accepts a fresh tick from today during the session", () => {
    const ltt = Math.floor(ist(2026, 9, 7, 9, 59).getTime() / 1000);
    expect(requireFreshTick(ltt, openNow - 500, 5000, openNow)).toEqual({ ok: true, reason: null });
  });

  it("rejects a tick the proxy has not seen recently", () => {
    const ltt = Math.floor(openNow / 1000);
    expect(requireFreshTick(ltt, openNow - 30000, 5000, openNow).reason).toBe("STALE_FEED");
  });

  it("rejects during pre-open even when the cached price looks recent", () => {
    const preOpen = ist(2026, 9, 7, 9, 14).getTime();
    const ltt = Math.floor(ist(2026, 9, 4, 15, 29).getTime() / 1000);
    expect(requireFreshTick(ltt, preOpen - 100, 5000, preOpen).reason).toBe("MARKET_CLOSED");
  });

  it("rejects a tick whose exchange timestamp is from a previous session", () => {
    // Feed reconnected and replayed yesterday's close: arrival is fresh, the
    // trade is not. Acting on this is how a stop fires against a stale price.
    const yesterdayClose = Math.floor(ist(2026, 9, 4, 15, 29).getTime() / 1000);
    expect(requireFreshTick(yesterdayClose, openNow - 100, 5000, openNow).reason)
      .toBe("TICK_FROM_PREVIOUS_SESSION");
  });

  it("accepts when the exchange timestamp is absent rather than blocking outright", () => {
    expect(requireFreshTick(0, openNow - 100, 5000, openNow).ok).toBe(true);
  });
});
