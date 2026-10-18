/**
 * Expiry Day (0DTE) command centre: countdown to 15:30 IST, the live ATM straddle and its decay
 * against a constant-IV model, multi-straddle charts, hero-zero strikes, OI walls and max-pain
 * drift, NIFTY vs SENSEX, and the expiry-day rules.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChartSpline, CircleDot, FlaskConical, Info, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { ExpiryCountdown } from "@/components/expiry/ExpiryCountdown";
import { ExpiryOIWalls } from "@/components/expiry/ExpiryOIWalls";
import { ExpiryRulesCard } from "@/components/expiry/ExpiryRulesCard";
import { HeroZeroTable } from "@/components/expiry/HeroZeroTable";
import { MultiStraddleChart } from "@/components/expiry/MultiStraddleChart";
import { StraddleChart } from "@/components/expiry/StraddleChart";
import { StraddleDecayVsTheory } from "@/components/expiry/StraddleDecayVsTheory";
import { WeeklyCompare } from "@/components/expiry/WeeklyCompare";
import { ModeBadge, Stat } from "@/components/expiry/ExpiryUi";
import { EXPIRY_SYMBOLS, analyseStraddle, expiryMetrics, hhmmIST, isExpirySymbol, oiWalls, openingATM, pickExpirySymbol, signTone, type ExpirySymbol } from "@/components/expiry/expiryMath";
import { useExpirySession, useNow } from "@/components/expiry/useExpirySession";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSnapshotRecorder } from "@/hooks/useSnapshotRecorder";
import {
  EM_METHOD_LABEL,
  expectedMoves,
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
  timeToExpiryYears,
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

  const [strikeMode, setStrikeMode] = useState<"floating" | "fixed">("floating");
  const [perLot, setPerLot] = useState(false);

  const floating = useMemo(() => analyseStraddle(s.snaps, { expiry: s.expiry, r: s.r, q: s.q }), [s.snaps, s.expiry, s.r, s.q]);
  const fixedStrike = useMemo(() => openingATM(s.snaps), [s.snaps]);
  const fixed = useMemo(
    () => (strikeMode === "fixed" && Number.isFinite(fixedStrike) ? analyseStraddle(s.snaps, { expiry: s.expiry, r: s.r, q: s.q, mode: { kind: "fixed", strike: fixedStrike } }) : null),
    [strikeMode, fixedStrike, s.snaps, s.expiry, s.r, s.q],
  );
  const a = strikeMode === "fixed" && fixed ? fixed : floating;
  const priceAt = useMemo(() => (s.mode === "sample" && s.asOf ? new Date(s.asOf) : new Date(minuteKey * 60_000)), [s.mode, s.asOf, minuteKey]);
  const metrics = useMemo(() => expiryMetrics(s.chain, { spot: s.spot, expiry: s.expiry, now: priceAt, r: s.r }), [s.chain, s.spot, s.expiry, priceAt, s.r]);
  const walls = useMemo(() => oiWalls(s.chain, s.spot, 1), [s.chain, s.spot]);

  const exchange = getContractSpec(symbol)?.exchange ?? "NSE";
  const session = getMarketSession(minute, exchange);
  const lot = s.lotSize > 0 ? s.lotSize : NaN;
  const mult = perLot && lot > 0 ? lot : 1;
  const unit = perLot && lot > 0 ? `per lot (${lot})` : "per unit";
  const dec = perLot && lot > 0 ? 0 : 2;
  const last = a.last;
  const straddleNow = last?.straddle ?? metrics.straddle;
  // The expected move always uses the floating ATM straddle, whichever strike the chart follows.
  const atmStraddleNow = floating.last?.straddle ?? metrics.straddle;
  const em = useMemo(
    () => expectedMoves({ spot: s.spot, atmIv: metrics.atmIv / 100, tYears: s.expiry ? timeToExpiryYears(s.expiry, priceAt) : NaN, straddle: atmStraddleNow }),
    [s.spot, metrics.atmIv, s.expiry, priceAt, atmStraddleNow],
  );
  const emBand = em.straddle ?? (Number.isFinite(em.iv.move) ? em.iv : null);
  const emMethod = em.straddle ? "straddle" : "iv";
  const vwapNow = a.vwap[a.vwap.length - 1];
  const vsVwap = last && Number.isFinite(vwapNow) ? last.straddle - vwapNow : NaN;
  const loading = s.isLoading;
  const isSample = s.mode === "sample";
  const weekly = expiry ? isWeeklyExpiry(symbol, expiry) : false;
  const fixedLabel = Number.isFinite(fixedStrike) ? `${formatStrike(fixedStrike)} straddle (fixed at open)` : "Fixed-strike straddle";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      <PageHeader
        icon={Zap}
        title="Expiry Day"
        description="A 0DTE command centre for the NIFTY Tuesday and SENSEX Thursday weeklies: straddle decay against theory, theta per minute, hero-zero strikes, OI walls and the rules that change on expiry day."
        source={
          <>
            <ModeBadge mode={s.mode} asOf={s.asOf} reason={s.reason} source={s.chainSource} />
            {recorder.recording ? (
              <span className="inline-flex h-5 items-center gap-1.5 rounded-capsule bg-control-track px-2 text-body-sm" title="Snapshots are saved in this browser every minute while the market is open">
                <CircleDot className="h-3.5 w-3.5 text-bearish motion-safe:animate-pulse" aria-hidden="true" /> Recording
              </span>
            ) : null}
          </>
        }
        actions={
          <div className="flex h-7 items-center gap-2">
            <Switch id="expiry-sample" checked={forceSample || s.chainSource === "sample"} disabled={s.chainSource === "sample" && !forceSample} onCheckedChange={setForceSample} />
            <Label htmlFor="expiry-sample" className="inline-flex items-center gap-1 text-body-sm">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Sample session
            </Label>
          </div>
        }
      />

      <section aria-label="Contract" className="flex flex-col gap-3 rounded-tile border border-separator bg-card px-3 py-2.5 shadow-card md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p id="expiry-symbol-label" className="mb-1 text-label text-muted-foreground">Index</p>
          <div className="-mx-1 overflow-x-auto px-1">
            <ToggleGroup type="single" value={symbol} onValueChange={(v) => v && setParam("symbol", v)} aria-labelledby="expiry-symbol-label" className="justify-start">
              {EXPIRY_SYMBOLS.map((sym) => {
                const first = getExpiries(sym, minute, 1)[0];
                const today = first?.date === dayKey;
                return (
                  <ToggleGroupItem key={sym} value={sym} size="sm" className="gap-1.5 whitespace-nowrap" aria-label={`${sym}${today ? ", expires today" : ""}`}>
                    {sym}
                    {today ? <span className="h-1.5 w-1.5 rounded-capsule bg-warning" aria-hidden="true" /> : null}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="expiry-select" className="text-label text-muted-foreground">Expiry</Label>
          <Select value={expiry} onValueChange={(v) => setParam("expiry", v === expiries[0]?.date ? null : v)}>
            <SelectTrigger id="expiry-select" className="w-full md:w-[240px]">
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
        <div role="alert" className="flex items-start gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning">
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
        <div className="flex flex-col gap-2 rounded-tile bg-control-track px-3 py-3 text-body-sm sm:flex-row sm:items-center sm:justify-between">
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
        <div role="alert" className="rounded-tile bg-wash-loss px-3 py-2 text-body-sm text-bearish">
          Could not load the {symbol} option chain. Retrying in the background.
        </div>
      ) : null}

      <section aria-label="Key numbers" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup type="single" size="sm" value={strikeMode} onValueChange={(v) => v && setStrikeMode(v as "floating" | "fixed")} aria-label="Straddle strike" className="justify-start">
            <ToggleGroupItem value="floating" aria-label="Floating ATM strike">Floating ATM</ToggleGroupItem>
            <ToggleGroupItem value="fixed" aria-label="Fixed at the opening ATM strike" disabled={!Number.isFinite(fixedStrike)}>Fixed K₀</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" size="sm" value={perLot ? "lot" : "unit"} onValueChange={(v) => v && setPerLot(v === "lot")} aria-label="Premium units">
            <ToggleGroupItem value="unit">₹/unit</ToggleGroupItem>
            <ToggleGroupItem value="lot" disabled={!(lot > 0)}>₹/lot</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
          <Stat label="Spot" value={Number.isFinite(s.spot) ? formatNumberIN(s.spot, 2) : "—"} hint={isSample ? "Sample" : s.chainSource !== "none" ? s.chainSource.toUpperCase() : undefined} />
          <Stat
            label="Straddle now"
            value={Number.isFinite(straddleNow) ? formatINR(straddleNow * mult, { decimals: dec }) : "—"}
            hint={last ? `${formatStrike(last.strike)} · ${hhmmIST(last.ts)} IST` : Number.isFinite(metrics.strike) ? `${formatStrike(metrics.strike)} · from the chain` : unit}
          />
          <Stat
            label="Decayed today"
            value={Number.isFinite(a.decayPct) ? formatPct(a.decayPct * 100, { decimals: 1 }) : "—"}
            tone={a.decayPct > 0 ? "text-bullish" : a.decayPct < 0 ? "text-bearish" : ""}
            hint={a.open ? `From ${formatINR(a.open.straddle * mult, { decimals: dec })} at ${hhmmIST(a.open.ts)}` : "Needs session history"}
            help="Share of the opening straddle premium lost so far. Positive is good for straddle sellers. Compare it with the constant-IV model in the Decay vs theory tab."
          />
          <Stat
            label="Theta / min"
            value={Number.isFinite(a.thetaPerMin) ? formatINR(a.thetaPerMin * mult, { decimals: perLot ? 1 : 3 }) : "—"}
            tone="text-bearish"
            hint={unit}
            help="Black-76 theta of the straddle (CE + PE) per trading day ÷ the 375-minute session, at the current straddle IV. A straddle buyer loses this each minute if nothing else changes; a seller earns it."
          />
          <Stat
            label={a.vwapBasis === "volume" ? "VWAP" : "TWAP"}
            value={Number.isFinite(vwapNow) ? formatINR(vwapNow * mult, { decimals: dec }) : "—"}
            tone={signTone(-vsVwap)}
            hint={Number.isFinite(vsVwap) ? `Straddle ${vsVwap < 0 ? "below" : "above"} by ${formatINR(Math.abs(vsVwap) * mult, { decimals: dec })}` : "Needs session history"}
            help={a.vwapBasis === "volume" ? "Volume-weighted average straddle price, weighted by the increase in CE + PE volume at the strike between snapshots. Straddle below VWAP is the usual short-straddle signal." : "No volume increments were available, so this is a time-weighted average."}
          />
          <Stat
            label="Next 15 min"
            value={Number.isFinite(a.decayNext15) ? formatINR(-a.decayNext15 * mult, { decimals: dec }) : "—"}
            tone="text-bearish"
            hint="Model decay, spot and IV unchanged"
          />
          <Stat
            label="Expected move"
            value={emBand ? `±${formatNumberIN(emBand.move)}` : "—"}
            tag={emBand ? <Badge variant="neutral" title={emMethod === "straddle" ? "0.85 × the ATM straddle: roughly a 50% band to expiry" : "One standard deviation from ATM IV to expiry"}>{EM_METHOD_LABEL[emMethod]}</Badge> : undefined}
            hint={emBand ? `${formatNumberIN(emBand.lower)}–${formatNumberIN(emBand.upper)}${em.straddle && Number.isFinite(em.iv.move) ? ` · ${EM_METHOD_LABEL.iv} ±${formatNumberIN(em.iv.move)}` : ""}` : undefined}
            help="Straddle ×0.85 is the typical move the ATM straddle prices in by expiry (about half of outcomes land inside). IV 1σ is the one-standard-deviation band from ATM IV, about two-thirds of outcomes."
          />
          <Stat
            label="Max pain"
            value={Number.isFinite(walls.maxPain) ? formatStrike(walls.maxPain) : "—"}
            hint={Number.isFinite(metrics.atmIv) ? `ATM IV ${formatPct(metrics.atmIv, { decimals: 1 })}` : undefined}
          />
        </div>
      </section>

      <StraddleChart
        a={a}
        mult={mult}
        unit={unit}
        title={strikeMode === "fixed" ? fixedLabel : "ATM straddle"}
        subtitle={<>{strikeMode === "floating" ? "Nearest strike to spot at each snapshot" : "Strike fixed at the opening ATM, a tradeable position"} · mid prices where quotes are tight · {unit}</>}
        symbol={symbol}
        mode={s.mode}
        asOf={s.asOf}
        reason={s.reason}
        source={s.chainSource}
        loading={loading}
        window={s.window}
        onShowSample={isSample ? undefined : () => setForceSample(true)}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to={`/straddles?symbol=${encodeURIComponent(symbol)}${expiry ? `&expiry=${expiry}` : ""}${strikeMode === "fixed" && Number.isFinite(fixedStrike) ? `&mode=fixed&strike=${fixedStrike}` : ""}`}>
              <ChartSpline aria-hidden="true" /> Straddle charts
            </Link>
          </Button>
        }
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
          <HeroZeroTable symbol={symbol} chain={s.chain} spot={s.spot} expiry={s.expiry} r={s.r} q={s.q} lotSize={s.lotSize} snaps={s.snaps} mode={s.mode} at={priceAt} loading={loading} />
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

      <footer className="hairline-t pt-3 text-body-sm text-muted-foreground">
        <p>Data for education and research. Not investment advice.</p>
        <p className="mt-1">
          Straddle history comes from option-chain snapshots kept in this browser. Model values use Black-76 with the risk-free rate from market settings. Lot sizes and charge rates should be verified against the latest exchange circulars.
        </p>
      </footer>
    </div>
  );
}
