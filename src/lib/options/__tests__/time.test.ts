import { describe, expect, it } from "vitest";
import {
  addTradingDays,
  dteLabel,
  getContractSpec,
  getExpiries,
  getLotSize,
  getMarketSession,
  getStrikeStep,
  isTradingDay,
  isWeeklyExpiry,
  nextSessionChange,
  normalizeExpiry,
  nowIST,
  previousTradingDay,
  registerContractSpecs,
  timeToExpiryYears,
  toISTDate,
  tradingDaysBetween,
  CONTRACT_SPECS,
  NSE_HOLIDAYS,
} from "@/lib/options";

const at = (iso: string, hhmm: string) => toISTDate(iso, hhmm);

describe("IST clock", () => {
  it("converts instants to IST wall time regardless of browser zone", () => {
    const d = new Date("2026-10-19T20:00:00Z"); // 01:30 IST on 20 Oct
    expect(nowIST(d)).toEqual({ date: "2026-10-20", hh: 1, mm: 30, ss: 0, weekday: 2 });
    expect(toISTDate("2026-10-20", "15:30").toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(Number.isNaN(toISTDate("bad").getTime())).toBe(true);
  });

  it("classifies market sessions", () => {
    expect(getMarketSession(at("2026-10-19", "09:05"))).toBe("pre-open");
    expect(getMarketSession(at("2026-10-19", "09:15"))).toBe("open");
    expect(getMarketSession(at("2026-10-19", "15:29"))).toBe("open");
    expect(getMarketSession(at("2026-10-19", "15:35"))).toBe("closed");
    expect(getMarketSession(at("2026-10-19", "15:45"))).toBe("closing");
    expect(getMarketSession(at("2026-10-20", "11:00"))).toBe("holiday");
    expect(getMarketSession(at("2026-10-17", "11:00"))).toBe("weekend");
  });

  it("labels the next session change", () => {
    expect(nextSessionChange(at("2026-10-19", "13:20")).label).toBe("Closes in 2h 10m");
    const afterClose = nextSessionChange(at("2026-10-19", "16:15"));
    expect(afterClose.session).toBe("open");
    // 20 Oct is Dussehra, so the next open is 21 Oct 09:15
    expect(afterClose.at.toISOString()).toBe(at("2026-10-21", "09:15").toISOString());
    expect(nextSessionChange(at("2026-10-19", "07:05")).label).toBe("Opens in 2h 10m");
  });
});

describe("trading calendar", () => {
  it("knows weekends and holidays", () => {
    expect(isTradingDay("2026-10-20")).toBe(false);
    expect(isTradingDay("2026-10-17")).toBe(false);
    expect(isTradingDay("2026-10-19")).toBe(true);
    expect(previousTradingDay("2026-10-21")).toBe("2026-10-19");
    expect(addTradingDays("2026-10-16", 2)).toBe("2026-10-21");
    expect(addTradingDays("2026-10-21", -2)).toBe("2026-10-16");
    expect(tradingDaysBetween("2026-10-16", "2026-10-23")).toBe(4);
    expect(NSE_HOLIDAYS[2026]).toContain("2026-11-24");
    for (const list of Object.values(NSE_HOLIDAYS)) for (const d of list) expect(new Date(d).getUTCDay() % 6).not.toBe(0);
  });

  it("measures time to 15:30 IST expiry with minute precision", () => {
    const now = at("2026-10-27", "09:30");
    expect(timeToExpiryYears("2026-10-27", now)).toBeCloseTo(360 / (365 * 24 * 60), 12);
    expect(timeToExpiryYears("2026-10-27", at("2026-10-27", "15:29"))).toBeCloseTo(1 / (365 * 24 * 60), 12);
    expect(timeToExpiryYears("2026-10-27", at("2026-10-27", "15:31"))).toBe(0);
    expect(timeToExpiryYears("2026-10-28", at("2026-10-27", "15:30"))).toBeCloseTo(1 / 365, 10);
    // trading mode: rest of today's session plus each full session to expiry
    const tTrade = timeToExpiryYears("2026-10-27", at("2026-10-23", "15:00"), { mode: "trading" });
    expect(tTrade).toBeCloseTo((30 + 2 * 375) / (252 * 375), 12);
    expect(Number.isNaN(timeToExpiryYears("garbage"))).toBe(true);
  });

  it("formats DTE labels", () => {
    expect(dteLabel("2026-10-27", at("2026-10-27", "12:18"))).toBe("Expiry today · 3h 12m");
    expect(dteLabel("2026-10-27", at("2026-10-25", "11:30"))).toBe("2d 4h");
    expect(dteLabel("2026-11-24", at("2026-11-12", "10:00"))).toBe("12 days");
    expect(dteLabel("2026-10-27", at("2026-10-28", "10:00"))).toBe("Expired");
  });

  it("normalises expiry strings", () => {
    const now = at("2026-10-17", "10:00");
    expect(normalizeExpiry("2026-10-20")).toBe("2026-10-20");
    expect(normalizeExpiry("20-Oct-2026")).toBe("2026-10-20");
    expect(normalizeExpiry("20 Oct 2026")).toBe("2026-10-20");
    expect(normalizeExpiry("20OCT26")).toBe("2026-10-20");
    expect(normalizeExpiry("Oct 20, 2026")).toBe("2026-10-20");
    expect(normalizeExpiry("20/10/2026")).toBe("2026-10-20");
    expect(normalizeExpiry("20 Oct", now)).toBe("2026-10-20");
    expect(normalizeExpiry("05 Jan", now)).toBe("2027-01-05"); // a date long past rolls to next year
    expect(normalizeExpiry("31-Feb-2026")).toBe("");
    expect(normalizeExpiry("tomorrow")).toBe("");
  });
});

describe("expiry rules Oct-Dec 2026", () => {
  const from = at("2026-10-01", "10:00");

  it("NIFTY: weekly Tuesday + monthly last Tuesday with holiday shifts", () => {
    const ex = getExpiries("NIFTY", from, 13);
    expect(ex.map((e) => e.date)).toEqual([
      "2026-10-06",
      "2026-10-13",
      "2026-10-19", // Tue 20 Oct Dussehra → Mon 19 Oct
      "2026-10-27",
      "2026-11-03",
      "2026-11-09", // Tue 10 Nov Balipratipada → Mon 9 Nov
      "2026-11-17",
      "2026-11-23", // Tue 24 Nov Guru Nanak Jayanti → Mon 23 Nov (monthly)
      "2026-12-01",
      "2026-12-08",
      "2026-12-15",
      "2026-12-22",
      "2026-12-29",
    ]);
    expect(ex.filter((e) => e.type === "monthly").map((e) => e.date)).toEqual(["2026-10-27", "2026-11-23", "2026-12-29"]);
    expect(ex[0].lotSize).toBe(65);
    expect(ex[0].dte).toBe(5);
    expect(ex[0].tradingDte).toBe(2); // sessions after 1 Oct: 2 Oct is Gandhi Jayanti, so only 5 and 6 Oct
    expect(isWeeklyExpiry("NIFTY", "2026-10-19")).toBe(true);
    expect(isWeeklyExpiry("NIFTY", "2026-10-27")).toBe(false);
  });

  it("BANKNIFTY / FINNIFTY / stocks: monthly last Tuesday only", () => {
    expect(getExpiries("BANKNIFTY", from, 3).map((e) => e.date)).toEqual(["2026-10-27", "2026-11-23", "2026-12-29"]);
    expect(getExpiries("FINNIFTY", from, 3).every((e) => e.type === "monthly")).toBe(true);
    expect(getExpiries("RELIANCE", from, 2).map((e) => e.date)).toEqual(["2026-10-27", "2026-11-23"]);
    expect(isWeeklyExpiry("BANKNIFTY", "2026-10-13")).toBe(false);
  });

  it("SENSEX weekly Thursday; BANKEX monthly last Thursday", () => {
    expect(getExpiries("SENSEX", from, 5).map((e) => e.date)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22", "2026-10-29"]);
    expect(getExpiries("BANKEX", from, 3).map((e) => e.date)).toEqual(["2026-10-29", "2026-11-26", "2026-12-31"]);
  });

  it("drops today's expiry after 15:30 IST", () => {
    expect(getExpiries("SENSEX", at("2026-10-01", "15:31"), 1)[0].date).toBe("2026-10-08");
  });
});

describe("instruments", () => {
  it("has 2026 lot sizes and strike steps", () => {
    expect(getLotSize("NIFTY")).toBe(65);
    expect(getLotSize("Nifty 50")).toBe(65);
    expect(getLotSize("BANKNIFTY")).toBe(30);
    expect(getLotSize("FINNIFTY")).toBe(60);
    expect(getLotSize("MIDCPNIFTY")).toBe(120);
    expect(getLotSize("SENSEX")).toBe(20);
    expect(getLotSize("BANKEX")).toBe(30);
    expect(getLotSize("UNKNOWNXYZ")).toBeUndefined();
    expect(getStrikeStep("BANKNIFTY")).toBe(100);
    expect(getStrikeStep("UNKNOWNXYZ")).toBe(50);
    expect(Object.values(CONTRACT_SPECS).filter((s) => s.kind === "STOCK").length).toBeGreaterThanOrEqual(60);
    expect(Object.values(CONTRACT_SPECS).every((s) => s.verify === true && !!s.effectiveFrom)).toBe(true);
  });

  it("keeps the old lot for older contracts", () => {
    expect(getLotSize("NIFTY", "2025-12-30")).toBe(75);
    expect(getLotSize("NIFTY", "2026-01-06")).toBe(65);
    expect(getLotSize("NIFTY", "2024-10-31")).toBe(25);
  });

  it("accepts runtime overrides", () => {
    registerContractSpecs([{ symbol: "NEWCO", lotSize: 900, strikeStep: 5 }]);
    expect(getLotSize("NEWCO")).toBe(900);
    registerContractSpecs([{ symbol: "NEWCO" }]); // no-op, keeps lot
    expect(getContractSpec("newco")?.strikeStep).toBe(5);
    registerContractSpecs([{ symbol: "BADCO" }]); // no lot size → ignored
    expect(getLotSize("BADCO")).toBeUndefined();
  });
});
