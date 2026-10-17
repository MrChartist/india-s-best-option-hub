/**
 * Straddles: any symbol, any expiry, any trading day. The rolling ATM straddle, a fixed strike or a
 * custom CE/PE pair through the session (premium with VWAP, the legs, premium against spot and a
 * multi-strike comparison), plus a multi-day view from NSE bhavcopy. Intraday history comes from
 * snapshots recorded in this browser, or a clearly labelled sample session.
 */
import { useCallback, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ChartSpline, CircleDot, FlaskConical, Info, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/PageHeader";
import { ALL_SYMBOLS, canonicalSymbol } from "@/components/option-chain/symbols";
import { analyseStraddle, hhmmIST, signTone } from "@/components/expiry/expiryMath";
import { ModeBadge, Stat } from "@/components/expiry/ExpiryUi";
import { StraddleChart } from "@/components/expiry/StraddleChart";
import { useExpirySession, useNow } from "@/components/expiry/useExpirySession";
import { DailyStraddleView } from "@/components/straddles/DailyStraddleView";
import { LegsChart } from "@/components/straddles/LegsChart";
import { MultiStrikeChart } from "@/components/straddles/MultiStrikeChart";
import { OpenInBuilder } from "@/components/straddles/OpenInBuilder";
import { PremiumVsSpotChart } from "@/components/straddles/PremiumVsSpotChart";
import { StraddleControls } from "@/components/straddles/StraddleControls";
import { useDailyStraddles } from "@/components/straddles/useDailyStraddles";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSnapshotRecorder } from "@/hooks/useSnapshotRecorder";
import { EM_METHOD_LABEL, findATMStrike, formatDateIST, formatINR, formatNumberIN, formatPct, formatStrike, getExpiries, getMarketSession, legMid } from "@/lib/options";
import { isStrangle, parseSelection, resolvePair, selectionLabel, selectionToParams, summarisePremium, toStrikeMode, type StrikeSelection } from "@/lib/straddles";

const VIEWS = ["intraday", "daily"] as const;
type View = (typeof VIEWS)[number];
const DAY_CHOICES = [10, 20, 40];

