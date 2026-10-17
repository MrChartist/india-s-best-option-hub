/**
 * Watchlist: multiple named lists, validated symbol entry with "Did you mean", sortable columns,
 * ban/near-ban badges, price flash (off under reduced motion) and a card list on small screens.
 * Without the proxy, quotes come from the labelled sample snapshot (the screener's sample
 * generator), so the list is never a column of "No quote".
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, ExternalLink, FlaskConical, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { MiniChart } from "@/components/MiniChart";
import { PageHeader } from "@/components/PageHeader";
import { ScrollRegion } from "@/components/ScrollRegion";
import { DataStatus } from "@/components/dashboard/DataState";
import { StartProxyButton } from "@/components/dashboard/NeedsLiveStrip";
import { useDashFno, useDashIndices } from "@/components/dashboard/useDashboardData";
import { sourceName, statusFrom, rangePosition } from "@/components/dashboard/dashboardModel";
import {
  MAX_LISTS,
  activeList,
  buildUniverse,
  createList,
  deleteList,
  loadWatchlists,
  nextSort,
  renameList,
  saveWatchlists,
  sortRows,
  updateActive,
  validateSymbol,
  type SortDir,
  type SortKey,
  type SortableRow,
  type WatchlistState,
} from "@/components/dashboard/watchlistModel";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useBanList } from "@/lib/screener/banList";
import { formatCompactIN, formatNumberIN, formatPct, formatSigned } from "@/lib/options";
import { cn } from "@/lib/utils";

const StockChart = lazy(() => import("@/components/StockChart").then((m) => ({ default: m.StockChart })));

interface Row extends SortableRow {
  open: number;
  high: number;
  low: number;
  kind: "stock" | "index" | "none";
  /** Quote from the labelled sample snapshot (proxy offline). */
  sample: boolean;
}

type Flash = "up" | "down";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const on = () => setReduced(!!mq?.matches);
    mq.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** Brief up/down highlight when a symbol's LTP changes. Disabled under reduced motion. */
