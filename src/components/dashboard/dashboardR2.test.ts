import { describe, expect, it } from "vitest";
import { getSpotPrice } from "@/lib/positionStore";
import { sampleRows } from "@/lib/screener/sample";
import { DASH_LAYOUT_KEY, DEFAULT_LAYOUT, SECTION_IDS } from "./dashboardModel";
import { breadthOf, bridgePath, sampleIndices, sampleMarketSnapshot, sampleSectors, sampleStocks, sampleVix, sampleVixHistory, summariseStocks } from "./sampleMarket";
import {
  EXPORT_KIND,
  MAX_WORKSPACES,
  PRESETS,
  WORKSPACES_KEY,
  activeWorkspace,
  addWorkspace,
  applyPreset,
  defaultWorkspaceState,
  deleteWorkspace,
  exportWorkspaces,
  importWorkspaces,
  loadWorkspaces,
  matchingPreset,
  renameWorkspace,
  sanitizeWorkspaceState,
  saveWorkspaces,
  switchWorkspace,
  uniqueName,
  updateActiveLayout,
} from "./workspaces";
import { INITIAL_TOUR, TOUR_KEY, TOUR_STEPS, loadTour, sanitizeTour, saveTour, tourReducer } from "./onboarding";
import { briefHeadline, buildMarketBrief, eventsLine, eventsToday, fiiLine, gapLine, maxPainLine, pcrLine, vixLine, wallsLine, type BriefInputs } from "./marketBrief";
import { collectLiveGaps, partitionSections } from "./liveGaps";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

class ThrowingStorage extends MemoryStorage {
  getItem(): string | null { throw new Error("blocked"); }
  setItem(): void { throw new Error("blocked"); }
}

// Tue 27 Oct 2026, 11:00 IST: a normal NIFTY weekly expiry Tuesday.
const TUE_OPEN = new Date("2026-10-27T05:30:00Z");
// Mon 26 Oct 2026, 11:00 IST: no index expiry.
const MON = new Date("2026-10-26T05:30:00Z");
// Sat 17 Oct 2026, 10:00 IST.
const SAT = new Date("2026-10-17T04:30:00Z");
// Mon 26 Oct 2026, 08:45 IST: before the pre-open.
const MON_EARLY = new Date("2026-10-26T03:15:00Z");

