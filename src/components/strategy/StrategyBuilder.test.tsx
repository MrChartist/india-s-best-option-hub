import { cloneElement, useState, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateSampleChain, getExpiries, istDateString, toISTDate, type Leg } from "@/lib/options";
import type { OptionChainHookData } from "@/hooks/useMarketData";
import { getTemplate, resolveTemplate, smileFromChain, type ResolveContext } from "@/lib/strategyTemplates";
import { analyseStrategy } from "./strategyAnalysis";
import { buildPayoffRows } from "./payoffRows";
import { PayoffChart } from "./PayoffChart";
import {
  decodeShare,
  encodeBase64Url,
  encodeShare,
  heatFootnote,
  maxCalendarGap,
  readBasketLeg,
  resolveInitialState,
  targetTimeline,
  toBuilderLegs,
  type ShareState,
  type TimePoint,
} from "./strategyState";

// ───────────────────────────── Fixtures ─────────────────────────────

const NOW = new Date("2026-10-19T05:00:00Z"); // Mon 19 Oct 2026, 10:30 IST
const EXP1 = "2026-10-27";
const EXP2 = "2026-11-03";
const SPOT = 25000;
const LOT = 65;
const lotSizeFor = () => LOT;
const chains = {
  [EXP1]: generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP1, now: NOW, strikes: 81 }).chain,
  [EXP2]: generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: EXP2, now: NOW, strikes: 81 }).chain,
};
const ctx: ResolveContext = {
  symbol: "NIFTY",
  spot: SPOT,
  expiries: [EXP1, EXP2],
  strikeStep: 50,
  lotSizeFor,
  chainFor: (e) => chains[e as keyof typeof chains],
  atmIv: 0.14,
  priceMode: "mid",
  now: NOW,
  r: 0.065,
  q: 0,
};

function analyse(legs: Leg[]) {
  return analyseStrategy({ legs: toBuilderLegs(legs), spot: SPOT, now: NOW, r: 0.065, q: 0, atmIv: 0.14, smile: smileFromChain(chains[EXP1], SPOT, 0.14), roundTrip: true });
}

// jsdom has no ResizeObserver (Radix Slider measures its thumb).
beforeAll(() => {
  if (!("ResizeObserver" in window)) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", { value: RO, configurable: true, writable: true });
    Object.defineProperty(globalThis, "ResizeObserver", { value: RO, configurable: true, writable: true });
  }
});

// Recharts' ResponsiveContainer measures 0×0 in jsdom; give the chart a fixed size instead.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  return { ...mod, ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 800, height: 300 }) };
});

// ───────────────────────────── Template → legs → stats ─────────────────────────────

describe("template to legs to max P/L and breakevens", () => {
  it("bull call spread: max profit = width − debit, max loss = debit, breakeven = long strike + debit", () => {
    const legs = resolveTemplate(getTemplate("bull-call-spread")!, ctx);
    expect(legs).toHaveLength(2);
    const long = legs.find((l) => l.side === "BUY")!;
    const short = legs.find((l) => l.side === "SELL")!;
    expect(long.type).toBe("CE");
    expect(short.strike).toBeGreaterThan(long.strike);
    const debit = long.premium - short.premium;
    const qty = long.lots * long.lotSize;
    const a = analyse(legs);
    expect(a.unlimitedProfit).toBe(false);
    expect(a.unlimitedLoss).toBe(false);
    expect(a.maxProfit).toBeCloseTo((short.strike - long.strike - debit) * qty, 0);
    expect(a.maxLoss).toBeCloseTo(-debit * qty, 0);
    expect(a.breakevens).toHaveLength(1);
    expect(Math.abs(a.breakevens[0] - (long.strike + debit))).toBeLessThan(1);
    expect(a.net.type).toBe("DEBIT");
  });

  it("iron condor: two breakevens at the short strikes ± net credit, loss capped by the wings", () => {
    const legs = resolveTemplate(getTemplate("iron-condor")!, ctx);
    expect(legs).toHaveLength(4);
    const shortPut = legs.find((l) => l.side === "SELL" && l.type === "PE")!;
    const shortCall = legs.find((l) => l.side === "SELL" && l.type === "CE")!;
    const longPut = legs.find((l) => l.side === "BUY" && l.type === "PE")!;
    const credit = legs.reduce((s, l) => s + (l.side === "SELL" ? l.premium : -l.premium), 0);
    const qty = shortPut.lots * shortPut.lotSize;
    const a = analyse(legs);
    expect(credit).toBeGreaterThan(0);
    expect(a.maxProfit).toBeCloseTo(credit * qty, 0);
    expect(a.maxLoss).toBeCloseTo(-(shortPut.strike - longPut.strike - credit) * qty, 0);
    expect(a.breakevens).toHaveLength(2);
    expect(Math.abs(a.breakevens[0] - (shortPut.strike - credit))).toBeLessThan(1);
    expect(Math.abs(a.breakevens[1] - (shortCall.strike + credit))).toBeLessThan(1);
    expect(a.margin.span + a.margin.exposure).toBeGreaterThan(0);
  });
});

