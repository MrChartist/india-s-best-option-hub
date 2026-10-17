import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BookOpen, Keyboard, RefreshCw, Wand2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { buildSampleChainData, isLiveSession, useExpiryList, useLiveIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { fetchLiveOptionChain } from "@/lib/marketApi";
import type { OptionData } from "@/lib/mockData";
import {
  BROKER_PRESETS,
  atmIV,
  black76Price,
  chainForward,
  dteLabel,
  forwardFromSpot,
  formatDateIST,
  formatINR,
  formatStrike,
  formatTimeIST,
  getContractSpec,
  getDividendYield,
  getExpiries,
  getLotSize,
  getMarketParams,
  getStrikeStep,
  istDateString,
  normalizeExpiry,
  pctToDec,
  syntheticFuture,
  timeToExpiryYears,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";
import { addPosition, createPosition, getLotSize as getFallbackLotSize, getSpotPrice } from "@/lib/positionStore";
import { chainQuote, getTemplate, resolveTemplate, smileFromChain, type PriceMode, type ResolveContext, type StrategyTemplate } from "@/lib/strategyTemplates";
import { ChargesBreakdown } from "@/components/strategy/ChargesBreakdown";
import { GreeksTable } from "@/components/strategy/GreeksTable";
import { LegTable } from "@/components/strategy/LegTable";
import { MiniChainPicker } from "@/components/strategy/MiniChainPicker";
import { PayoffChart } from "@/components/strategy/PayoffChart";
import { PnlHeatTable } from "@/components/strategy/PnlHeatTable";
import { SaveShareMenu } from "@/components/strategy/SaveShareMenu";
import { StatsPanel } from "@/components/strategy/StatsPanel";
import { StrategyWizard } from "@/components/strategy/StrategyWizard";
import { SymbolPicker } from "@/components/strategy/SymbolPicker";
import { TemplateLibrary } from "@/components/strategy/TemplateLibrary";
import { Segmented } from "@/components/strategy/Segmented";
import { analyseStrategy, computeP50 } from "@/components/strategy/strategyAnalysis";
import {
  decodeShare,
  encodeShare,
  flipSide,
  isTypingTarget,
  makeLegId,
  parseLegsParam,
  shiftStrikes,
  targetTimeline,
  toBuilderLegs,
  updateLegById,
  type BuilderLeg,
} from "@/components/strategy/strategyState";

const DRAFT_KEY = "mc_strategy_draft_v1";
const BANNER_KEY = "mc_sb_sebi_banner_v1";
const SEBI_STUDY_URL =
  "https://www.sebi.gov.in/reports-and-statistics/research/sep-2024/updated-sebi-study-reveals-93-of-individual-traders-incurred-losses-in-equity-fando-between-fy22-and-fy24-amounting-to-rs-1-8-lakh-crores-over-three-years_86906.html";
const QUICK_TEMPLATES = ["iron-condor", "short-strangle", "bull-call-spread", "bear-put-spread", "long-straddle", "call-calendar"];

const PRICE_MODES = [
  { value: "mid", label: "Mid", title: "Midpoint of bid and ask" },
  { value: "ltp", label: "LTP", title: "Last traded price" },
  { value: "natural", label: "Natural", title: "Buy at ask, sell at bid" },
] as const;

function lotSizeFor(symbol: string, expiry: string): number {
  return getLotSize(symbol, expiry) ?? getFallbackLotSize(symbol) ?? 1;
}

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the draft simply is not kept */
  }
}

interface InitialState {
  symbol: string;
  legs: BuilderLeg[];
  name: string;
  message: string | null;
  fromParams: boolean;
}