describe("sample market snapshot", () => {
  it("uses the sample-chain spots and the screener's day changes for indices", () => {
    const idx = sampleIndices();
    const rows = sampleRows();
    expect(idx.map((i) => i.symbol)).toEqual(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]);
    for (const i of idx) {
      expect(i.ltp).toBe(getSpotPrice(i.symbol));
      expect(i.changePercent).toBeCloseTo(rows.find((r) => r.symbol === i.symbol)?.changePct ?? NaN, 6);
      expect(i.prevClose * (1 + i.changePercent / 100)).toBeCloseTo(i.ltp, 0);
      expect(i.low).toBeLessThanOrEqual(Math.min(i.open, i.ltp));
      expect(i.high).toBeGreaterThanOrEqual(Math.max(i.open, i.ltp));
      expect(i.path).toHaveLength(75);
      expect(i.path[0]).toBe(i.open);
      expect(i.path[i.path.length - 1]).toBe(i.ltp);
    }
  });

  it("is deterministic for a seed", () => {
    expect(sampleIndices(7)).toEqual(sampleIndices(7));
    expect(sampleStocks(7)).toEqual(sampleStocks(7));
    expect(sampleMarketSnapshot(7).vix).toEqual(sampleVix(7));
  });

  it("builds stocks from the screener sample with consistent OHLC, OI and OI change", () => {
    const stocks = sampleStocks();
    const rows = sampleRows().filter((r) => r.kind === "STOCK");
    expect(stocks).toHaveLength(rows.length);
    for (const s of stocks.slice(0, 40)) {
      const r = rows.find((x) => x.symbol === s.symbol);
      expect(s.ltp).toBe(r?.ltp);
      expect(s.changePercent).toBe(r?.changePct);
      expect(s.low).toBeLessThanOrEqual(Math.min(s.open, s.ltp));
      expect(s.high).toBeGreaterThanOrEqual(Math.max(s.open, s.ltp));
      expect(s.openInterest).toBeGreaterThan(0);
      if (s.oiChange !== 0) expect(Math.sign(s.oiChange)).toBe(Math.sign(r?.oiChangePct ?? 0));
    }
  });

  it("summarises movers like the live hook", () => {
    const sum = summariseStocks(sampleStocks());
    expect(sum.gainers).toHaveLength(5);
    expect(sum.losers).toHaveLength(5);
    expect(sum.mostActive).toHaveLength(10);
    expect(sum.gainers[0].changePercent).toBeGreaterThanOrEqual(sum.gainers[4].changePercent);
    expect(sum.losers[0].changePercent).toBeLessThanOrEqual(sum.losers[4].changePercent);
    expect(sum.mostActive[0].volume).toBeGreaterThanOrEqual(sum.mostActive[9].volume);
    expect(["Long Buildup", "Short Buildup", "Short Covering", "Long Unwinding", "Neutral"]).toContain(sum.mostActive[0].oiInterpretation);
  });

  it("counts breadth with a ±0.05% unchanged band and skips bad values", () => {
    expect(breadthOf([{ changePercent: 1 }, { changePercent: -0.2 }, { changePercent: 0.04 }, { changePercent: NaN }])).toEqual({ advances: 1, declines: 1, unchanged: 1 });
  });

  it("averages sample sectors, best first, and needs two stocks per sector", () => {
    const sectors = sampleSectors(sampleStocks());
    expect(sectors.length).toBeGreaterThan(3);
    for (let i = 1; i < sectors.length; i++) expect(sectors[i - 1].change).toBeGreaterThanOrEqual(sectors[i].change);
    expect(sectors.some((s) => s.name === "Other")).toBe(false);
  });

  it("takes sample VIX from the sample chain's NIFTY IV and draws a history that ends at it", () => {
    const v = sampleVix();
    expect(v.value).toBeGreaterThanOrEqual(13);
    expect(v.value).toBeLessThanOrEqual(15);
    expect(v.low).toBeLessThanOrEqual(v.value);
    expect(v.high).toBeGreaterThanOrEqual(v.value);
    const h = sampleVixHistory(v.value, MON, 30);
    expect(h).toHaveLength(30);
    expect(h[h.length - 1].close).toBe(v.value);
    for (let i = 1; i < h.length; i++) expect(h[i].time).toBeGreaterThan(h[i - 1].time);
    expect(h.every((p) => p.close >= v.value * 0.6 && p.close <= v.value * 1.6)).toBe(true);
    expect(sampleVixHistory(0, MON)).toEqual([]);
  });

  it("pins a bridge path at both ends", () => {
    let n = 0;
    const rnd = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const p = bridgePath(100, 110, 20, 0.5, rnd);
    expect(p[0]).toBe(100);
    expect(p[19]).toBe(110);
    expect(bridgePath(1, 2, 1, 1, rnd)).toEqual([2]);
  });
});

