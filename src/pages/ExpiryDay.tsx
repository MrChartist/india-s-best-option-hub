/**
 * Expiry Day (0DTE) command centre: countdown to 15:30 IST, the live ATM straddle and its decay
 * against a constant-IV model, multi-straddle charts, hero-zero strikes, OI walls and max-pain
 * drift, NIFTY vs SENSEX, and the expiry-day rules.
 */
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CircleDot, FlaskConical, Info, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ExpiryCountdown } from "@/components/expiry/ExpiryCountdown";
import { ExpiryOIWalls } from "@/components/expiry/ExpiryOIWalls";
import { ExpiryRulesCard } from "@/components/expiry/ExpiryRulesCard";
import { HeroZeroTable } from "@/components/expiry/HeroZeroTable";
import { MultiStraddleChart } from "@/components/expiry/MultiStraddleChart";
import { StraddleChart } from "@/components/expiry/StraddleChart";
import { StraddleDecayVsTheory } from "@/components/expiry/StraddleDecayVsTheory";
import { WeeklyCompare } from "@/components/expiry/WeeklyCompare";
import { ModeBadge, Stat } from "@/components/expiry/ExpiryUi";
import { EXPIRY_SYMBOLS, analyseStraddle, expiryMetrics, isExpirySymbol, oiWalls, pickExpirySymbol, type ExpirySymbol } from "@/components/expiry/expiryMath";
import { useExpirySession, useNow } from "@/components/expiry/useExpirySession";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSnapshotRecorder } from "@/hooks/useSnapshotRecorder";
import {
  expectedMoveFromStraddle,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  formatStrike,
  getContractSpec,
  getExpiries,
  getMarketSession,
  istDateString,
  isWeeklyExpiry,
} from "@/lib/options";