export default function Straddles() {
  useDocumentTitle("Straddles");
  const [params, setParams] = useSearchParams();
  const symParam = canonicalSymbol(params.get("symbol"));
  const symbol = ALL_SYMBOLS.some((s) => s.value === symParam) ? symParam : "NIFTY";
  const viewParam = params.get("view");
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "intraday";
  const daysParam = Number(params.get("days"));
  const days = DAY_CHOICES.includes(daysParam) ? daysParam : 20;
  const selection = useMemo(() => parseSelection((k) => params.get(k)), [params]);

  const minute = useNow(60_000);
  const minuteKey = Math.floor(minute.getTime() / 60_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh the expiry list each minute (it rolls at 15:30)
  const expiries = useMemo(() => getExpiries(symbol, new Date(), 6), [symbol, minuteKey]);
  const expParam = params.get("expiry") || "";
  const expiry = expiries.some((e) => e.date === expParam) ? expParam : expiries[0]?.date ?? "";

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const setSelection = useCallback((sel: StrikeSelection) => update(selectionToParams(sel)), [update]);

  const [forceSample, setForceSample] = useState(false);
  const [perLot, setPerLot] = useState(false);
  const s = useExpirySession(symbol, expiry, { forceSample });
  const recordTargets = useMemo(() => (expiry ? [{ symbol, expiry }] : []), [symbol, expiry]);
  const recorder = useSnapshotRecorder(recordTargets);

  const strikes = useMemo(() => s.chain.map((r) => r.strikePrice).filter((k) => k > 0), [s.chain]);
  const atm = useMemo(() => findATMStrike(s.chain, s.spot), [s.chain, s.spot]);
  const mode = useMemo(() => toStrikeMode(selection), [selection]);
  const a = useMemo(() => analyseStraddle(s.snaps, { expiry: s.expiry, r: s.r, q: s.q, mode }), [s.snaps, s.expiry, s.r, s.q, mode]);
  const summary = useMemo(() => summarisePremium(a.points, { values: a.vwap, basis: a.vwapBasis }), [a]);

  const lot = s.lotSize > 0 ? s.lotSize : NaN;
  const mult = perLot && lot > 0 ? lot : 1;
  const unit = perLot && lot > 0 ? `per lot (${lot})` : "per unit";
  const dec = perLot && lot > 0 ? 0 : 2;
  const isSample = s.mode === "sample";
  const strangle = isStrangle(selection);

  // Quotes for the builder hand-off from the latest chain, at the strikes the selection resolves to now.
  const pairNow = resolvePair(selection, atm);
  const quotes = useMemo(() => {
    const ceRow = s.chain.find((r) => r.strikePrice === pairNow.ce);
    const peRow = s.chain.find((r) => r.strikePrice === pairNow.pe);
    return {
      ce: { strike: pairNow.ce, premium: ceRow ? legMid(ceRow.ce) : NaN, ivPct: ceRow?.ce.iv },
      pe: { strike: pairNow.pe, premium: peRow ? legMid(peRow.pe) : NaN, ivPct: peRow?.pe.iv },
    };
  }, [s.chain, pairNow.ce, pairNow.pe]);

  const last = summary.last;
  const open = summary.open;
  const domain: [number, number] = [open ? Math.min(open.ts, s.window.start) : s.window.start, Math.max(s.window.end, last?.ts ?? 0)];
  const premiumNow = last?.straddle ?? (Number.isFinite(quotes.ce.premium) && Number.isFinite(quotes.pe.premium) ? quotes.ce.premium + quotes.pe.premium : NaN);
  const beLow = last ? last.peStrike - last.straddle : NaN;
  const beHigh = last ? last.strike + last.straddle : NaN;

  const daily = useDailyStraddles({ symbol, expiry, days, sampleChain: s.chainSource === "sample", spot: s.spot, enabled: view === "daily" });
  const session = getMarketSession(minute);

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <PageHeader
        icon={ChartSpline}
        eyebrow="Chain & OI"
        title="Straddles"
        description="Straddle and strangle charts for any F&O symbol and expiry: combined premium with VWAP, each leg, premium against spot, a multi-strike comparison and a multi-day view from NSE bhavcopy."
        source={
          <>
            <ModeBadge mode={s.mode} asOf={s.asOf} reason={s.reason} source={s.chainSource} />
            {recorder.recording ? (
              <span className="inline-flex items-center gap-1.5 rounded-capsule border border-border bg-card px-2.5 py-0.5 text-body-sm" title="Snapshots are saved in this browser every minute while the market is open">
                <CircleDot className="h-3.5 w-3.5 text-bearish motion-safe:animate-pulse" aria-hidden="true" /> Recording
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <div className="flex items-center gap-2 rounded-capsule border border-border bg-card px-3 py-1">
              <Switch id="straddles-sample" checked={forceSample || s.chainSource === "sample"} disabled={s.chainSource === "sample" && !forceSample} onCheckedChange={setForceSample} />
              <Label htmlFor="straddles-sample" className="inline-flex items-center gap-1 text-body-sm">
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> Sample session
              </Label>
            </div>
            <OpenInBuilder symbol={symbol} expiry={s.expiry || expiry} ce={quotes.ce} pe={quotes.pe} lotSize={s.lotSize} sample={isSample || s.chainSource === "sample"} />
          </>
        }
      />

      <StraddleControls
        symbol={symbol}
        onSymbol={(v) => update({ symbol: v === "NIFTY" ? null : v, expiry: null, mode: null, strike: null, ce: null, pe: null })}
        expiries={expiries.map((e) => ({ date: e.date, dte: e.dte, kind: e.type }))}
        expiry={expiry}
        onExpiry={(v) => update({ expiry: v === expiries[0]?.date ? null : v })}
        selection={selection}
        onSelection={setSelection}
        strikes={strikes}
        atm={atm}
      />

      {isSample ? (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            {s.chainSource === "sample" && !forceSample
              ? `Live data is unavailable (${s.reason ?? "no source answered"}), so this page shows a simulated ${symbol} session.`
              : "Sample session on: the intraday charts below come from a simulated trading day."}{" "}
            It ends on the sample option chain&apos;s prices and is not market data.
          </p>
        </div>
      ) : null}

      {s.mode === "empty" && !s.isLoading && view === "intraday" ? (
        <div className="flex flex-col gap-2 rounded-tile border border-border bg-surface px-3 py-3 text-body-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {session === "open"
              ? "Collecting snapshots. The intraday charts start after the next two polls (about 15 to 30 seconds)."
              : `No snapshots were recorded in this browser for the ${formatDateIST(s.window.date)} session. The daily view works from the exchange's end-of-day files.`}
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => update({ view: "daily" })}>
              Daily view
            </Button>
            <Button size="sm" variant="outline" onClick={() => setForceSample(true)}>
              <FlaskConical aria-hidden="true" /> Show a sample session
            </Button>
          </div>
        </div>
      ) : null}

      {s.isError ? (
        <div role="alert" className="rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
          Could not load the {symbol} option chain. Retrying in the background.
        </div>
      ) : null}

      <section aria-label="Key numbers" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-body-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{selectionLabel(selection)}</span>
            {last && selection.kind === "atm" ? ` · now ${formatStrike(last.strike)}` : ""}
            {s.expiry ? ` · ${formatDateIST(s.expiry)} expiry` : ""}
          </p>
          <ToggleGroup type="single" size="sm" value={perLot ? "lot" : "unit"} onValueChange={(v) => v && setPerLot(v === "lot")} aria-label="Premium units">
            <ToggleGroupItem value="unit">₹/unit</ToggleGroupItem>
            <ToggleGroupItem value="lot" disabled={!(lot > 0)}>₹/lot</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
          <Stat label="Spot" value={Number.isFinite(s.spot) ? formatNumberIN(s.spot, 2) : "—"} hint={isSample ? "Sample" : s.chainSource !== "none" ? s.chainSource.toUpperCase() : undefined} />
          <Stat
            label="Premium now"
            value={Number.isFinite(premiumNow) ? formatINR(premiumNow * mult, { decimals: dec }) : "—"}
            hint={last ? `${hhmmIST(last.ts)} IST` : Number.isFinite(premiumNow) ? "From the chain" : unit}
          />
          <Stat
            label="Since open"
            value={Number.isFinite(summary.change) ? formatINR(summary.change * mult, { decimals: dec }) : "—"}
            tone={signTone(-summary.change)}
            help="Change in the combined premium since the first snapshot, coloured from a seller's view: a falling premium shows green."
            hint={Number.isFinite(summary.changePct) ? `${formatPct(summary.changePct, { decimals: 1, signed: true })} from ${formatINR((open?.straddle ?? NaN) * mult, { decimals: dec })}` : "Needs session history"}
          />
          <Stat
            label={summary.vwapBasis === "volume" ? "Premium VWAP" : "Premium TWAP"}
            value={Number.isFinite(summary.vwap) ? formatINR(summary.vwap * mult, { decimals: dec }) : "—"}
            tone={signTone(-summary.vsVwap)}
            hint={Number.isFinite(summary.vsVwap) ? `Premium ${summary.vsVwap < 0 ? "below" : "above"} by ${formatINR(Math.abs(summary.vsVwap) * mult, { decimals: dec })}` : "Needs session history"}
            help="Running average of the combined premium, weighted by the rise in CE + PE volume between snapshots. Premium under VWAP is the usual short-straddle signal; above it, buyers are in control."
          />
          <Stat
            className="col-span-2 sm:col-span-1"
            label="Day range"
            value={Number.isFinite(summary.low) ? `${formatNumberIN(summary.low * mult, dec)}–${formatNumberIN(summary.high * mult, dec)}` : "—"}
            hint={summary.strikeChanges > 0 ? `ATM rolled ${summary.strikeChanges}×` : unit}
          />
          <Stat
            className="col-span-2 sm:col-span-1"
            label="Breakevens"
            value={Number.isFinite(beLow) ? `${formatNumberIN(beLow)}–${formatNumberIN(beHigh)}` : "—"}
            hint="At expiry, for today's premium"
            help="Spot levels at expiry where the pair is worth what it costs now: PE strike minus premium and CE strike plus premium. A short pair profits between them; a long pair outside them."
          />
          {strangle ? (
            <Stat
              label="CE share"
              value={Number.isFinite(summary.ceShare) ? formatPct(summary.ceShare * 100, { decimals: 0 }) : "—"}
              hint="Of the combined premium"
              help="How much of the strangle's premium sits in the call. Above 50%, spot has drifted towards the call strike."
            />
          ) : (
            <Stat
              label="Implied move"
              value={Number.isFinite(summary.impliedMove) ? `±${formatNumberIN(summary.impliedMove)}` : "—"}
              tag={Number.isFinite(summary.impliedMove) ? <Badge variant="neutral" title="0.85 × the straddle: roughly a 50% band to expiry">{EM_METHOD_LABEL.straddle}</Badge> : undefined}
              hint={Number.isFinite(summary.impliedMovePct) ? `${formatPct(summary.impliedMovePct, { decimals: 2 })} of spot` : undefined}
              help="0.85 × the straddle premium is the typical move it prices in by expiry: about half of outcomes land inside it."
            />
          )}
          <Stat
            label="Straddle IV"
            value={Number.isFinite(a.sigmaNowCalendar) ? formatPct(a.sigmaNowCalendar * 100, { decimals: 1 }) : "—"}
            hint={strangle ? "Same-strike straddles only" : Number.isFinite(a.sigmaOpenCalendar) ? `Open ${formatPct(a.sigmaOpenCalendar * 100, { decimals: 1 })}` : undefined}
            help="Black-76 implied volatility of the CE + PE pair at one strike, in the calendar convention used across the app."
          />
        </div>
      </section>

      <Tabs value={view} onValueChange={(v) => update({ view: v === "intraday" ? null : v })}>
        <TabsList>
          <TabsTrigger value="intraday">Intraday</TabsTrigger>
          <TabsTrigger value="daily">Daily · bhavcopy</TabsTrigger>
        </TabsList>
        <TabsContent value="intraday" className="mt-3 space-y-4">
          <StraddleChart
            a={a}
            mult={mult}
            unit={unit}
            title={selection.kind === "atm" ? "ATM straddle (rolling)" : selectionLabel(selection)}
            subtitle={<>{selection.kind === "atm" ? "Nearest strike to spot at each snapshot" : "Strikes held through the session"} · combined CE + PE · mid prices where quotes are tight · {unit}</>}
            symbol={symbol}
            mode={s.mode}
            asOf={s.asOf}
            reason={s.reason}
            source={s.chainSource}
            loading={s.isLoading}
            window={s.window}
            onShowSample={isSample ? undefined : () => setForceSample(true)}
            emptyHint={
              selection.kind === "atm"
                ? undefined
                : isSample
                  ? "The sample session lists 20 strikes either side of ATM, and at least one of these strikes is outside that range. Pick strikes from the lists above or switch to the rolling ATM."
                  : "No recorded snapshot has prices for both legs at these strikes yet. Keep this page open in market hours, pick strikes nearer spot, or switch to the rolling ATM."
            }
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <LegsChart points={a.points} mult={mult} unit={unit} mode={s.mode} domain={domain} />
            <PremiumVsSpotChart points={a.points} mult={mult} unit={unit} mode={s.mode} />
          </div>
          <MultiStrikeChart snaps={s.snaps} mult={mult} unit={unit} mode={s.mode} domain={domain} highlight={selection.kind === "fixed" ? selection.strike : undefined} />
        </TabsContent>
        <TabsContent value="daily" className="mt-3">
          <DailyStraddleView
            data={daily.data}
            loading={daily.isLoading || (view === "daily" && !daily.data && daily.fetchStatus === "fetching")}
            error={daily.isError}
            selection={selection}
            mult={mult}
            unit={unit}
            days={days}
            onDaysChange={(d) => update({ days: d === 20 ? null : String(d) })}
            symbol={symbol}
          />
        </TabsContent>
      </Tabs>

      <footer className="border-t border-border pt-3 text-body-sm text-muted-foreground">
        <p>Data for education and research. Not investment advice.</p>
        <p className="mt-1">
          Intraday history comes from option-chain snapshots kept in this browser while a chain page is open. Daily closes come from NSE&apos;s F&amp;O bhavcopy through the local proxy. On expiry day, the{" "}
          <Link to={`/expiry-day?symbol=${encodeURIComponent(symbol)}`} className="inline-flex items-center gap-1 text-primary-ink underline-offset-2 hover:underline">
            <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Expiry Day
          </Link>{" "}
          page adds theta per minute, hero-zero strikes and OI walls.
        </p>
      </footer>
    </div>
  );
}
