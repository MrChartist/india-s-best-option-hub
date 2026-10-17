import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Cpu, FlaskConical, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { addLegs, readBasket, strategyBuilderUrl, writeBasket } from "@/components/option-chain/basket";
import { OptimizerForm } from "@/components/optimizer/OptimizerForm";
import { DEFAULT_FORM_SETTINGS, type FormSettings } from "@/components/optimizer/formSettings";
import { ResultsGrid } from "@/components/optimizer/ResultsGrid";
import type { PayoffView } from "@/components/optimizer/ResultCard";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  enrichChain,
  formatCompactIN,
  formatDateIST,
  formatNumberIN,
  formatPct,
  formatStrike,
  formatTimeIST,
  getMarketParams,
  getStrikeStep,
  istDateString,
  normalizeExpiry,
  toISTDate,
} from "@/lib/options";
import {
  ALL_KINDS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  KIND_META,
  SENTIMENTS,
  buildScoreContext,
  clampTargetDate,
  contextSummary,
  isAbortError,
  rankResults,
  roundTo,
  runOptimizer,
  sentimentTarget,
  toBasketLegs,
  type OptimizerInput,
  type OptimizerOutput,
  type OptimizerProgress,
  type RankedCandidate,
  type RunMode,
  type Sentiment,
  type StrategyCategory,
} from "@/lib/optimizer";
import { cn } from "@/lib/utils";

const PREFS_KEY = "mc_optimizer_v1";

interface Prefs {
  symbol: string;
  settings: FormSettings;
}

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      const s = { ...DEFAULT_FORM_SETTINGS, ...(p.settings ?? {}) };
      const cats = Array.isArray(s.categories) ? s.categories.filter((c): c is StrategyCategory => CATEGORY_ORDER.includes(c as StrategyCategory)) : [];
      return {
        symbol: typeof p.symbol === "string" && p.symbol ? p.symbol : "NIFTY",
        settings: { ...s, categories: cats.length ? cats : [...CATEGORY_ORDER] },
      };
    }
  } catch {
    /* blocked storage: defaults */
  }
  return { symbol: "NIFTY", settings: DEFAULT_FORM_SETTINGS };
}

function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

type TabKey = "top" | StrategyCategory;

interface RunState {
  output: OptimizerOutput;
  mode: RunMode;
  view: PayoffView;
  asOf: number;
  key: string;
}