// ───────────────────────────── Initial state ─────────────────────────────

describe("resolveInitialState", () => {
  const draftLegs = toBuilderLegs(resolveTemplate(getTemplate("short-strangle")!, ctx));
  const draft: ShareState = { symbol: "NIFTY", name: "My strangle", legs: draftLegs };
  const basketParam = (legs: object[]) => encodeBase64Url(JSON.stringify(legs));
  const niftyLeg = { symbol: "NIFTY", expiry: EXP1, strike: 25500, type: "CE", side: "BUY", lots: 1, premium: 40, iv: 0.13 };
  const bankLeg = { symbol: "BANKNIFTY", expiry: EXP1, strike: 56000, type: "PE", side: "SELL", lots: 1, premium: 210, iv: null };

  it("?legs= replaces the draft by default and keeps the old draft for undo", () => {
    const st = resolveInitialState({ params: new URLSearchParams({ legs: basketParam([niftyLeg]) }), draft, today: "2026-10-19", lotSizeFor });
    expect(st.legs).toHaveLength(1);
    expect(st.legs[0].strike).toBe(25500);
    expect(st.previous?.legs).toHaveLength(draftLegs.length);
    expect(st.previous?.name).toBe("My strangle");
    expect(st.message).toMatch(/replacing your draft/);
    expect(st.persist).toBe(true);
  });

  it("&mode=append appends to a same-symbol draft", () => {
    const st = resolveInitialState({ params: new URLSearchParams({ legs: basketParam([niftyLeg]), mode: "append" }), draft, today: "2026-10-19", lotSizeFor });
    expect(st.legs).toHaveLength(draftLegs.length + 1);
    expect(st.name).toBe("My strangle");
    expect(st.previous).not.toBeNull();
    expect(st.message).toMatch(/Added 1 leg/);
  });

  it("keeps legs on other symbols in `skipped` instead of dropping them", () => {
    const st = resolveInitialState({ params: new URLSearchParams({ legs: basketParam([niftyLeg, bankLeg, bankLeg]) }), draft: null, today: "2026-10-19", lotSizeFor });
    expect(st.symbol).toBe("NIFTY");
    expect(st.legs).toHaveLength(1);
    expect(st.skipped.map((l) => l.symbol)).toEqual(["BANKNIFTY", "BANKNIFTY"]);
    expect(st.previous).toBeNull();
  });

  it("does not persist when there is no draft (the default template is not saved until edited)", () => {
    const st = resolveInitialState({ params: new URLSearchParams(), draft: null, today: "2026-10-19", lotSizeFor });
    expect(st.legs).toHaveLength(0);
    expect(st.fromParams).toBe(false);
    expect(st.persist).toBe(false);
  });

  it("drops expired draft legs and ignores a draft on another ?symbol=", () => {
    expect(resolveInitialState({ params: new URLSearchParams(), draft, today: "2026-10-28", lotSizeFor }).legs).toHaveLength(0);
    const other = resolveInitialState({ params: new URLSearchParams({ symbol: "banknifty" }), draft, today: "2026-10-19", lotSizeFor });
    expect(other.symbol).toBe("BANKNIFTY");
    expect(other.legs).toHaveLength(0);
  });

  it("?s= opens a read-only snapshot and never persists it", () => {
    const s = encodeShare({ symbol: "NIFTY", name: "Shared", legs: draftLegs, pricedAt: 1_760_000_000_000, source: "sample", spot: 25010 });
    const st = resolveInitialState({ params: new URLSearchParams({ s }), draft: null, today: "2026-10-19", lotSizeFor });
    expect(st.shared).toEqual({ pricedAt: 1_760_000_000_000, source: "sample", spot: 25010 });
    expect(st.persist).toBe(false);
    expect(st.legs.every((l) => l.manual)).toBe(true);
  });
});

