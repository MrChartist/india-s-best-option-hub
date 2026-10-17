/**
 * IV percentile panel for OI Analysis.
 *  - IV rank / percentile come from real history (India VIX for NIFTY, bhavcopy IV30 otherwise),
 *    with an "insufficient history" state instead of a made-up number.
 *  - "Skew position" (formerly shown as "IV percentile") is where ATM IV sits among today's strike IVs.
 *  - The smile is an OTM composite on a numeric strike axis.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowUpRight, Gauge, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveOptionChain } from "@/hooks/useMarketData";
import { axisProps, chartColors, gridProps, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { PCR_BANDS, calculatePCR, pcrSignal } from "@/lib/oiUtils";
import { cn } from "@/lib/utils";
import type { OptionData } from "@/lib/mockData";
import { formatNumberIN, formatStrike } from "@/lib/options";
import { REGIME_LABEL, ivRegime } from "@/lib/volatility/history";
import { buildSmile, skewPosition, smileSeries } from "@/lib/volatility/smile";
import { DerivedBadge, HelpTip, SampleBadge, StatTile } from "@/components/volatility/VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import { useIvRank } from "@/components/volatility/useVolatility";

interface Props {
  chain: OptionData[];
  spotPrice: number;
  symbol: string;
  /** ISO expiry of `chain`. When omitted, the nearest-expiry chain's expiry is used. */
  expiry?: string;
  /** Set when `chain` is the labelled sample fallback. */
  isSample?: boolean;
}

const PCR_GAUGE_MAX = 2;
const pcrPct = (v: number) => `${(Math.min(Math.max(v, 0), PCR_GAUGE_MAX) / PCR_GAUGE_MAX) * 100}%`;
const PCR_GAUGE_BANDS = [
  { from: 0, to: PCR_BANDS.low, cls: "bg-bearish/25", label: "Call heavy" },
  { from: PCR_BANDS.low, to: PCR_BANDS.high, cls: "bg-muted-foreground/15", label: "Balanced" },
  { from: PCR_BANDS.high, to: PCR_BANDS.extreme, cls: "bg-bullish/25", label: "Put heavy" },
  { from: PCR_BANDS.extreme, to: PCR_GAUGE_MAX, cls: "bg-warning/30", label: "Extreme" },
];

