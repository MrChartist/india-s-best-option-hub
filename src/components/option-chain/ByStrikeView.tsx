import { useEffect, useMemo, useRef } from "react";
import { useQueries } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, Crosshair, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useChainMulti } from "@/hooks/useMarketData";
import { fetchLiveOptionChain } from "@/lib/marketApi";
import type { ExpiryDate, OptionData } from "@/lib/mockData";
import { axisProps, chartColors, gridProps, legendStyle, tooltipStyle } from "@/lib/chartTheme";
import { dteLabel, formatCompactIN, formatDateIST, formatGreek, formatNumberIN, formatStrike, getLotSize } from "@/lib/options";
import { buildChainModel, type LegView } from "./chainModel";
import { ChangeText } from "./cells";
import { SourceBadge } from "./SourceBadge";

export interface ByStrikeViewProps {
  symbol: string;
  expiries: ExpiryDate[];
  strikes: number[];
  atmStrike: number;
  selectedStrike: number | null;
  onSelectStrike: (k: number) => void;
  /** Source of the main (single-expiry) chain, used to decide on the per-expiry fallback. */
  mainSource: string;
  fallbackLotSize: number;
}

interface ExpiryRow {
  expiry: string;
  dte: string;
  ce: LegView | null;
  pe: LegView | null;
  atmIv: number;
  forward: number;
}

const MAX_EXPIRIES = 6;