function usePriceFlash(rows: readonly Row[], disabled: boolean): Record<string, Flash> {
  const prev = useRef(new Map<string, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flash, setFlash] = useState<Record<string, Flash>>({});
  useEffect(() => {
    const next: Record<string, Flash> = {};
    for (const r of rows) {
      const p = prev.current.get(r.symbol);
      if (p !== undefined && r.ltp > 0 && p > 0 && r.ltp !== p) next[r.symbol] = r.ltp > p ? "up" : "down";
      if (r.ltp > 0) prev.current.set(r.symbol, r.ltp);
    }
    if (disabled || Object.keys(next).length === 0) return;
    setFlash(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash({}), 800);
  }, [rows, disabled]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return flash;
}

const n2 = (v: number) => formatNumberIN(v, 2, { minDecimals: 2 });

export default function Watchlist() {
  useDocumentTitle("Watchlist");
  const [state, setState] = useState<WatchlistState>(() => loadWatchlists());
  const [saveFailed, setSaveFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "error" | "ok"; text: string; suggestions: string[] } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: SortDir }>({ key: null, dir: "desc" });
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);

  const fno = useDashFno();
  const idx = useDashIndices();
  const ban = useBanList();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setSaveFailed(!saveWatchlists(state));
  }, [state]);

  const list = activeList(state);
  const allStocks = useMemo(() => fno.data?.allStocks ?? [], [fno.data]);
  const indices = idx.data.data;

  const universe = useMemo(() => buildUniverse([...allStocks.map((s) => s.symbol), ...indices.map((i) => i.symbol)]), [allStocks, indices]);
  const banned = useMemo(() => new Set(ban.banned), [ban.banned]);
  const nearBan = useMemo(() => new Map(ban.nearBan.map((n) => [n.symbol, n.mwplPct])), [ban.nearBan]);

  const rows = useMemo<Row[]>(() => {
    const stockMap = new Map(allStocks.map((s) => [s.symbol, s]));
    const idxMap = new Map(indices.map((i) => [i.symbol, i]));
    return list.symbols.map((sym): Row => {
      const s = stockMap.get(sym);
      if (s && s.ltp > 0) {
        return { symbol: sym, ltp: s.ltp, change: s.change, changePercent: s.changePercent, open: s.open, high: s.high, low: s.low, volume: s.volume || 0, oi: s.openInterest || 0, oiChange: s.oiChange || 0, hasData: true, kind: "stock", sample: fno.isSample };
      }
      const i = idxMap.get(sym);
      if (i && i.ltp > 0) {
        return { symbol: sym, ltp: i.ltp, change: i.change, changePercent: i.changePercent, open: i.open || i.ltp, high: i.high || i.ltp, low: i.low || i.ltp, volume: 0, oi: 0, oiChange: 0, hasData: true, kind: "index", sample: idx.isSample };
      }
      return { symbol: sym, ltp: 0, change: 0, changePercent: 0, open: 0, high: 0, low: 0, volume: 0, oi: 0, oiChange: 0, hasData: false, kind: "none", sample: false };
    });
  }, [list.symbols, allStocks, indices, fno.isSample, idx.isSample]);

  const flash = usePriceFlash(rows, reducedMotion);

  const visible = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const filtered = q ? rows.filter((r) => r.symbol.includes(q)) : rows;
    return sortRows(filtered, sort.key, sort.dir);
  }, [rows, filter, sort]);

  const withData = visible.filter((r) => r.hasData);
  const adv = withData.filter((r) => r.changePercent > 0).length;
  const dec = withData.filter((r) => r.changePercent < 0).length;
  const avg = withData.length ? withData.reduce((s, r) => s + r.changePercent, 0) / withData.length : NaN;

  const loading = fno.isLoading && idx.isLoading;
  const sampleRows = rows.filter((r) => r.hasData && r.sample).length;
  const quoted = rows.filter((r) => r.hasData).length;
  const anySample = sampleRows > 0;
  // Only tag rows one by one when live and sample quotes are mixed; otherwise the page chip says it.
  const mixed = anySample && sampleRows < quoted;
  const refetchFno = fno.refetch;
  const retry = useCallback(() => {
    void refetchFno();
  }, [refetchFno]);
  const status = statusFrom({ isLoading: loading, isError: fno.isError, hasData: quoted > 0, source: anySample ? "sample" : fno.data?.source, stale: fno.data?.stale, isLive: fno.data?.isLive });

  const addSymbol = useCallback(
    (raw: string) => {
      const res = validateSymbol(raw, universe, list.symbols);
      if (!res.ok) {
        setFeedback({ tone: "error", text: res.message, suggestions: res.suggestions });
        return;
      }
      setState((s) => updateActive(s, (l) => [...l, res.symbol]));
      setInput("");
      setFeedback({ tone: "ok", text: res.renamedFrom ? `${res.renamedFrom} is now ${res.symbol}. Added ${res.symbol}.` : `Added ${res.symbol}.`, suggestions: [] });
    },
    [universe, list.symbols],
  );

  const remove = useCallback((sym: string) => setState((s) => updateActive(s, (l) => l.filter((x) => x !== sym))), []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    addSymbol(input);
  };

  const datalist = useMemo(() => {
    const q = input.trim().toUpperCase();
    if (!q) return [];
    const out: string[] = [];
    for (const s of universe) {
      if (s.startsWith(q) && !list.symbols.includes(s)) out.push(s);
      if (out.length >= 12) break;
    }
    return out.sort();
  }, [input, universe, list.symbols]);

  const cols = 11; // star, symbol, ltp, change, chg%, range, volume, oi, oi chg, chart, actions

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Star}
        eyebrow="Overview"
        title="Watchlist"
        description={
          <>
            {list.symbols.length} symbol{list.symbols.length === 1 ? "" : "s"} in “{list.name}”. Select a symbol to open its option chain.
            {saveFailed ? <span className="text-warning"> Could not save to this browser; changes last until you close the tab.</span> : null}
          </>
        }
        source={<DataStatus status={status} lastUpdated={fno.data?.asOf} source={sourceName(anySample ? "sample" : fno.data?.source)} reason={anySample ? fno.data?.reason ?? idx.data.reason : fno.data?.reason} />}
        actions={
          <form onSubmit={onSubmit} className="flex w-full flex-wrap items-start gap-2 sm:w-auto" noValidate>
            <div className="relative w-[112px] shrink-0 sm:w-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Filter symbols in this watchlist" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 w-full pl-8 sm:w-[120px]" />
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <label htmlFor="wl-add" className="sr-only">Add symbol</label>
              <Input
                id="wl-add"
                placeholder="Add symbol, e.g. INFY"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (feedback?.tone === "error") setFeedback(null);
                }}
                className="h-9 w-full uppercase placeholder:normal-case sm:w-[168px]"
                list="wl-symbols"
                autoComplete="off"
                aria-invalid={feedback?.tone === "error"}
                aria-describedby="wl-feedback"
              />
              <datalist id="wl-symbols">
                {datalist.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <Button type="submit" variant="outline" className="h-9 gap-1">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add
            </Button>
          </form>
        }
      />

      <div id="wl-feedback" aria-live="polite" className="min-h-0">
        {feedback ? (
          <div className={cn("flex flex-wrap items-center gap-2 rounded-tile border px-3 py-2 text-body-sm", feedback.tone === "error" ? "border-bearish/30 bg-wash-loss" : "border-bullish/30 bg-wash-profit")}>
            <span className={feedback.tone === "error" ? "text-bearish" : "text-bullish"}>{feedback.text}</span>
            {feedback.suggestions.length > 0 ? (
              <>
                <span className="text-muted-foreground">Did you mean</span>
                {feedback.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => addSymbol(s)} className="rounded-chip border border-border bg-card px-2 py-0.5 font-medium hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none">
                    {s}
                  </button>
                ))}
              </>
            ) : null}
            <button type="button" onClick={() => setFeedback(null)} className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none" aria-label="Dismiss message">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {anySample && list.symbols.length > 0 ? (
        <div role="status" className="flex flex-col gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-foreground">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              {mixed ? `${sampleRows} of ${quoted} quotes are sample numbers (marked “Sample”)` : "Live quotes are unavailable, so these are sample prices, changes, ranges and OI"}. They are illustrative, not market data.
              {quoted < rows.length ? ` ${rows.length - quoted} symbol${rows.length - quoted === 1 ? " has" : "s have"} no quote.` : ""}
            </span>
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2.5" onClick={retry} disabled={fno.isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", fno.isFetching && "motion-safe:animate-spin")} aria-hidden="true" /> Retry
            </Button>
            <StartProxyButton onRecovered={retry} />
          </div>
        </div>
      ) : !loading && quoted === 0 && list.symbols.length > 0 && fno.isError ? (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-bearish/30 bg-wash-loss px-3 py-2 text-body-sm text-bearish">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Quotes could not be loaded. Retry in a moment.</span>
        </div>
      ) : null}

      <ListTabs state={state} setState={setState} />

      {/* Desktop and tablet: table */}
      <Card className="hidden overflow-hidden md:block">
        <ScrollRegion label={`Watchlist “${list.name}” table`}>
          <table className="w-full min-w-[920px] text-body">
            <caption className="sr-only">Watchlist “{list.name}”. Column headers sort the table.</caption>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-label uppercase text-muted-foreground">
                <th scope="col" className="w-9 px-2 py-2"><span className="sr-only">Remove</span></th>
                <SortTh label="Symbol" k="symbol" sort={sort} setSort={setSort} align="left" />
                <SortTh label="LTP" k="ltp" sort={sort} setSort={setSort} />
                <SortTh label="Change" k="change" sort={sort} setSort={setSort} />
                <SortTh label="Chg %" k="changePercent" sort={sort} setSort={setSort} />
                <th scope="col" className="px-2 py-2 text-center font-[650]">Day range</th>
                <SortTh label="Volume" k="volume" sort={sort} setSort={setSort} />
                <SortTh label="OI" k="oi" sort={sort} setSort={setSort} />
                <SortTh label="OI chg" k="oiChange" sort={sort} setSort={setSort} />
                <th scope="col" className="px-2 py-2 text-center font-[650]">3M</th>
                <th scope="col" className="px-3 py-2 text-right font-[650]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }, (_, i) => `wl-skeleton-${i}`).map((id) => (
                    <tr key={id} className="border-b border-border">
                      <td colSpan={cols} className="px-3 py-2.5">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : visible.map((r) => (
                    <tr
                      key={r.symbol}
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-accent/40 motion-safe:transition-colors motion-safe:duration-500",
                        flash[r.symbol] === "up" && "bg-wash-profit",
                        flash[r.symbol] === "down" && "bg-wash-loss",
                      )}
                    >
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => remove(r.symbol)} className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none" aria-label={`Remove ${r.symbol} from watchlist`}>
                          <Star className="h-3.5 w-3.5 fill-warning text-warning" aria-hidden="true" />
                        </button>
                      </td>
                      <th scope="row" className="px-2 py-2 text-left font-medium">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link to={`/option-chain?symbol=${encodeURIComponent(r.symbol)}`} className="rounded-sm hover:underline focus-visible:shadow-ember focus-visible:outline-none">
                            {r.symbol}
                          </Link>
                          <BanBadge symbol={r.symbol} banned={banned} nearBan={nearBan} />
                          {r.kind === "index" ? <Badge variant="neutral">Index</Badge> : null}
                          {mixed && r.sample ? <SampleTag /> : null}
                        </span>
                      </th>
                      <td className="px-2 py-2 text-right font-num font-semibold tabular-nums">{r.hasData ? n2(r.ltp) : <span className="font-normal text-muted-foreground">No quote</span>}</td>
                      <td className={cn("px-2 py-2 text-right font-num tabular-nums", tone(r))}>{r.hasData ? formatSigned(r.change, 2) : "—"}</td>
                      <td className="px-2 py-2 text-right">{r.hasData ? <PctChip v={r.changePercent} /> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-2">{r.hasData && r.high > r.low ? <RangeBar r={r} /> : <span className="block text-center text-muted-foreground">—</span>}</td>
                      <td className="px-2 py-2 text-right font-num tabular-nums text-muted-foreground">{r.volume > 0 ? formatCompactIN(r.volume) : "—"}</td>
                      <td className="px-2 py-2 text-right font-num tabular-nums">{r.oi > 0 ? formatCompactIN(r.oi) : "—"}</td>
                      <td className={cn("px-2 py-2 text-right font-num tabular-nums", r.oiChange > 0 ? "text-bullish" : r.oiChange < 0 ? "text-bearish" : "text-muted-foreground")}>
                        {r.oiChange ? `${r.oiChange > 0 ? "+" : ""}${formatCompactIN(r.oiChange)}` : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-center">
                          <MiniChart symbol={r.symbol} width={80} height={24} disabled={r.sample} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <RowActions symbol={r.symbol} onChart={() => setChartSymbol(r.symbol)} onRemove={() => remove(r.symbol)} />
                      </td>
                    </tr>
                  ))}
              {!loading && visible.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-3 py-10 text-center text-body text-muted-foreground">
                    {filter ? "No symbols match your filter." : "This watchlist is empty. Add a symbol above to start tracking it."}
                  </td>
                </tr>
              ) : null}
            </tbody>
            {!loading && withData.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-border bg-surface text-body-sm">
                  <td colSpan={2} className="px-3 py-2 text-muted-foreground">
                    {visible.length} shown · {withData.length} with quotes
                  </td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right font-num tabular-nums">
                    <span className="text-bullish">▲ {adv}</span> / <span className="text-bearish">▼ {dec}</span>
                  </td>
                  <td className={cn("px-2 py-2 text-right font-num tabular-nums", avg > 0 ? "text-bullish" : avg < 0 ? "text-bearish" : "text-muted-foreground")}>Avg {formatPct(avg, { signed: true })}</td>
                  <td colSpan={cols - 5} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </ScrollRegion>
      </Card>

      {/* Mobile: card list */}
      <div className="space-y-2 md:hidden">
        <div className="flex items-center gap-2">
          <label htmlFor="wl-sort-mobile" className="text-body-sm text-muted-foreground">Sort</label>
          <select
            id="wl-sort-mobile"
            value={sort.key ? `${sort.key}:${sort.dir}` : ""}
            onChange={(e) => {
              const [k, dir] = e.target.value.split(":");
              setSort(k ? { key: k as SortKey, dir: dir as SortDir } : { key: null, dir: "desc" });
            }}
            className="h-9 flex-1 rounded-md border border-input bg-card px-2 text-body focus-visible:border-primary focus-visible:shadow-ember focus-visible:outline-none"
          >
            <option value="">My order</option>
            <option value="changePercent:desc">Top gainers</option>
            <option value="changePercent:asc">Top losers</option>
            <option value="symbol:asc">Symbol A–Z</option>
            <option value="volume:desc">Volume</option>
            <option value="oi:desc">Open interest</option>
          </select>
        </div>
        {loading ? (
          Array.from({ length: 4 }, (_, i) => `wl-card-skeleton-${i}`).map((id) => <Skeleton key={id} className="h-20 w-full rounded-card" />)
        ) : visible.length === 0 ? (
          <Card className="p-6 text-center text-body text-muted-foreground">{filter ? "No symbols match your filter." : "This watchlist is empty. Add a symbol above."}</Card>
        ) : (
          <ul className="space-y-2">
            {visible.map((r) => (
              <li key={r.symbol}>
                <Card className={cn("p-3 motion-safe:transition-colors motion-safe:duration-500", flash[r.symbol] === "up" && "bg-wash-profit", flash[r.symbol] === "down" && "bg-wash-loss")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link to={`/option-chain?symbol=${encodeURIComponent(r.symbol)}`} className="rounded-sm text-lead font-semibold hover:underline focus-visible:shadow-ember focus-visible:outline-none">
                          {r.symbol}
                        </Link>
                        <BanBadge symbol={r.symbol} banned={banned} nearBan={nearBan} />
                        {mixed && r.sample ? <SampleTag /> : null}
                      </div>
                      <p className="mt-0.5 font-num text-body-sm tabular-nums text-muted-foreground">
                        {r.volume > 0 ? `Vol ${formatCompactIN(r.volume)}` : null}
                        {r.oi > 0 ? ` · OI ${formatCompactIN(r.oi)}` : null}
                        {!r.hasData ? "No quote" : null}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-num text-lead font-bold tabular-nums">{r.hasData ? n2(r.ltp) : "—"}</p>
                      {r.hasData ? <PctChip v={r.changePercent} /> : null}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {r.hasData && r.high > r.low ? <div className="flex-1"><RangeBar r={r} /></div> : <div className="flex-1" />}
                    <RowActions symbol={r.symbol} onChart={() => setChartSymbol(r.symbol)} onRemove={() => remove(r.symbol)} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-body-sm text-muted-foreground">
        Volume and OI are in shares. Ban and near-ban flags (MWPL 80% or more) come from NSE{ban.source === "unavailable" ? " and are unavailable right now" : ""}. Data for education and research. Not investment advice.
      </p>

      {chartSymbol ? (
        <Suspense fallback={null}>
          <StockChart symbol={chartSymbol} asSheet open={!!chartSymbol} onOpenChange={(open) => { if (!open) setChartSymbol(null); }} />
        </Suspense>
      ) : null}
    </div>
  );
}

function SampleTag() {
  return (
    <Badge variant="warning" title="Sample quote: illustrative, not market data">
      Sample
    </Badge>
  );
}

function tone(r: Row): string {
  if (!r.hasData || r.change === 0) return "text-muted-foreground";
  return r.change > 0 ? "text-bullish" : "text-bearish";
}

function PctChip({ v }: { v: number }) {
  const up = v > 0;
  const flat = v === 0;
  return (
    <span className={cn("inline-flex rounded-chip px-1.5 py-0.5 font-num text-body-sm font-semibold tabular-nums", flat ? "bg-muted text-muted-foreground" : up ? "bg-wash-profit text-bullish" : "bg-wash-loss text-bearish")}>
      <span aria-hidden="true">{flat ? "■" : up ? "▲" : "▼"}&nbsp;</span>
      {formatPct(v, { signed: true })}
    </span>
  );
}

function RangeBar({ r }: { r: Row }) {
  const pos = rangePosition(r.ltp, r.low, r.high);
  return (
    <div className="min-w-[110px]" title={`Low ${n2(r.low)} · High ${n2(r.high)}`}>
      <div className="relative h-1.5 rounded-full bg-muted" role="meter" aria-valuemin={r.low} aria-valuemax={r.high} aria-valuenow={r.ltp} aria-label={`${r.symbol} position in day range`}>
        <div className={cn("absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-card", r.changePercent >= 0 ? "bg-bullish" : "bg-bearish")} style={{ left: `${pos}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between font-num text-micro tabular-nums text-muted-foreground">
        <span>{formatNumberIN(r.low, 0)}</span>
        <span>{formatNumberIN(r.high, 0)}</span>
      </div>
    </div>
  );
}

function BanBadge({ symbol, banned, nearBan }: { symbol: string; banned: Set<string>; nearBan: Map<string, number> }) {
  if (banned.has(symbol)) {
    return (
      <Badge variant="bearish" title="In the F&O ban period: no new positions, only square-off">
        Ban
      </Badge>
    );
  }
  const pct = nearBan.get(symbol);
  if (pct !== undefined) {
    return (
      <Badge variant="warning" title={`Market-wide position limit used: ${formatPct(pct, { decimals: 0 })}. Ban starts at 95%.`}>
        Near ban {formatPct(pct, { decimals: 0 })}
      </Badge>
    );
  }
  return null;
}

function RowActions({ symbol, onChart, onRemove }: { symbol: string; onChart: () => void; onRemove: () => void }) {
  const btn = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none";
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button type="button" className={btn} onClick={onChart} aria-label={`Open ${symbol} price chart`}>
        <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <Link to={`/option-chain?symbol=${encodeURIComponent(symbol)}`} className={btn} aria-label={`Open ${symbol} option chain`}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      <button type="button" className={cn(btn, "hover:text-destructive")} onClick={onRemove} aria-label={`Remove ${symbol}`}>
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function SortTh({ label, k, sort, setSort, align = "right" }: { label: string; k: SortKey; sort: { key: SortKey | null; dir: SortDir }; setSort: (s: { key: SortKey | null; dir: SortDir }) => void; align?: "left" | "right" }) {
  const active = sort.key === k;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={ariaSort} className={cn("px-2 py-2 font-[650]", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={() => setSort(nextSort(sort, k))}
        // Label then icon, as in the Screener table; right-aligned headers keep the label edge
        // flush with the numbers below by letting the icon sit just past it.
        className={cn("inline-flex items-center gap-1 rounded-sm uppercase hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none", active && "text-foreground", align === "right" && "-mr-4")}
      >
        {label}
        <Icon className={cn("h-3 w-3", !active && "opacity-50")} aria-hidden="true" />
      </button>
    </th>
  );
}

function ListTabs({ state, setState }: { state: WatchlistState; setState: (fn: (s: WatchlistState) => WatchlistState) => void }) {
  const [newName, setNewName] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const list = activeList(state);

  const tabsRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = state.lists.findIndex((l) => l.id === state.activeId);
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + state.lists.length) % state.lists.length;
    const id = state.lists[j].id;
    setState((s) => ({ ...s, activeId: id }));
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLButtonElement>(`[data-list-id="${id}"]`)?.focus());
    e.preventDefault();
  };

  let renameForm: ReactNode = null;
  if (renaming) {
    renameForm = (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setState((s) => renameList(s, renaming, renameText));
          setRenaming(null);
        }}
      >
        <label htmlFor="wl-rename" className="sr-only">New name</label>
        <Input id="wl-rename" autoFocus value={renameText} onChange={(e) => setRenameText(e.target.value)} maxLength={40} className="h-8 w-[160px]" onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
        <Button type="submit" size="sm" className="h-8">Save</Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setRenaming(null)}>Cancel</Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={tabsRef} role="tablist" aria-label="Watchlists" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 scrollbar-hide" onKeyDown={onKeyDown}>
        {state.lists.map((l) => {
          const selected = l.id === state.activeId;
          return (
            <button
              key={l.id}
              type="button"
              role="tab"
              data-list-id={l.id}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setState((s) => ({ ...s, activeId: l.id }))}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-tab border px-3 text-body-sm font-medium transition-colors focus-visible:shadow-ember focus-visible:outline-none",
                selected ? "border-border bg-card text-foreground shadow-card" : "border-transparent bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {l.name}
              <span className="font-num text-micro tabular-nums text-muted-foreground">{l.symbols.length}</span>
            </button>
          );
        })}
      </div>

      {renameForm}

      {!renaming ? (
        <>
          <Popover open={newOpen} onOpenChange={setNewOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1" disabled={state.lists.length >= MAX_LISTS} title={state.lists.length >= MAX_LISTS ? `Up to ${MAX_LISTS} watchlists` : undefined}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New list
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[260px] p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setState((s) => createList(s, newName));
                  setNewName("");
                  setNewOpen(false);
                }}
                className="space-y-2"
              >
                <label htmlFor="wl-new" className="text-label uppercase text-muted-foreground">List name</label>
                <Input id="wl-new" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Banks" maxLength={40} className="h-9" />
                <Button type="submit" size="sm" className="w-full">Create</Button>
              </form>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Actions for ${list.name}`}>
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameText(list.name);
                  setRenaming(list.id);
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setState((s) => updateActive(s, (l) => [...l].sort()))}>
                <ArrowUpDown className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Sort list A–Z
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={state.lists.length <= 1}
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  if (window.confirm(`Delete the watchlist “${list.name}”? This cannot be undone.`)) setState((s) => deleteList(s, list.id));
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Delete list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );
}
