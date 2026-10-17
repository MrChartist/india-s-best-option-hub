import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, BookOpen, Eye, FlaskConical, Keyboard, Layers, Loader2, PackagePlus, Radio, RefreshCw, Wand2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SaveBasketDialog } from "@/components/SaveBasketDialog";
import { previewBasket, type BasketPreview } from "@/lib/basketApi";
import { saveBasket } from "@/lib/basketStore";
import { mapLegsToBasketLegs } from "@/lib/strategyLegMapper";
import { encodeLegs, type BasketLeg } from "@/components/option-chain/basket";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  groupBySymbol,
  isTypingTarget,
  makeLegId,
  resolveInitialState,
  shiftStrikes,
  targetTimeline,
  toBuilderLegs,
  updateLegById,
  type BuilderLeg,
  type InitialState,
  type ShareSource,
  type ShareState,
  type SharedSnapshot,
} from "@/components/strategy/strategyState";

const DRAFT_KEY = "mc_strategy_draft_v1";
const BANNER_KEY = "mc_sb_sebi_banner_v1";
/** Legs per strategy. Broker baskets (typically 10-20 orders) and NSE spread orders cap well below 18. */
const MAX_LEGS = 10;
const SEBI_STUDY_URL =
  "https://www.sebi.gov.in/reports-and-statistics/research/sep-2024/updated-sebi-study-reveals-93-of-individual-traders-incurred-losses-in-equity-fando-between-fy22-and-fy24-amounting-to-rs-1-8-lakh-crores-over-three-years_86906.html";
const QUICK_TEMPLATES = ["iron-condor", "short-strangle", "bull-call-spread", "bear-put-spread", "long-straddle", "call-calendar"];

const PRICE_MODES = [
  { value: "mid", label: "Mid", title: "Midpoint of bid and ask" },
  { value: "ltp", label: "LTP", title: "Last traded price" },
  { value: "natural", label: "Natural", title: "Buy at ask, sell at bid" },
] as const;

const WIDE_QUERY = "(min-width: 1024px)";

/** True at the lg breakpoint and up, where the builder uses its two-column layout. */
function useWideLayout(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const mq = window.matchMedia(WIDE_QUERY);
      mq.addEventListener?.("change", cb);
      return () => mq.removeEventListener?.("change", cb);
    },
    () => (typeof window !== "undefined" && !!window.matchMedia ? window.matchMedia(WIDE_QUERY).matches : false),
    () => false,
  );
}

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

function readInitial(params: URLSearchParams): InitialState {
  return resolveInitialState({ params, draft: decodeShare(readStore(DRAFT_KEY), lotSizeFor), today: istDateString(), lotSizeFor });
}

