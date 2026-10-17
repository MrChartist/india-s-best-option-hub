import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Layers, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { buildSampleChainData, isLiveSession, type OptionChainHookData } from "@/hooks/useMarketData";
import { fetchLiveOptionChain } from "@/lib/marketApi";
import { axisProps, barCursor, gridProps, legendStyle, tokenColor, tooltipStyle } from "@/lib/chartTheme";
import { findATMStrike, formatDateIST, modalStrikeStep, normalizeExpiry } from "@/lib/options";
import { maxLegOI, significantStrikes, windowAround } from "@/lib/oiUtils";
import type { ExpiryDate, OptionData } from "@/lib/mockData";
import { EmptyState, ModuleHeader } from "@/components/oi/shared";
import { fmtOI, fmtOIChange, fmtStrike } from "@/components/oi/format";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  /** Expiries available for the symbol (ISO values). */
  expiries: ExpiryDate[];
  /** Expiry the page is showing; its chain is passed in so it is not fetched twice. */
  primaryExpiry: string;
  primaryChain: OptionData[];
  spotPrice: number;
  /** True when the primary chain is sample data. */
  sample?: boolean;
}

type SecondaryData = Pick<OptionChainHookData, "chain" | "source" | "expiry">;

/** A secondary expiry chain, polled every 45 s in session (5 min outside). Disabled when not shown. */
function useSecondaryChain(symbol: string, expiry: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["oi-secondary-chain", symbol, expiry],
    queryFn: async (): Promise<SecondaryData> => {
      const exp = expiry ?? "";
      try {
        const r = await fetchLiveOptionChain(symbol, exp);
        if (r.chain.length > 0) return { chain: r.chain, source: r.stale ? "cache" : r.source, expiry: r.expiry || normalizeExpiry(exp) };
      } catch {
        /* fall through to the labelled sample */
      }
      const s = await buildSampleChainData(symbol, exp, "Live chain unavailable for this expiry");
      return { chain: s.chain, source: "sample", expiry: s.expiry };
    },
    enabled: enabled && !!symbol && !!expiry,
    refetchInterval: () => (isLiveSession() ? 45_000 : 300_000),
    staleTime: 30_000,
    retry: 0,
  });
}

const CE_ALPHA = [0.9, 0.55, 0.3];
const PE_ALPHA = [0.9, 0.55, 0.3];

interface Signal {
  strike: number;
  label: string;
  tone: "bullish" | "bearish";
  detail: string;
}

/**
 * Multi-expiry OI by strike. The page's expiry is always shown; up to two more can be toggled on.
 * Secondary expiries are fetched only while they are switched on.
 */