describe("workspaces", () => {
  it("defines four presets that each keep every section", () => {
    expect(PRESETS.map((p) => p.name)).toEqual(["Scalper", "Writer", "Swing", "Expiry"]);
    for (const p of PRESETS) {
      expect(new Set(p.layout.order).size).toBe(SECTION_IDS.length);
      expect(p.layout.hidden.every((h) => p.layout.order.includes(h))).toBe(true);
      expect(matchingPreset(p.layout)).toBe(p.id);
    }
    expect(PRESETS.find((p) => p.id === "expiry")?.layout.order[0]).toBe("expiry");
    expect(matchingPreset(DEFAULT_LAYOUT)).toBeNull();
  });

  it("migrates the single layout of the previous release on first load", () => {
    const s = new MemoryStorage();
    s.setItem(DASH_LAYOUT_KEY, JSON.stringify({ order: ["breadth"], hidden: ["indices"], density: "compact" }));
    const st = loadWorkspaces(s);
    expect(st.workspaces).toHaveLength(1);
    expect(activeWorkspace(st).layout.density).toBe("compact");
    expect(activeWorkspace(st).layout.hidden).toEqual(["indices"]);
    expect(loadWorkspaces(new MemoryStorage())).toEqual(defaultWorkspaceState());
  });

  it("round-trips through storage and survives blocked or corrupt storage", () => {
    const s = new MemoryStorage();
    const st = addWorkspace(defaultWorkspaceState(), "Expiry desk", PRESETS[3].layout);
    expect(saveWorkspaces(st, s)).toBe(true);
    expect(loadWorkspaces(s)).toEqual(st);
    s.setItem(WORKSPACES_KEY, "{oops");
    expect(loadWorkspaces(s).workspaces).toHaveLength(1);
    expect(saveWorkspaces(st, new ThrowingStorage())).toBe(false);
    expect(loadWorkspaces(new ThrowingStorage())).toEqual(defaultWorkspaceState());
    expect(saveWorkspaces(st, null)).toBe(false);
  });

  it("adds, switches, renames and deletes workspaces with unique names", () => {
    let st = defaultWorkspaceState();
    st = addWorkspace(st, "  Monday   expiry ", DEFAULT_LAYOUT);
    expect(activeWorkspace(st).name).toBe("Monday expiry");
    st = addWorkspace(st, "monday EXPIRY", DEFAULT_LAYOUT);
    expect(activeWorkspace(st).name).toBe("monday EXPIRY (2)");
    const first = st.workspaces[0].id;
    st = switchWorkspace(st, first);
    expect(st.activeId).toBe(first);
    expect(switchWorkspace(st, "nope")).toBe(st);
    st = renameWorkspace(st, first, "Main");
    expect(st.workspaces[0].name).toBe("Main");
    expect(renameWorkspace(st, first, "   ").workspaces[0].name).toBe("Main");
    st = deleteWorkspace(st, first);
    expect(st.workspaces).toHaveLength(2);
    expect(st.activeId).toBe(st.workspaces[0].id);
    const one = defaultWorkspaceState();
    expect(deleteWorkspace(one, one.activeId)).toBe(one);
  });

  it("caps the number of workspaces", () => {
    let st = defaultWorkspaceState();
    for (let i = 0; i < MAX_WORKSPACES + 3; i++) st = addWorkspace(st, `W${i}`, DEFAULT_LAYOUT);
    expect(st.workspaces).toHaveLength(MAX_WORKSPACES);
  });

  it("applies a preset only to the active workspace and edits layouts immutably", () => {
    let st = addWorkspace(defaultWorkspaceState(), "Second", DEFAULT_LAYOUT);
    st = applyPreset(st, "writer");
    expect(matchingPreset(activeWorkspace(st).layout)).toBe("writer");
    expect(matchingPreset(st.workspaces[0].layout)).toBeNull();
    const same = updateActiveLayout(st, (l) => l);
    expect(same).toBe(st);
    const dense = updateActiveLayout(st, (l) => ({ ...l, density: "compact" }));
    expect(activeWorkspace(dense).layout.density).toBe("compact");
    expect(activeWorkspace(st).layout.density).toBe("comfortable");
  });

  it("exports JSON and imports it back as extra workspaces", () => {
    const st = applyPreset(defaultWorkspaceState(), "scalper");
    const json = exportWorkspaces(st, undefined, new Date("2026-10-17T00:00:00Z"));
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(EXPORT_KIND);
    expect(parsed.exportedAt).toBe("2026-10-17T00:00:00.000Z");
    expect(parsed.workspaces[0]).not.toHaveProperty("id");
    const r = importWorkspaces(st, json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.workspaces).toHaveLength(2);
    expect(r.added).toEqual(["My dashboard (2)"]);
    expect(activeWorkspace(r.state).name).toBe("My dashboard (2)");
    expect(matchingPreset(activeWorkspace(r.state).layout)).toBe("scalper");
  });

  it("imports a single workspace or a bare layout, and explains bad input", () => {
    const st = defaultWorkspaceState();
    const one = importWorkspaces(st, JSON.stringify({ name: "Shared", layout: PRESETS[1].layout }));
    expect(one.ok && activeWorkspace(one.state).name).toBe("Shared");
    const bare = importWorkspaces(st, JSON.stringify({ order: ["breadth", "indices"], hidden: [], density: "compact" }));
    expect(bare.ok && activeWorkspace(bare.state).layout.order[0]).toBe("breadth");
    expect(importWorkspaces(st, "not json")).toMatchObject({ ok: false });
    expect(importWorkspaces(st, "42")).toMatchObject({ ok: false });
    expect(importWorkspaces(st, JSON.stringify({ workspaces: [{ name: "x" }] }))).toMatchObject({ ok: false });
    let full = st;
    for (let i = 0; i < MAX_WORKSPACES; i++) full = addWorkspace(full, `W${i}`, DEFAULT_LAYOUT);
    expect(importWorkspaces(full, JSON.stringify({ name: "x", layout: DEFAULT_LAYOUT }))).toMatchObject({ ok: false });
  });

  it("sanitises junk state and de-duplicates ids and names", () => {
    expect(sanitizeWorkspaceState(null)).toBeNull();
    expect(sanitizeWorkspaceState({ workspaces: [] })).toBeNull();
    const st = sanitizeWorkspaceState({ activeId: "zzz", workspaces: [{ id: "a", name: "A", layout: {} }, { id: "a", name: "a", layout: null }, 5] });
    expect(st?.workspaces).toHaveLength(2);
    expect(st?.workspaces[1].id).not.toBe("a");
    expect(st?.workspaces[1].name).toBe("a (2)");
    expect(st?.activeId).toBe("a");
    expect(uniqueName("X", [])).toBe("X");
  });
});

