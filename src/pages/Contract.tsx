import { useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, BarChart3, Download, Gauge, LineChart as LineChartIcon, Loader2, RefreshCw, ScanSearch, Sigma, Waves } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuildupBadge, type BuildupKind } from "@/components/ui/buildup-badge";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { isKnownFnoSymbol } from "@/components/option-chain/symbols";
import { ContractActions, ContractSwitcher, DepthPanel, FactsPanel } from "@/components/contract/ContractPanels";
import { EmptyState, Panel, PanelSkeleton, ProvenanceBadge, STAT_GROUP, Stat, type Provenance } from "@/components/contract/ContractUi";
import { DailyHistory } from "@/components/contract/DailyHistory";
import { GreeksCharts, IvChart, OiChart, PriceChart, VolumeChart } from "@/components/contract/IntradayCharts";
import { useContractData, type IntradayMode } from "@/components/contract/useContractData";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { classifyBuildup, dteLabel, formatCompactIN, formatDateIST, formatGreek, formatINR, formatNumberIN, formatPct, formatSigned, formatStrike, getExpiries, isValidIsoDate, type Buildup } from "@/lib/options";
import { checkContractExpiry } from "@/lib/history/contractExpiry";
import { hhmmIST as hhmm, moneyness, parseContractParams, type ContractKey } from "@/lib/history/contractSeries";
import { snapshotsToCSV, type ChainSnapshot } from "@/lib/snapshotStore";
import type { OptionLegDataExt } from "@/lib/types/market";
import { cn } from "@/lib/utils";

const BUILDUP_CODE: Partial<Record<Buildup, BuildupKind>> = {
  LONG_BUILDUP: "LB",
  SHORT_BUILDUP: "SB",
  SHORT_COVERING: "SC",
  LONG_UNWINDING: "LU",
};

const MODE_TO_PROVENANCE: Record<IntradayMode, Provenance> = { live: "live", recorded: "recorded", sample: "sample", empty: "empty" };

/** Inline notice: tinted fill, no stroke (macOS info banners). */
const BANNER = "flex items-start gap-2 rounded-tile px-3 py-2 text-body-sm";

const tone = (v: number) => (!Number.isFinite(v) || v === 0 ? "" : v > 0 ? "text-bullish" : "text-bearish");

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Contract detail: one option (symbol, expiry, strike, CE/PE) with its live quote, intraday LTP vs
 * spot, OI and OI change, IV, Greeks over time, volume, depth and NSE bhavcopy daily history.
 * Route: /contract/:symbol/:expiry/:strike/:type
 */
export default function Contract() {
  const { symbol, expiry, strike, type } = useParams();
  const [search] = useSearchParams();
  // Memoised on the primitive route params: a fresh key object every render would defeat the
  // series memo in useContractData (re-extracting and re-enriching on every clock tick and poll).
  const parsed = useMemo(() => parseContractParams({ symbol, expiry, strike, type }), [symbol, expiry, strike, type]);
  if ("error" in parsed) return <InvalidContract message={parsed.error} />;
  const k = parsed.key;
  // Never build a sample contract page for a symbol that has no F&O contracts.
  if (!isKnownFnoSymbol(k.symbol)) return <InvalidContract message={`${k.symbol} is not an F&O underlying.`} />;
  const check = checkContractExpiry(k.symbol, k.expiry);
  if (check.kind === "shifted") {
    return <Navigate replace to={`${contractPath({ ...k, expiry: check.to })}?from=${encodeURIComponent(k.expiry)}`} />;
  }
  if (check.kind === "expired") return <ExpiredContract k={k} />;
  if (check.kind === "unlisted") {
    return <InvalidContract message={`${formatDateIST(k.expiry)} is not a listed ${k.symbol} expiry.`} symbol={k.symbol} />;
  }
  const from = search.get("from");
  return <ContractView k={k} shiftedFrom={from && isValidIsoDate(from) && from !== k.expiry ? from : undefined} />;
}

