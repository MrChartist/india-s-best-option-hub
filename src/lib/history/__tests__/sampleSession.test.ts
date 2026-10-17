import { describe, expect, it } from "vitest";
import { generateSampleChain } from "@/lib/options";
import { buildSampleContractSession, buildSampleDailyHistory, sampleContractWindow } from "../sampleSession";

const fri = new Date("2026-10-16T08:00:00Z"); // Fri 13:30 IST
const sat = new Date("2026-10-17T06:00:00Z");

describe("sample contract session", () => {
  it("covers today's session so far, or the previous trading day", () => {
    expect(sampleContractWindow(fri)).toMatchObject({ date: "2026-10-16", end: fri.getTime() });
    const w = sampleContractWindow(sat);
    expect(w.date).toBe("2026-10-16");
    expect(w.end - w.start).toBe(375 * 60_000);
  });

  it("is deterministic and anchored to generateSampleChain at now", () => {
    const o = { symbol: "NIFTY", expiry: "2026-10-20", strike: 25000, spot: 25012.35, now: fri };
    const a = buildSampleContractSession(o);
    const b = buildSampleContractSession(o);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(40);
    const last = a[a.length - 1];
    expect(last.ts).toBe(fri.getTime());
    expect(last.spot).toBe(25012.35);
    const row = generateSampleChain({ symbol: "NIFTY", spot: 25012.35, expiry: "2026-10-20", now: fri, strikes: 41 }).chain.find((r) => r.strikePrice === 25000)!;
    const ce = last.rows.find((r) => r.side === "CE")!;
    const pe = last.rows.find((r) => r.side === "PE")!;
    expect(ce).toMatchObject({ ltp: row.ce.ltp, oi: row.ce.oi, vol: row.ce.volume, iv: row.ce.iv, bid: row.ce.bidPrice, ask: row.ce.askPrice });
    expect(pe).toMatchObject({ ltp: row.pe.ltp, oi: row.pe.oi, vol: row.pe.volume });
    expect(a[0].rows.find((r) => r.side === "CE")!.oi).toBe(Math.max(0, row.ce.oi - row.ce.oiChange));
  });

  it("produces a plausible path: ascending time, positive prices, cumulative volume", () => {
    const a = buildSampleContractSession({ symbol: "BANKNIFTY", expiry: "2026-10-27", strike: 56000, spot: 55880, now: sat });
    for (let i = 1; i < a.length; i++) {
      expect(a[i].ts).toBeGreaterThan(a[i - 1].ts);
      const v0 = a[i - 1].rows[0].vol;
      expect(a[i].rows[0].vol).toBeGreaterThanOrEqual(v0);
    }
    for (const s of a) for (const r of s.rows) {
      expect(r.ltp).toBeGreaterThan(0);
      expect(r.ask).toBeGreaterThanOrEqual(r.bid);
      expect(r.iv).toBeGreaterThan(5);
    }
  });

  it("handles off-grid strikes and refuses unusable input", () => {
    expect(buildSampleContractSession({ symbol: "NIFTY", expiry: "2026-10-20", strike: 25025, spot: 25000, now: fri }).length).toBeGreaterThan(10);
    expect(buildSampleContractSession({ symbol: "NIFTY", expiry: "2026-10-20", strike: 0, spot: 25000, now: fri })).toEqual([]);
    expect(buildSampleContractSession({ symbol: "NIFTY", expiry: "2026-10-01", strike: 25000, spot: 25000, now: fri })).toEqual([]);
  });
});

describe("sample daily history", () => {
  it("returns trading days before the session, oldest first, with consistent OI changes", () => {
    const rows = buildSampleDailyHistory({ symbol: "NIFTY", expiry: "2026-11-24", strike: 25000, type: "PE", spot: 25000, days: 10, now: fri });
    expect(rows).toHaveLength(10);
    expect(rows[rows.length - 1].date).toBe("2026-10-15");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].date > rows[i - 1].date).toBe(true);
      expect(rows[i].chgOi).toBe(rows[i].oi - rows[i - 1].oi);
    }
    expect(rows.every((r) => r.close > 0 && r.underlyingClose > 0)).toBe(true);
    expect(buildSampleDailyHistory({ symbol: "NIFTY", expiry: "2026-11-24", strike: 25000, type: "PE", spot: 25000, days: 10, now: fri })).toEqual(rows);
  });
});
