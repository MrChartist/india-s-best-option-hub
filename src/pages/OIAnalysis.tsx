import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, ArrowUpRight, ChartColumn, Keyboard, Loader2, MapPin, RefreshCw, WifiOff, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BuildupBadge } from "@/components/ui/buildup-badge";
import { PageHeader } from "@/components/PageHeader";
import MetricHelp from "@/components/learn/MetricHelp";
import { OIHeatmap } from "@/components/OIHeatmap";
import { SupportResistance } from "@/components/SupportResistance";
import { MultiExpiryOI } from "@/components/MultiExpiryOI";
import { IVPercentileGauge } from "@/components/IVPercentileGauge";
import { SymbolSearch } from "@/components/option-chain/SymbolSearch";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { resolveFnoSymbol } from "@/components/option-chain/symbols";
import { UnknownSymbolNotice } from "@/components/option-chain/UnknownSymbolNotice";
import { BuildupQuadrant } from "@/components/oi/BuildupQuadrant";
import { OIReplay } from "@/components/oi/OIReplay";
import { PCRSuite } from "@/components/oi/PCRSuite";
import { OITimeSeries } from "@/components/oi/OITimeSeries";
import { CumulativeOIChange, RangeOIChange } from "@/components/oi/OIFlowCharts";
import { useOiSession } from "@/components/oi/useOiSession";
import { emMethodTag } from "@/components/oi/MaxPainTable";
import { EmptyState, ExpiryPills, ModuleHeader, Segmented, StatTile } from "@/components/oi/shared";
import { EDU_NOTE, fmtOI, fmtOIChange, fmtRatio, fmtStrike } from "@/components/oi/format";
import { useExpiryList, useLiveOptionChain } from "@/hooks/useMarketData";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { axisProps, barCursor, chartColors, gridProps, legendStyle, tokenColor, tooltipCursor, tooltipStyle } from "@/lib/chartTheme";
import { inferOiUnit } from "@/lib/gexData";
import { contractPath } from "@/lib/history/contractSeries";
import { compactAxisFormatter, enrichChain, findATMStrike, getMarketParams, normalizeExpiry } from "@/lib/options";
import {
  BUILDUP_LABEL,
  buildupCode,
  calculatePCR,
  dominantBuildup,
  expirySummary,
  getATMZoneAnalysis,
  getBuildup,
  getDeltaOI,
  getIVSkew,
  getMaxPain,
  getStrikePCR,
  legPriceChange,
  pcrSignal,
  significantStrikes,
  spotMaxPainLabel,
  strikeGap,
} from "@/lib/oiUtils";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "oi-dist", label: "OI by strike" },
  { value: "oi-change", label: "OI change" },
  { value: "buildup", label: "Buildup" },
  { value: "quadrant", label: "Quadrant" },
  { value: "writer-delta", label: "Writer delta" },
  { value: "strike-pcr", label: "Strike PCR" },
  { value: "pcr", label: "PCR" },
  { value: "multi-expiry", label: "Multi-expiry" },
  { value: "replay", label: "Replay" },
  { value: "iv-smile", label: "IV smile" },
  { value: "top-oi", label: "Top strikes" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

const ZONE_SIZES = [2, 5] as const;

/** "CE · PE" links from a strike row to the two contract pages. */
function ContractLinks({ symbol, expiry, strike }: { symbol: string; expiry: string; strike: number }) {
  if (!expiry) return null;
  return (
    <span className="ml-1.5 inline-flex gap-1 align-middle">
      {(["CE", "PE"] as const).map((t) => (
        <Link
          key={t}
          to={contractPath(symbol, expiry, strike, t)}
          className="rounded-chip bg-control-track px-1 text-micro font-medium leading-4 text-muted-foreground hover:bg-wash-brand hover:text-primary-ink focus-visible:shadow-focus focus-visible:outline-none"
          aria-label={`Open the ${fmtStrike(strike)} ${t} contract page`}
        >
          {t}
        </Link>
      ))}
    </span>
  );
}

/** Build-up badge for a leg; a muted dash when the build-up is neutral or unknown. */
function LegBuildup({ b, compact }: { b: Parameters<typeof buildupCode>[0]; compact?: boolean }) {
  const code = buildupCode(b);
  return code ? <BuildupBadge kind={code} variant={compact ? "compact" : "full"} /> : <span className="text-muted-foreground" title={BUILDUP_LABEL[b]}>—</span>;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "combobox";
}

/** Prefix "+" on positive ticks of a change axis ("+1.2L"). */
const signedTick = (f: (v: number) => string) => (v: number) => (v > 0 ? `+${f(v)}` : f(v));

export default function OIAnalysis() {
  const [params, setParams] = useSearchParams();
  // A symbol with no F&O contracts falls back to NIFTY (with a notice) instead of a fake chain.
  const { symbol, unknown: unknownSymbol } = resolveFnoSymbol(params.get("symbol"));
  const expiryParam = normalizeExpiry(params.get("expiry") || "");
  const strikeParam = Number(params.get("strike"));
  const tabParam = params.get("tab");
  const tab: TabValue = (TABS.some((t) => t.value === tabParam) ? tabParam : "oi-dist") as TabValue;
  const zonePerSide = Number(params.get("zone")) === 5 ? 5 : 2;
  useDocumentTitle(`OI Analysis · ${symbol}`);

  const setParam = useCallback(
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

  const { data: liveData, refetch, isLoading, isFetching, isError } = useLiveOptionChain(symbol, expiryParam || undefined);
  const { data: expiryData } = useExpiryList(symbol);
  const chain = useMemo(() => liveData?.chain ?? [], [liveData]);
  const spotPrice = liveData?.spotPrice ?? 0;
  const lotSize = liveData?.lotSize ?? 0;
  const isSample = liveData?.source === "sample";
  const afterHours = !!liveData?.afterHours && !isSample;
  const hasData = chain.length > 0;

  const expiries = useMemo(() => {
    const list = expiryData?.expiries?.length ? expiryData.expiries : liveData?.expiries ?? [];
    return list.filter((e) => !!e.value).map((e) => ({ ...e, value: normalizeExpiry(e.value) || e.value }));
  }, [expiryData, liveData?.expiries]);
  const expiry = expiryParam || liveData?.expiry || expiries[0]?.value || "";

  // Picking the nearest expiry clears the param so this page shares one poll with the IV panel.
  const selectExpiry = useCallback((v: string) => setParam({ expiry: v === expiries[0]?.value ? null : v, strike: null }), [setParam, expiries]);

  const handleRefetch = useCallback(() => void refetch(), [refetch]);

  // Real keyboard shortcuts: R refresh, [ and ] previous / next expiry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleRefetch();
      } else if ((e.key === "[" || e.key === "]") && expiries.length > 1) {
        const i = Math.max(0, expiries.findIndex((x) => x.value === expiry));
        const j = e.key === "]" ? Math.min(expiries.length - 1, i + 1) : Math.max(0, i - 1);
        if (j !== i) selectExpiry(expiries[j].value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleRefetch, expiries, expiry, selectExpiry]);

  const atmStrike = useMemo(() => (hasData ? findATMStrike(chain, spotPrice) : NaN), [chain, spotPrice, hasData]);
  const highlight = Number.isFinite(strikeParam) && chain.some((r) => r.strikePrice === strikeParam) ? strikeParam : undefined;
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);
  const pcrData = useMemo(() => calculatePCR(chain), [chain]);
  const signal = pcrSignal(pcrData.pcrOI);
  const significant = useMemo(() => significantStrikes(chain), [chain]);
  const oiUnit = useMemo(() => inferOiUnit(chain, lotSize), [chain, lotSize]);

  // The x-axis is categorical, so keep every listed strike between the first and last significant
  // strike: small strikes inside the range show as short bars instead of silently vanishing, and the
  // category spacing stays a uniform strike grid.
  const oiData = useMemo(() => {
    if (significant.length === 0) return [];
    const ks = significant.map((o) => o.strikePrice);
    const lo = Math.min(...ks);
    const hi = Math.max(...ks);
    return chain
      .filter((o) => o.strikePrice >= lo && o.strikePrice <= hi)
      .sort((a, b) => a.strikePrice - b.strikePrice)
      .map((o) => ({ strike: o.strikePrice, callOI: o.ce.oi, putOI: o.pe.oi, callChg: o.ce.oiChange, putChg: o.pe.oiChange, callVol: o.ce.volume, putVol: o.pe.volume }));
  }, [significant, chain]);
  const oiChangeData = useMemo(() => {
    const maxChg = Math.max(0, ...chain.map((o) => Math.max(Math.abs(o.ce.oiChange), Math.abs(o.pe.oiChange))));
    const cut = maxChg * 0.05;
    const ks = chain.filter((o) => maxChg > 0 && (Math.abs(o.ce.oiChange) >= cut || Math.abs(o.pe.oiChange) >= cut)).map((o) => o.strikePrice);
    if (ks.length === 0) return [];
    const lo = Math.min(...ks);
    const hi = Math.max(...ks);
    // Contiguous strike range (see oiData): no hidden gaps on the categorical axis.
    return chain
      .filter((o) => o.strikePrice >= lo && o.strikePrice <= hi)
      .sort((a, b) => a.strikePrice - b.strikePrice)
      .map((o) => ({ strike: o.strikePrice, callOIChg: o.ce.oiChange, putOIChg: o.pe.oiChange }));
  }, [chain]);
  const ivSmileData = useMemo(() => getIVSkew(chain), [chain]);
  // The NSE feed sends delta 0 for every leg, so fill missing Greeks before −OI × delta.
  const deltaOIData = useMemo(() => {
    const withDelta = hasData && spotPrice > 0 && expiry ? enrichChain(chain, { spot: spotPrice, expiry }) : chain;
    return getDeltaOI(withDelta, spotPrice, undefined, { oiUnit, lotSize });
  }, [chain, spotPrice, expiry, hasData, oiUnit, lotSize]);
  // Shared-unit axis ticks: one unit (K / L / Cr) per axis, picked from the data extent, so an axis
  // never mixes "1.1L" with "55K".
  const oiAxisTick = useMemo(() => compactAxisFormatter(...oiData.flatMap((d) => [d.callOI, d.putOI])), [oiData]);
  const oiChgAxisTick = useMemo(() => signedTick(compactAxisFormatter(...oiChangeData.flatMap((d) => [d.callOIChg, d.putOIChg]))), [oiChangeData]);
  const deltaAxisTick = useMemo(
    () => signedTick(compactAxisFormatter(...deltaOIData.flatMap((d) => [d.ceDeltaOI, d.peDeltaOI, d.netDeltaOI]))),
    [deltaOIData],
  );
  const strikePCRData = useMemo(() => getStrikePCR(chain, spotPrice), [chain, spotPrice]);
  const zone = useMemo(() => getATMZoneAnalysis(chain, spotPrice, undefined, zonePerSide), [chain, spotPrice, zonePerSide]);

  const buildupRows = useMemo(
    () =>
      significant
        .map((o) => ({
          strike: o.strikePrice,
          ce: { oi: o.ce.oi, chg: o.ce.oiChange, px: legPriceChange(o.ce), b: getBuildup(o.ce) },
          pe: { oi: o.pe.oi, chg: o.pe.oiChange, px: legPriceChange(o.pe), b: getBuildup(o.pe) },
        }))
        .sort((a, b) => Math.abs(b.ce.chg) + Math.abs(b.pe.chg) - Math.abs(a.ce.chg) - Math.abs(a.pe.chg))
        .slice(0, 12)
        .sort((a, b) => a.strike - b.strike),
    [significant],
  );
  const hasPriceChange = buildupRows.some((r) => Number.isFinite(r.ce.px) || Number.isFinite(r.pe.px));

  const topCEOI = useMemo(() => [...chain].sort((a, b) => b.ce.oi - a.ce.oi).slice(0, 5), [chain]);
  const topPEOI = useMemo(() => [...chain].sort((a, b) => b.pe.oi - a.pe.oi).slice(0, 5), [chain]);

  const session = useOiSession(symbol, expiry, spotPrice);
  const ceDominant = useMemo(() => dominantBuildup(chain, "CE"), [chain]);
  const peDominant = useMemo(() => dominantBuildup(chain, "PE"), [chain]);

  const pcrRows = useMemo(() => {
    if (!hasData || !expiry) return [];
    return [{ ...expirySummary(chain, spotPrice, expiry, { r: getMarketParams().r }), sample: isSample }];
  }, [chain, spotPrice, expiry, hasData, isSample]);

  const strikeTick = (v: number) => fmtStrike(v);
  const strikeLabel = (v: number) => `Strike ${fmtStrike(v)}`;
  const mpLabel = spotMaxPainLabel(spotPrice, maxPain, strikeGap(chain.map((r) => r.strikePrice)));
  const refLines = () => {
    const out: JSX.Element[] = [];
    // When spot sits on max pain, the max pain line carries one combined label instead of two.
    if (Number.isFinite(atmStrike)) out.push(<ReferenceLine key="atm" x={atmStrike} stroke={chartColors.spot} strokeDasharray="4 4" label={mpLabel.combined ? undefined : { value: "ATM", fill: chartColors.spot, fontSize: 11, position: "top" }} />);
    if (highlight) out.push(<ReferenceLine key="hl" x={highlight} stroke={chartColors.foreground} strokeWidth={1.5} label={{ value: fmtStrike(highlight), fill: chartColors.foreground, fontSize: 11, position: "insideTopRight" }} />);
    return out;
  };

  const summary = pcrRows[0];
  const metricCards: Array<{ key: string; label: ReactNode; value: ReactNode; cls?: string; sub?: ReactNode }> = [
    {
      key: "maxPain",
      label: <MetricHelp metric="maxPain" value={maxPain || undefined}>Max pain</MetricHelp>,
      value: fmtStrike(maxPain),
      cls: "text-warning",
      sub: spotPrice > 0 && maxPain > 0 ? `${maxPain - spotPrice >= 0 ? "+" : "−"}${Math.abs(maxPain - spotPrice).toLocaleString("en-IN", { maximumFractionDigits: 0 })} pts from spot` : undefined,
    },
    { key: "pcr", label: <MetricHelp metric="pcr" value={pcrData.pcrOI || undefined}>PCR (OI)</MetricHelp>, value: fmtRatio(pcrData.pcrOI), cls: signal.className, sub: signal.label },
    {
      key: "em",
      label: <MetricHelp metric="em">Expected move</MetricHelp>,
      value: summary?.expectedMove ? `±${summary.expectedMove.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—",
      sub: summary?.emSource ? `${emMethodTag(summary.emSource)} · to expiry` : "Needs IV or an ATM straddle",
    },
    {
      key: "buildup",
      label: <MetricHelp metric="buildup">Dominant buildup</MetricHelp>,
      value: (
        <span className="inline-flex items-center gap-1.5 text-body-sm">
          <span className="text-label text-muted-foreground">CE</span>
          <LegBuildup b={ceDominant.buildup} compact />
          <span className="text-label text-muted-foreground">PE</span>
          <LegBuildup b={peDominant.buildup} compact />
        </span>
      ),
      sub: ceDominant.share > 0 || peDominant.share > 0 ? `By OI change · ${Math.round(ceDominant.share * 100)}% / ${Math.round(peDominant.share * 100)}%` : "Premium changes not sent",
    },
    { key: "ceoi", label: "Call OI", value: fmtOI(pcrData.totalCEOI), cls: "text-bearish", sub: "Resistance side" },
    { key: "peoi", label: "Put OI", value: fmtOI(pcrData.totalPEOI), cls: "text-bullish", sub: "Support side" },
    { key: "cechg", label: "Call OI change", value: fmtOIChange(pcrData.totalCEOIChg), cls: "text-bearish", sub: pcrData.totalCEOIChg >= 0 ? "Writers adding" : "Writers exiting" },
    { key: "pechg", label: "Put OI change", value: fmtOIChange(pcrData.totalPEOIChg), cls: "text-bullish", sub: pcrData.totalPEOIChg >= 0 ? "Writers adding" : "Writers exiting" },
  ];

  const chartCard = (title: string, hint: string, body: ReactNode, right?: ReactNode) => (
    <Card className="overflow-hidden">
      <ModuleHeader title={title} hint={hint} right={right} />
      <CardContent className="p-4">{body}</CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ChartColumn}
        title="OI Analysis"
        description="Open interest walls, intraday OI change, buildup and PCR by strike for one expiry."
        source={
          <>
            {liveData && <SourceBadge source={liveData.source} asOf={liveData.asOf} stale={liveData.stale} isLive={liveData.isLive} reason={liveData.reason} />}
            {spotPrice > 0 && (
              <span className="font-num text-body-sm text-muted-foreground">
                Spot <span className="font-semibold text-foreground">{spotPrice.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
                {maxPain > 0 && (
                  <>
                    {" "}· Max pain <span className="font-semibold text-warning">{fmtStrike(maxPain)}</span>
                  </>
                )}
              </span>
            )}
            {hasData && <Badge variant={signal.tone === "neutral" ? "neutral" : signal.tone}>PCR {fmtRatio(pcrData.pcrOI)} · {signal.label}</Badge>}
          </>
        }
        actions={
          <>
            <SymbolSearch value={symbol} onSelect={(v) => setParam({ symbol: v, expiry: null, strike: null })} />
            <Button variant="outline" className="gap-1.5" onClick={handleRefetch} disabled={isFetching} aria-label="Refresh data (R)">
              {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
            <Button asChild variant="ghost" className="gap-1">
              <Link to={`/max-pain-pcr?symbol=${encodeURIComponent(symbol)}${expiry ? `&expiry=${expiry}` : ""}`}>
                Max pain &amp; PCR <ArrowUpRight />
              </Link>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts">
                  <Keyboard />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3 text-body-sm" align="end">
                <p className="mb-2 text-label text-muted-foreground">Keyboard shortcuts</p>
                <dl className="space-y-1.5">
                  {[
                    ["Refresh data", "R"],
                    ["Previous expiry", "["],
                    ["Next expiry", "]"],
                  ].map(([label, key]) => (
                    <div key={key} className="flex items-center justify-between">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>
                        <kbd className="rounded-chip bg-control-track px-1.5 py-0.5 font-mono text-micro">{key}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </PopoverContent>
            </Popover>
          </>
        }
      />
      {unknownSymbol ? <UnknownSymbolNotice symbol={unknownSymbol} /> : null}
      <div className="space-y-2">
        <ExpiryPills expiries={expiries} value={expiry} onChange={selectExpiry} />
        {highlight && (
          <div className="inline-flex h-6 items-center gap-1.5 rounded-capsule bg-control-track pl-2.5 pr-1 text-body-sm">
            <MapPin className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" />
            Strike {fmtStrike(highlight)} highlighted
            <button type="button" className="rounded-capsule p-0.5 hover:bg-control-track focus-visible:shadow-focus focus-visible:outline-none" onClick={() => setParam({ strike: null })} aria-label="Clear highlighted strike">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {afterHours && (
        <div className="flex items-center gap-2 rounded-tile bg-wash-warning/60 px-3 py-2 text-warning" role="status">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-body-sm font-medium">Market closed. {hasData ? "Showing the last available OI from the closing session." : "No saved chain yet; data appears when the market opens."}</p>
        </div>
      )}

      {isError && !liveData && (
        <Card>
          <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="Could not load the option chain" action={<Button size="sm" variant="outline" onClick={handleRefetch}>Try again</Button>} />
        </Card>
      )}

      {isLoading && !liveData ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-body text-muted-foreground" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary-ink" /> Loading {symbol} option chain…
          </CardContent>
        </Card>
      ) : !hasData ? (
        liveData && (
          <Card>
            <EmptyState icon={<WifiOff className="h-5 w-5" />} title="No option chain for this symbol and expiry" action={<Button size="sm" variant="outline" onClick={handleRefetch}>Retry</Button>}>
              Data refreshes every few seconds during market hours (09:15 to 15:30 IST). Check that the local proxy is running.
            </EmptyState>
          </Card>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 items-start gap-2 md:grid-cols-4">
            {metricCards.map((m) => (
              <StatTile key={m.key} variant="box" label={m.label} value={m.value} valueClass={m.cls} sub={m.sub} />
            ))}
          </div>

          {/* ATM zone */}
          <Card className="overflow-hidden">
            <ModuleHeader
              title={`ATM zone · ATM ± ${zone.perSide} (${zone.strikes} strikes)`}
              hint="PCR change compares the zone PCR now with the zone PCR at the previous close (OI minus today's change)."
              right={
                <Segmented<number>
                  label="Strikes each side of ATM"
                  value={zonePerSide}
                  onChange={(n) => setParam({ zone: n === 2 ? null : String(n) })}
                  options={ZONE_SIZES.map((n) => ({ value: n, label: `± ${n}` }))}
                />
              }
            />
            <CardContent className="space-y-3 p-4">
              <div className="grid grid-cols-2 items-start gap-2 md:grid-cols-3 xl:grid-cols-6">
                <StatTile label="Zone PCR" value={fmtRatio(zone.pcr)} valueClass={pcrSignal(zone.pcr).className} />
                <StatTile label="PCR change" value={zone.prevPcr > 0 ? `${zone.pcrChange >= 0 ? "+" : ""}${zone.pcrChange.toFixed(2)}` : "—"} sub={zone.prevPcr > 0 ? `from ${zone.prevPcr.toFixed(2)}` : undefined} valueClass={zone.pcrChange > 0 ? "text-bullish" : zone.pcrChange < 0 ? "text-bearish" : undefined} />
                <StatTile label="Call OI" value={fmtOI(zone.totalCEOI)} valueClass="text-bearish" />
                <StatTile label="Put OI" value={fmtOI(zone.totalPEOI)} valueClass="text-bullish" />
                <StatTile label="Call OI chg" value={`${zone.ceOIChgPercent >= 0 ? "+" : ""}${zone.ceOIChgPercent.toFixed(2)}%`} sub={fmtOIChange(zone.totalCEOIChg)} />
                <StatTile label="Put OI chg" value={`${zone.peOIChgPercent >= 0 ? "+" : ""}${zone.peOIChgPercent.toFixed(2)}%`} sub={fmtOIChange(zone.totalPEOIChg)} />
              </div>
              <div className="overflow-x-auto rounded-md border border-separator">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strike</TableHead>
                      <TableHead className="text-right">Call OI</TableHead>
                      <TableHead className="text-right">Call chg</TableHead>
                      <TableHead className="text-right">PCR</TableHead>
                      <TableHead className="text-right">Put chg</TableHead>
                      <TableHead className="text-right">Put OI</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {zone.strikeData.map((s) => (
                      <TableRow key={s.strike} className={cn("font-num text-body-sm", s.isATM && "bg-wash-brand/55 shadow-[inset_0_0_0_var(--hairline)_hsl(var(--primary)/0.5)]", highlight === s.strike && "outline outline-2 -outline-offset-2 outline-primary")}>
                        <TableCell className="font-semibold">
                          {fmtStrike(s.strike)}
                          {s.isATM && <span className="ml-1.5 text-micro font-semibold text-primary-ink">ATM</span>}
                          <ContractLinks symbol={symbol} expiry={expiry} strike={s.strike} />
                        </TableCell>
                        <TableCell className="text-right">{fmtOI(s.ceOI)}</TableCell>
                        <TableCell className="text-right text-bearish">
                          {fmtOIChange(s.ceOIChg)} <span className="text-muted-foreground">({s.ceOIChgPct >= 0 ? "+" : ""}{s.ceOIChgPct.toFixed(1)}%)</span>
                        </TableCell>
                        <TableCell className={cn("text-right font-semibold", pcrSignal(s.pcr).className)}>{fmtRatio(s.pcr)}</TableCell>
                        <TableCell className="text-right text-bullish">
                          {fmtOIChange(s.peOIChg)} <span className="text-muted-foreground">({s.peOIChgPct >= 0 ? "+" : ""}{s.peOIChgPct.toFixed(1)}%)</span>
                        </TableCell>
                        <TableCell className="text-right">{fmtOI(s.peOI)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid items-start gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OIHeatmap chain={chain} spotPrice={spotPrice} highlightStrike={highlight} />
            </div>
            <SupportResistance chain={chain} spotPrice={spotPrice} symbol={symbol} expiry={expiry} asOf={liveData?.asOf} />
          </div>

          <section aria-labelledby="intraday-oi" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="intraday-oi" className="flex items-center gap-2 font-display text-title">
                <Activity className="h-4 w-4 text-primary-ink" aria-hidden="true" />
                Intraday OI
              </h2>
              <p className="text-body-sm text-muted-foreground">
                {session.source === "recorded" ? "From snapshots recorded in this browser today." : "No recorded session yet: showing a labelled sample day. Keep this tab open in market hours to record your own."}
              </p>
            </div>
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <CumulativeOIChange session={session} unit={oiUnit} />
              <RangeOIChange session={session} unit={oiUnit} />
            </div>
            <OITimeSeries session={session} unit={oiUnit} />
          </section>

          <Tabs value={tab} onValueChange={(v) => setParam({ tab: v === "oi-dist" ? null : v })}>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList className="w-max">
                {TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value} className="text-body-sm">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="oi-dist">
              {chartCard(
                "Call and put OI by strike",
                "Every listed strike across the range where OI is at least 5% of the largest. Calls are resistance, puts are support.",
                <div className="h-[340px] sm:h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={oiData} barGap={0} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis {...axisProps} dataKey="strike" tickFormatter={strikeTick} minTickGap={14} />
                      <YAxis {...axisProps} tickFormatter={oiAxisTick} width={52} />
                      <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={strikeLabel} formatter={(v: number, n: string) => [fmtOI(v), n]} />
                      <Legend wrapperStyle={legendStyle} />
                      {maxPain > 0 && <ReferenceLine x={maxPain} stroke={chartColors.warning} strokeDasharray="5 4" label={{ value: mpLabel.combined ? (mpLabel.text ?? "") : "Max pain", fill: chartColors.warning, fontSize: 11, position: mpLabel.combined ? "top" : "insideTopLeft" }} />}
                      {refLines()}
                      <Bar dataKey="callOI" name="Call OI" fill={chartColors.call} fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="putOI" name="Put OI" fill={chartColors.put} fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>,
              )}
            </TabsContent>

            <TabsContent value="oi-change">
              {chartCard(
                "Change in OI by strike",
                "Today's OI change. Faded bars are OI being closed.",
                <div className="h-[340px] sm:h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={oiChangeData} barGap={0} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis {...axisProps} dataKey="strike" tickFormatter={strikeTick} minTickGap={14} />
                      <YAxis {...axisProps} tickFormatter={oiChgAxisTick} width={56} />
                      <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={strikeLabel} formatter={(v: number, n: string) => [fmtOIChange(v), n]} />
                      <Legend wrapperStyle={legendStyle} />
                      <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />
                      {refLines()}
                      <Bar dataKey="callOIChg" name="Call OI change" fill={chartColors.call} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                        {oiChangeData.map((e) => (
                          <Cell key={e.strike} fill={chartColors.call} fillOpacity={e.callOIChg >= 0 ? 0.85 : 0.35} />
                        ))}
                      </Bar>
                      <Bar dataKey="putOIChg" name="Put OI change" fill={chartColors.put} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                        {oiChangeData.map((e) => (
                          <Cell key={e.strike} fill={chartColors.put} fillOpacity={e.putOIChg >= 0 ? 0.85 : 0.35} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>,
              )}
            </TabsContent>

            <TabsContent value="buildup">
              <Card className="overflow-hidden">
                <ModuleHeader
                  title="Buildup by strike"
                  hint="The 12 most active strikes. Same rule for calls and puts: premium and OI up = long build-up; premium down, OI up = short build-up; premium up, OI down = short covering; both down = long unwinding."
                />
                <CardContent className="p-0">
                  {!hasPriceChange && <p className="hairline-b px-4 py-2 text-body-sm text-muted-foreground">This source did not send premium changes, so buildup shows as neutral.</p>}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Call buildup</TableHead>
                          <TableHead className="text-right">Call OI chg</TableHead>
                          <TableHead className="text-right">Call prem chg</TableHead>
                          <TableHead className="text-center">Strike</TableHead>
                          <TableHead>Put prem chg</TableHead>
                          <TableHead>Put OI chg</TableHead>
                          <TableHead className="text-right">Put buildup</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {buildupRows.map((r) => (
                          <TableRow key={r.strike} className={cn("font-num text-body-sm", r.strike === atmStrike && "bg-wash-brand/55", highlight === r.strike && "outline outline-2 -outline-offset-2 outline-primary")}>
                            <TableCell>
                              <LegBuildup b={r.ce.b} />
                            </TableCell>
                            <TableCell className="text-right">{fmtOIChange(r.ce.chg)}</TableCell>
                            <TableCell className={cn("text-right", r.ce.px > 0 ? "text-bullish" : r.ce.px < 0 ? "text-bearish" : "text-muted-foreground")}>{Number.isFinite(r.ce.px) ? `${r.ce.px > 0 ? "+" : ""}${r.ce.px.toFixed(2)}` : "—"}</TableCell>
                            <TableCell className="whitespace-nowrap text-center font-semibold">
                              {fmtStrike(r.strike)}
                              <ContractLinks symbol={symbol} expiry={expiry} strike={r.strike} />
                            </TableCell>
                            <TableCell className={cn(r.pe.px > 0 ? "text-bullish" : r.pe.px < 0 ? "text-bearish" : "text-muted-foreground")}>{Number.isFinite(r.pe.px) ? `${r.pe.px > 0 ? "+" : ""}${r.pe.px.toFixed(2)}` : "—"}</TableCell>
                            <TableCell>{fmtOIChange(r.pe.chg)}</TableCell>
                            <TableCell className="text-right">
                              <LegBuildup b={r.pe.b} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="quadrant">
              <BuildupQuadrant chain={chain} sample={isSample} />
            </TabsContent>

            <TabsContent value="writer-delta">
              {chartCard(
                "Writer delta exposure by strike (lots)",
                "Option writers hold the opposite side of buyers: −OI × delta. Positive net means writers are long delta at that strike (they gain if the index rises).",
                deltaOIData.length === 0 || deltaOIData.every((d) => d.ceDeltaOI === 0 && d.peDeltaOI === 0) ? (
                  <EmptyState title="No delta in this chain">Greeks were not sent by this source.</EmptyState>
                ) : (
                  <div className="h-[340px] sm:h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={deltaOIData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid {...gridProps} />
                        <XAxis {...axisProps} dataKey="strike" tickFormatter={strikeTick} minTickGap={14} />
                        <YAxis {...axisProps} tickFormatter={deltaAxisTick} width={56} />
                        <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={strikeLabel} formatter={(v: number, n: string) => [`${fmtOIChange(v)} lots`, n]} />
                        <Legend wrapperStyle={legendStyle} />
                        <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />
                        {refLines()}
                        <Bar dataKey="ceDeltaOI" name="Call writers" fill={chartColors.call} fillOpacity={0.75} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                        <Bar dataKey="peDeltaOI" name="Put writers" fill={chartColors.put} fillOpacity={0.75} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                        <Line type="monotone" dataKey="netDeltaOI" name="Net writer delta" stroke={chartColors.warning} strokeWidth={2} dot={false} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ),
                <Badge variant="info">Derived</Badge>,
              )}
            </TabsContent>

            <TabsContent value="strike-pcr">
              {chartCard(
                "PCR by strike",
                "Strikes where both legs hold at least 5% of the largest OI. Above 1 = put heavy (support), below 1 = call heavy (resistance).",
                <div className="h-[340px] sm:h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={strikePCRData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid {...gridProps} />
                      <XAxis {...axisProps} dataKey="strike" tickFormatter={strikeTick} minTickGap={14} />
                      <YAxis {...axisProps} domain={[0, "auto"]} tickFormatter={(v: number) => v.toFixed(1)} width={40} />
                      <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={strikeLabel} formatter={(v: number) => [fmtRatio(v), "PCR"]} />
                      <ReferenceLine y={1} stroke={tokenColor("muted-foreground", 0.7)} strokeDasharray="5 5" />
                      {refLines()}
                      <Bar dataKey="pcr" name="PCR" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                        {strikePCRData.map((e) => (
                          <Cell key={e.strike} fill={e.pcr >= 1 ? chartColors.put : chartColors.call} fillOpacity={0.75} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>,
              )}
            </TabsContent>

            <TabsContent value="pcr">
              <PCRSuite rows={pcrRows} selected={expiry} onSelect={selectExpiry} />
            </TabsContent>

            <TabsContent value="multi-expiry">
              <MultiExpiryOI symbol={symbol} expiries={expiries} primaryExpiry={expiry} primaryChain={chain} spotPrice={spotPrice} sample={isSample} />
            </TabsContent>

            <TabsContent value="replay">
              <OIReplay symbol={symbol} expiry={expiry} />
            </TabsContent>

            <TabsContent value="iv-smile">
              {chartCard(
                "IV smile",
                "Implied volatility by strike for calls and puts.",
                ivSmileData.length === 0 ? (
                  <EmptyState title="No IV in this chain" />
                ) : (
                  <div className="h-[340px] sm:h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ivSmileData} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid {...gridProps} />
                        <XAxis {...axisProps} dataKey="strike" tickFormatter={strikeTick} minTickGap={14} />
                        <YAxis {...axisProps} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={44} />
                        <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} labelFormatter={strikeLabel} formatter={(v: number, n: string) => [v > 0 ? `${v.toFixed(2)}%` : "—", n]} />
                        <Legend wrapperStyle={legendStyle} />
                        {refLines()}
                        <Line type="monotone" dataKey="callIV" name="Call IV" stroke={chartColors.call} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="putIV" name="Put IV" stroke={chartColors.put} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="avgIV" name="Average IV" stroke={chartColors.iv} strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ),
              )}
            </TabsContent>

            <TabsContent value="top-oi">
              <div className="grid items-start gap-4 md:grid-cols-2">
                {([
                  { title: "Top 5 call OI (resistance)", rows: topCEOI, side: "ce" as const, cls: "text-bearish" },
                  { title: "Top 5 put OI (support)", rows: topPEOI, side: "pe" as const, cls: "text-bullish" },
                ]).map((blk) => (
                  <Card key={blk.side} className="overflow-hidden">
                    <ModuleHeader title={<span className={blk.cls}>{blk.title}</span>} />
                    <CardContent className="overflow-x-auto p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Strike</TableHead>
                            <TableHead className="text-right">OI</TableHead>
                            <TableHead className="text-right">OI chg</TableHead>
                            <TableHead className="text-right">IV</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {blk.rows.map((r) => {
                            const leg = r[blk.side];
                            return (
                              <TableRow key={r.strikePrice} className={cn("font-num text-body-sm", highlight === r.strikePrice && "outline outline-2 -outline-offset-2 outline-primary")}>
                                <TableCell className="font-semibold">
                                  {expiry ? (
                                    <Link
                                      to={contractPath(symbol, expiry, r.strikePrice, blk.side === "ce" ? "CE" : "PE")}
                                      className="rounded-chip underline-offset-4 hover:text-primary-ink hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                                      aria-label={`Open the ${fmtStrike(r.strikePrice)} ${blk.side === "ce" ? "CE" : "PE"} contract page`}
                                    >
                                      {fmtStrike(r.strikePrice)}
                                    </Link>
                                  ) : (
                                    fmtStrike(r.strikePrice)
                                  )}
                                </TableCell>
                                <TableCell className="text-right">{fmtOI(leg.oi)}</TableCell>
                                <TableCell className={cn("text-right", blk.cls)}>{fmtOIChange(leg.oiChange)}</TableCell>
                                <TableCell className="text-right">{leg.iv > 0 ? `${leg.iv.toFixed(1)}%` : "—"}</TableCell>
                                <TableCell className="text-right">₹{leg.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          <IVPercentileGauge chain={chain} spotPrice={spotPrice} symbol={symbol} expiry={expiry} isSample={isSample} />
        </>
      )}

      <p className="hairline-t pt-3 text-body-sm text-muted-foreground">
        {EDU_NOTE} OI walls, buildup and PCR describe positioning, not direction. Thresholds are relative to the largest OI in the chain.
      </p>
    </div>
  );
}
