import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, ScanSearch, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceBadge } from "@/components/option-chain/SourceBadge";
import { ScreenerTable } from "@/components/screener/ScreenerTable";
import { ScreenerFilters } from "@/components/screener/ScreenerFilters";
import { PresetBar } from "@/components/screener/PresetBar";
import { BuildupQuadrant } from "@/components/screener/BuildupQuadrant";
import { BanListPanel } from "@/components/screener/BanListPanel";
import { RolloverPanel } from "@/components/screener/RolloverPanel";
import { BigMoneyPanel } from "@/components/screener/BigMoneyPanel";
import { ScanProgress } from "@/components/screener/ScanProgress";
import { FeedBadge, SampleBadge } from "@/components/screener/ScreenerUi";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { istDateString } from "@/lib/options";
import { applyFilters, rowsToCSV, sortRows, EMPTY_FILTERS, type FilterState, type SortDir, type SortKey } from "@/lib/screener/filters";
import { getPreset, presetCounts, presetRules, type PresetId } from "@/lib/screener/presets";
import { MWPL_DANGER_PCT, MWPL_NEAR_PCT } from "@/lib/screener/metrics";
import { useScreenerData } from "@/lib/screener/useScreener";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "table", label: "Screener" },
  { value: "quadrant", label: "Buildup quadrant" },
  { value: "ban", label: "Ban list & MWPL" },
  { value: "rollover", label: "Rollover & basis" },
  { value: "bigmoney", label: "Big Money" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

function downloadCSV(csv: string, filename: string) {
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download blocked by the browser */
  }
}

function Kpi({ label, value, tone, onClick, pressed }: { label: string; value: number; tone: string; onClick?: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "flex flex-col items-start rounded-tile border bg-card px-3 py-2 text-left shadow-card transition-colors duration-fast hover:border-primary/40 focus-visible:shadow-ember focus-visible:outline-none",
        pressed ? "border-primary/50" : "border-border",
      )}
    >
      <span className="text-label uppercase text-muted-foreground">{label}</span>
      <span className={cn("font-num text-title tabular-nums", tone)}>{value}</span>
    </button>
  );
}