// ───────────────────────────── Basket guard ─────────────────────────────

describe("readBasketLeg (hand-written guard)", () => {
  it("accepts aliases and numeric strings, rejects bad values", () => {
    expect(readBasketLeg({ symbol: " nifty ", expiry: EXP1, strike: "25000", type: "call", side: "short", lots: "2", premium: "10.5" })).toEqual({
      symbol: "NIFTY",
      expiry: EXP1,
      strike: 25000,
      type: "CE",
      side: "SELL",
      lots: 2,
      premium: 10.5,
      iv: undefined,
    });
    expect(readBasketLeg({ symbol: "NIFTY", expiry: EXP1, strike: 25000, type: "CE", side: "BUY" })).toMatchObject({ lots: 1, premium: 0 });
    expect(readBasketLeg({ symbol: "NIFTY", expiry: EXP1, strike: -5, type: "CE", side: "BUY" })).toBeNull();
    expect(readBasketLeg({ symbol: "NIFTY", expiry: EXP1, strike: 25000, type: "XX", side: "BUY" })).toBeNull();
    expect(readBasketLeg({ symbol: "NIFTY", expiry: EXP1, strike: 25000, type: "PE", side: "BUY", lots: 0 })).toBeNull();
    expect(readBasketLeg({ symbol: "NIFTY", expiry: EXP1, strike: true, type: "PE", side: "BUY" })).toBeNull();
    expect(readBasketLeg(null)).toBeNull();
    expect(readBasketLeg([1, 2])).toBeNull();
  });
});

// ───────────────────────────── Share links ─────────────────────────────