describe("onboarding tour", () => {
  it("has five steps covering chain, builder, paper and learn", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["welcome", "chain", "builder", "paper", "learn"]);
    expect(TOUR_STEPS.slice(1).every((s) => s.to && s.cta)).toBe(true);
  });

  it("steps forward and back, finishes on the last step and can restart", () => {
    let t = INITIAL_TOUR;
    t = tourReducer(t, { type: "back" });
    expect(t.step).toBe(0);
    for (let i = 0; i < 4; i++) t = tourReducer(t, { type: "next" });
    expect(t).toEqual({ step: 4, done: false });
    t = tourReducer(t, { type: "next" });
    expect(t.done).toBe(true);
    expect(tourReducer(t, { type: "restart" })).toEqual(INITIAL_TOUR);
    expect(tourReducer(INITIAL_TOUR, { type: "goto", step: 99 }).step).toBe(4);
    expect(tourReducer(INITIAL_TOUR, { type: "dismiss" })).toEqual({ step: 0, done: true });
  });

  it("persists safely", () => {
    const s = new MemoryStorage();
    saveTour({ step: 2, done: false }, s);
    expect(loadTour(s)).toEqual({ step: 2, done: false });
    s.setItem(TOUR_KEY, "{bad");
    expect(loadTour(s)).toEqual(INITIAL_TOUR);
    expect(loadTour(new ThrowingStorage())).toEqual(INITIAL_TOUR);
    expect(() => saveTour({ step: 1, done: true }, new ThrowingStorage())).not.toThrow();
    expect(sanitizeTour({ step: -3, done: "yes" })).toEqual({ step: 0, done: false });
    expect(sanitizeTour({ step: 2.5 })).toEqual({ step: 0, done: false });
  });
});

