import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Cpu, Database, Download, FlaskConical, History, Info, Play, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BacktestForm } from "@/components/backtest/BacktestForm";
import { BacktestSummary } from "@/components/backtest/BacktestSummary";
import { EquityChart } from "@/components/backtest/EquityChart";
import { SplitTable } from "@/components/backtest/SplitTable";
import { TradesTable } from "@/components/backtest/TradesTable";
import { BACKTEST_PRESETS } from "@/components/backtest/presets";
import { useBacktestRunner, type RunResult, type RunnerState } from "@/components/backtest/useBacktestRunner";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SAMPLE_DATA_MODE, useProxyStatus } from "@/lib/api/proxyClient";
import { DEFAULT_SETTINGS, SAMPLE_RANGE, parseSettings, tradesToCsv, type BacktestSettings } from "@/lib/backtest";
import { formatDateIST, formatNumberIN, getBrokerPreset } from "@/lib/options";

const PREFS_KEY = "mc_backtest_v1";

function readPrefs(proxyOnline: boolean): BacktestSettings {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const s = parseSettings(JSON.parse(raw));
      return SAMPLE_DATA_MODE ? { ...s, data: "sample" } : s;
    }
  } catch {
    /* blocked storage or bad JSON: defaults */
  }
  return { ...DEFAULT_SETTINGS, data: proxyOnline && !SAMPLE_DATA_MODE ? "bhavcopy" : "sample" };
}

function writePrefs(s: BacktestSettings): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function downloadCsv(result: RunResult): void {
  const o = result.output;
  const csv = tradesToCsv(o.trades, o.symbol, o.source);
  const name = `backtest_${o.symbol}_${o.templateId}_${o.range.from}_${o.range.to}${o.source === "sample" ? "_SAMPLE" : ""}.csv`;
  try {
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Trades exported", { description: `${o.trades.length} rows · ${name}` });
  } catch {
    toast.error("Could not create the CSV file in this browser");
  }
}