export default function Screener() {
  useDocumentTitle("F&O Screener");
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: TabValue = TABS.some((t) => t.value === tabParam) ? (tabParam as TabValue) : "table";
  const initialPreset = getPreset(params.get("preset"));

  const [presetId, setPresetId] = useState<PresetId | null>(initialPreset?.id ?? null);
  const [filters, setFilters] = useState<FilterState>(() => (initialPreset ? { ...EMPTY_FILTERS, rules: presetRules(initialPreset) } : EMPTY_FILTERS));
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(initialPreset?.sort ?? { key: "volRatio", dir: "desc" });
  const [priority, setPriority] = useState<string[]>([]);

  const data = useScreenerData(priority);
  const { rows, isSample } = data;

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort]);
  const counts = useMemo(() => presetCounts(rows), [rows]);
  const sectors = useMemo(() => [...new Set(rows.map((r) => r.sector))], [rows]);

  // Scan the rows the user is looking at first.
  const visibleKey = sorted.slice(0, 50).map((r) => r.symbol).join(",");
  useEffect(() => {
    const t = setTimeout(() => setPriority(visibleKey ? visibleKey.split(",") : []), 400);
    return () => clearTimeout(t);
  }, [visibleKey]);

  // Apply every key in one setParams call: two calls in the same handler would each start from
  // the same render-time params and the second would overwrite the first.
  const patchParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );
  const setParam = useCallback((key: string, value: string | null) => patchParams({ [key]: value }), [patchParams]);

  const selectPreset = (id: PresetId | null) => {
    setPresetId(id);
    const p = getPreset(id);
    setFilters((f) => ({ ...f, rules: p ? presetRules(p) : [] }));
    if (p) setSort(p.sort);
    patchParams(tab !== "table" && tab !== "quadrant" ? { preset: id, tab: null } : { preset: id });
  };

  const onFiltersChange = (next: FilterState) => {
    setFilters(next);
    if (presetId && next.rules !== filters.rules) {
      setPresetId(null);
      setParam("preset", null);
    }
  };

  const onSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "symbol" ? "asc" : "desc" }));
  };

  const onExport = () => downloadCSV(rowsToCSV(sorted), `fno-screener${isSample ? "-sample" : ""}-${istDateString()}.csv`);

  const danger = useMemo(() => rows.filter((r) => !r.banned && r.mwplPct !== null && r.mwplPct >= MWPL_DANGER_PCT), [rows]);
  const nearBan = useMemo(() => rows.filter((r) => !r.banned && r.mwplPct !== null && r.mwplPct >= MWPL_NEAR_PCT), [rows]);
  const bannedCount = rows.filter((r) => r.banned).length;
  const banSample = data.ban.banMeta?.source === "sample" || data.ban.mwplMeta?.source === "sample";

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-1 sm:px-0">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-display">
            <ScanSearch className="h-6 w-6 text-primary-ink" aria-hidden="true" />
            F&amp;O Screener
          </h1>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            Every NSE F&amp;O stock and index with buildup, ATM IV, IV percentile, PCR, volume spikes, MWPL, ban list, basis and rollover in one sortable table.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <SourceBadge
              source={data.universeSource}
              asOf={data.universeAsOf}
              stale={data.universeStale}
              isLive={!isSample && !data.universeStale}
              reason={data.universeReason}
            />
            {!isSample ? <FeedBadge meta={data.ban.mwplMeta} label="MWPL" eod /> : null}
            {!isSample ? <FeedBadge meta={data.spurtsMeta} label="OI spurts" /> : null}
          </div>
        </div>
        <ScanProgress progress={data.scan.progress} enabled={!isSample} onPause={data.scan.pause} onResume={data.scan.resume} onReset={data.scan.clear} />
      </header>

      {isSample ? (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            The live F&amp;O list is unavailable{data.universeReason ? ` (${data.universeReason})` : ""}. Every number below is sample data for illustration. Start the local proxy to see market data.
          </p>
        </div>
      ) : null}

      {danger.length > 0 ? (
        <div role="status" className="flex flex-wrap items-start gap-2 rounded-tile border border-bearish/40 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Near-ban alert{banSample ? " (sample)" : ""}: </span>
            {danger
              .slice(0, 8)
              .map((r) => `${r.symbol} ${r.mwplPct?.toFixed(1)}%`)
              .join(" · ")}
            {danger.length > 8 ? ` and ${danger.length - 8} more` : ""} above {MWPL_DANGER_PCT}% of MWPL. The ban starts at 95%.
          </p>
          <button type="button" className="rounded-chip font-semibold underline-offset-2 hover:underline focus-visible:shadow-ember focus-visible:outline-none" onClick={() => setParam("tab", "ban")}>
            View ban list
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Long buildup" value={counts["long-buildup"]} tone="text-bullish" pressed={presetId === "long-buildup"} onClick={() => selectPreset(presetId === "long-buildup" ? null : "long-buildup")} />
        <Kpi label="Short buildup" value={counts["short-buildup"]} tone="text-bearish" pressed={presetId === "short-buildup"} onClick={() => selectPreset(presetId === "short-buildup" ? null : "short-buildup")} />
        <Kpi label="In ban" value={bannedCount} tone="text-bearish" onClick={() => setParam("tab", "ban")} />
        <Kpi label="Near ban ≥80%" value={nearBan.length} tone="text-warning" pressed={presetId === "near-ban"} onClick={() => selectPreset(presetId === "near-ban" ? null : "near-ban")} />
      </div>

      <Tabs value={tab} onValueChange={(t) => setParam("tab", t === "table" ? null : t)}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {(tab === "table" || tab === "quadrant") && (
          <div className="mt-4 space-y-3">
            <PresetBar active={presetId} counts={counts} onSelect={selectPreset} />
            <ScreenerFilters value={filters} onChange={onFiltersChange} sectors={sectors} matchCount={sorted.length} totalCount={rows.length} onExport={onExport} />
          </div>
        )}

        <TabsContent value="table" className="mt-4">
          <Card className="overflow-hidden">
            {isSample ? (
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <SampleBadge />
                <span className="text-body-sm text-muted-foreground">Rows are generated for illustration.</span>
              </div>
            ) : null}
            <ScreenerTable
              rows={sorted}
              sortKey={sort.key}
              sortDir={sort.dir}
              onSort={onSort}
              scanningSymbol={data.scan.progress.current?.symbol ?? null}
              onClearFilters={() => selectPreset(null)}
              isLoading={data.isLoading}
            />
          </Card>
        </TabsContent>
        <TabsContent value="quadrant" className="mt-4">
          <BuildupQuadrant rows={sorted} isSample={isSample} />
        </TabsContent>
        <TabsContent value="ban" className="mt-4">
          <BanListPanel data={data.ban} />
        </TabsContent>
        <TabsContent value="rollover" className="mt-4">
          <RolloverPanel rows={rows} isSample={isSample} />
        </TabsContent>
        <TabsContent value="bigmoney" className="mt-4">
          <BigMoneyPanel rows={rows} isSample={isSample} spurtsMeta={data.spurtsMeta} />
        </TabsContent>
      </Tabs>

      <p className="border-t border-border pt-3 text-body-sm text-muted-foreground">
        Data for education and research. Not investment advice. Prices from NSE; futures OI, basis and rollover from the NSE F&amp;O bhavcopy (end of day); MWPL and ban list from NSE
        clearing files; IV and PCR from option chains via your local proxy; HV and volume averages from daily candles. IVs are solved with Black-76 on the put-call parity forward.
      </p>
    </div>
  );
}