/** "NIFTY · 20 Oct 2026 · 25,000 CE": separators keep the parts from running together in the display face. */
function contractTitle(k: ContractKey): string {
  return `${k.symbol} · ${formatDateIST(k.expiry)} · ${formatStrike(k.strike)} ${k.type}`;
}

function contractPath(k: ContractKey): string {
  return `/contract/${encodeURIComponent(k.symbol)}/${k.expiry}/${k.strike}/${k.type}`;
}

/** Upcoming listed expiries for a symbol, as quick links. */
function ExpiryLinks({ symbol, strike, type }: { symbol: string; strike?: number; type?: "CE" | "PE" }) {
  const next = getExpiries(symbol, new Date(), 3);
  if (next.length === 0 || !strike || !type) return null;
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {next.map((e) => (
        <Button key={e.date} asChild size="sm" variant="ghost">
          <Link to={contractPath({ symbol, expiry: e.date, strike, type })}>
            {formatDateIST(e.date)} · {formatStrike(strike)} {type}
          </Link>
        </Button>
      ))}
    </div>
  );
}

/** A settled contract: no live LTP, OI build-up or Greeks, only links onward. */
function ExpiredContract({ k }: { k: ContractKey }) {
  const title = contractTitle(k);
  useDocumentTitle(`${title} (expired)`);
  return (
    <div className="space-y-3">
      <PageHeader
        icon={ScanSearch}
        title={title}
        description="This contract has expired. Live quotes, open-interest build-up and Greeks only apply to listed contracts."
        source={<Badge variant="neutral">Expired</Badge>}
      />
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" aria-hidden="true" />}
        title={`Settled at 15:30 IST on ${formatDateIST(k.expiry)}`}
        action={
          <div className="flex flex-col items-center gap-2">
            <Button asChild variant="outline">
              <Link to={`/option-chain?symbol=${encodeURIComponent(k.symbol)}`}>Open the {k.symbol} option chain</Link>
            </Button>
            <ExpiryLinks symbol={k.symbol} strike={k.strike} type={k.type} />
          </div>
        }
      >
        Settlement prices for past expiries are in the NSE F&amp;O bhavcopy. The same strike on a listed expiry is linked below.
      </EmptyState>
    </div>
  );
}

function InvalidContract({ message, symbol }: { message: string; symbol?: string }) {
  useDocumentTitle("Contract not found");
  return (
    <div className="space-y-3">
      <PageHeader icon={ScanSearch} title="Contract not found" description="Contract links look like /contract/NIFTY/2026-10-20/25000/CE: symbol, expiry date, strike and CE or PE." />
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" aria-hidden="true" />}
        title={message}
        action={
          <Button asChild variant="outline">
            <Link to={symbol ? `/option-chain?symbol=${encodeURIComponent(symbol)}` : "/option-chain"}>Pick a contract from the option chain</Link>
          </Button>
        }
      >
        {symbol ? (
          <>
            Listed {symbol} expiries: {getExpiries(symbol, new Date(), 4).map((e) => formatDateIST(e.date)).join(", ") || "none found"}.
          </>
        ) : null}
      </EmptyState>
    </div>
  );
}