function readInitial(params: URLSearchParams): InitialState {
  const symParam = (params.get("symbol") || "").toUpperCase();
  const shared = decodeShare(params.get("s"), lotSizeFor);
  if (shared && shared.legs.length) {
    return { symbol: shared.symbol, legs: shared.legs, name: shared.name || "Shared strategy", message: `Loaded a shared strategy with ${shared.legs.length} legs.`, fromParams: true };
  }
  const draft = decodeShare(readStore(DRAFT_KEY), lotSizeFor);
  const today = istDateString();
  const draftLegs = (draft?.legs ?? []).filter((l) => l.expiry >= today);
  let symbol = symParam || draft?.symbol || "NIFTY";
  let legs = symParam && draft && draft.symbol !== symParam ? [] : draftLegs;
  let name = legs.length ? draft?.name || "" : "";
  let message: string | null = null;
  const basket = parseLegsParam(params.get("legs"), lotSizeFor);
  if (basket.length) {
    const bSym = basket[0].symbol;
    const same = basket.filter((l) => l.symbol === bSym);
    if (bSym === symbol && legs.length) {
      legs = [...legs, ...same];
      message = `Added ${same.length} leg${same.length === 1 ? "" : "s"} from your basket.`;
    } else {
      legs = same;
      name = "";
      message = `Loaded ${same.length} leg${same.length === 1 ? "" : "s"} from your basket${draftLegs.length && draft?.symbol !== bSym ? ` (your ${draft?.symbol} draft was replaced)` : ""}.`;
    }
    symbol = bSym;
    if (same.length < basket.length) message += " Legs on other symbols were skipped.";
  }
  return { symbol, legs, name, message, fromParams: basket.length > 0 || !!symParam };
}

interface SideChain {
  chain: OptionData[];
  spotPrice: number;
  source: string;
}

async function fetchChainFor(symbol: string, expiry: string): Promise<SideChain> {
  try {
    const res = await fetchLiveOptionChain(symbol, expiry);
    if (res.chain.length) return { chain: res.chain, spotPrice: res.spotPrice, source: res.stale ? "cache" : res.source };
  } catch {
    /* fall back to the labelled sample below */
  }
  const sample = await buildSampleChainData(symbol, expiry, "Live chain unavailable");
  return { chain: sample.chain, spotPrice: sample.spotPrice, source: "sample" };
}