export function ByStrikeView({ symbol, expiries, strikes, atmStrike, selectedStrike, onSelectStrike, mainSource, fallbackLotSize }: ByStrikeViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const wanted = useMemo(() => expiries.slice(0, MAX_EXPIRIES).map((e) => e.value), [expiries]);
  const multi = useChainMulti(symbol, wanted.length > 0 ? wanted : "all");

  // Fallback: the multi-expiry endpoint answered with sample data while the single chain is live.
  const needFallback = multi.isSuccess && multi.data?.source === "sample" && mainSource !== "sample" && wanted.length > 0;
  const perExpiry = useQueries({
    queries: wanted.map((exp) => ({
      queryKey: ["chain-by-expiry", symbol, exp],
      queryFn: () => fetchLiveOptionChain(symbol, exp),
      enabled: needFallback,
      staleTime: 30000,
      retry: 0,
    })),
  });

  const fallbackReady = needFallback && perExpiry.some((q) => q.isSuccess && q.data.chain.length > 0);
  const fallbackLoading = needFallback && perExpiry.some((q) => q.isLoading);

  const dataset = useMemo((): { spot: number; chains: Array<{ expiry: string; chain: OptionData[] }>; source: string; asOf: number; stale: boolean; reason?: string } | null => {
    if (fallbackReady) {
      const ok = perExpiry.map((q, i) => ({ q, exp: wanted[i] })).filter((x) => x.q.isSuccess && x.q.data.chain.length > 0);
      const first = ok[0]?.q.data;
      return {
        spot: first?.spotPrice ?? 0,
        chains: ok.map((x) => ({ expiry: x.q.data?.expiry || x.exp, chain: x.q.data?.chain ?? [] })),
        source: first?.stale ? "cache" : first?.source ?? "nse",
        asOf: first?.asOf ?? Date.now(),
        stale: !!first?.stale,
        reason: "Fetched one expiry at a time",
      };
    }
    if (!multi.data) return null;
    return { spot: multi.data.spot, chains: multi.data.expiries, source: multi.data.source, asOf: multi.data.asOf, stale: multi.data.stale, reason: multi.data.reason };
  }, [fallbackReady, perExpiry, wanted, multi.data]);

  const strike = selectedStrike ?? atmStrike;

  const rows = useMemo((): ExpiryRow[] => {
    if (!dataset) return [];
    return dataset.chains
      .map(({ expiry, chain }) => {
        const lot = getLotSize(symbol, expiry) ?? fallbackLotSize;
        const m = buildChainModel(chain, { spot: dataset.spot, expiry, lotSize: lot, symbol });
        const r = m.rows.find((x) => x.strike === strike);
        return { expiry, dte: dteLabel(expiry), ce: r?.ce ?? null, pe: r?.pe ?? null, atmIv: m.atmIv, forward: m.forward };
      })
      .sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  }, [dataset, strike, symbol, fallbackLotSize]);

  const termData = useMemo(
    () =>
      rows.map((r) => ({
        label: formatDateIST(r.expiry).replace(/ \d{4}$/, ""),
        atmIv: Number.isFinite(r.atmIv) ? Number(r.atmIv.toFixed(2)) : null,
        ceIv: r.ce && r.ce.leg.iv > 0 ? Number(r.ce.leg.iv.toFixed(2)) : null,
        peIv: r.pe && r.pe.leg.iv > 0 ? Number(r.pe.leg.iv.toFixed(2)) : null,
      })),
    [rows],
  );

  // keep the selected strike chip in view
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-chip="${strike}"]`);
    const box = scrollRef.current;
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [strike]);

  const loading = multi.isLoading || fallbackLoading;
  const isSample = dataset?.source === "sample";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded-card border border-border bg-card p-2 shadow-card">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Scroll strikes left" onClick={() => scrollRef.current?.scrollBy({ left: -240, behavior: "smooth" })}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div ref={scrollRef} className="flex flex-1 gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]" role="listbox" aria-label="Strike">
          {strikes.map((k) => {
            const sel = k === strike;
            const atm = k === atmStrike;
            return (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={sel}
                data-chip={k}
                onClick={() => onSelectStrike(k)}
                className={cn(
                  "shrink-0 rounded-pill border px-2.5 py-1 font-num text-xs tabular-nums transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none",
                  sel ? "border-foreground bg-foreground font-bold text-background" : atm ? "border-primary/50 bg-wash-brand font-semibold text-primary-ink" : "border-border hover:bg-accent",
                )}
              >
                {formatStrike(k)}
                {atm && <span className="ml-1 text-[9px] font-bold">ATM</span>}
              </button>
            );
          })}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Scroll strikes right" onClick={() => scrollRef.current?.scrollBy({ left: 240, behavior: "smooth" })}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {dataset && <SourceBadge source={dataset.source} asOf={dataset.asOf} stale={dataset.stale} reason={dataset.reason} isLive={!dataset.stale && dataset.source !== "sample"} />}
        {loading && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading expiries…
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {symbol} {formatStrike(strike)} across {rows.length} {rows.length === 1 ? "expiry" : "expiries"}
        </span>
      </div>

      {isSample && (
        <p className="rounded-tile border border-warning/30 bg-wash-warning px-3 py-2 text-xs text-warning">
          Sample data: the multi-expiry feed is unavailable, so these prices are generated with Black-76 for illustration only.
        </p>
      )}

      <div className="overflow-hidden rounded-card border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          {loading && rows.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Crosshair className="h-8 w-8 opacity-30" />
              <p className="text-sm">No expiries to compare yet.</p>
            </div>
          ) : (
            <table className="w-full border-collapse font-num text-[12.5px]">
              <thead className="bg-card">
                <tr className="text-label uppercase">
                  <th colSpan={6} className="bg-wash-loss/50 py-1.5 text-center text-bearish">Calls</th>
                  <th className="border-x border-border bg-surface py-1.5 text-center">Expiry</th>
                  <th colSpan={6} className="bg-wash-profit/50 py-1.5 text-center text-bullish">Puts</th>
                </tr>
                <tr className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {["OI", "OI chg", "IV", "Δ", "Θ", "LTP"].map((h) => (
                    <th key={`c-${h}`} className="px-2 py-1.5 text-right">{h}</th>
                  ))}
                  <th className="border-x border-border bg-surface px-2 py-1.5 text-center">DTE</th>
                  {["LTP", "Θ", "Δ", "IV", "OI chg", "OI"].map((h) => (
                    <th key={`p-${h}`} className="px-2 py-1.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.expiry} className="border-b border-border/60 transition-colors hover:bg-accent/50">
                    <LegCells lv={r.ce} align="right" order="ce" />
                    <td className="border-x border-border bg-surface px-2 py-1.5 text-center">
                      <p className="font-semibold">{formatDateIST(r.expiry)}</p>
                      <p className="text-[10.5px] text-muted-foreground">{r.dte}</p>
                    </td>
                    <LegCells lv={r.pe} align="left" order="pe" />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {termData.length > 1 && (
        <div className="rounded-card border border-border bg-card p-3 shadow-card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-bold">IV term structure</h3>
            <Badge variant="neutral">ATM IV by expiry</Badge>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={termData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} unit="%" domain={["auto", "auto"]} width={52} />
                <RTooltip contentStyle={tooltipStyle} formatter={(v: number | string) => (typeof v === "number" ? `${v.toFixed(2)}%` : v)} />
                <Legend wrapperStyle={legendStyle} />
                <Line type="monotone" dataKey="atmIv" name="ATM IV" stroke={chartColors.iv} strokeWidth={2.25} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="ceIv" name={`${formatStrike(strike)} CE IV`} stroke={chartColors.call} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                <Line type="monotone" dataKey="peIv" name={`${formatStrike(strike)} PE IV`} stroke={chartColors.put} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Upward slope (contango) is normal; a downward slope (backwardation) often signals near-term event risk.</p>
        </div>
      )}
    </div>
  );
}

function LegCells({ lv, align, order }: { lv: LegView | null; align: "left" | "right"; order: "ce" | "pe" }) {
  const cls = cn("px-2 py-1.5 tabular-nums whitespace-nowrap", align === "right" ? "text-right" : "text-left", lv?.itm && "bg-wash-warning/45");
  const cells = lv
    ? [
        <td key="oi" className={cls}>{lv.leg.oi > 0 ? formatCompactIN(lv.leg.oi) : "—"}</td>,
        <td key="oic" className={cls}><ChangeText value={lv.leg.oiChange} compact /></td>,
        <td key="iv" className={cls}>{lv.leg.iv > 0 ? lv.leg.iv.toFixed(1) : "—"}</td>,
        <td key="d" className={cls}>{lv.leg.delta ? formatGreek("delta", lv.leg.delta) : "—"}</td>,
        <td key="t" className={cls}>{lv.leg.theta ? formatGreek("theta", lv.leg.theta) : "—"}</td>,
        <td key="l" className={cn(cls, "font-semibold")}>{lv.leg.ltp > 0 ? formatNumberIN(lv.leg.ltp, 2, { minDecimals: 2 }) : "—"}</td>,
      ]
    : Array.from({ length: 6 }, (_, i) => (
        <td key={i} className={cn(cls, "text-muted-foreground")}>—</td>
      ));
  return <>{order === "ce" ? cells : [...cells].reverse()}</>;
}