export function IVPercentileGauge({ chain, spotPrice, symbol, expiry, isSample }: Props) {
  const nearest = useLiveOptionChain(symbol);
  const exp = expiry || nearest.data?.expiry || "";
  const sample = isSample ?? nearest.data?.source === "sample";
  const smile = useMemo(() => (exp && chain.length ? buildSmile(chain, { spot: spotPrice, expiry: exp }) : null), [chain, spotPrice, exp]);
  const series = useMemo(() => (smile ? smileSeries(smile) : []), [smile]);
  const skew = useMemo(() => (smile ? skewPosition(smile) : null), [smile]);
  const rank = useIvRank(symbol);
  const { pcrOI: currentPCR } = useMemo(() => calculatePCR(chain), [chain]);

  // Same reading, bands and wording as the Max Pain page's PCR suite.
  const pcrSig = pcrSignal(currentPCR);
  const ivp = rank.stats.ivPercentile;
  const regime = ivRegime(rank.stats.ivRank);

  if (chain.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Gauge className="mx-auto mb-2 h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-body text-muted-foreground">IV and PCR need an option chain.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-lead">
              <Gauge className="h-4 w-4 text-primary-ink" aria-hidden="true" /> IV percentile
              <Link
                to={`/volatility?symbol=${encodeURIComponent(symbol)}`}
                className="ml-auto inline-flex items-center gap-0.5 text-body-sm font-medium text-primary-ink hover:underline focus-visible:shadow-ember focus-visible:outline-none"
              >
                Details <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0">
            <div>
              <div className="mb-1 flex justify-between text-body-sm tabular-nums text-muted-foreground" aria-hidden="true">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </div>
              <div
                className="relative h-3 overflow-hidden rounded-full bg-gradient-to-r from-bullish/30 via-warning/30 to-bearish/30"
                {...(ivp !== null
                  ? {
                      role: "meter",
                      "aria-valuemin": 0,
                      "aria-valuemax": 100,
                      "aria-valuenow": Math.round(ivp),
                      "aria-valuetext": `${formatNumberIN(ivp, 0)} of 100`,
                      "aria-label": "IV percentile",
                    }
                  : {
                      role: "img",
                      "aria-label": `IV percentile unavailable: ${rank.stats.n} days of history`,
                    })}
              >
                {ivp !== null ? <div className="absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${ivp}%` }} /> : null}
              </div>
              <div className="mt-2 text-center">
                <span className="font-num text-num-hero tabular-nums">{ivp === null ? "—" : formatNumberIN(ivp, 0)}</span>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                {rank.stats.insufficient ? (
                  <Badge variant="neutral">Insufficient history ({rank.stats.n} days)</Badge>
                ) : (
                  <Badge variant={regime === "premium-selling" ? "bearish" : regime === "premium-buying" ? "bullish" : "neutral"}>{REGIME_LABEL[regime]}</Badge>
                )}
                {rank.currentIsSample ? <SampleBadge /> : null}
              </div>
              <p className="mt-2 text-center text-body-sm text-muted-foreground">
                {rank.basisLabel}: {fmtVol(rank.current)} · {rank.historySummary}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="ATM IV" value={fmtVol(smile?.atmIv)} sub="this expiry" />
              <StatTile label="IV rank" value={rank.stats.ivRank === null ? "—" : formatNumberIN(rank.stats.ivRank, 0)} sub={rank.stats.insufficient ? `${rank.stats.n} days` : `${fmtVol(rank.stats.low)}–${fmtVol(rank.stats.high)}`} />
              <StatTile
                label="Skew position"
                value={skew && Number.isFinite(skew.position) ? formatNumberIN(skew.position, 0) : "—"}
                sub={skew && Number.isFinite(skew.min) ? `strikes ${fmtVol(skew.min)}–${fmtVol(skew.max)}` : "no smile"}
                help="Where ATM IV sits among today's strike IVs (0 = cheapest strike, 100 = richest). It describes the smile's shape, not history."
              />
              <StatTile label="RR25" value={fmtVolPts(smile?.rr25)} sub="25Δ call − put" help="25-delta risk reversal. Negative means puts are priced richer than calls." />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="p-4 pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lead">
              <Activity className="h-4 w-4 text-primary-ink" aria-hidden="true" /> {symbol} IV smile
              <span className="ml-auto flex gap-1.5">{sample ? <SampleBadge /> : <DerivedBadge title="OTM composite" />}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-[320px]" role="img" aria-label="Implied volatility by strike">
              {series.length > 1 && smile ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 12, right: 12, bottom: 0, left: -10 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis type="number" dataKey="strike" domain={["dataMin", "dataMax"]} {...axisProps} tickFormatter={(v: number) => formatStrike(v)} minTickGap={28} />
                    <YAxis {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={tooltipLabelStyle}
                      cursor={tooltipCursor}
                      labelFormatter={(v: number) => `Strike ${formatStrike(v)}`}
                      formatter={(v: number) => [fmtVol(v, 2), "IV"]}
                    />
                    <ReferenceLine x={smile.F} stroke={chartColors.spot} strokeDasharray="4 4" label={{ value: "Fwd", fill: chartColors.muted, fontSize: 11, position: "top" }} />
                    <Line type="monotone" dataKey="iv" name="IV" stroke={chartColors.iv} strokeWidth={2} dot={{ r: 1.5 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-muted-foreground">No usable IV in this chain.</p>
                </div>
              )}
            </div>
            <p className="mt-2 text-body-sm text-muted-foreground">Puts below the forward, calls above. Missing IVs are solved with Black-76 from mid prices.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-lead">
              <TrendingUp className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Put-call ratio
              <HelpTip text="PCR = total put OI ÷ total call OI for this expiry. Heavy put writing (high PCR) is often read as support; heavy call writing (low PCR) as resistance." />
            </CardTitle>
            <Badge variant={pcrSig.tone === "neutral" ? "neutral" : pcrSig.tone} className="tabular-nums" title={pcrSig.label}>
              {currentPCR > 0 ? `${currentPCR.toFixed(2)} · ` : ""}
              {pcrSig.label.split(" · ")[0]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {/* Linear 0–2 scale; ticks and bands share the marker's scale so they line up. */}
          <div className="relative h-3 overflow-hidden rounded-full" role="meter" aria-valuemin={0} aria-valuemax={PCR_GAUGE_MAX} aria-valuenow={currentPCR} aria-valuetext={`${currentPCR.toFixed(2)}, ${pcrSig.label}`} aria-label="Put-call ratio">
            {PCR_GAUGE_BANDS.map((b) => (
              <div key={b.label} className={cn("absolute inset-y-0", b.cls)} style={{ left: pcrPct(b.from), width: `calc(${pcrPct(b.to)} - ${pcrPct(b.from)})` }} />
            ))}
            {currentPCR > 0 ? <div className="absolute top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-foreground transition-all" style={{ left: pcrPct(currentPCR) }} /> : null}
          </div>
          <div className="relative mt-1 h-4 text-body-sm tabular-nums text-muted-foreground" aria-hidden="true">
            <span className="absolute left-0">0</span>
            {[PCR_BANDS.low, PCR_BANDS.high, PCR_BANDS.extreme].map((v) => (
              <span key={v} className="absolute -translate-x-1/2" style={{ left: pcrPct(v) }}>
                {v}
              </span>
            ))}
            <span className="absolute right-0">{PCR_GAUGE_MAX}+</span>
          </div>
          <p className="mt-3 text-center text-body-sm text-muted-foreground">
            {pcrSig.description}{" "}
            Context only, not a signal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