export default function StrategyBuilder() {
  useDocumentTitle("Strategy Builder");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => readInitial(params));
  const [symbol, setSymbol] = useState(initial.symbol);
  const [legs, setLegs] = useState<BuilderLeg[]>(initial.legs);
  const [name, setName] = useState(initial.name);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string>(() => initial.legs.map((l) => l.expiry).sort()[0] ?? "");
  const [priceMode, setPriceMode] = useState<PriceMode>("mid");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [brokerId, setBrokerId] = useState("zerodha");
  const [roundTrip, setRoundTrip] = useState(true);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [ivShift, setIvShift] = useState(0);
  const [targetIdx, setTargetIdx] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(() => readStore(BANNER_KEY) === "1");
  const [now, setNow] = useState(() => new Date());
  const chartRef = useRef<HTMLDivElement>(null);
  const pendingTemplate = useRef<string | null>(initial.legs.length === 0 && !initial.fromParams ? "iron-condor" : null);

  // One-time: announce what came from the URL, then drop the params so a refresh does not re-add legs.
  useEffect(() => {
    if (initial.message) toast.success(initial.message);
    if (params.has("legs") || params.has("s")) {
      const next = new URLSearchParams(params);
      next.delete("legs");
      next.delete("s");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Keep a per-browser draft so a trip to the option chain and back keeps your legs.
  useEffect(() => {
    writeStore(DRAFT_KEY, encodeShare({ symbol, name, legs }));
  }, [symbol, name, legs]);

  // ── Market data ──
  const expiryQuery = useExpiryList(symbol);
  const expiries = useMemo(() => {
    const today = istDateString(now);
    const live = (expiryQuery.data?.expiries ?? []).map((e) => normalizeExpiry(e.value) || normalizeExpiry(e.label)).filter(Boolean);
    const list = live.length ? live : getExpiries(symbol, now, 8).map((e) => e.date);
    return Array.from(new Set(list)).filter((d) => d >= today).sort();
  }, [expiryQuery.data, symbol, now]);

  useEffect(() => {
    if (expiries.length && (!expiry || expiry < istDateString(now))) setExpiry(expiries[0]);
  }, [expiries, expiry, now]);

  const main = useLiveOptionChain(symbol, expiry || undefined);
  const { data: indices } = useLiveIndices();

  const extraExpiries = useMemo(() => {
    const want = new Set<string>(legs.map((l) => l.expiry));
    const idx = expiries.indexOf(expiry);
    if (idx >= 0 && expiries[idx + 1]) want.add(expiries[idx + 1]);
    want.delete(expiry);
    if (main.data?.expiry) want.delete(main.data.expiry);
    return Array.from(want).filter(Boolean).sort().slice(0, 4);
  }, [legs, expiries, expiry, main.data?.expiry]);

  const sideQueries = useQueries({
    queries: extraExpiries.map((e) => ({
      queryKey: ["sb-chain", symbol, e],
      queryFn: () => fetchChainFor(symbol, e),
      staleTime: 15_000,
      refetchInterval: isLiveSession() ? 30_000 : 300_000,
      retry: 0,
    })),
  });

  const chainMap = useMemo(() => {
    const m = new Map<string, OptionData[]>();
    if (main.data?.chain?.length) m.set(main.data.expiry || expiry, main.data.chain);
    sideQueries.forEach((q, i) => {
      if (q.data?.chain?.length) m.set(extraExpiries[i], q.data.chain);
    });
    return m;
  }, [main.data, expiry, sideQueries, extraExpiries]);

  const indexLtp = indices?.data?.find((i) => i.symbol === symbol)?.ltp;
  const spot = main.data?.spotPrice && main.data.spotPrice > 0 ? main.data.spotPrice : indexLtp && indexLtp > 0 ? indexLtp : getSpotPrice(symbol);
  const { r } = getMarketParams();
  const isIndex = getContractSpec(symbol)?.kind !== "STOCK";
  const strikeStep = getContractSpec(symbol) ? getStrikeStep(symbol) : main.data?.stepSize || 50;
  const mainChain = useMemo(() => chainMap.get(expiry) ?? [], [chainMap, expiry]);
  // Carry yield implied by the chain's put-call parity forward (F = S·e^{(r−q)T}). Leg IVs and the
  // smile are read on that forward, so valuing legs with the same q keeps the T+0 curve and pnlNow at
  // ~0 at the entry spot. Falls back to the static dividend table when the chain has no usable parity.
  const q = useMemo(() => {
    const qStatic = getDividendYield(symbol);
    const T = timeToExpiryYears(expiry, now);
    if (!(spot > 0) || !(T > 1 / 365) || mainChain.length === 0) return qStatic;
    const F = chainForward(mainChain, spot, T, r);
    const noParity = Math.abs(F - spot * Math.exp(r * T)) <= 1e-9 * spot;
    if (!(F > 0) || noParity) return qStatic;
    const implied = r - Math.log(F / spot) / T;
    return Number.isFinite(implied) ? Math.max(-0.1, Math.min(0.1, implied)) : qStatic;
  }, [symbol, expiry, now, spot, mainChain, r]);
  const anySample = main.data?.source === "sample" || sideQueries.some((s) => s.data?.source === "sample");

  const atmIvDec = useMemo(() => {
    const T = timeToExpiryYears(expiry, now);
    const F = chainForward(mainChain, spot, T > 0 ? T : 0, r);
    const iv = atmIV(mainChain, F);
    return Number.isFinite(iv) && iv > 0 ? pctToDec(iv) : isIndex ? 0.14 : 0.3;
  }, [mainChain, spot, expiry, now, r, isIndex]);

  const smileFor = useCallback(
    (exp: string) => {
      const T = timeToExpiryYears(exp, now);
      const chain = chainMap.get(exp);
      const F = chain ? chainForward(chain, spot, T > 0 ? T : 0, r) : forwardFromSpot(spot, T > 0 ? T : 0, r, q);
      return smileFromChain(chain, F, atmIvDec);
    },
    [chainMap, spot, now, r, q, atmIvDec],
  );

  /** Market price for a leg: chain quote in the chosen mode, else a Black-76 model price on the smile. */
  const quoteForLeg = useCallback(
    (l: Leg): { premium: number; iv?: number; source: "chain" | "model" } | null => {
      if (!(spot > 0) || !l.expiry) return null;
      const T = timeToExpiryYears(l.expiry, now);
      const chain = chainMap.get(l.expiry);
      if (l.type === "FUT") {
        const synth = chain?.length ? syntheticFuture(chain, spot) : NaN;
        const fut = Number.isFinite(synth) && synth > 0 ? synth : forwardFromSpot(spot, T > 0 ? T : 0, r, q);
        return { premium: Math.round(fut * 100) / 100, source: Number.isFinite(synth) ? "chain" : "model" };
      }
      const cq = chainQuote(chain, l.strike, l.type, l.side, priceMode);
      if (cq) return { premium: cq.premium, iv: cq.iv ?? smileFor(l.expiry)(l.strike), source: "chain" };
      if (!(T > 0)) return null;
      const iv = smileFor(l.expiry)(l.strike);
      const F = forwardFromSpot(spot, T, r, q);
      const px = black76Price({ F, K: l.strike, T, r, sigma: iv, type: l.type });
      return { premium: Math.max(0.05, Math.round(px * 20) / 20), iv, source: "model" };
    },
    [spot, now, chainMap, priceMode, r, q, smileFor],
  );

  // Refresh premiums from the chain: always for legs that need a quote, every poll when "refresh" is on.
  useEffect(() => {
    setLegs((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (l.manual) return l;
        if (!autoRefresh && !l.requote && l.premium > 0) return l;
        const qt = quoteForLeg(l);
        if (!qt) return l;
        const requote = qt.source !== "chain";
        const iv = qt.iv ?? l.iv;
        if (Math.abs(qt.premium - l.premium) < 0.005 && iv === l.iv && requote === !!l.requote) return l;
        changed = true;
        return { ...l, premium: qt.premium, iv, requote };
      });
      return changed ? next : prev;
    });
  }, [legs, quoteForLeg, autoRefresh]);

  const resolveCtx = useMemo<ResolveContext | null>(() => {
    if (!(spot > 0) || !expiry) return null;
    const idx = Math.max(0, expiries.indexOf(expiry));
    const list = [expiry, ...expiries.slice(idx + 1)];
    return {
      symbol,
      spot,
      expiries: list,
      strikeStep,
      lotSizeFor: (e: string) => lotSizeFor(symbol, e),
      chainFor: (e: string) => chainMap.get(e),
      atmIv: atmIvDec,
      priceMode,
      now,
      r,
      q,
    };
  }, [spot, expiry, expiries, symbol, strikeStep, chainMap, atmIvDec, priceMode, now, r, q]);

  const applyTemplate = useCallback((t: StrategyTemplate, resolved: Leg[]) => {
    setLegs(toBuilderLegs(resolved));
    setName(t.name);
    setTemplateId(t.id);
    setFocusedId(null);
    setTargetIdx(0);
    setLibraryOpen(false);
  }, []);

  // Apply a pending template (first visit, or after a symbol change) once the chain is in.
  useEffect(() => {
    const id = pendingTemplate.current;
    if (!id || !resolveCtx || !mainChain.length || main.isFetching) return;
    const t = getTemplate(id);
    pendingTemplate.current = null;
    if (!t) return;
    const resolvedLegs = resolveTemplate(t, resolveCtx);
    if (resolvedLegs.length) applyTemplate(t, resolvedLegs);
  }, [resolveCtx, mainChain.length, main.isFetching, applyTemplate]);

  // ── Leg actions (all immutable) ──
  const changeLeg = useCallback(
    (id: string, patch: Partial<BuilderLeg>) => {
      setLegs((prev) => {
        const cur = prev.find((l) => l.id === id);
        if (!cur) return prev;
        const structural = "strike" in patch || "type" in patch || "expiry" in patch || ("side" in patch && priceMode === "natural") || patch.manual === false;
        const extra: Partial<BuilderLeg> = {};
        if (structural && !patch.manual) Object.assign(extra, { manual: false, requote: true });
        if ("expiry" in patch && patch.expiry) extra.lotSize = lotSizeFor(cur.symbol, patch.expiry);
        if (patch.type === "FUT") extra.strike = 0;
        if (patch.type && patch.type !== "FUT" && cur.type === "FUT") extra.strike = Math.round(spot / strikeStep) * strikeStep;
        return updateLegById(prev, id, { ...patch, ...extra });
      });
      setTemplateId(null);
    },
    [priceMode, spot, strikeStep],
  );

  const removeLeg = useCallback((id: string) => {
    setLegs((prev) => prev.filter((l) => l.id !== id));
    setFocusedId((f) => (f === id ? null : f));
    setTemplateId(null);
  }, []);

  const addLeg = useCallback(
    (o?: { type: OptionType; side: Side; strike: number; premium: number; ivPct?: number }) => {
      if (!expiry) return;
      const strike = o?.strike ?? Math.round(spot / strikeStep) * strikeStep;
      const leg: BuilderLeg = {
        id: makeLegId(),
        symbol,
        type: o?.type ?? "CE",
        side: o?.side ?? "BUY",
        strike,
        expiry,
        lots: 1,
        lotSize: lotSizeFor(symbol, expiry),
        premium: o?.premium ?? 0,
        iv: o?.ivPct && o.ivPct > 0 ? pctToDec(o.ivPct) : undefined,
        enabled: true,
        requote: !o,
      };
      setLegs((prev) => [...prev, leg]);
      setFocusedId(leg.id);
      setTemplateId(null);
      if (!name) setName("Custom strategy");
    },
    [expiry, spot, strikeStep, symbol, name],
  );

  const changeSymbol = (s: string) => {
    if (s === symbol) return;
    pendingTemplate.current = templateId ?? (legs.length ? null : "iron-condor");
    if (legs.length && !templateId) toast.message(`Legs cleared for ${s}`, { description: "Strikes and lot sizes differ between underlyings." });
    setSymbol(s);
    setExpiry("");
    setLegs([]);
    setName(templateId ? name : "");
    setFocusedId(null);
    setTargetIdx(0);
  };

  const changeExpiry = (e: string) => {
    const old = expiry;
    setExpiry(e);
    setTargetIdx(0);
    setLegs((prev) => prev.map((l) => (l.expiry === old ? { ...l, expiry: e, lotSize: lotSizeFor(l.symbol, e), manual: false, requote: true } : l)));
  };

  const loadShare = (share: string) => {
    const st = decodeShare(share, lotSizeFor);
    if (!st || !st.legs.length) {
      toast.error("That saved strategy could not be read.");
      return;
    }
    if (st.symbol !== symbol) {
      setSymbol(st.symbol);
      pendingTemplate.current = null;
    }
    setLegs(st.legs);
    setName(st.name || "Saved strategy");
    setTemplateId(null);
    setExpiry(st.legs.map((l) => l.expiry).sort()[0] ?? "");
    toast.success(`Loaded ${st.name || "strategy"}`);
  };

  // ── Analytics ──
  const deferredLegs = useDeferredValue(legs);
  const broker = BROKER_PRESETS.find((b) => b.id === brokerId);
  const frontExp = useMemo(() => deferredLegs.filter((l) => l.enabled).map((l) => l.expiry).sort()[0] ?? expiry, [deferredLegs, expiry]);
  const analysis = useMemo(
    () => analyseStrategy({ legs: deferredLegs, spot, now, r, q, atmIv: atmIvDec, smile: smileFor(frontExp), broker, roundTrip }),
    [deferredLegs, spot, now, r, q, atmIvDec, smileFor, frontExp, broker, roundTrip],
  );
  const p50 = useMemo(() => computeP50(analysis, spot, atmIvDec, r), [analysis, spot, atmIvDec, r]);
  const timeline = useMemo(() => targetTimeline(analysis.frontExpiry || expiry, now), [analysis.frontExpiry, expiry, now]);
  const wizardTimeline = useMemo(() => targetTimeline(expiry, now), [expiry, now]);
  useEffect(() => {
    if (targetIdx > timeline.length - 1) setTargetIdx(Math.max(0, timeline.length - 1));
  }, [timeline.length, targetIdx]);

  const strikesFor = useCallback(
    (exp: string) => {
      const listed = (chainMap.get(exp) ?? []).map((r0) => r0.strikePrice).filter((k) => k > 0);
      if (listed.length) return Array.from(new Set(listed)).sort((a, b) => a - b);
      const atmK = Math.round(spot / strikeStep) * strikeStep;
      return Array.from({ length: 61 }, (_, i) => atmK + (i - 30) * strikeStep).filter((k) => k > 0);
    },
    [chainMap, spot, strikeStep],
  );
  const marketPriceFor = useCallback((l: BuilderLeg) => quoteForLeg(l)?.premium, [quoteForLeg]);
  const usedStrikes = useMemo(() => new Set(legs.filter((l) => l.expiry === expiry && l.type !== "FUT").map((l) => `${l.strike}${l.type}`)), [legs, expiry]);

  // ── Hotkeys: N add, Space flip focused, Delete remove focused, [ ] shift all strikes, { } shift focused ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || libraryOpen || wizardOpen) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addLeg();
      } else if (e.key === " " && focusedId) {
        e.preventDefault();
        setLegs((prev) => prev.map((l) => (l.id === focusedId ? { ...flipSide(l), requote: priceMode === "natural" ? true : l.requote, manual: priceMode === "natural" ? false : l.manual } : l)));
        setTemplateId(null);
      } else if (e.key === "Delete" && focusedId) {
        e.preventDefault();
        removeLeg(focusedId);
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        setLegs((prev) => shiftStrikes(prev, e.key === "]" ? 1 : -1, strikeStep));
      } else if ((e.key === "{" || e.key === "}") && focusedId) {
        e.preventDefault();
        setLegs((prev) => shiftStrikes(prev, e.key === "}" ? 1 : -1, strikeStep, [focusedId]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addLeg, removeLeg, focusedId, strikeStep, priceMode, libraryOpen, wizardOpen]);

  // ── Positions / summary ──
  const addToPositions = () => {
    const opts = legs.filter((l) => l.enabled && l.type !== "FUT");
    const futs = legs.filter((l) => l.enabled && l.type === "FUT").length;
    const greeksById = new Map(analysis.legGreeks.map((g) => [g.id, g.unit]));
    let added = 0;
    for (const l of opts) {
      if (l.type === "FUT") continue;
      const g = greeksById.get(l.id);
      const pos = createPosition({
        symbol: l.symbol,
        type: l.type,
        action: l.side,
        strike: l.strike,
        entryPrice: l.premium,
        currentPrice: quoteForLeg(l)?.premium ?? l.premium,
        lots: l.lots,
        lotSize: l.lotSize,
        expiry: l.expiry,
        iv: l.iv ? Math.round(l.iv * 1000) / 10 : undefined,
        delta: g ? Math.round(g.delta * 1000) / 1000 : undefined,
        theta: g ? Math.round(g.theta * 100) / 100 : undefined,
      });
      addPosition(pos);
      added++;
    }
    if (added) {
      toast.success(`Added ${added} leg${added === 1 ? "" : "s"} to Positions`, {
        description: futs ? `${futs} futures leg${futs === 1 ? " was" : "s were"} skipped (Positions tracks options only).` : "Entry prices are the premiums shown here.",
        action: { label: "Open", onClick: () => navigate("/position-tracker") },
      });
    } else {
      toast.error("No option legs to add", { description: "Positions tracks options only." });
    }
  };

  const summary = () => {
    const a = analysis;
    const lines = [
      `${name || "Custom strategy"} · ${symbol}`,
      `Spot ${formatStrike(Math.round(spot))} · ${formatDateIST(now)} ${formatTimeIST(now)}${anySample ? " · SAMPLE DATA" : ""}`,
      "",
      ...legs.filter((l) => l.enabled).map((l) => `${l.side} ${l.lots} lot${l.lots > 1 ? "s" : ""} (${l.lots * l.lotSize} qty) ${l.type === "FUT" ? "FUT" : `${l.strike} ${l.type}`} ${formatDateIST(l.expiry)} @ ₹${l.premium.toFixed(2)}`),
      "",
      `Max profit: ${a.unlimitedProfit ? "Unlimited" : formatINR(a.maxProfit, { decimals: 0 })}`,
      `Max loss: ${a.unlimitedLoss ? "Unlimited" : formatINR(a.maxLoss, { decimals: 0 })}`,
      `Breakevens: ${a.breakevens.map((b) => formatStrike(Math.round(b))).join(", ") || "None"} (after costs: ${a.breakevensNet.map((b) => formatStrike(Math.round(b))).join(", ") || "None"})`,
      `Prob. of profit: ${Number.isFinite(a.pop) ? (a.pop * 100).toFixed(1) + "%" : "—"}`,
      `Net premium: ${a.net.type === "CREDIT" ? "Credit" : "Debit"} ${formatINR(Math.abs(a.net.net), { decimals: 0 })}`,
      `Margin (estimate): ${formatINR(a.margin.total, { decimals: 0 })}`,
      `Greeks: Δ ${a.netGreeks.delta.toFixed(1)} · Γ ${a.netGreeks.gamma.toFixed(3)} · Θ ₹${a.netGreeks.theta.toFixed(0)}/day · Vega ₹${a.netGreeks.vega.toFixed(0)}/pt`,
      "",
      "Mr. Chartist Options Terminal · Data for education and research. Not investment advice.",
    ];
    return lines.join("\n");
  };

  // ── Source badge ──
  const source = main.data?.source;
  const sourceBadge = main.isLoading ? (
    <Badge variant="neutral">Loading</Badge>
  ) : anySample ? (
    <Badge variant="warning" title={main.data?.reason || "Live data unavailable"}>Sample data</Badge>
  ) : main.data?.stale || source === "cache" ? (
    <Badge variant="info">Cached</Badge>
  ) : main.data?.afterHours ? (
    <Badge variant="neutral">Closing prices</Badge>
  ) : main.data?.isLive ? (
    <Badge variant="bullish">Live</Badge>
  ) : (
    <Badge variant="neutral">Delayed</Badge>
  );

  const quickPicks = resolveCtx ? (
    <div className="flex flex-wrap justify-center gap-1.5">
      {QUICK_TEMPLATES.map((id) => {
        const t = getTemplate(id);
        if (!t) return null;
        return (
          <Button
            key={id}
            type="button"
            variant="outline"
            size="pill"
            onClick={() => {
              const resolved = resolveTemplate(t, resolveCtx);
              if (resolved.length) applyTemplate(t, resolved);
            }}
          >
            {t.name}
          </Button>
        );
      })}
    </div>
  ) : null;

  const maxRisk = !analysis.unlimitedLoss && Number.isFinite(analysis.maxLoss) && analysis.maxLoss < 0 ? Math.abs(analysis.maxLoss) : null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Strategy Builder</h1>
          <p className="text-sm text-muted-foreground">Build multi-leg option strategies from the live chain, then test them across price, time and IV.</p>
        </div>
        <div className="flex items-center gap-2">
          {sourceBadge}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Keyboard shortcuts">
                <Keyboard className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="end">
              <p className="mb-2 text-label uppercase text-muted-foreground">Keyboard shortcuts</p>
              <dl className="space-y-1.5 text-xs">
                {[
                  ["Add leg", "N"],
                  ["Flip buy/sell of the selected leg", "Space"],
                  ["Remove the selected leg", "Delete"],
                  ["Shift all strikes down / up", "[  ]"],
                  ["Shift the selected leg", "Shift + [  ]"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>
                      <kbd className="rounded-chip border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{v}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">Click or Tab to a leg to select it. Shortcuts pause while you type.</p>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {!bannerHidden && (
        <div role="note" className="flex items-start gap-2 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="flex-1 leading-relaxed">
            <span className="font-semibold">9 out of 10 individual F&O traders lost money</span> between FY22 and FY24, according to a{" "}
            <a href={SEBI_STUDY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary-ink underline underline-offset-2">
              SEBI study
            </a>
            . Size positions so a full loss is affordable.
          </p>
          <button
            type="button"
            onClick={() => {
              setBannerHidden(true);
              writeStore(BANNER_KEY, "1");
            }}
            className="rounded-chip p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:shadow-ember"
            aria-label="Dismiss risk notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <section aria-label="Strategy controls" className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-card p-2.5 shadow-card">
        <SymbolPicker value={symbol} onChange={changeSymbol} />
        <Select value={expiry} onValueChange={changeExpiry}>
          <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Expiry for new legs">
            <SelectValue placeholder="Expiry" />
          </SelectTrigger>
          <SelectContent>
            {expiries.map((e) => (
              <SelectItem key={e} value={e} className="text-xs">
                {formatDateIST(e)} <span className="text-muted-foreground">· {dteLabel(e, now)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-baseline gap-1.5 px-1 font-num text-sm">
          <span className="text-label uppercase text-muted-foreground">Spot</span>
          <span className="font-semibold">{spot > 0 ? formatStrike(Math.round(spot * 100) / 100) : "—"}</span>
          <span className="text-[11px] text-muted-foreground">
            · Lot {lotSizeFor(symbol, expiry)} · IV {(atmIvDec * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Segmented ariaLabel="Price leg premiums at" value={priceMode} options={PRICE_MODES} onChange={(v) => {
            setPriceMode(v);
            setLegs((prev) => prev.map((l) => (l.manual ? l : { ...l, requote: true })));
          }} />
          <div className="flex items-center gap-1.5">
            <Switch id="sb-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="sb-refresh" className="flex items-center gap-1 text-xs">
              <RefreshCw className="h-3 w-3" aria-hidden="true" /> Refresh to market
            </Label>
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLibraryOpen(true)}>
            <BookOpen /> Templates
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setWizardOpen(true)}>
            <Wand2 /> By view
          </Button>
          <SaveShareMenu legs={legs} symbol={symbol} name={name} summary={summary} chartRef={chartRef} onLoad={loadShare} onAddToPositions={addToPositions} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5 xl:col-span-4">
          <LegTable
            legs={legs}
            expiries={expiries}
            strikesFor={strikesFor}
            marketPriceFor={marketPriceFor}
            focusedId={focusedId}
            netPremium={analysis.net}
            templateName={name}
            onChange={changeLeg}
            onRemove={removeLeg}
            onFocus={setFocusedId}
            onAdd={() => addLeg()}
            onClear={() => {
              setLegs([]);
              setName("");
              setTemplateId(null);
              setFocusedId(null);
            }}
            emptyState={quickPicks}
          />
          <MiniChainPicker
            chain={mainChain}
            spot={spot}
            expiry={expiry}
            priceMode={priceMode}
            loading={main.isLoading}
            usedStrikes={usedStrikes}
            onAdd={(o) => addLeg(o)}
          />
        </div>
        <div className="min-w-0 space-y-4 lg:col-span-7 xl:col-span-8">
          <PayoffChart
            legs={analysis.active}
            spot={spot}
            now={now}
            r={r}
            q={q}
            timeline={timeline}
            targetIndex={targetIdx}
            onTargetIndex={setTargetIdx}
            ivShift={ivShift}
            onIvShift={setIvShift}
            atmIv={atmIvDec}
            breakevens={analysis.breakevens}
            multiExpiry={analysis.multiExpiry}
            frontAt={analysis.frontAt}
            frontExpiry={analysis.frontExpiry || expiry}
            chartRef={chartRef}
            badge={anySample ? <Badge variant="warning">Sample data</Badge> : analysis.multiExpiry ? <Badge variant="info">Calendar</Badge> : undefined}
          />
          <StatsPanel a={analysis} p50={p50} spot={spot} roundTrip={roundTrip} />
        </div>
      </div>

      <PnlHeatTable
        legs={analysis.active}
        symbol={symbol}
        spot={spot}
        now={now}
        r={r}
        q={q}
        ivShift={ivShift}
        frontExpiry={analysis.frontExpiry || expiry}
        T={analysis.T}
        atmIv={atmIvDec}
        strikes={strikesFor(analysis.frontExpiry || expiry)}
        maxRisk={maxRisk}
        margin={analysis.margin.total}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <GreeksTable rows={analysis.legGreeks} net={analysis.netGreeks} spot={spot} />
        <ChargesBreakdown
          charges={analysis.charges}
          brokerId={brokerId}
          onBrokerId={setBrokerId}
          roundTrip={roundTrip}
          onRoundTrip={setRoundTrip}
          orders={analysis.active.length * (roundTrip ? 2 : 1)}
          hasLongOptions={analysis.active.some((l) => l.side === "BUY" && l.type !== "FUT")}
        />
      </div>

      <TemplateLibrary open={libraryOpen} onOpenChange={setLibraryOpen} ctx={resolveCtx} onPick={applyTemplate} />
      <StrategyWizard open={wizardOpen} onOpenChange={setWizardOpen} ctx={resolveCtx} timeline={wizardTimeline} broker={broker} onPick={applyTemplate} />

      <footer className="space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          Prices use Black-76 on the forward with time measured to 15:30 IST expiry. Probabilities assume a lognormal market and are not forecasts. Margin is a SPAN-style estimate; your broker&apos;s figure will differ.
          {anySample && " Some chains above are sample data because live data was unavailable."}
        </p>
        <p className="font-medium">Data for education and research. Not investment advice.</p>
      </footer>
    </div>
  );
}
