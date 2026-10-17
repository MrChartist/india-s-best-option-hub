import { describe, expect, it } from "vitest";
import { calcCharges, exerciseSTT, type Fill } from "@/lib/options";
import { getTemplate } from "@/lib/strategyTemplates";
import { anchorLegs, entryExpiry, legPnlPerUnit, makeChainView, monthlyExpiries, normaliseConfig, resolveLegs, runBacktestSync, slipped } from "../engine";
import { generateSampleDataset, SAMPLE_RANGE } from "../sampleData";
import { FEB_EXPIRIES, R, baseConfig, fixtureDataset, flat } from "./fixtures";

const fills = (legs: Array<{ type: "CE" | "PE" | "FUT"; side: "BUY" | "SELL"; entry: number; lots: number; lotSize: number }>): Fill[] =>
  legs.map((l) => ({ type: l.type, side: l.side, price: l.entry, qty: l.lots * l.lotSize, exchange: "NSE" }));

describe("entry timing", () => {
  const ds = fixtureDataset(flat(), FEB_EXPIRIES);
  const monthly = monthlyExpiries(ds);

  it("marks the last expiry of each month as monthly", () => {
    expect([...monthly].sort()).toEqual(["2026-02-24", "2026-03-31"]);
  });

  it("dte timing opens on the last session with DTE at or above the target", () => {
    const cfg = baseConfig({ dte: 7 });
    const opens = ds.days.map((d, i) => [d.date, entryExpiry(d, ds.days[i + 1], cfg, monthly)] as const).filter(([, e]) => e);
    expect(opens).toEqual([
      ["2026-02-03", "2026-02-10"],
      ["2026-02-10", "2026-02-17"],
      ["2026-02-17", "2026-02-24"],
    ]);
  });

  it("monthly series skips weekly expiries", () => {
    const cfg = baseConfig({ dte: 7, series: "monthly" });
    const opens = ds.days.map((d, i) => entryExpiry(d, ds.days[i + 1], cfg, monthly)).filter(Boolean);
    expect(opens).toEqual(["2026-02-24"]);
  });

  it("weekday timing opens on the chosen weekdays into the nearest expiry with the minimum DTE", () => {
    const cfg = baseConfig({ timing: "weekday", weekdays: [1], dte: 1 });
    const opens = ds.days.map((d, i) => [d.date, entryExpiry(d, ds.days[i + 1], cfg, monthly)] as const).filter(([, e]) => e);
    expect(opens).toEqual([
      ["2026-02-02", "2026-02-03"],
      ["2026-02-09", "2026-02-10"],
      ["2026-02-16", "2026-02-17"],
      ["2026-02-23", "2026-02-24"],
    ]);
  });

  it("a weekday filter restricts dte entries", () => {
    const cfg = baseConfig({ dte: 7, weekdays: [3] });
    expect(ds.days.map((d, i) => entryExpiry(d, ds.days[i + 1], cfg, monthly)).filter(Boolean)).toEqual([]);
  });
});

describe("strike selection", () => {
  const ds = fixtureDataset(flat(25_010), FEB_EXPIRIES);
  const day = ds.days[1]; // 2026-02-03
  const front = makeChainView(day, day.chains.find((c) => c.expiry === "2026-02-10")!, "NIFTY", R);
  const back = makeChainView(day, day.chains.find((c) => c.expiry === "2026-02-17")!, "NIFTY", R);

  it("builds a view with a parity forward and an implied ATM IV", () => {
    expect(front.atmK).toBe(25_000);
    expect(front.F).toBeGreaterThan(25_000);
    expect(front.atmIv).toBeGreaterThan(0.13);
    expect(front.atmIv).toBeLessThan(0.17);
  });

  it("ATM ± N moves the short strikes N steps out of the money", () => {
    const legs = resolveLegs(getTemplate("short-strangle")!, baseConfig({ strikeMode: "atm", atmOffset: 3 }), front, null)!;
    expect(legs.map((l) => [l.type, l.strike])).toEqual([
      ["CE", 25_150],
      ["PE", 24_850],
    ]);
  });

  it("delta mode re-selects the short legs and keeps the iron condor wings 4 strikes out", () => {
    const legs = resolveLegs(getTemplate("iron-condor")!, baseConfig({ strikeMode: "delta", delta: 0.3 }), front, null)!;
    const [sc, sp, lc, lp] = legs.map((l) => l.strike);
    expect(lc - sc).toBe(200);
    expect(sp - lp).toBe(200);
    const d = (K: number) => Math.abs(K - front.F);
    expect(d(sc)).toBeLessThan(d(resolveLegs(getTemplate("iron-condor")!, baseConfig(), front, null)![0].strike));
  });

  it("premium mode picks the OTM strike whose close is nearest the target", () => {
    const legs = resolveLegs(getTemplate("short-strangle")!, baseConfig({ strikeMode: "premium", premium: 40 }), front, null)!;
    for (const l of legs) {
      const px = front.quote(l.strike, l.type as "CE" | "PE")!;
      for (const K of front.strikes) {
        const otm = l.type === "CE" ? K >= front.atmK : K <= front.atmK;
        if (!otm) continue;
        const alt = front.quote(K, l.type as "CE" | "PE");
        if (alt !== null) expect(Math.abs(px - 40)).toBeLessThanOrEqual(Math.abs(alt - 40));
      }
    }
  });

  it("shifts the whole spread when the anchor is the long leg", () => {
    const t = getTemplate("bull-call-spread")!;
    expect(anchorLegs(t)).toEqual({ CE: 0 });
    const base = resolveLegs(t, baseConfig(), front, null)!;
    const moved = resolveLegs(t, baseConfig({ strikeMode: "atm", atmOffset: 2 }), front, null)!;
    expect(moved[0].strike).toBe(25_100);
    expect(moved[1].strike - moved[0].strike).toBe(base[1].strike - base[0].strike);
  });

  it("calendars use the next expiry at the same strike", () => {
    const legs = resolveLegs(getTemplate("call-calendar")!, baseConfig({ strikeMode: "delta", delta: 0.35 }), front, back)!;
    expect(legs[0].view.expiry).toBe("2026-02-10");
    expect(legs[1].view.expiry).toBe("2026-02-17");
    expect(legs[0].strike).toBe(legs[1].strike);
    expect(resolveLegs(getTemplate("call-calendar")!, baseConfig(), front, null)).toBeNull();
  });
});