export default function Optimizer() {
  useDocumentTitle("Strategy optimizer");
  const navigate = useNavigate();
  const initial = useMemo(readPrefs, []);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [settings, setSettings] = useState<FormSettings>(initial.settings);
  const [expiryChoice, setExpiryChoice] = useState("");
  const [targetChoice, setTargetChoice] = useState<number | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>("neutral");
  const [dateChoice, setDateChoice] = useState("");
  const [tab, setTab] = useState<TabKey>("top");

  useEffect(() => writePrefs({ symbol, settings }), [symbol, settings]);

  // ── Data ──
  const frontQ = useLiveOptionChain(symbol, expiryChoice || undefined);
  const front = frontQ.data;
  const frontExpiry = front?.expiry ? normalizeExpiry(front.expiry) || front.expiry : "";
  const expiries = useMemo(() => front?.expiries ?? [], [front?.expiries]);
  const backExpiry = useMemo(() => {
    const later = expiries
      .map((e) => normalizeExpiry(e.value))
      .filter((v) => v && v > frontExpiry)
      .sort();
    return later[0] ?? "";
  }, [expiries, frontExpiry]);
  // Without a back expiry the hook gets the same arguments as the front query, so React Query dedupes it.
  const backQ = useLiveOptionChain(symbol, backExpiry || expiryChoice || undefined);
  const back = backQ.data;

  const spot = front?.spotPrice ?? 0;
  const lotSize = front?.lotSize ?? 0;
  const step = front?.stepSize && front.stepSize > 0 ? front.stepSize : getStrikeStep(symbol);
  const isSample = front?.source === "sample";

  const frontChain = useMemo(
    () => (front && frontExpiry && spot > 0 ? enrichChain(front.chain, { spot, expiry: frontExpiry }) : []),
    [front, frontExpiry, spot],
  );
  const backUsable = !!back && !!backExpiry && normalizeExpiry(back.expiry) === backExpiry && (back.source === "sample") === isSample && back.chain.length > 0;
  const backChain = useMemo(
    () => (backUsable && back ? enrichChain(back.chain, { spot: back.spotPrice || spot, expiry: backExpiry }) : []),
    [backUsable, back, backExpiry, spot],
  );

  // ── Derived inputs ──
  const today = istDateString();
  const targetDate = frontExpiry ? clampTargetDate(dateChoice || frontExpiry, today, frontExpiry) : "";
  const r = useMemo(() => getMarketParams().r, []);
  const kinds = useMemo(() => ALL_KINDS.filter((k) => settings.categories.includes(KIND_META[k].category)), [settings.categories]);

  const baseInput = useMemo((): Omit<OptimizerInput, "targetPrice" | "nowMs"> | null => {
    if (!front || frontChain.length === 0 || !(spot > 0) || !(lotSize > 0) || !frontExpiry) return null;
    return {
      symbol,
      spot,
      lotSize,
      front: { expiry: frontExpiry, chain: frontChain },
      back: backChain.length > 0 ? { expiry: backExpiry, chain: backChain } : null,
      r,
      targetDate,
      budget: settings.budget,
      maxLots: settings.maxLots,
      definedRiskOnly: settings.definedRiskOnly,
      strikesAroundAtm: settings.strikesAroundAtm,
      minOiPct: settings.minOiPct,
      maxSpreadPct: settings.maxSpreadPct,
      minPremium: settings.minPremium,
      pricing: settings.pricing,
      kinds,
    };
  }, [front, frontChain, backChain, backExpiry, spot, lotSize, frontExpiry, symbol, r, targetDate, settings, kinds]);

  // Market context (forward, ATM IV, 1σ to the target date) for the chart and sentiment shortcuts.
  const market = useMemo(() => {
    if (!baseInput) return null;
    const ctx = buildScoreContext({ ...baseInput, targetPrice: spot, nowMs: Date.now() }, today);
    return { ctx, summary: contextSummary(ctx) };
  }, [baseInput, spot, today]);

  const sentimentPrice = useCallback(
    (sId: Sentiment) => {
      const k = SENTIMENTS.find((x) => x.id === sId)?.sigmas ?? 0;
      if (!market) return roundTo(spot, step / 10);
      return sentimentTarget(spot, market.ctx.sigma, Math.max(market.ctx.tTarget, 1 / 365), k, step / 10);
    },
    [market, spot, step],
  );

  // A sentiment shortcut fixes the target once (it does not drift with every live tick).
  useEffect(() => {
    if (targetChoice === null && market && spot > 0) setTargetChoice(sentimentPrice(sentiment ?? "neutral"));
  }, [targetChoice, market, spot, sentiment, sentimentPrice]);
  const targetPrice = targetChoice ?? 0;

  // Reset per-underlying choices when the symbol changes.
  const changeSymbol = (s: string) => {
    if (s === symbol) return;
    setSymbol(s);
    setExpiryChoice("");
    setTargetChoice(null);
    setSentiment("neutral");
    setDateChoice("");
  };
  const changeExpiry = (e: string) => {
    setExpiryChoice(e);
    setDateChoice("");
    if (sentiment) setTargetChoice(null);
  };

  // ── Run ──
  const [run, setRun] = useState<RunState | null>(null);
  const [progress, setProgress] = useState<OptimizerProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [nonce, setNonce] = useState(0);

  const runKey = useMemo(
    () => (baseInput ? JSON.stringify({ s: symbol, e: frontExpiry, b: backChain.length > 0 ? backExpiry : "", src: front?.source, t: targetPrice, d: targetDate, st: { ...settings, w: undefined }, n: nonce }) : ""),
    [baseInput, symbol, frontExpiry, backExpiry, backChain.length, front?.source, targetPrice, targetDate, settings, nonce],
  );
  const inputRef = useRef<{ base: typeof baseInput; target: number; asOf: number }>({ base: null, target: 0, asOf: 0 });
  inputRef.current = { base: baseInput, target: targetPrice, asOf: front?.asOf ?? 0 };

  useEffect(() => {
    if (!runKey) return;
    const timer = window.setTimeout(() => {
      const { base, target, asOf } = inputRef.current;
      if (!base || !(target > 0)) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const nowMs = Date.now();
      const input: OptimizerInput = { ...base, targetPrice: target, nowMs };
      setRunning(true);
      setRunError(null);
      setProgress({ done: 0, total: 1, phase: "enumerate" });
      runOptimizer(input, { signal: ac.signal, onProgress: (p) => setProgress(p) })
        .then(({ output, mode }) => {
          if (ac.signal.aborted) return;
          setRun({
            output,
            mode,
            asOf,
            key: runKey,
            view: {
              symbol: base.symbol,
              spot: base.spot,
              target,
              lower: output.context.lower,
              upper: output.context.upper,
              nowMs,
              atDateMs: output.context.atDateMs,
              frontExpiryMs: toISTDate(base.front.expiry, "15:30").getTime(),
              atExpiry: output.context.atExpiry,
              r: base.r,
            },
          });
        })
        .catch((err: unknown) => {
          if (isAbortError(err)) return;
          setRunError(err instanceof Error ? err.message : "The optimizer could not finish");
        })
        .finally(() => {
          if (abortRef.current === ac) {
            setRunning(false);
            setProgress(null);
          }
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [runKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ranked = useMemo(() => (run ? rankResults(run.output.results, settings.w, 10) : null), [run, settings.w]);
  const visibleCats = CATEGORY_ORDER.filter((c) => settings.categories.includes(c));
  const activeTab: TabKey = tab !== "top" && !visibleCats.includes(tab) ? "top" : tab;
  const list: RankedCandidate[] = ranked ? (activeTab === "top" ? ranked.overall : ranked.byCategory[activeTab]) : [];
  const newerChain = !!run && !running && !!front && front.asOf !== run.asOf && run.key === runKey;

  // ── Actions ──
  const openInBuilder = useCallback(
    (c: RankedCandidate) => {
      navigate(strategyBuilderUrl(toBasketLegs(c, c.lots, symbol)));
    },
    [navigate, symbol],
  );
  const addToBasket = useCallback(
    (c: RankedCandidate) => {
      const legs = toBasketLegs(c, c.lots, symbol);
      writeBasket(addLegs(readBasket(), legs));
      toast.success(`Added ${c.label} to the basket`, { description: `${legs.length} leg${legs.length === 1 ? "" : "s"}${isSample ? " · sample prices" : ""}` });
    },
    [symbol, isSample],
  );

  const stats = run?.output.stats;
  const pctDone = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const daysToTarget = market ? market.summary.tTarget * 365 : NaN;

  return (
    <div className="space-y-3 pb-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-title">Strategy optimizer</h1>
          <p className="text-body-sm text-muted-foreground">Set a target price, a date and a budget. We rank liquid NSE strategies by return and chance of profit.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {front && <SourceBadge source={front.source} asOf={front.asOf} stale={front.stale} isLive={front.isLive} reason={front.reason} />}
          <Badge variant="neutral">Margin & POP derived</Badge>
        </div>
      </header>

      {isSample && (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-warning/30 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Sample data.</span> The live chain is unavailable ({front?.reason ?? "offline"}), so prices come from a generated Black-76 chain. Results are illustrative, not tradable quotes.
          </p>
        </div>
      )}

      {/* Market strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { id: "spot", label: `${symbol} spot`, value: spot > 0 ? formatNumberIN(spot, 2) : "—" },
          { id: "iv", label: "ATM IV", value: market ? formatPct(market.summary.atmIv * 100, { decimals: 1 }) : "—" },
          {
            id: "range",
            // text-transform: uppercase would turn σ into Σ (summation), so keep the symbol lower case.
            label: (
              <>
                1<span className="normal-case">σ</span> to target
              </>
            ),
            value: market ? `${formatStrike(Math.round(market.summary.lower))} – ${formatStrike(Math.round(market.summary.upper))}` : "—" },
          { id: "days", label: "To target date", value: Number.isFinite(daysToTarget) ? (daysToTarget < 1 ? `${Math.max(0, Math.round(daysToTarget * 24))}h` : `${daysToTarget.toFixed(1)} days`) : "—" },
          { id: "lot", label: "Lot size", value: lotSize > 0 ? `${lotSize}` : "—" },
        ].map((m) => (
          <div key={m.id} className="min-w-0 rounded-tile border border-border bg-card px-3 py-2 shadow-card">
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{m.label}</div>
            {front ? <div className="truncate font-num text-[15px] font-bold tabular-nums">{m.value}</div> : <Skeleton className="mt-1 h-5 w-20" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <aside className="h-fit rounded-card border border-border bg-card p-3 shadow-card lg:sticky lg:top-16" aria-label="Optimizer settings">
          <OptimizerForm
            symbol={symbol}
            onSymbolChange={changeSymbol}
            expiries={expiries}
            expiry={frontExpiry}
            onExpiryChange={changeExpiry}
            spot={spot}
            step={step}
            chart={market ? { forward: market.ctx.forwardTarget, sigma: market.ctx.sigma, T: market.ctx.tTarget, lower: market.summary.lower, upper: market.summary.upper } : null}
            targetPrice={targetPrice}
            onTargetPrice={(v) => {
              setTargetChoice(v);
              setSentiment(null);
            }}
            activeSentiment={sentiment}
            onSentiment={(sId) => {
              setSentiment(sId);
              setTargetChoice(sentimentPrice(sId));
            }}
            targetDate={targetDate}
            onTargetDate={(d) => {
              setDateChoice(d);
              if (sentiment) setTargetChoice(null);
            }}
            minDate={today}
            maxDate={frontExpiry || today}
            settings={settings}
            onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onReset={() => setSettings(DEFAULT_FORM_SETTINGS)}
          />
        </aside>

        <section className="min-w-0 space-y-3" aria-labelledby="opt-results-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="opt-results-h" className="flex items-center gap-1.5 font-display text-[16px] font-bold">
              <Sparkles className="h-4 w-4 text-primary-ink" aria-hidden="true" />
              Best strategies for {formatStrike(targetPrice)} by {targetDate ? formatDateIST(targetDate) : "expiry"}
            </h2>
            <div className="flex items-center gap-1.5">
              {newerChain && (
                <Button size="pill" variant="outline" onClick={() => setNonce((n) => n + 1)}>
                  <RefreshCw aria-hidden="true" /> Newer chain · re-run
                </Button>
              )}
              <Button size="pill" variant="ghost" onClick={() => setNonce((n) => n + 1)} disabled={!baseInput || running} aria-label="Run the optimizer again">
                <RefreshCw className={cn(running && "animate-spin")} aria-hidden="true" /> Re-run
              </Button>
            </div>
          </div>

          {/* Progress and stats */}
          <div className="min-h-[34px] space-y-1" aria-live="polite">
            {running && progress ? (
              <>
                <Progress value={progress.phase === "enumerate" ? 3 : pctDone} className="h-1.5" aria-label="Optimizer progress" />
                <p className="text-[11px] text-muted-foreground">
                  {progress.phase === "enumerate" ? "Building candidates…" : `Scoring ${formatNumberIN(progress.done)} of ${formatNumberIN(progress.total)} strategies…`}
                </p>
              </>
            ) : stats ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>
                  Scanned <b className="font-num text-foreground">{formatNumberIN(stats.enumerated)}</b>
                </span>
                <span>
                  Fit budget and profit at target <b className="font-num text-foreground">{formatNumberIN(stats.feasible)}</b>
                </span>
                {stats.liquidityRejected > 0 && <span>Illiquid {formatNumberIN(stats.liquidityRejected)}</span>}
                {stats.riskSkipped > 0 && <span>Undefined risk {formatNumberIN(stats.riskSkipped)}</span>}
                {stats.overBudget > 0 && <span>Over budget {formatNumberIN(stats.overBudget)}</span>}
                {stats.unprofitable > 0 && <span>No profit at target {formatNumberIN(stats.unprofitable)}</span>}
                <span className="inline-flex items-center gap-1">
                  <Cpu className="h-3 w-3" aria-hidden="true" />
                  {(stats.durationMs / 1000).toFixed(2)}s · {run?.mode === "worker" ? "Web Worker" : "main thread"}
                </span>
                {run && <span>Chain as of {formatTimeIST(run.asOf)}</span>}
              </p>
            ) : null}
          </div>

          {stats?.multiExpirySkipped && settings.categories.includes("calendar_diagonal") && (
            <p className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Calendars and diagonals need the next expiry{backExpiry ? ` (${formatDateIST(backExpiry)})` : ""} from the same data source; it is not available right now.
            </p>
          )}

          {runError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {runError}
              </span>
              <Button size="pill" variant="outline" onClick={() => setNonce((n) => n + 1)}>
                Try again
              </Button>
            </div>
          )}

          {frontQ.isError && !front && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
              <span>Could not load the option chain for {symbol}.</span>
              <Button size="pill" variant="outline" onClick={() => frontQ.refetch()}>
                Retry
              </Button>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setTab(v as TabKey)}>
            <div className="-mx-1 overflow-x-auto px-1 pb-1 pr-6 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)]">
              <TabsList className="h-auto w-max">
                <TabsTrigger value="top" className="text-xs">
                  Top picks
                </TabsTrigger>
                {visibleCats.map((c) => (
                  <TabsTrigger key={c} value={c} className="gap-1 text-xs" disabled={!!ranked && ranked.counts[c] === 0}>
                    {CATEGORY_LABELS[c]}
                    {ranked && <span className="font-num text-[10px] text-muted-foreground">{ranked.counts[c]}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>

          <ResultsGrid
            results={list}
            view={run?.view ?? null}
            loading={running || (!run && (frontQ.isLoading || !!baseInput))}
            onOpen={openInBuilder}
            onAddToBasket={addToBasket}
            emptyHint={
              stats && stats.feasible === 0 && stats.overBudget > stats.unprofitable
                ? `Most strategies need more than ${formatCompactIN(settings.budget, { symbol: true })} of margin. Raise the budget or allow fewer lots.`
                : undefined
            }
          />

          <div className="space-y-1 rounded-tile bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <p>
              <span className="font-semibold text-foreground">How this works.</span> Each structure is priced at {settings.pricing === "mid" ? "the bid/ask midpoint" : "natural prices (buy at ask, sell at bid)"}, valued at your
              target with Black-76 (time value kept when the target date is before expiry) and sized to your budget using a SPAN-style margin estimate. Return is profit at target after
              round-trip charges, divided by margin. Chance of profit uses a lognormal model with the chain&apos;s volatility smile. The slider blends the two.
            </p>
            <p>Data for education and research. Not investment advice.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