function ContractView({ k, shiftedFrom }: { k: ContractKey; shiftedFrom?: string }) {
  const label = contractTitle(k);
  useDocumentTitle(label);
  const [dailyDays, setDailyDays] = useState(10);
  const d = useContractData(k, { dailyDays });
  const leg = d.leg as OptionLegDataExt | undefined;
  const last = d.series[d.series.length - 1];
  const s = d.summary;

  const change = leg?.change ?? (leg?.prevClose ? leg.ltp - leg.prevClose : NaN);
  const pChange = leg?.pChange ?? (leg?.prevClose ? ((leg.ltp - leg.prevClose) / leg.prevClose) * 100 : NaN);
  const m = moneyness(k, d.spot, leg?.ltp ?? NaN, d.atmBand);
  const buildup = leg ? BUILDUP_CODE[classifyBuildup(Number.isFinite(change) ? change : s.ltpChange, leg.oiChange)] : undefined;
  const iv = leg && leg.iv > 0 ? leg.iv : last && last.sigma > 0 ? last.sigma * 100 : NaN;
  const loadingQuote = d.live.isLoading && !d.data;

  const contractSnaps = useMemo<ChainSnapshot[]>(
    () => (d.intraday.data?.snaps ?? []).map((snap) => ({ ...snap, rows: snap.rows.filter((r) => r.strike === k.strike && r.side === k.type) })).filter((snap) => snap.rows.length > 0),
    [d.intraday.data, k.strike, k.type],
  );

  const provenance = MODE_TO_PROVENANCE[d.intradayMode];
  const sessionDate = d.intraday.data?.date;
  const intradayTitle = (icon: ReactNode, text: string, badge = true) => (
    <>
      {icon}
      {text}
      {badge ? <ProvenanceBadge kind={provenance} asOf={last?.ts} /> : null}
    </>
  );

  return (
    <div className="space-y-3">
      <PageHeader
        icon={ScanSearch}
        title={label}
        description="Price, open interest, IV and Greeks for one option through the session, with top-of-book depth and NSE end-of-day history."
        source={
          <>
            {d.data ? <SourceBadge source={d.data.source} asOf={d.data.asOf} stale={d.data.stale} isLive={d.data.isLive} reason={d.data.reason} /> : null}
            <Badge variant="neutral">{dteLabel(k.expiry)}</Badge>
            {d.lotSize > 0 ? <Badge variant="outline">Lot {formatNumberIN(d.lotSize)}</Badge> : null}
            <Badge variant={m.state === "ITM" ? "bullish" : m.state === "ATM" ? "info" : "neutral"}>{m.state}</Badge>
            {buildup ? <BuildupBadge kind={buildup} /> : null}
          </>
        }
        actions={<ContractActions k={k} leg={leg} />}
      />

      <ContractSwitcher k={k} strikes={d.strikes} expiries={d.data?.expiries ?? []} spot={d.spot} />

      {shiftedFrom ? (
        <div role="status" className={cn(BANNER, "bg-wash-info")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <span>
            {formatDateIST(shiftedFrom)} is an NSE holiday, so this contract expires on {formatDateIST(k.expiry)} instead. The link was updated.
          </span>
        </div>
      ) : null}

      {d.live.isError && !d.data ? (
        <div role="alert" className={cn(BANNER, "flex-wrap items-center bg-wash-loss")}>
          <AlertTriangle className="h-4 w-4 text-bearish" aria-hidden="true" />
          Could not load the option chain for {k.symbol}.
          <Button variant="outline" className="ml-auto" onClick={() => void d.live.refetch()}>
            <RefreshCw aria-hidden="true" /> Retry
          </Button>
        </div>
      ) : null}
      {d.data && !d.expiryMatches ? (
        <div role="status" className={cn(BANNER, "bg-wash-warning")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            The {formatDateIST(k.expiry)} expiry is not in the live chain (the feed returned {d.data.expiry ? formatDateIST(d.data.expiry) : "another expiry"}). It may have expired. Recorded history below still applies.
          </span>
        </div>
      ) : d.data && !leg ? (
        <div role="status" className={cn(BANNER, "bg-wash-warning")}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>Strike {formatNumberIN(k.strike, 2)} is not listed in the current chain. Pick a listed strike above.</span>
        </div>
      ) : null}

      <section aria-label="Contract summary" className={cn(STAT_GROUP, "grid-cols-2 sm:grid-cols-4 2xl:grid-cols-8")}>
        <Stat
          label="LTP"
          value={loadingQuote ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /> : formatINR(leg?.ltp ?? NaN)}
          tone={tone(change)}
          hint={Number.isFinite(change) ? <span className={tone(change)}>{`${formatSigned(change)} (${formatPct(pChange, { signed: true })})`}</span> : "vs previous close"}
        />
        <Stat
          label="Spot"
          value={d.spot > 0 ? formatNumberIN(d.spot, 2) : "—"}
          hint={d.spot > 0 ? `${formatSigned(d.spot - k.strike, 0)} from strike` : undefined}
          help="Underlying index or stock price from the same chain feed."
        />
        <Stat
          label="IV"
          value={Number.isFinite(iv) ? formatPct(iv, { decimals: 2 }) : "—"}
          hint={Number.isFinite(s.ivChange) ? <span className={tone(s.ivChange)}>{`${formatSigned(s.ivChange)} pts today`}</span> : leg && leg.iv > 0 ? "From the feed" : "Solved from LTP"}
        />
        <Stat
          label="Open interest"
          value={leg ? formatCompactIN(leg.oi) : "—"}
          hint={leg ? <span className={tone(leg.oiChange)}>{`${formatSigned(leg.oiChange, 0)} today`}</span> : undefined}
          help="Contracts open at the exchange. The change is versus the previous day's close, as reported by the feed."
        />
        <Stat label="Volume" value={leg ? formatCompactIN(leg.volume) : "—"} hint="Traded today" />
        <Stat
          label={m.state === "ITM" ? "Intrinsic" : "Time value"}
          value={m.state === "ITM" ? formatINR(m.intrinsic) : formatINR(m.timeValue)}
          hint={m.state === "ITM" ? `Time value ${formatINR(m.timeValue)}` : `Intrinsic ${formatINR(m.intrinsic)}`}
          help="Intrinsic value is what the option would pay if it expired now. Time value is the rest of the premium, which decays to zero by expiry."
        />
        <Stat
          label="Delta · Gamma"
          value={last ? formatGreek("delta", last.delta) : "—"}
          hint={last ? `Γ ${formatGreek("gamma", last.gamma)}` : undefined}
          help="Black-Scholes Greeks from the latest LTP, spot and IV, computed in the browser."
        />
        <Stat
          label="Theta · Vega"
          value={last ? formatGreek("theta", last.theta) : "—"}
          tone={last && last.theta < 0 ? "text-bearish" : ""}
          hint={last ? `ν ${formatGreek("vega", last.vega)} per vol pt` : undefined}
          help="Theta: rupees per calendar day per unit. Vega: rupees per one point of IV per unit."
        />
      </section>

      {d.intraday.isLoading || loadingQuote ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <PanelSkeleton label="Loading price chart" />
          <PanelSkeleton label="Loading open interest chart" />
        </div>
      ) : d.series.length < 2 ? (
        <Panel title={intradayTitle(<LineChartIcon className="h-4 w-4 text-primary-ink" aria-hidden="true" />, "Intraday")} subtitle="LTP, OI, IV and Greeks through the session">
          <EmptyState
            icon={<Activity className="h-6 w-6" aria-hidden="true" />}
            title={d.series.length === 1 ? "Only one snapshot so far" : "No intraday history for this contract yet"}
            action={
              <Button variant="outline" onClick={() => void d.intraday.refetch()} disabled={d.intraday.isFetching}>
                {d.intraday.isFetching ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Check again
              </Button>
            }
          >
            Intraday charts build from option-chain snapshots. They are recorded in this browser while a page with the recorder is open during market hours (09:15–15:30 IST), or by the proxy itself when it runs with RECORD_SYMBOLS={k.symbol}.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title={intradayTitle(<LineChartIcon className="h-4 w-4 text-primary-ink" aria-hidden="true" />, "LTP vs spot")}
              subtitle={
                <>
                  {sessionDate ? `${formatDateIST(sessionDate)} · ` : ""}
                  {d.series.length} points, {hhmm(d.series[0].ts)}–{hhmm(last.ts)} IST · high {formatINR(s.high)}, low {formatINR(s.low)}
                </>
              }
              actions={
                contractSnaps.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => downloadCsv(`${k.symbol}_${k.expiry}_${k.strike}${k.type}_${sessionDate ?? "intraday"}${d.sample ? "_SAMPLE" : ""}.csv`, snapshotsToCSV(contractSnaps))}
                  >
                    <Download aria-hidden="true" /> CSV
                  </Button>
                ) : undefined
              }
            >
              <PriceChart points={d.series} type={k.type} />
              <p className="mt-2 text-body-sm text-muted-foreground">
                Session change <span className={cn("font-num tabular-nums", tone(s.ltpChange))}>{formatSigned(s.ltpChange)} ({formatPct(s.ltpChangePct, { signed: true, decimals: 1 })})</span> while spot moved{" "}
                <span className="font-num tabular-nums">{formatSigned((last?.spot ?? 0) - (s.first?.spot ?? 0))}</span> points.
              </p>
            </Panel>
            <Panel
              title={intradayTitle(<BarChart3 className="h-4 w-4 text-primary-ink" aria-hidden="true" />, "Open interest")}
              subtitle={
                <>
                  Line: OI. Bars: change between snapshots. Session{" "}
                  <span className={cn("font-num tabular-nums", tone(s.oiChange))}>{formatSigned(s.oiChange, 0)} ({formatPct(s.oiChangePct, { signed: true, decimals: 1 })})</span>
                </>
              }
            >
              <OiChart points={d.series} type={k.type} />
            </Panel>
            <Panel
              title={intradayTitle(<Waves className="h-4 w-4 text-primary-ink" aria-hidden="true" />, "Implied volatility")}
              subtitle={d.series.some((p) => p.ivSource === "solved") ? "Feed IV where reported; otherwise solved from LTP with Black-Scholes" : "IV as reported by the feed"}
            >
              <IvChart points={d.series} />
            </Panel>
            <Panel title={intradayTitle(<Gauge className="h-4 w-4 text-primary-ink" aria-hidden="true" />, "Volume")} subtitle={`Contracts traded between snapshots · ${formatCompactIN(s.volume)} in the window`}>
              <VolumeChart points={d.series} />
            </Panel>
          </div>
          <Panel
            title={
              <>
                <Sigma className="h-4 w-4 text-primary-ink" aria-hidden="true" />
                Greeks over time
                <ProvenanceBadge kind={d.sample ? "sample" : "derived"} />
              </>
            }
            subtitle="Δ, Γ, Θ and ν at every snapshot from its spot, LTP-implied or reported IV and the time left to 15:30 IST on expiry (Black-Scholes with dividend yield)"
          >
            <GreeksCharts points={d.series} />
          </Panel>
        </>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <DepthPanel leg={leg} lotSize={d.lotSize} sample={d.sample} />
        <FactsPanel k={k} leg={leg} spot={d.spot} lotSize={d.lotSize} thetaPerUnit={last?.theta ?? NaN} />
      </div>

      <DailyHistory
        type={k.type}
        result={d.daily.data}
        loading={d.daily.isLoading && !!d.data}
        fetching={d.daily.isFetching}
        error={d.daily.isError}
        days={dailyDays}
        onDaysChange={setDailyDays}
        onRetry={() => void d.daily.refetch()}
      />

      <p className="text-body-sm text-muted-foreground">
        {d.sample
          ? "Sample mode: the quote, intraday session and daily rows are simulated so the page can be explored without the proxy. Start the proxy (npm run proxy) for NSE data."
          : "Greeks and IV are computed in the browser with the terminal's shared options maths. Intraday history comes from snapshots recorded in this browser or by the proxy's opt-in recorder; nothing is invented when history is missing."}
      </p>
    </div>
  );
}