describe("fills and P&L", () => {
  it("slippage always worsens the fill", () => {
    expect(slipped(100, "BUY", 1)).toBe(101);
    expect(slipped(100, "SELL", 1)).toBe(99);
    expect(slipped(0.05, "SELL", 5)).toBe(0.05);
    expect(slipped(100, "BUY", 0)).toBe(100);
  });

  it("per-unit P&L by side", () => {
    expect(legPnlPerUnit({ side: "BUY", entry: 10 }, 15)).toBe(5);
    expect(legPnlPerUnit({ side: "SELL", entry: 10 }, 15)).toBe(-5);
  });

  it("clamps impossible settings", () => {
    const c = normaliseConfig(baseConfig({ lots: 0, dte: -3, weekdays: [0, 6, 2, 2], delta: 5, profitPct: -1, slippagePct: 99 }));
    expect(c.lots).toBe(1);
    expect(c.dte).toBe(1);
    expect(c.weekdays).toEqual([2]);
    expect(c.delta).toBe(0.9);
    expect(c.profitPct).toBeNull();
    expect(c.slippagePct).toBe(20);
  });
});

describe("runs", () => {
  it("settles a short straddle at expiry on intrinsic value with entry charges only", () => {
    const path = flat(25_000).map(([d]) => [d, d === "2026-02-10" ? 25_180 : 25_000] as [string, number]);
    const out = runBacktestSync(baseConfig({ to: "2026-02-10" }), fixtureDataset(path, FEB_EXPIRIES));
    // The next trade opens at the same close (DTE 7 to the 17 Feb expiry) and is cut by the end of data.
    expect(out.trades.map((x) => x.reason)).toEqual(["expiry", "end"]);
    const t = out.trades[0];
    expect(t.entryDate).toBe("2026-02-03");
    expect(t.exitDate).toBe("2026-02-10");
    expect(t.reason).toBe("expiry");
    expect(t.legs.every((l) => l.lotSize === 65)).toBe(true);
    const ce = t.legs.find((l) => l.type === "CE")!;
    const pe = t.legs.find((l) => l.type === "PE")!;
    expect(ce.exit).toBe(180);
    expect(pe.exit).toBe(0);
    const gross = (ce.entry - 180 + pe.entry) * 65;
    expect(t.gross).toBeCloseTo(gross, 2);
    const entryCharges = calcCharges(fills(t.legs), { onDate: "2026-02-03" }).total;
    expect(t.charges).toBeCloseTo(entryCharges, 2);
    expect(t.net).toBeCloseTo(gross - entryCharges, 2);
    expect(t.netPremium).toBeCloseTo((ce.entry + pe.entry) * 65, 2);
    expect(t.basisKind).toBe("premium");
  });

  it("charges exercise STT on a long ITM option held to expiry", () => {
    const path = flat(25_000).map(([d]) => [d, d === "2026-02-10" ? 25_300 : 25_000] as [string, number]);
    const out = runBacktestSync(baseConfig({ templateId: "long-call", to: "2026-02-10" }), fixtureDataset(path, FEB_EXPIRIES));
    const t = out.trades[0];
    const leg = t.legs[0];
    expect(leg.exit).toBe(25_300 - leg.strike);
    const entry = calcCharges(fills(t.legs), { onDate: "2026-02-03" }).total;
    expect(t.charges).toBeCloseTo(entry + exerciseSTT(leg.exit, 65, "2026-02-10"), 2);
  });

  it("takes profit at the close when the target is reached", () => {
    const out = runBacktestSync(baseConfig({ profitPct: 50, to: "2026-02-10" }), fixtureDataset(flat(), FEB_EXPIRIES));
    const t = out.trades[0];
    expect(t.reason).toBe("target");
    expect(t.gross).toBeGreaterThanOrEqual(t.basis * 0.5);
    expect(t.exitDate < "2026-02-10").toBe(true);
    // exit charges are on top of the entry charges
    expect(t.charges).toBeGreaterThan(calcCharges(fills(t.legs), { onDate: t.entryDate }).total);
  });

  it("stops out on a gap", () => {
    const path = flat().map(([d]) => [d, d >= "2026-02-05" ? 26_250 : 25_000] as [string, number]);
    const out = runBacktestSync(baseConfig({ stopPct: 100, to: "2026-02-10" }), fixtureDataset(path, FEB_EXPIRIES));
    expect(out.trades[0].reason).toBe("stop");
    expect(out.trades[0].exitDate).toBe("2026-02-05");
    expect(out.trades[0].gross).toBeLessThan(-out.trades[0].basis);
    expect(out.trades[0].mae).toBeLessThan(0);
  });

  it("exits on days held and on exit DTE", () => {
    const ds = fixtureDataset(flat(), FEB_EXPIRIES);
    const a = runBacktestSync(baseConfig({ maxDaysHeld: 2, to: "2026-02-10" }), ds).trades[0];
    expect([a.reason, a.exitDate, a.daysHeld]).toEqual(["time", "2026-02-05", 2]);
    const b = runBacktestSync(baseConfig({ exitDte: 3, to: "2026-02-10" }), ds).trades[0];
    expect([b.reason, b.exitDate]).toEqual(["dte", "2026-02-09"]);
  });

  it("one position at a time: overlapping signals are counted as busy", () => {
    const out = runBacktestSync(baseConfig({ timing: "weekday", weekdays: [], dte: 7 }), fixtureDataset(flat(), FEB_EXPIRIES));
    expect(out.skipped.busy).toBeGreaterThan(0);
    for (let i = 1; i < out.trades.length; i++) expect(out.trades[i].entryDate >= out.trades[i - 1].exitDate).toBe(true);
  });

  it("closes a trade still open at the end of the data and says so", () => {
    const out = runBacktestSync(baseConfig({ to: "2026-02-06" }), fixtureDataset(flat(), FEB_EXPIRIES));
    expect(out.trades.at(-1)?.reason).toBe("end");
    expect(out.warnings.join(" ")).toMatch(/still open/);
    expect(out.equity.at(-1)?.pnl).toBeCloseTo(out.stats.netPnl, 2);
  });

  it("prices a missing strike with the model and counts it", () => {
    const ds = fixtureDataset(flat(), FEB_EXPIRIES);
    // Remove the ATM call close on the day after entry.
    const c = ds.days[2].chains.find((x) => x.expiry === "2026-02-10")!;
    c.ce[c.strikes.indexOf(25_000)] = null;
    const out = runBacktestSync(baseConfig({ maxDaysHeld: 1, to: "2026-02-10" }), ds);
    expect(out.trades[0].modelFills).toBe(1);
    expect(out.trades[0].legs.find((l) => l.type === "CE")?.modelExit).toBe(true);
    expect(out.warnings.join(" ")).toMatch(/Black-76/);
  });

  it("rejects an unknown template", () => {
    expect(() => runBacktestSync(baseConfig({ templateId: "nope" }), fixtureDataset(flat(), FEB_EXPIRIES))).toThrow(/Unknown strategy/);
  });

  it("uses the lot size in force for each expiry and is deterministic on the sample", () => {
    const ds = generateSampleDataset("NIFTY");
    const cfg = baseConfig({ templateId: "iron-condor", strikeMode: "delta", delta: 0.16, profitPct: 50, stopPct: 150, from: SAMPLE_RANGE.from, to: SAMPLE_RANGE.to });
    const a = runBacktestSync(cfg, ds);
    const b = runBacktestSync(cfg, generateSampleDataset("NIFTY"));
    expect(a.stats).toEqual(b.stats);
    expect(a.trades.length).toBeGreaterThan(30);
    // Sized by the lot in force on the entry date: min(entry date, expiry) before the 2025-12-31 revision → 75.
    for (const t of a.trades) for (const l of t.legs) expect(l.lotSize).toBe((t.entryDate < l.expiry ? t.entryDate : l.expiry) < "2025-12-31" ? 75 : 65);
    expect(a.lotSizes.map((x) => x.lotSize)).toEqual([75, 65]);
    expect(a.equity).toHaveLength(a.range.days);
    expect(a.byWeekday.reduce((s, r) => s + r.trades, 0)).toBe(a.trades.length);
    expect(a.byVix.reduce((s, r) => s + r.trades, 0)).toBe(a.trades.length);
  });
});