const SOURCE_TEXT: Record<ShareSource, string> = { live: "live", sample: "sample data", delayed: "delayed data" };

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
  const wide = useWideLayout();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [initial] = useState(() => readInitial(params));
  const [shared, setShared] = useState<SharedSnapshot | null>(initial.shared);
  const [skipped, setSkipped] = useState<BuilderLeg[]>(initial.skipped);
  const [confirmSampleOpen, setConfirmSampleOpen] = useState(false);
  const readOnly = shared !== null;
  /** The draft is written back only once it is the user's own work (not the default template or a shared link). */
  const persistRef = useRef(initial.persist);
  const announcedRef = useRef(false);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [legs, setLegs] = useState<BuilderLeg[]>(initial.legs);
  const [name, setName] = useState(initial.name);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [expiry, setExpiry] = useState<string>(() => initial.legs.map((l) => l.expiry).sort()[0] ?? "");
  const [priceMode, setPriceMode] = useState<PriceMode>("mid");
  const [autoRefresh, setAutoRefresh] = useState(initial.shared === null);
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

  /** Mark the strategy as the user's own: persist the draft from now on and leave any shared snapshot. */
  const touch = useCallback(() => {
    persistRef.current = true;
    setShared(null);
  }, []);

  const restoreDraft = useCallback((prev: ShareState) => {
    persistRef.current = true;
    pendingTemplate.current = null;
    setShared(null);
    setSkipped([]);
    setSymbol(prev.symbol);
    setLegs(prev.legs);
    setName(prev.name || "");
    setTemplateId(null);
    setFocusedId(null);
    setTargetIdx(0);
    setExpiry(prev.legs.map((l) => l.expiry).sort()[0] ?? "");
    toast.success("Previous draft restored", { description: `${prev.legs.length} leg${prev.legs.length === 1 ? "" : "s"} on ${prev.symbol}.` });
  }, []);

  // One-time: announce what came from the URL, then drop the params so a refresh does not re-add legs.
  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    const prev = initial.previous;
    if (initial.message) {
      toast.success(initial.message, prev ? { duration: 12_000, action: { label: "Undo (restore previous draft)", onClick: () => restoreDraft(prev) } } : undefined);
    }
    if (params.has("legs") || params.has("s") || params.has("mode")) {
      const next = new URLSearchParams(params);
      next.delete("legs");
      next.delete("s");
      next.delete("mode");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Keep a per-browser draft so a trip to the option chain and back keeps your legs. The untouched
  // default template and read-only shared snapshots are never written, so they cannot overwrite a draft.
  useEffect(() => {
    if (persistRef.current && !readOnly) writeStore(DRAFT_KEY, encodeShare({ symbol, name, legs }));
  }, [symbol, name, legs, readOnly]);

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

  const applyTemplate = useCallback((t: StrategyTemplate, resolved: Leg[], auto = false) => {
    if (auto) persistRef.current = false;
    else touch();
    setLegs(toBuilderLegs(resolved));
    setName(t.name);
    setTemplateId(t.id);
    setFocusedId(null);
    setTargetIdx(0);
    setLibraryOpen(false);
  }, [touch]);

  // Apply a pending template (first visit, or after a symbol change) once the chain is in.
  useEffect(() => {
    const id = pendingTemplate.current;
    if (!id || !resolveCtx || !mainChain.length || main.isFetching) return;
    const t = getTemplate(id);
    pendingTemplate.current = null;
    if (!t) return;
    const resolvedLegs = resolveTemplate(t, resolveCtx);
    // First-visit default: not saved until edited. After a symbol switch the user's draft keeps saving.
    if (resolvedLegs.length) applyTemplate(t, resolvedLegs, !persistRef.current);
  }, [resolveCtx, mainChain.length, main.isFetching, applyTemplate]);

  // ── Leg actions (all immutable) ──
  const changeLeg = useCallback(
    (id: string, patch: Partial<BuilderLeg>) => {
      touch();
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
    [priceMode, spot, strikeStep, touch],
  );

  const removeLeg = useCallback(
    (id: string) => {
      touch();
      setLegs((prev) => prev.filter((l) => l.id !== id));
      setFocusedId((f) => (f === id ? null : f));
      setTemplateId(null);
    },
    [touch],
  );

  const atLegLimit = legs.length >= MAX_LEGS;
  const addLeg = useCallback(
    (o?: { type: OptionType; side: Side; strike: number; premium: number; ivPct?: number }) => {
      if (!expiry) return;
      if (legs.length >= MAX_LEGS) {
        toast.error(`Up to ${MAX_LEGS} legs per strategy`, {
          id: "leg-limit",
          description: "Broker baskets and exchange spread orders cap the number of legs. Remove a leg to add another.",
        });
        return;
      }
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
      touch();
      setLegs((prev) => [...prev, leg]);
      setFocusedId(leg.id);
      setTemplateId(null);
      if (!name) setName("Custom strategy");
    },
    [expiry, spot, strikeStep, symbol, name, touch, legs.length],
  );

  const changeSymbol = (s: string) => {
    if (s === symbol) return;
    touch();
    setSkipped([]);
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
    touch();
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
    touch();
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
      if (e.ctrlKey || e.metaKey || e.altKey || libraryOpen || wizardOpen || readOnly) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        addLeg();
      } else if (e.key === " " && focusedId) {
        e.preventDefault();
        touch();
        setLegs((prev) => prev.map((l) => (l.id === focusedId ? { ...flipSide(l), requote: priceMode === "natural" ? true : l.requote, manual: priceMode === "natural" ? false : l.manual } : l)));
        setTemplateId(null);
      } else if (e.key === "Delete" && focusedId) {
        e.preventDefault();
        removeLeg(focusedId);
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        touch();
        setLegs((prev) => shiftStrikes(prev, e.key === "]" ? 1 : -1, strikeStep));
      } else if ((e.key === "{" || e.key === "}") && focusedId) {
        e.preventDefault();
        touch();
        setLegs((prev) => shiftStrikes(prev, e.key === "}" ? 1 : -1, strikeStep, [focusedId]));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addLeg, removeLeg, focusedId, strikeStep, priceMode, libraryOpen, wizardOpen, readOnly, touch]);

  // ── Positions / paper trading ──
  const pricesAreSample = anySample || shared?.source === "sample";
  const greeksCard = <GreeksTable rows={analysis.legGreeks} net={analysis.netGreeks} spot={spot} />;
  const methodNote = (
    <>
      Prices use Black-76 on the forward with time measured to 15:30 IST expiry. Probabilities assume a lognormal market and are not forecasts. Margin is a SPAN-style estimate; your broker&apos;s figure will differ.
      {anySample && " Some chains above are sample data because live data was unavailable."}
    </>
  );
  const optionLegs = useMemo(() => legs.filter((l) => l.enabled && l.type !== "FUT"), [legs]);
  const paperHref = useMemo(() => {
    const basket: BasketLeg[] = [];
    for (const l of optionLegs) {
      if (l.type === "FUT") continue;
      basket.push({ symbol: l.symbol, expiry: l.expiry, strike: l.strike, type: l.type, side: l.side, lots: l.lots, premium: l.premium, iv: l.iv ?? null });
    }
    return basket.length ? `/paper-trading?legs=${encodeLegs(basket)}` : null;
  }, [optionLegs]);
  const openPaperTrade = () => {
    if (paperHref) navigate(paperHref);
  };

  // ── Save as basket (1CLIQ-TRADE-SPEC.md §9) ──
  // basket-deploy resolves the legs against the live chain for a preview, then the basket is saved
  // locally. Neither step places an order.
  const basketSymbols = useMemo(() => [...new Set(optionLegs.map((l) => l.symbol))], [optionLegs]);
  const basketLegs = useMemo(() => mapLegsToBasketLegs(optionLegs), [optionLegs]);
  const canSaveBasket = basketLegs.length > 0 && basketSymbols.length === 1;
  const [basketPreview, setBasketPreview] = useState<BasketPreview | null>(null);
  const [resolvingBasket, setResolvingBasket] = useState(false);
  const [savingBasket, setSavingBasket] = useState(false);
  const handleSaveAsBasket = async () => {
    if (!canSaveBasket) return;
    setResolvingBasket(true);
    try {
      setBasketPreview(await previewBasket(basketSymbols[0], basketLegs));
    } catch (e) {
      toast.error(`Could not resolve basket: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResolvingBasket(false);
    }
  };
  const handleConfirmSaveBasket = (basketName: string) => {
    if (!basketPreview) return;
    setSavingBasket(true);
    try {
      saveBasket({ name: basketName, symbol: basketSymbols[0], legs: basketLegs });
      toast.success(`Basket "${basketName}" saved`, {
        description: basketPreview.blockedForLive
          ? `${basketPreview.blockedLegIds.length} leg(s) are paper-only until a broker contract resolves.`
          : "All legs resolved to live contracts.",
      });
      setBasketPreview(null);
    } catch (e) {
      toast.error(`Could not save basket: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingBasket(false);
    }
  };

  const commitToPositions = () => {
    const futs = legs.filter((l) => l.enabled && l.type === "FUT").length;
    const greeksById = new Map(analysis.legGreeks.map((g) => [g.id, g.unit]));
    const source: "sample" | "live" = pricesAreSample ? "sample" : "live";
    let added = 0;
    for (const l of optionLegs) {
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
        tag: name || undefined,
      });
      addPosition(Object.assign(pos, { source }));
      added++;
    }
    if (added) {
      toast.success(`Added ${added} leg${added === 1 ? "" : "s"} to Positions${source === "sample" ? " (tagged sample)" : ""}`, {
        description: futs ? `${futs} futures leg${futs === 1 ? " was" : "s were"} skipped (Positions tracks options only).` : "Entry prices are the premiums shown here.",
        action: { label: "Open", onClick: () => navigate("/position-tracker") },
      });
    } else {
      toast.error("No option legs to add", { description: "Positions tracks options only." });
    }
  };

  const addToPositions = () => {
    if (pricesAreSample && optionLegs.length) setConfirmSampleOpen(true);
    else commitToPositions();
  };

  const openLive = () => {
    persistRef.current = true;
    setShared(null);
    setAutoRefresh(true);
    setLegs((prev) => prev.map((l) => ({ ...l, manual: false, requote: true })));
    toast.success("Repriced at market", { description: "Entry premiums now follow the chain. Edit freely; this is your draft." });
  };

  const editCopy = () => {
    touch();
    toast.message("Editing a copy", { description: "Shared entry prices are kept. Turn on Refresh to market to reprice." });
  };

  const swapToSkipped = (sym: string) => {
    const take = skipped.filter((l) => l.symbol === sym);
    if (!take.length) return;
    const keep = skipped.filter((l) => l.symbol !== sym);
    const current = legs.filter((l) => l.symbol === symbol);
    touch();
    pendingTemplate.current = null;
    setSkipped([...keep, ...current]);
    setSymbol(sym);
    setLegs(take);
    setName("");
    setTemplateId(null);
    setFocusedId(null);
    setTargetIdx(0);
    setExpiry(take.map((l) => l.expiry).sort()[0] ?? "");
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

  const shareSource: ShareSource = anySample ? "sample" : main.data?.isLive && !main.data?.stale ? "live" : "delayed";
  const skippedGroups = groupBySymbol(skipped);
  const sharedTime = shared?.pricedAt ? `${formatTimeIST(shared.pricedAt)}${istDateString(new Date(shared.pricedAt)) !== istDateString(now) ? `, ${formatDateIST(shared.pricedAt)}` : ""}` : null;

  const maxRisk = !analysis.unlimitedLoss && Number.isFinite(analysis.maxLoss) && analysis.maxLoss < 0 ? Math.abs(analysis.maxLoss) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Layers}
        eyebrow="Strategy"
        title="Strategy Builder"
        description="Build multi-leg option strategies from the live chain, then test them across price, time and IV."
        source={sourceBadge}
        actions={
          <>
            <Button
              type="button"
              size="sm"
              onClick={openPaperTrade}
              disabled={!paperHref}
              title={paperHref ? "Stage these option legs in Paper Trading" : "Add at least one enabled option leg (futures are not paper traded)"}
            >
              <FlaskConical /> Paper trade
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleSaveAsBasket}
              disabled={!canSaveBasket || resolvingBasket}
              title={
                canSaveBasket
                  ? "Resolve these legs against the live Dhan chain and save them as a basket (no order is placed)"
                  : "Add enabled option legs on a single symbol to save a basket"
              }
            >
              {resolvingBasket ? <Loader2 className="animate-spin" aria-hidden /> : <PackagePlus aria-hidden />} Save as basket
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Keyboard shortcuts">
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
                <p className="mt-2 text-[11px] text-muted-foreground">Click or Tab to a leg to select it. Shortcuts pause while you type or view a shared snapshot.</p>
              </PopoverContent>
            </Popover>
          </>
        }
      />

      {shared && (
        <div role="status" className="flex flex-col gap-2 rounded-tile border border-info/30 bg-wash-info px-3 py-2.5 text-xs sm:flex-row sm:items-center">
          <Eye className="hidden h-4 w-4 shrink-0 text-info sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1 leading-relaxed">
            <p className="font-semibold">
              Shared snapshot, read-only{" · "}
              <span className="font-num">{sharedTime ? `Priced at ${sharedTime}` : "Price time not recorded"}</span>
              {" · "}
              {shared.source ? SOURCE_TEXT[shared.source] : "source not recorded"}
            </p>
            <p className="text-muted-foreground">
              Entry premiums are frozen as shared{shared.spot ? <> (spot then <span className="font-num">{formatStrike(Math.round(shared.spot))}</span>)</> : null}. P&L and Greeks use today&apos;s market.
              {shared.source === "sample" && " These prices were sample data, not market quotes."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" onClick={openLive}>
              <Radio /> Open live
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={editCopy}>
              Edit a copy
            </Button>
          </div>
        </div>
      )}

      {skippedGroups.length > 0 && (
        <div role="note" className="flex flex-col gap-2 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2.5 text-xs sm:flex-row sm:items-center">
          <AlertTriangle className="hidden h-4 w-4 shrink-0 text-warning sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1 leading-relaxed">
            <p className="font-semibold">
              {skipped.length} basket leg{skipped.length === 1 ? "" : "s"} on {skippedGroups.map((g) => g.symbol).join(", ")} {skipped.length === 1 ? "was" : "were"} not loaded.
            </p>
            <p className="text-muted-foreground">A strategy uses one underlying. Switch to build the other one; the legs here are kept in this list.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {skippedGroups.slice(0, 3).map((g) => (
              <Button key={g.symbol} type="button" size="sm" variant="outline" onClick={() => swapToSkipped(g.symbol)}>
                Build {g.symbol} ({g.legs.length})
              </Button>
            ))}
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Dismiss skipped legs notice" onClick={() => setSkipped([])}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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
            className="rounded-chip p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:shadow-ember [@media(pointer:coarse)]:p-2.5"
            aria-label="Dismiss risk notice"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <section aria-label="Strategy controls" className="flex min-w-0 flex-wrap items-center gap-2 rounded-card border border-border bg-card p-2.5 shadow-card">
        <SymbolPicker value={symbol} onChange={changeSymbol} />
        <Select value={expiry} onValueChange={changeExpiry}>
          <SelectTrigger className="h-8 w-full min-w-0 gap-2 whitespace-nowrap text-xs sm:w-auto sm:min-w-[150px] sm:max-w-full" aria-label="Expiry for new legs">
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
          <SaveShareMenu
            legs={legs}
            symbol={symbol}
            name={name}
            summary={summary}
            chartRef={chartRef}
            onLoad={loadShare}
            onAddToPositions={addToPositions}
            source={shared?.source ?? shareSource}
            pricedAt={shared?.pricedAt}
            spot={shared?.spot ?? spot}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-12 [&>*]:min-w-0">
        <fieldset disabled={readOnly} aria-label={readOnly ? "Strategy legs (read-only shared snapshot)" : undefined} className="min-w-0 space-y-4 lg:col-span-5 xl:col-span-4">
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
              touch();
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
            disabledReason={atLegLimit ? `Leg limit reached (${MAX_LEGS}). Remove a leg to add another.` : undefined}
            onAdd={(o) => addLeg(o)}
          />
        </fieldset>
        <div className="order-first min-w-0 space-y-4 lg:order-none lg:col-span-7 xl:col-span-8">
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
            badge={
              pricesAreSample ? (
                <Badge variant="warning">Sample data</Badge>
              ) : shared ? (
                <Badge variant="info">Shared prices</Badge>
              ) : analysis.multiExpiry ? (
                <Badge variant="info">Calendar</Badge>
              ) : undefined
            }
          />
          <StatsPanel a={analysis} p50={p50} spot={spot} roundTrip={roundTrip} />
          {/* Two-column layout: the Greeks fill the space beside the legs and mini chain. */}
          {wide ? greeksCard : null}
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

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {wide ? null : greeksCard}
        <ChargesBreakdown
          charges={analysis.charges}
          brokerId={brokerId}
          onBrokerId={setBrokerId}
          roundTrip={roundTrip}
          onRoundTrip={setRoundTrip}
          orders={analysis.active.length * (roundTrip ? 2 : 1)}
          hasLongOptions={analysis.active.some((l) => l.side === "BUY" && l.type !== "FUT")}
        />
        {wide ? (
          <aside aria-label="How these numbers are worked out" className="self-start rounded-card border border-border bg-card p-4 text-body-sm leading-relaxed text-muted-foreground shadow-card">
            <p className="mb-1 text-label uppercase text-muted-foreground">Method</p>
            {methodNote}
          </aside>
        ) : null}
      </div>

      <TemplateLibrary open={libraryOpen} onOpenChange={setLibraryOpen} ctx={resolveCtx} onPick={applyTemplate} />
      <AlertDialog open={confirmSampleOpen} onOpenChange={setConfirmSampleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>These prices are sample data</AlertDialogTitle>
            <AlertDialogDescription>
              Live quotes were unavailable, so the entry premiums here are sample values, not prices you could trade at. Positions is for real trades. Paper Trading is the safer place to practise this strategy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmSampleOpen(false);
                commitToPositions();
              }}
            >
              Add anyway (tagged sample)
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmSampleOpen(false);
                openPaperTrade();
              }}
              disabled={!paperHref}
            >
              <FlaskConical /> Paper trade instead
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StrategyWizard open={wizardOpen} onOpenChange={setWizardOpen} ctx={resolveCtx} timeline={wizardTimeline} broker={broker} onPick={applyTemplate} />

      <footer className="space-y-1 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
        {wide ? null : <p>{methodNote}</p>}
        <p className="font-medium">Data for education and research. Not investment advice.</p>
      </footer>
      <SaveBasketDialog
        preview={basketPreview}
        defaultName={name || "Untitled basket"}
        busy={savingBasket}
        onConfirm={handleConfirmSaveBasket}
        onCancel={() => setBasketPreview(null)}
      />
    </div>
  );
}
