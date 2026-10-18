import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Smile as SmileIcon, Spline } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { axisProps, chartColors, gridProps, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { dteLabel, formatDateIST, formatNumberIN, formatStrike, formatTimeIST, previousTradingDay, toISTDate } from "@/lib/options";
import { lastSnapshotBetween, snapshotNear, snapshotToChain } from "@/lib/volatility/api";
import { lastSessionDate } from "@/lib/volatility/history";
import { buildSmile, fitSmileSvi, smileSeries, type Smile } from "@/lib/volatility/smile";
import type { ExpiryChain } from "@/lib/volatility/surface";
import { DataState, DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge } from "./VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import type { PrevSessionData } from "./useVolatility";

export interface SmileChartProps {
  symbol: string;
  smiles: Smile[];
  chains: ExpiryChain[];
  isSample: boolean;
  prev: PrevSessionData | null | undefined;
}

interface Overlay {
  smile: Smile;
  label: string;
}

function useHourAgoSmile(symbol: string, expiry: string, enabled: boolean) {
  // Re-query at most once every five minutes.
  const bucket = Math.floor(Date.now() / 300_000);
  return useQuery({
    queryKey: ["smile-1h", symbol, expiry, bucket],
    queryFn: async (): Promise<Overlay | null> => {
      const target = Date.now() - 3_600_000;
      const snap = await snapshotNear(symbol, expiry, target, 15 * 60_000);
      if (!snap || !(snap.spot > 0)) return null;
      const smile = buildSmile(snapshotToChain(snap), { spot: snap.spot, expiry, now: new Date(snap.ts) });
      return smile.points.length ? { smile, label: `1 h ago (${formatTimeIST(snap.ts)})` } : null;
    },
    enabled: enabled && !!expiry,
    staleTime: 300_000,
    retry: 0,
  });
}

function useYesterdaySmile(symbol: string, expiry: string, prev: PrevSessionData | null | undefined, enabled: boolean) {
  const prevDate = previousTradingDay(lastSessionDate());
  return useQuery({
    queryKey: ["smile-yday", symbol, expiry, prevDate, !!prev],
    queryFn: async (): Promise<Overlay | null> => {
      const snap = await lastSnapshotBetween(symbol, expiry, toISTDate(prevDate, "09:15").getTime(), toISTDate(prevDate, "15:35").getTime());
      if (snap && snap.spot > 0) {
        const smile = buildSmile(snapshotToChain(snap), { spot: snap.spot, expiry, now: new Date(snap.ts) });
        if (smile.points.length) return { smile, label: `Yesterday (recorded ${formatTimeIST(snap.ts)})` };
      }
      const bhav = prev?.chains.find((c) => c.expiry === expiry);
      if (bhav) {
        const smile = buildSmile(bhav.chain, { spot: bhav.underlying, expiry, now: toISTDate(prevDate, "15:30") });
        if (smile.points.length) return { smile, label: `Yesterday close (bhavcopy, ${formatDateIST(prevDate)})` };
      }
      return null;
    },
    enabled: enabled && !!expiry,
    staleTime: 600_000,
    retry: 0,
  });
}

export function SmileChart({ symbol, smiles, chains, isSample, prev }: SmileChartProps) {
  const [expiry, setExpiry] = useState<string>("");
  const [showHour, setShowHour] = useState(true);
  const [showYday, setShowYday] = useState(true);
  const [showSvi, setShowSvi] = useState(false);

  useEffect(() => {
    if (smiles.length && !smiles.some((s) => s.expiry === expiry)) {
      // Default to the first expiry at least a day out (expiry-day smiles are noisy).
      setExpiry((smiles.find((s) => s.T * 365 >= 1) ?? smiles[0]).expiry);
    }
  }, [smiles, expiry]);

  const current = smiles.find((s) => s.expiry === expiry) ?? null;
  // Snapshots and overlays only make sense against real chains.
  const hour = useHourAgoSmile(symbol, expiry, showHour && !isSample);
  const yday = useYesterdaySmile(symbol, expiry, prev, showYday && !isSample);
  const svi = useMemo(() => (showSvi && current ? fitSmileSvi(current) : null), [showSvi, current]);

  const series = useMemo(() => {
    const out: Array<{ key: string; label: string; data: Array<{ strike: number; iv: number }>; color: string; dashed?: boolean; width: number }> = [];
    if (current) out.push({ key: "now", label: isSample ? "Now (sample)" : "Now", data: smileSeries(current), color: chartColors.iv, width: 2.25 });
    if (showHour && hour.data) out.push({ key: "hour", label: hour.data.label, data: smileSeries(hour.data.smile), color: chartColors.spot, width: 1.5 });
    if (showYday && yday.data) out.push({ key: "yday", label: yday.data.label, data: smileSeries(yday.data.smile), color: chartColors.muted, dashed: true, width: 1.5 });
    if (svi) out.push({ key: "svi", label: `SVI fit (RMSE ${svi.fit.rmseIv.toFixed(2)} pts)`, data: svi.curve, color: chartColors.c4, dashed: true, width: 1.25 });
    return out;
  }, [current, hour.data, yday.data, svi, showHour, showYday, isSample]);

  const domain = useMemo(() => {
    const ks = series.flatMap((s) => s.data.map((d) => d.strike));
    const now = current ? smileSeries(current).map((d) => d.strike) : ks;
    const base = now.length ? now : ks;
    return base.length ? [Math.min(...base), Math.max(...base)] : [0, 1];
  }, [series, current]);

  if (smiles.length === 0) {
    return (
      <Card>
        <EmptyState icon={SmileIcon} title="No smile available" body="The option chain has no usable prices for this symbol right now." />
      </Card>
    );
  }

  const ydaySmile = yday.data?.smile;
  const dAtm = current && ydaySmile ? current.atmIv - ydaySmile.atmIv : NaN;
  const dRr = current && ydaySmile ? current.rr25 - ydaySmile.rr25 : NaN;

  return (
    <Card>
      <PanelHeader
        icon={SmileIcon}
        title={`${symbol} volatility smile`}
        subtitle="OTM composite: puts below the forward, calls above. Strikes without a usable quote are left as gaps."
        right={
          <>
            {isSample ? <SampleBadge /> : <DerivedBadge title="IV solved with Black-76" />}
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="w-[180px]" aria-label="Expiry">
                <SelectValue placeholder="Expiry" />
              </SelectTrigger>
              <SelectContent>
                {smiles.map((s) => (
                  <SelectItem key={s.expiry} value={s.expiry}>
                    {formatDateIST(s.expiry)} · {dteLabel(s.expiry)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />
      <CardContent className="space-y-3 p-4 pt-0">
        {current ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Skew metrics">
            <Badge variant="info">ATM {fmtVol(current.atmIv)}</Badge>
            <Badge variant={current.rr25 < 0 ? "bearish" : "bullish"} title="25-delta risk reversal: 25Δ call IV minus 25Δ put IV">
              RR25 {fmtVolPts(current.rr25)}
            </Badge>
            <Badge variant="neutral" title="25-delta butterfly: average of the 25Δ wings minus ATM IV">
              BF25 {fmtVolPts(current.bf25)}
            </Badge>
            <Badge variant="outline">25Δ P {fmtVol(current.iv25p)}</Badge>
            <Badge variant="outline">25Δ C {fmtVol(current.iv25c)}</Badge>
            <Badge variant="outline">Fwd {formatNumberIN(current.F, 1)}</Badge>
            {Number.isFinite(dAtm) ? <Badge variant="neutral">ATM vs yday {fmtVolPts(dAtm)}</Badge> : null}
            {Number.isFinite(dRr) ? <Badge variant="neutral">RR25 vs yday {fmtVolPts(dRr)}</Badge> : null}
            <HelpTip text="A negative RR25 means downside puts are priced richer than upside calls, the usual state for Indian indices. A larger BF25 means fatter tails are priced in." />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Sample chains have no recorded snapshots: show the comparisons as off, not "on with nothing drawn". */}
          <div className="flex items-center gap-2" title={isSample ? "No snapshot yet: comparisons need live chains" : undefined}>
            <Switch id="ov-hour" checked={showHour && !isSample} onCheckedChange={setShowHour} disabled={isSample} aria-describedby={isSample ? "ov-sample-note" : undefined} />
            <Label htmlFor="ov-hour" className={cn("text-body-sm", isSample && "text-muted-foreground")}>1 h ago</Label>
          </div>
          <div className="flex items-center gap-2" title={isSample ? "No snapshot yet: comparisons need live chains" : undefined}>
            <Switch id="ov-yday" checked={showYday && !isSample} onCheckedChange={setShowYday} disabled={isSample} aria-describedby={isSample ? "ov-sample-note" : undefined} />
            <Label htmlFor="ov-yday" className={cn("text-body-sm", isSample && "text-muted-foreground")}>Yesterday</Label>
          </div>
          {isSample ? (
            <span id="ov-sample-note" className="text-body-sm text-muted-foreground">
              No snapshot yet: 1 h ago and Yesterday need live chains.
            </span>
          ) : null}
          <div className="flex items-center gap-2">
            <Switch id="ov-svi" checked={showSvi} onCheckedChange={setShowSvi} />
            <Label htmlFor="ov-svi" className="flex items-center gap-1 text-body-sm">
              <Spline className="h-3.5 w-3.5" aria-hidden="true" /> SVI fit
            </Label>
          </div>
        </div>

        <div className="h-[340px]" role="img" aria-label={`Implied volatility by strike for the ${formatDateIST(expiry)} expiry`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis
                type="number"
                dataKey="strike"
                domain={domain}
                allowDataOverflow
                {...axisProps}
                tickFormatter={(v: number) => formatStrike(v)}
                minTickGap={28}
              />
              <YAxis type="number" dataKey="iv" {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                cursor={tooltipCursor}
                labelFormatter={(v: number) => `Strike ${formatStrike(v)}${current ? ` · ${((v / current.F - 1) * 100).toFixed(1)}% from fwd` : ""}`}
                formatter={(v: number, name: string) => [fmtVol(v, 2), name]}
              />
              {current ? <ReferenceLine x={current.F} stroke={chartColors.spot} strokeDasharray="4 4" label={{ value: "Fwd", fill: chartColors.muted, fontSize: 11, position: "top" }} /> : null}
              {series.map((s) => (
                <Line
                  key={s.key}
                  data={s.data}
                  dataKey="iv"
                  name={s.label}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  dot={s.key === "now" ? { r: 1.5 } : false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {series.length > 0 ? (
          <div className="flex flex-wrap gap-4">
            {series.map((s) => (
              <LegendChip key={s.key} color={s.color} label={s.label} dashed={s.dashed} />
            ))}
          </div>
        ) : null}
        {!isSample && ((showHour && hour.isFetched && !hour.data) || (showYday && yday.isFetched && !yday.data)) ? (
          <p className="text-body-sm text-muted-foreground">
            {showHour && hour.isFetched && !hour.data ? "No snapshot from about an hour ago. " : ""}
            {showYday && yday.isFetched && !yday.data ? "No yesterday smile for this expiry. " : ""}
            Snapshots are recorded in this browser while the Option Chain page is open; yesterday falls back to the NSE bhavcopy when the proxy can reach it.
          </p>
        ) : null}
        {chains.length > 0 && current === null ? <DataState status="empty" emptyText="Select an expiry to view its smile" minHeight={64} /> : null}
      </CardContent>
    </Card>
  );
}