function ProgressPanel({ state, onCancel }: { state: RunnerState; onCancel: () => void }) {
  let label = "Preparing…";
  let value = 0;
  if (state.status === "loading") {
    const l = state.load;
    value = l && l.total > 0 ? (l.done / l.total) * 100 : 2;
    label = l ? `Loading NSE bhavcopy: ${l.done} of ${l.total} sessions${l.cached ? ` (${l.cached} from this browser's cache)` : ""}` : "Contacting the local proxy…";
  } else if (state.status === "running") {
    const p = state.progress;
    value = p ? (p.phase === "prepare" ? 3 : p.phase === "stats" ? 99 : Math.max(4, (p.done / Math.max(1, p.total)) * 100)) : 2;
    label = !p || p.phase === "prepare" ? "Preparing the dataset…" : p.phase === "stats" ? "Crunching the statistics…" : `Simulating session ${p.done} of ${p.total} · ${p.trades} trade${p.trades === 1 ? "" : "s"} so far`;
  }
  return (
    <div className="space-y-2 rounded-card border border-border bg-card p-3 shadow-card" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-body-sm font-semibold" role="status" aria-live="polite">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary-ink motion-reduce:animate-none" aria-hidden="true" />
          <span className="min-w-0 truncate">{label}</span>
        </p>
        <Button size="pill" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Progress value={value} aria-label="Backtest progress" />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {["net", "win", "exp", "pf", "dd", "streak", "sharpe", "costs"].map((k) => (
          <Skeleton key={k} className="h-[66px] rounded-tile" />
        ))}
      </div>
      <Skeleton className="h-[340px] rounded-card" />
      <Skeleton className="h-[220px] rounded-card" />
    </div>
  );
}

function EmptyState({ onPreset }: { onPreset: (patch: Partial<BacktestSettings>) => void }) {
  return (
    <div className="rounded-card border border-dashed border-border bg-card px-4 py-8 text-center shadow-card sm:px-8">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-wash-brand">
        <History className="h-5 w-5 text-primary-ink" aria-hidden="true" />
      </div>
      <h2 className="mt-3 font-display text-[17px] font-bold">Test a strategy on past expiries</h2>
      <p className="mx-auto mt-1 max-w-md text-body-sm text-muted-foreground">
        Choose a template, entry rule and exits on the left, then run. Every trade is filled at the end-of-day close, net of Indian charges, with the lot size each contract actually had.
      </p>
      <div className="mx-auto mt-4 grid max-w-2xl gap-2 sm:grid-cols-3">
        {BACKTEST_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPreset(p.patch)}
            className="group rounded-tile border border-border bg-surface/60 p-3 text-left transition-colors duration-fast hover:border-primary/40 hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
          >
            <span className="flex items-center gap-1.5 text-body-sm font-semibold text-foreground">
              <Play className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />
              {p.label}
            </span>
            <span className="mt-1 block text-[12px] leading-snug text-muted-foreground">{p.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Assumptions({ result }: { result: RunResult }) {
  const o = result.output;
  const c = o.config;
  const broker = getBrokerPreset(c.brokerId);
  const lots = o.lotSizes.map((l, i) => (i === 0 ? `${l.lotSize}` : `${l.lotSize} from the ${formatDateIST(l.expiry)} expiry`)).join(", then ");
  return (
    <section className="rounded-card border border-border bg-card p-3 shadow-card" aria-labelledby="bt-method-h">
      <h2 id="bt-method-h" className="flex items-center gap-1.5 font-display text-[14px] font-bold">
        <Info className="h-4 w-4 text-primary-ink" aria-hidden="true" /> How this was tested
      </h2>
      <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-[12px] leading-relaxed text-muted-foreground sm:grid-cols-2">
        <li>
          <span className="font-semibold text-foreground">Fills:</span> end-of-day closes with {formatNumberIN(c.slippagePct, 1)}% slippage on every fill. Stops and targets are checked only at the close, so live losses on a gap can be larger.
        </li>
        <li>
          <span className="font-semibold text-foreground">Costs:</span> {broker?.name ?? "Broker"} brokerage, STT, exchange, SEBI, stamp duty and GST at each fill date's rates; long ITM options left to expiry pay exercise STT.
        </li>
        <li>
          <span className="font-semibold text-foreground">Settlement:</span> options open at expiry settle at intrinsic value on the index close of the expiry day.
        </li>
        <li>
          <span className="font-semibold text-foreground">Lot size:</span> {lots || "per contract expiry"}, as set by NSE for each expiry. Returns use {formatNumberIN(c.capital)} of capital; margin is a SPAN-style estimate.
        </li>
        <li>
          <span className="font-semibold text-foreground">Positions:</span> one at a time; {o.skipped.busy} signal{o.skipped.busy === 1 ? " was" : "s were"} skipped while a trade was open
          {o.skipped.noChain + o.skipped.noPrice > 0 ? ` and ${o.skipped.noChain + o.skipped.noPrice} for missing chain data` : ""}.
        </li>
        <li>
          <span className="font-semibold text-foreground">Data:</span>{" "}
          {o.source === "sample"
            ? `seeded sample dataset (${formatDateIST(SAMPLE_RANGE.from)} – ${formatDateIST(SAMPLE_RANGE.to)}), Black-76 prices on a simulated index and VIX. Not market history.`
            : `NSE F&O bhavcopy closes for ${o.range.days} sessions${result.data.cached ? ` (${result.data.cached} read from this browser's cache)` : ""}${result.data.vixMissing ? "; India VIX history was unavailable" : ", India VIX from NSE"}.`}
        </li>
      </ul>
      {o.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border pt-2 text-[12px] text-warning">
          {o.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {w}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">Past results, real or simulated, do not predict future returns. This is an educational tool, not investment advice.</p>
    </section>
  );
}

function Results({ result, stale }: { result: RunResult; stale: boolean }) {
  const o = result.output;
  const sample = o.source === "sample";
  const [tab, setTab] = useState("trades");
  if (o.trades.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card px-4 py-8 text-center shadow-card">
        <AlertTriangle className="mx-auto h-6 w-6 text-warning" aria-hidden="true" />
        <h2 className="mt-2 font-display text-[16px] font-bold">No trades matched these rules</h2>
        <p className="mx-auto mt-1 max-w-md text-body-sm text-muted-foreground">
          Between {formatDateIST(o.range.from)} and {formatDateIST(o.range.to)} no session met the entry rule. Try a smaller DTE, clear the weekday filter, or switch the expiry to Weekly.
        </p>
      </div>
    );
  }
  return (
    <div className={stale ? "space-y-3 opacity-60 transition-opacity" : "space-y-3 transition-opacity"}>
      <BacktestSummary stats={o.stats} capital={o.config.capital} />
      <section className="rounded-card border border-border bg-card p-3 shadow-card" aria-labelledby="bt-equity-h">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="bt-equity-h" className="font-display text-[14px] font-bold">
            Equity curve and drawdown
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Net of charges, open trades marked at each close{sample ? " · sample data" : ""}
          </p>
        </div>
        <EquityChart points={o.equity} capital={o.config.capital} sample={sample} />
      </section>
      <section className="rounded-card border border-border bg-card p-3 shadow-card" aria-label="Trade breakdown">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="trades">Trades ({o.trades.length})</TabsTrigger>
              <TabsTrigger value="vix">VIX regime</TabsTrigger>
              <TabsTrigger value="weekday">Weekday</TabsTrigger>
              <TabsTrigger value="exit">Exit reason</TabsTrigger>
            </TabsList>
            <Button size="pill" variant="outline" onClick={() => downloadCsv(result)}>
              <Download aria-hidden="true" /> Export CSV
            </Button>
          </div>
          <TabsContent value="trades" className="mt-3">
            <TradesTable trades={o.trades} symbol={o.symbol} sample={sample} />
          </TabsContent>
          <TabsContent value="vix" className="mt-3">
            <SplitTable rows={o.byVix} caption="Results by India VIX at entry" groupLabel="VIX at entry" empty="No India VIX closes were available for these sessions." />
          </TabsContent>
          <TabsContent value="weekday" className="mt-3">
            <SplitTable rows={o.byWeekday} caption="Results by entry weekday" groupLabel="Entry day" empty="No trades." />
          </TabsContent>
          <TabsContent value="exit" className="mt-3">
            <SplitTable rows={o.byReason} caption="Results by exit reason" groupLabel="Exit" empty="No trades." />
          </TabsContent>
        </Tabs>
      </section>
      <Assumptions result={result} />
    </div>
  );
}

export default function Backtest() {
  useDocumentTitle("Backtester");
  const proxy = useProxyStatus();
  const proxyOnline = proxy.status === "online";
  const [settings, setSettings] = useState<BacktestSettings>(() => readPrefs(proxyOnline));
  const [resetKey, setResetKey] = useState(0);
  const { state, result, run, cancel } = useBacktestRunner();
  const busy = state.status === "loading" || state.status === "running";

  useEffect(() => writePrefs(settings), [settings]);

  const change = useCallback((patch: Partial<BacktestSettings>) => setSettings((s) => ({ ...s, ...patch })), []);
  const runWith = useCallback(
    (s: BacktestSettings) => {
      void run(s);
    },
    [run],
  );
  const onPreset = (patch: Partial<BacktestSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setResetKey((k) => k + 1);
    runWith(next);
  };

  const ranKey = useMemo(() => (result ? JSON.stringify(result.output.config) : ""), [result]);
  const resultSample = result?.output.source === "sample";
  const settingsChanged = !!result && !busy && JSON.stringify(settings) !== JSON.stringify(result.settings);

  const source = result ? (
    resultSample ? (
      <Badge variant="warning">
        <FlaskConical aria-hidden="true" /> Sample data
      </Badge>
    ) : (
      <Badge variant="info">
        <Database aria-hidden="true" /> NSE bhavcopy · {result.output.range.days} sessions
      </Badge>
    )
  ) : (
    <Badge variant={settings.data === "sample" ? "warning" : "neutral"}>
      {settings.data === "sample" ? <FlaskConical aria-hidden="true" /> : <Database aria-hidden="true" />}
      {settings.data === "sample" ? "Sample dataset selected" : "NSE bhavcopy selected"}
    </Badge>
  );

  return (
    <div className="space-y-3 pb-4">
      <PageHeader
        icon={History}
        eyebrow="Strategy"
        title="Backtester"
        description="Replay an options strategy over past expiries using end-of-day closes: entries by DTE, weekday, delta or premium, exits by target, stop or time, all net of charges."
        source={
          <>
            {source}
            <Badge variant="neutral">EOD closes</Badge>
            {result ? (
              <Badge variant="neutral" title={result.mode === "worker" ? "Ran in a background Web Worker" : "Ran on the main thread (Web Workers unavailable)"}>
                <Cpu aria-hidden="true" /> {(result.durationMs / 1000).toFixed(1)}s
              </Badge>
            ) : null}
          </>
        }
      />

      {result && resultSample ? (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-warning/30 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Sample data.</span>{" "}
            {result.data.fallbackReason ? `${result.data.fallbackReason}, so this run used the generated sample instead of NSE bhavcopy. ` : ""}
            Prices come from a seeded Black-76 simulation of {result.output.symbol} and India VIX ({formatDateIST(SAMPLE_RANGE.from)} – {formatDateIST(SAMPLE_RANGE.to)}). The figures show how the tool works; they are not market history.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <aside className="h-fit rounded-card border border-border bg-card p-3 shadow-card lg:sticky lg:top-4" aria-label="Backtest settings panel">
          <BacktestForm
            settings={settings}
            onChange={change}
            onRun={() => runWith(settings)}
            onCancel={cancel}
            onReset={() => {
              setSettings({ ...DEFAULT_SETTINGS, data: settings.data });
              setResetKey((k) => k + 1);
            }}
            busy={busy}
            proxyOnline={proxyOnline}
            sampleOnly={SAMPLE_DATA_MODE}
            resetKey={resetKey}
          />
        </aside>

        <section className="min-w-0 space-y-3" aria-labelledby="bt-results-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="bt-results-h" className="flex min-w-0 items-center gap-1.5 font-display text-[16px] font-bold">
              <Sparkles className="h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
              <span className="min-w-0 truncate">
                {result ? `${result.output.templateName} on ${result.output.symbol}` : "Results"}
              </span>
            </h2>
            {result ? (
              <p className="text-[11px] text-muted-foreground">
                {formatDateIST(result.output.range.from)} – {formatDateIST(result.output.range.to)} · {result.output.range.days} sessions
              </p>
            ) : null}
          </div>

          {busy ? <ProgressPanel state={state} onCancel={cancel} /> : null}
          {settingsChanged ? (
            <p className="flex items-center gap-1.5 rounded-tile border border-info/30 bg-wash-info px-3 py-2 text-body-sm text-info" role="status">
              <Info className="h-4 w-4 shrink-0" aria-hidden="true" /> Settings changed since this run. Press Run backtest to update.
            </p>
          ) : null}
          {state.status === "error" ? (
            <div role="alert" className="flex flex-wrap items-start justify-between gap-2 rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
              <p className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">The backtest stopped.</span> {state.message}
                </span>
              </p>
              <Button size="pill" variant="outline" onClick={() => runWith(settings)}>
                <RefreshCw aria-hidden="true" /> Try again
              </Button>
            </div>
          ) : null}

          {result ? <Results key={ranKey} result={result} stale={busy} /> : busy ? <ResultsSkeleton /> : <EmptyState onPreset={onPreset} />}
        </section>
      </div>
    </div>
  );
}