const TABS = [
  { value: "decay", label: "Decay vs theory" },
  { value: "multi", label: "Multi-straddle" },
  { value: "hero", label: "Hero-zero" },
  { value: "oi", label: "OI walls & flow" },
  { value: "compare", label: "NIFTY vs SENSEX" },
  { value: "rules", label: "Rules" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

export default function ExpiryDay() {
  useDocumentTitle("Expiry Day");
  const [params, setParams] = useSearchParams();
  const [defaults] = useState(() => pickExpirySymbol(new Date()));
  const symParam = (params.get("symbol") || "").toUpperCase();
  const symbol: ExpirySymbol = isExpirySymbol(symParam) ? symParam : defaults.symbol;
  const tabParam = params.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : "decay";

  const minute = useNow(60_000);
  const dayKey = istDateString(minute);
  const minuteKey = Math.floor(minute.getTime() / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh the expiry list each minute (it rolls at 15:30)
  const expiries = useMemo(() => getExpiries(symbol, new Date(), 4), [symbol, minuteKey]);
  const expParam = params.get("expiry") || "";
  const expiry = expiries.some((e) => e.date === expParam) ? expParam : expiries[0]?.date ?? "";
  const expIdx = expiries.findIndex((e) => e.date === expiry);
  const nextExpiry = expiries[expIdx + 1]?.date ?? "";
  const expInfo = expiries[expIdx];
  const isToday = expiry === dayKey;

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const next = new URLSearchParams(params);
      if (v) next.set(k, v);
      else next.delete(k);
      if (k === "symbol") next.delete("expiry");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const [forceSample, setForceSample] = useState(false);
  const s = useExpirySession(symbol, expiry, { forceSample });

  const recordTargets = useMemo(() => [{ symbol, expiry }, ...(nextExpiry ? [{ symbol, expiry: nextExpiry }] : [])].filter((t) => !!t.expiry), [symbol, expiry, nextExpiry]);
  const recorder = useSnapshotRecorder(recordTargets);

  const floating = useMemo(() => analyseStraddle(s.snaps, { expiry: s.expiry, r: s.r, q: s.q }), [s.snaps, s.expiry, s.r, s.q]);
  const priceAt = useMemo(() => (s.mode === "sample" && s.asOf ? new Date(s.asOf) : new Date(minuteKey * 60_000)), [s.mode, s.asOf, minuteKey]);
  const metrics = useMemo(() => expiryMetrics(s.chain, { spot: s.spot, expiry: s.expiry, now: priceAt, r: s.r }), [s.chain, s.spot, s.expiry, priceAt, s.r]);
  const walls = useMemo(() => oiWalls(s.chain, s.spot, 1), [s.chain, s.spot]);

  const exchange = getContractSpec(symbol)?.exchange ?? "NSE";
  const session = getMarketSession(minute, exchange);
  const lot = s.lotSize > 0 ? s.lotSize : NaN;
  const straddleNow = floating.last?.straddle ?? metrics.straddle;
  const em = expectedMoveFromStraddle(straddleNow, s.spot);
  const loading = s.isLoading;
  const isSample = s.mode === "sample";
  const weekly = expiry ? isWeeklyExpiry(symbol, expiry) : false;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-display">
            <Zap className="h-6 w-6 text-primary-ink" aria-hidden="true" />
            Expiry Day
          </h1>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            A 0DTE command centre for the NIFTY Tuesday and SENSEX Thursday weeklies: straddle decay against theory, theta per minute, hero-zero strikes, OI walls and the rules that change on expiry day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeBadge mode={s.mode} asOf={s.asOf} reason={s.reason} source={s.chainSource} />
          {recorder.recording ? (
            <span className="inline-flex items-center gap-1.5 rounded-capsule border border-border bg-card px-2.5 py-1 text-body-sm" title="Snapshots are saved in this browser every minute while the market is open">
              <CircleDot className="h-3.5 w-3.5 text-bearish motion-safe:animate-pulse" aria-hidden="true" /> Recording
            </span>
          ) : null}
          <div className="flex items-center gap-2 rounded-capsule border border-border bg-card px-3 py-1">
            <Switch id="expiry-sample" checked={forceSample || s.chainSource === "sample"} disabled={s.chainSource === "sample" && !forceSample} onCheckedChange={setForceSample} />
            <Label htmlFor="expiry-sample" className="inline-flex items-center gap-1 text-body-sm">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Sample session
            </Label>
          </div>
        </div>
      </header>

      <section aria-label="Contract" className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 shadow-card md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p id="expiry-symbol-label" className="mb-1 text-label uppercase text-muted-foreground">Index</p>
          <div className="-mx-1 overflow-x-auto px-1">
            <ToggleGroup type="single" value={symbol} onValueChange={(v) => v && setParam("symbol", v)} aria-labelledby="expiry-symbol-label" className="justify-start">
              {EXPIRY_SYMBOLS.map((sym) => {
                const first = getExpiries(sym, minute, 1)[0];
                const today = first?.date === dayKey;
                return (
                  <ToggleGroupItem key={sym} value={sym} size="sm" className="gap-1.5 whitespace-nowrap" aria-label={`${sym}${today ? ", expires today" : ""}`}>
                    {sym}
                    {today ? <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" /> : null}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="expiry-select" className="text-label uppercase text-muted-foreground">Expiry</Label>
          <Select value={expiry} onValueChange={(v) => setParam("expiry", v === expiries[0]?.date ? null : v)}>
            <SelectTrigger id="expiry-select" className="h-9 w-full md:w-[240px]">
              <SelectValue placeholder="No expiry" />
            </SelectTrigger>
            <SelectContent>
              {expiries.map((e) => (
                <SelectItem key={e.date} value={e.date}>
                  {formatDateIST(e.date)} · {isWeeklyExpiry(symbol, e.date) ? "weekly" : "monthly"} · {e.dte === 0 ? "today" : `${e.dte}d`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <ExpiryCountdown symbol={symbol} expiry={expiry} type={weekly ? "weekly" : expInfo?.type} />

      {isSample ? (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {s.chainSource === "sample" && !forceSample
              ? `Live data is unavailable (${s.reason ?? "no source answered"}), so this page shows a simulated ${symbol} session.`
              : "Sample session on: the straddle, decay and flow below come from a simulated trading day."}{" "}
            It is not market data.
          </p>
        </div>
      ) : null}

      {s.mode === "empty" && !loading ? (
        <div className="flex flex-col gap-2 rounded-tile border border-border bg-surface px-3 py-3 text-body-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {session === "open"
              ? "Collecting snapshots. The straddle chart starts after the next two polls (about 15 to 30 seconds)."
              : `No snapshots were recorded in this browser for the ${formatDateIST(s.window.date)} session. Levels below use the ${s.chainStale ? "last saved" : "latest"} chain; the intraday charts fill while this page is open in market hours.`}
          </p>
          <Button size="sm" variant="outline" onClick={() => setForceSample(true)} className="shrink-0">
            <FlaskConical aria-hidden="true" /> Show a sample session
          </Button>
        </div>
      ) : null}

      {s.isError ? (
        <div role="alert" className="rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
          Could not load the {symbol} option chain. Retrying in the background.
        </div>
      ) : null}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Spot" value={Number.isFinite(s.spot) ? formatNumberIN(s.spot, isSample ? 0 : 2) : "—"} hint={isSample ? "Sample" : s.chainSource !== "none" ? s.chainSource.toUpperCase() : undefined} />
        <Stat
          label="ATM straddle"
          value={Number.isFinite(straddleNow) ? formatINR(straddleNow) : "—"}
          hint={Number.isFinite(straddleNow) && lot > 0 ? `${formatINR(straddleNow * lot, { decimals: 0 })} per lot` : undefined}
        />
        <Stat
          label="Decayed today"
          value={Number.isFinite(floating.decayPct) ? formatPct(floating.decayPct * 100, { decimals: 1 }) : "—"}
          tone={floating.decayPct > 0 ? "text-bullish" : floating.decayPct < 0 ? "text-bearish" : ""}
          hint={floating.open ? `From ${formatINR(floating.open.straddle)} at open` : "Needs session history"}
        />
        <Stat
          label="Theta / min"
          value={Number.isFinite(floating.thetaPerMin) && lot > 0 ? formatINR(floating.thetaPerMin * lot, { decimals: 1 }) : "—"}
          tone="text-bearish"
          hint="ATM straddle, per lot"
          help="Black-76 theta of the ATM straddle per trading day ÷ 375 session minutes, times the lot size. A straddle buyer loses this each minute if nothing else changes; a seller earns it."
        />
        <Stat
          label="Expected move"
          value={Number.isFinite(em.move) ? `±${formatNumberIN(em.move)}` : "—"}
          hint={Number.isFinite(em.pct) ? `${formatPct(em.pct, { decimals: 2 })} · ${formatNumberIN(em.lower)}–${formatNumberIN(em.upper)}` : undefined}
          help="0.85 × the ATM straddle: the typical move the straddle prices in by expiry."
        />
        <Stat
          label="Max pain"
          value={Number.isFinite(walls.maxPain) ? formatStrike(walls.maxPain) : "—"}
          hint={Number.isFinite(metrics.atmIv) ? `ATM IV ${formatPct(metrics.atmIv, { decimals: 1 })}` : undefined}
        />
      </section>

      <StraddleChart
        snaps={s.snaps}
        expiry={s.expiry}
        r={s.r}
        q={s.q}
        lotSize={s.lotSize}
        mode={s.mode}
        asOf={s.asOf}
        reason={s.reason}
        source={s.chainSource}
        loading={loading}
        floating={floating}
        window={s.window}
        onShowSample={() => setForceSample(true)}
      />

      <Tabs value={tab} onValueChange={(t) => setParam("tab", t === "decay" ? null : t)}>
        <div className="-mx-1.5 overflow-x-auto px-1.5 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="decay" className="mt-3">
          <StraddleDecayVsTheory snaps={s.snaps} expiry={s.expiry} r={s.r} q={s.q} mode={s.mode} loading={loading} />
        </TabsContent>
        <TabsContent value="multi" className="mt-3">
          <MultiStraddleChart symbol={symbol} nearExpiry={s.expiry} nextExpiry={nextExpiry} nearSnaps={s.snaps} nearMode={s.mode} step={s.strikeStep} lotSize={s.lotSize} />
        </TabsContent>
        <TabsContent value="hero" className="mt-3">
          <HeroZeroTable chain={s.chain} spot={s.spot} expiry={s.expiry} r={s.r} q={s.q} lotSize={s.lotSize} snaps={s.snaps} mode={s.mode} at={priceAt} loading={loading} />
        </TabsContent>
        <TabsContent value="oi" className="mt-3">
          <ExpiryOIWalls chain={s.chain} spot={s.spot} snaps={s.snaps} mode={s.mode} lotSize={s.lotSize} expiry={s.expiry} loading={loading} />
        </TabsContent>
        <TabsContent value="compare" className="mt-3">
          <WeeklyCompare session={session} />
        </TabsContent>
        <TabsContent value="rules" className="mt-3">
          <ExpiryRulesCard symbol={symbol} spot={s.spot} lotSize={s.lotSize} step={s.strikeStep} expiry={s.expiry} sample={isSample || s.chainSource === "sample"} />
        </TabsContent>
      </Tabs>

      {!isToday && expiry ? (
        <p className="text-body-sm text-muted-foreground">
          {symbol} does not expire today. The page tracks the {formatDateIST(expiry)} contract; switch to the index marked with a dot for today&apos;s expiry.
        </p>
      ) : null}

      <footer className="border-t border-border pt-3 text-body-sm text-muted-foreground">
        <p>Data for education and research. Not investment advice.</p>
        <p className="mt-1">
          Straddle history comes from option-chain snapshots kept in this browser. Model values use Black-76 with the risk-free rate from market settings. Lot sizes and charge rates should be verified against the latest exchange circulars.
        </p>
      </footer>
    </div>
  );
}