export function MultiExpiryOI({ symbol, expiries, primaryExpiry, primaryChain, spotPrice, sample }: Props) {
  const others = useMemo(() => expiries.filter((e) => e.value && e.value !== primaryExpiry).slice(0, 4), [expiries, primaryExpiry]);
  const [selected, setSelected] = useState<string[]>([]);
  const [showOIChange, setShowOIChange] = useState(false);

  // Keep only selections that still exist for this symbol, max two.
  const active = useMemo(() => selected.filter((v) => others.some((o) => o.value === v)).slice(0, 2), [selected, others]);
  const q1 = useSecondaryChain(symbol, active[0], active.length > 0);
  const q2 = useSecondaryChain(symbol, active[1], active.length > 1);

  const series = useMemo(() => {
    const list: Array<{ key: string; label: string; chain: OptionData[]; sample: boolean }> = [
      { key: "e0", label: formatDateIST(primaryExpiry || new Date()), chain: primaryChain, sample: !!sample },
    ];
    if (active[0] && q1.data) list.push({ key: "e1", label: formatDateIST(active[0]), chain: q1.data.chain, sample: q1.data.source === "sample" });
    if (active[1] && q2.data) list.push({ key: "e2", label: formatDateIST(active[1]), chain: q2.data.chain, sample: q2.data.source === "sample" });
    return list;
  }, [primaryExpiry, primaryChain, sample, active, q1.data, q2.data]);

  const data = useMemo(() => {
    const base = significantStrikes(primaryChain);
    if (base.length === 0) return [];
    const atm = findATMStrike(base, spotPrice);
    const strikes = windowAround(base.map((r) => ({ strike: r.strikePrice })), atm, 15).map((r) => r.strike);
    const maps = series.map((s) => new Map(s.chain.map((r) => [r.strikePrice, r])));
    return strikes.map((strike) => {
      const row: Record<string, number> = { strike };
      series.forEach((s, i) => {
        const o = maps[i].get(strike);
        row[`ce_${s.key}`] = o ? (showOIChange ? o.ce.oiChange : o.ce.oi) : 0;
        row[`pe_${s.key}`] = o ? (showOIChange ? o.pe.oiChange : o.pe.oi) : 0;
      });
      return row;
    });
  }, [primaryChain, spotPrice, series, showOIChange]);

  const atmStrike = useMemo(() => (primaryChain.length ? findATMStrike(primaryChain, spotPrice) : NaN), [primaryChain, spotPrice]);

  const signals = useMemo((): Signal[] => {
    const maxOI = maxLegOI(primaryChain);
    if (maxOI <= 0) return [];
    const step = modalStrikeStep(primaryChain, spotPrice);
    const cut = maxOI * 0.05;
    const out: Signal[] = [];
    for (const o of primaryChain) {
      if (Number.isFinite(atmStrike) && Math.abs(o.strikePrice - atmStrike) > step * 10) continue;
      if (o.ce.oiChange >= cut) out.push({ strike: o.strikePrice, label: "Call writing", tone: "bearish", detail: `Resistance adding: call OI ${fmtOI(o.ce.oi)}, change ${fmtOIChange(o.ce.oiChange)}` });
      if (o.pe.oiChange >= cut) out.push({ strike: o.strikePrice, label: "Put writing", tone: "bullish", detail: `Support adding: put OI ${fmtOI(o.pe.oi)}, change ${fmtOIChange(o.pe.oiChange)}` });
      if (o.ce.oiChange <= -cut) out.push({ strike: o.strikePrice, label: "Call unwinding", tone: "bullish", detail: `Resistance easing: call OI down ${fmtOI(Math.abs(o.ce.oiChange))}` });
      if (o.pe.oiChange <= -cut) out.push({ strike: o.strikePrice, label: "Put unwinding", tone: "bearish", detail: `Support easing: put OI down ${fmtOI(Math.abs(o.pe.oiChange))}` });
    }
    const mag = (s: Signal) => {
      const row = primaryChain.find((r) => r.strikePrice === s.strike);
      if (!row) return 0;
      return Math.abs(s.label.startsWith("Call") ? row.ce.oiChange : row.pe.oiChange);
    };
    return out.sort((a, b) => mag(b) - mag(a)).slice(0, 8);
  }, [primaryChain, spotPrice, atmStrike]);

  const toggle = (v: string) => setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev.filter((x) => others.some((o) => o.value === x)), v].slice(-2)));
  const loading = (active[0] && q1.isLoading) || (active[1] && q2.isLoading);
  // The page header labels a sample primary chain; flag only sample secondary expiries here.
  const anySample = !sample && series.some((s) => s.sample);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <ModuleHeader
          icon={<Layers className="h-4 w-4 text-primary-ink" />}
          title={`Multi-expiry OI ${showOIChange ? "change" : "by strike"}`}
          hint="The selected expiry is always shown. Add up to two more; they refresh every 45 seconds."
          right={
            <>
              {anySample && <Badge variant="warning">Includes sample expiry</Badge>}
              <div className="flex items-center gap-2">
                <Switch id="multi-exp-chg" checked={showOIChange} onCheckedChange={setShowOIChange} />
                <Label htmlFor="multi-exp-chg" className="text-xs text-muted-foreground">
                  OI change
                </Label>
              </div>
            </>
          }
        />
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Compare expiries">
            <span className="rounded-capsule border border-primary/50 bg-wash-brand px-3 py-1 text-xs font-medium text-primary-ink">{formatDateIST(primaryExpiry || new Date())} · shown</span>
            {others.map((e) => {
              const on = active.includes(e.value);
              return (
                <button
                  key={e.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(e.value)}
                  className={cn(
                    "rounded-capsule border px-3 py-1 text-xs font-medium transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                    on ? "border-foreground/30 bg-muted text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {e.label || formatDateIST(e.value)}
                </button>
              );
            })}
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Loading expiry" />}
          </div>
          {data.length === 0 ? (
            <EmptyState icon={<Layers className="h-5 w-5" />} title="No OI to compare" />
          ) : (
            <div className="h-[340px] sm:h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} barGap={1} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...axisProps} dataKey="strike" tickFormatter={(v: number) => fmtStrike(v)} minTickGap={16} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => fmtOI(v)} width={52} />
                  <Tooltip contentStyle={tooltipStyle} cursor={barCursor} labelFormatter={(v: number) => `Strike ${fmtStrike(v)}`} formatter={(v: number, name: string) => [showOIChange ? fmtOIChange(v) : fmtOI(v), name]} />
                  <Legend wrapperStyle={legendStyle} />
                  {showOIChange && <ReferenceLine y={0} stroke={tokenColor("muted-foreground", 0.6)} />}
                  {Number.isFinite(atmStrike) && <ReferenceLine x={atmStrike} stroke={tokenColor("chart-1")} strokeDasharray="4 4" label={{ value: "ATM", fill: tokenColor("chart-1"), fontSize: 11, position: "top" }} />}
                  {series.flatMap((s, i) => [
                    <Bar key={`ce_${s.key}`} dataKey={`ce_${s.key}`} name={`Call ${s.label}`} fill={tokenColor("chart-call", CE_ALPHA[i])} radius={[2, 2, 0, 0]} isAnimationActive={false} />,
                    <Bar key={`pe_${s.key}`} dataKey={`pe_${s.key}`} name={`Put ${s.label}`} fill={tokenColor("chart-put", PE_ALPHA[i])} radius={[2, 2, 0, 0]} isAnimationActive={false} />,
                  ])}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {signals.length > 0 && (
        <Card className="overflow-hidden">
          <ModuleHeader icon={<AlertTriangle className="h-4 w-4 text-warning" />} title="Writing and unwinding near ATM" hint="Strikes within 10 steps of ATM where today's OI change is at least 5% of the largest OI." />
          <CardContent className="p-4">
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {signals.map((s) => (
                <li key={`${s.strike}-${s.label}`} className={cn("flex items-start gap-3 rounded-tile border p-3", s.tone === "bullish" ? "border-bullish/25 bg-wash-profit/40" : "border-bearish/25 bg-wash-loss/40")}>
                  {s.tone === "bullish" ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-bullish" aria-hidden="true" /> : <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-bearish" aria-hidden="true" />}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-num text-xs font-bold">{fmtStrike(s.strike)}</span>
                      <Badge variant={s.tone}>{s.label}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