describe("daily market brief", () => {
  const base: BriefInputs = {
    now: MON,
    nifty: { ltp: 25150, open: 25100, prevClose: 25000, sample: false },
    vix: { value: 13.2, changePercent: -1.5, sample: false },
    pcr: { value: 0.95, prev: 0.9, sample: false },
    maxPain: { value: 25100, prev: 25000, spot: 25150, expiry: "2026-10-20", sample: false },
    fii: { longPct: 28.4, changePts: 1.2, zone: "Heavily short", tone: "bearish", sample: false },
    walls: { resistance: 25500, support: 24800, spot: 25150, sample: false },
  };

  it("reads the opening gap and whether it extended or faded", () => {
    const g = gapLine(base);
    expect(g.value).toBe("+0.40%");
    expect(g.tone).toBe("bullish");
    expect(g.detail).toMatch(/Gap up of \+100 pts at 25,100; the move has extended since \(\+50 pts\)/);
    const faded = gapLine({ ...base, nifty: { ltp: 25050, open: 25100, prevClose: 25000, sample: true } });
    expect(faded.detail).toMatch(/faded/);
    expect(faded.sample).toBe(true);
    expect(gapLine({ ...base, nifty: { ltp: 25010, open: 25010, prevClose: 25000, sample: false } }).detail).toMatch(/^Flat open/);
    expect(gapLine({ ...base, nifty: null }).available).toBe(false);
  });

  it("uses GIFT Nifty for the gap before the open", () => {
    const g = gapLine({ ...base, now: MON_EARLY, gift: { lastPrice: 25080, niftyClose: 25000 } });
    expect(g.detail).toMatch(/GIFT Nifty implies \+80 pts/);
    expect(g.phrase).toBe("GIFT Nifty points to a higher open");
  });

  it("bands VIX and PCR like the rest of the app", () => {
    const v = vixLine(base);
    expect(v.value).toBe("13.20");
    expect(v.detail).toMatch(/Low/);
    expect(v.tone).toBe("bullish");
    expect(vixLine({ ...base, vix: { value: 22, changePercent: 6, sample: false } }).tone).toBe("bearish");
    const p = pcrLine(base);
    expect(p.detail).toMatch(/^Balanced\. Up from 0\.90/);
    expect(p.tone).toBe("neutral");
    expect(pcrLine({ ...base, pcr: { value: 0.6, sample: false } }).tone).toBe("bearish");
    expect(pcrLine({ ...base, pcr: { value: 1.4, sample: false } }).tone).toBe("bullish");
    expect(pcrLine({ ...base, pcr: { value: 0, sample: false } }).available).toBe(false);
  });

  it("reports the max pain shift, or says history is needed", () => {
    const m = maxPainLine(base);
    expect(m.value).toBe("+100 pts");
    expect(m.detail).toMatch(/25,000 → 25,100 for 20 Oct\. Spot is 50 pts above\./);
    const noPrev = maxPainLine({ ...base, maxPain: { ...base.maxPain!, prev: null } });
    expect(noPrev.value).toBe("25,100");
    expect(noPrev.detail).toMatch(/No previous close is recorded yet/);
  });

  it("summarises FII positioning and OI walls", () => {
    expect(fiiLine(base).value).toBe("28.4% long");
    expect(fiiLine(base).detail).toBe("Heavily short (+1.2 pts on the day).");
    expect(fiiLine({ ...base, fii: null }).available).toBe(false);
    const w = wallsLine(base);
    expect(w.value).toBe("24,800 – 25,500");
    expect(w.detail).toMatch(/2\.8% range/);
    expect(wallsLine({ ...base, walls: { resistance: null, support: null, spot: 1, sample: false } }).available).toBe(false);
  });

  it("lists events today: expiry day, weekend and the next expiry", () => {
    expect(eventsToday(TUE_OPEN).expiries.map((e) => e.symbol)).toContain("NIFTY");
    // 27 Oct is the last Tuesday: the monthly expiry for all four NSE indices.
    const tue = eventsLine({ ...base, now: TUE_OPEN });
    expect(tue.value).toBe("4 expiries");
    expect(tue.detail).toMatch(/^NIFTY monthly, BANKNIFTY monthly, FINNIFTY monthly and MIDCPNIFTY monthly expire today at 15:30 IST/);
    expect(tue.tone).toBe("warning");
    // 3 Nov is an ordinary NIFTY weekly Tuesday.
    expect(eventsLine({ ...base, now: new Date("2026-11-03T05:30:00Z") }).value).toBe("Expiry day");
    const after = eventsLine({ ...base, now: new Date("2026-10-27T11:00:00Z") });
    expect(after.detail).toMatch(/expired today at 15:30 IST/);
    expect(eventsLine({ ...base, now: SAT }).value).toBe("Weekend");
    const mon = eventsLine(base);
    expect(mon.value).toBe("No expiry");
    expect(mon.detail).toMatch(/Next NIFTY weekly expiry 27 Oct/);
  });

  it("builds seven linked lines and a one-sentence headline", () => {
    const items = buildMarketBrief(base);
    expect(items.map((i) => i.key)).toEqual(["gap", "vix", "pcr", "maxPain", "fii", "walls", "events"]);
    expect(items.every((i) => i.to.startsWith("/"))).toBe(true);
    expect(briefHeadline(items)).toBe("Gap up, VIX low, PCR balanced.");
    expect(briefHeadline(buildMarketBrief({ ...base, now: TUE_OPEN }))).toBe("Gap up, VIX low, PCR balanced, NIFTY, BANKNIFTY, FINNIFTY and MIDCPNIFTY expiries today.");
    expect(briefHeadline([])).toBe("Waiting for market data.");
  });
});

describe("live gaps", () => {
  it("lists item gaps first, then empty sections", () => {
    const g = collectLiveGaps({ gift: false, pcrPrev: false, maxPainPrev: true, emptySections: [{ id: "movers", title: "Top movers" }] });
    expect(g.map((x) => x.label)).toEqual(["GIFT Nifty", "PCR vs previous close", "Top movers"]);
    expect(collectLiveGaps({ gift: true, pcrPrev: true, maxPainPrev: true })).toEqual([]);
  });

  it("keeps populated sections in order and pulls empty ones out", () => {
    expect(partitionSections(["indices", "movers", "breadth"], new Set(["movers"] as const))).toEqual({ populated: ["indices", "breadth"], empty: ["movers"] });
  });
});