describe("share links", () => {
  it("v2 carries entry prices, the price time, source and spot", () => {
    const legs = toBuilderLegs(resolveTemplate(getTemplate("iron-condor")!, ctx));
    const st = decodeShare(encodeShare({ symbol: "NIFTY", name: "Condor", legs, pricedAt: 1_760_000_000_000, source: "live", spot: 25000.5 }), lotSizeFor);
    expect(st?.pricedAt).toBe(1_760_000_000_000);
    expect(st?.source).toBe("live");
    expect(st?.spot).toBe(25000.5);
    expect(st?.legs.map((l) => l.premium)).toEqual(legs.map((l) => Math.round(l.premium * 100) / 100));
  });

  it("still decodes v1 links (no time or source)", () => {
    const v1 = encodeBase64Url(JSON.stringify({ v: 1, sym: "nifty", n: "Old", legs: [["CE", "SELL", 25500, EXP1, 1, 80.5, 0.13, 1], ["PE", "BUY", 24500, EXP1, 2, 30, null, 0]] }));
    const st = decodeShare(v1, lotSizeFor);
    expect(st?.symbol).toBe("NIFTY");
    expect(st?.legs).toHaveLength(2);
    expect(st?.legs[1]).toMatchObject({ enabled: false, lots: 2, iv: undefined, manual: true });
    expect(st?.pricedAt).toBeUndefined();
    expect(st?.source).toBeUndefined();
  });

  it("drops an unknown source and rejects unknown versions", () => {
    const bad = encodeBase64Url(JSON.stringify({ v: 2, sym: "NIFTY", legs: [], src: "hacked", ts: -1 }));
    expect(decodeShare(bad, lotSizeFor)).toEqual({ symbol: "NIFTY", name: undefined, legs: [] });
    expect(decodeShare(encodeBase64Url(JSON.stringify({ v: 3, sym: "NIFTY", legs: [] })), lotSizeFor)).toBeNull();
  });

  it("fuzz: decodeShare never throws and only returns well-formed legs", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
    const atoms: unknown[] = [null, undefined, true, 0, -1, 1, 1e308, NaN, "", "CE", "PE", "FUT", "BUY", "SELL", EXP1, "x".repeat(50), [], {}, 25000, 0.5];
    const randomValue = (depth: number): unknown => {
      if (depth <= 0 || rand() < 0.5) return pick(atoms);
      if (rand() < 0.5) return Array.from({ length: Math.floor(rand() * 9) }, () => randomValue(depth - 1));
      return { v: pick([1, 2, 3, "1"]), sym: pick(atoms), n: pick(atoms), legs: randomValue(depth - 1), ts: pick(atoms), src: pick(["live", "sample", 7]) };
    };
    const valid = encodeShare({ symbol: "NIFTY", legs: toBuilderLegs(resolveTemplate(getTemplate("iron-condor")!, ctx)), pricedAt: Date.now(), source: "sample" });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_=+/%!{}[]\"";
    for (let i = 0; i < 1500; i++) {
      let input: string;
      const mode = i % 4;
      if (mode === 0) input = Array.from({ length: Math.floor(rand() * 80) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      else if (mode === 1) input = encodeBase64Url(JSON.stringify(randomValue(4)) ?? "null");
      else if (mode === 2) {
        const at = Math.floor(rand() * valid.length);
        input = valid.slice(0, at) + alphabet[Math.floor(rand() * alphabet.length)] + valid.slice(at + 1);
      } else input = valid.slice(0, Math.floor(rand() * valid.length));
      let out: ReturnType<typeof decodeShare> = null;
      expect(() => {
        out = decodeShare(input, lotSizeFor);
      }).not.toThrow();
      const st = out as ShareState | null;
      if (st) {
        expect(typeof st.symbol).toBe("string");
        for (const l of st.legs) {
          expect(["CE", "PE", "FUT"]).toContain(l.type);
          expect(["BUY", "SELL"]).toContain(l.side);
          expect(Number.isFinite(l.premium) && l.premium >= 0).toBe(true);
          expect(l.lots).toBeGreaterThanOrEqual(1);
          expect(l.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }
    }
    expect(decodeShare(undefined, lotSizeFor)).toBeNull();
    expect(decodeShare("a".repeat(30000), lotSizeFor)).toBeNull();
  });
});

// ───────────────────────────── Heat-table footnote ─────────────────────────────

describe("heatFootnote", () => {
  const at = (iso: string, label: string, final = false): TimePoint => ({ at: toISTDate(iso, "15:30"), label, final });

  it("describes closes and flags weekend theta when columns skip calendar days", () => {
    const cols = [at("2026-10-23", "Now"), at("2026-10-23", "23 Oct close"), at("2026-10-26", "26 Oct close"), at("2026-10-27", "At expiry", true)];
    expect(maxCalendarGap(cols)).toBe(3);
    const f = heatFootnote(cols);
    expect(f.mode).toBe("closes");
    expect(f.columns).toMatch(/trading-day closes/);
    expect(f.gapNote).toMatch(/weekend or exchange holiday/);
  });

  it("switches to hourly wording on expiry day and has no gap note", () => {
    const cols = targetTimeline(EXP1, new Date("2026-10-27T04:00:00Z")); // 09:30 IST on expiry day
    const f = heatFootnote(cols);
    expect(f.mode).toBe("hourly");
    expect(f.columns).toMatch(/hourly/);
    expect(f.gapNote).toBeNull();
  });
});

// ───────────────────────────── Payoff: the slider moves the T+n curve ─────────────────────────────

describe("payoff T+n curve", () => {
  const legs = resolveTemplate(getTemplate("long-straddle")!, ctx);
  const timeline = targetTimeline(EXP1, NOW);

  it("buildPayoffRows: later target dates lose time value at the spot", () => {
    const base = { legs, spot: SPOT, zoom: 0.06, breakevens: [], multiExpiry: false, frontAt: null, ivShift: 0, now: NOW, r: 0.065, q: 0 };
    const atSpot = (rows: ReturnType<typeof buildPayoffRows>) => rows.find((r) => r.spot === SPOT)!.target;
    const t0 = buildPayoffRows({ ...base, targetAt: timeline[0].at });
    const tMid = buildPayoffRows({ ...base, targetAt: timeline[3].at });
    expect(t0.length).toBeGreaterThan(200);
    expect(atSpot(tMid)).toBeLessThan(atSpot(t0));
    expect(t0.map((r) => r.expiry)).toEqual(tMid.map((r) => r.expiry));
  });

  it("moving the target-date slider changes the curve and its label", () => {
    function Harness() {
      const [idx, setIdx] = useState(0);
      const [iv, setIv] = useState(0);
      return (
        <TooltipProvider>
          <PayoffChart
            legs={legs}
            spot={SPOT}
            now={NOW}
            r={0.065}
            q={0}
            timeline={timeline}
            targetIndex={idx}
            onTargetIndex={setIdx}
            ivShift={iv}
            onIvShift={setIv}
            atmIv={0.14}
            breakevens={[]}
            multiExpiry={false}
            frontAt={null}
            frontExpiry={EXP1}
          />
        </TooltipProvider>
      );
    }
    render(<Harness />);
    const chart = screen.getByRole("img", { name: /Payoff chart/ });
    const before = chart.getAttribute("aria-label");
    expect(screen.getAllByText("Today (T+0)").length).toBeGreaterThan(0);
    const slider = screen.getAllByRole("slider").find((el) => el.getAttribute("aria-valuetext") === "Now")!;
    act(() => {
      slider.focus();
    });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(chart.getAttribute("aria-label")).not.toBe(before);
    expect(screen.queryAllByText("Today (T+0)")).toHaveLength(0);
    expect(screen.getAllByText(/^T\+\d+ close$/).length).toBeGreaterThan(0);
    expect(screen.getByText("IV 1σ")).toBeInTheDocument();
  });
});

// ───────────────────────────── Fresh mount from a share URL ─────────────────────────────

const liveExpiries = getExpiries("NIFTY", new Date(), 4).map((e) => e.date);
const FRONT = liveExpiries[0];
const pageChain = generateSampleChain({ symbol: "NIFTY", spot: SPOT, expiry: FRONT, strikes: 61 });
const hookData: OptionChainHookData = {
  chain: pageChain.chain,
  spotPrice: SPOT,
  expiries: [],
  expiry: FRONT,
  lotSize: LOT,
  stepSize: 50,
  maxPain: SPOT,
  totalCEOI: 0,
  totalPEOI: 0,
  isLive: false,
  afterHours: false,
  source: "sample",
  cachedAt: null,
  asOf: Date.now(),
  stale: true,
  reason: "Proxy offline",
};

vi.mock("@/hooks/useMarketData", () => ({
  useLiveOptionChain: () => ({ data: hookData, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn() }),
  useExpiryList: () => ({ data: undefined, isLoading: false }),
  useLiveIndices: () => ({ data: undefined }),
  isLiveSession: () => false,
  buildSampleChainData: vi.fn(async () => hookData),
}));
vi.mock("@/lib/marketApi", () => ({
  fetchLiveOptionChain: vi.fn(async () => ({ chain: hookData.chain, spotPrice: SPOT, source: "sample", stale: true })),
}));

import StrategyBuilder from "@/pages/StrategyBuilder";

let lastLocation = "";
function LocationProbe() {
  const loc = useLocation();
  lastLocation = `${loc.pathname}${loc.search}`;
  return null;
}

function renderPage(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="/strategy-builder"
              element={
                <>
                  <StrategyBuilder />
                  <LocationProbe />
                </>
              }
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("Strategy Builder page", () => {
  beforeEach(() => {
    localStorage.clear();
    lastLocation = "";
  });
  afterEach(() => cleanup());

  it("a share URL opens as a frozen read-only snapshot in a fresh mount, and Open live hands it back", async () => {
    const legs = toBuilderLegs([
      { symbol: "NIFTY", type: "CE", side: "SELL", strike: 25500, expiry: FRONT, lots: 2, lotSize: LOT, premium: 61.25, iv: 0.12 },
      { symbol: "NIFTY", type: "CE", side: "BUY", strike: 25700, expiry: FRONT, lots: 2, lotSize: LOT, premium: 22.4, iv: 0.12 },
    ]);
    const pricedAt = toISTDate(istDateString(), "14:05").getTime();
    const s = encodeShare({ symbol: "NIFTY", name: "Bear call", legs, pricedAt, source: "sample", spot: 25012 });
    renderPage(`/strategy-builder?s=${s}`);

    const banner = await screen.findByText(/Shared snapshot, read-only/);
    const status = banner.closest("[role=status]") as HTMLElement;
    expect(within(status).getByText(/Priced at 14:05 IST/)).toBeInTheDocument();
    expect(status).toHaveTextContent(/sample data/);
    expect(screen.getByRole("heading", { level: 1, name: "Strategy Builder" })).toBeInTheDocument();
    // Entry premiums survived the round trip and the legs cannot be edited.
    const legsGroup = screen.getByRole("group", { name: /read-only shared snapshot/ });
    expect(legsGroup).toBeDisabled();
    expect(screen.getAllByText("Bear call").length).toBeGreaterThan(0);
    // The URL is cleaned and the shared snapshot is not written over the draft.
    expect(lastLocation).toBe("/strategy-builder");
    expect(localStorage.getItem("mc_strategy_draft_v1")).toBeNull();

    fireEvent.click(within(status).getByRole("button", { name: /Open live/ }));
    expect(screen.queryByText(/Shared snapshot, read-only/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /read-only shared snapshot/ })).not.toBeInTheDocument();
    expect(localStorage.getItem("mc_strategy_draft_v1")).not.toBeNull();
  });

  it("Paper trade sends enabled option legs to /paper-trading?legs=", async () => {
    const legs = toBuilderLegs([{ symbol: "NIFTY", type: "PE", side: "BUY", strike: 24800, expiry: FRONT, lots: 1, lotSize: LOT, premium: 90, iv: 0.13 }]);
    const s = encodeShare({ symbol: "NIFTY", legs, pricedAt: Date.now(), source: "live" });
    renderPage(`/strategy-builder?s=${s}`);
    await screen.findByText(/Shared snapshot, read-only/);
    fireEvent.click(screen.getByRole("button", { name: /Paper trade/ }));
    expect(lastLocation).toMatch(/^\/paper-trading\?legs=/);
    const { decodeLegs } = await import("@/components/option-chain/basket");
    const sent = decodeLegs(lastLocation.split("legs=")[1]);
    expect(sent).toEqual([{ symbol: "NIFTY", expiry: FRONT, strike: 24800, type: "PE", side: "BUY", lots: 1, premium: 90, iv: 0.13 }]);
  });
});
