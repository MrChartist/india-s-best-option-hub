import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download, Pause, Play, Radar, RefreshCw, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateIST, formatNumberIN, formatTimeIST, getMarketSession, istDateString } from "@/lib/options";
import { scanScreenerSymbol } from "@/lib/volatility/api";
import { SCREENER_UNIVERSE, rankByIvChange, screenerCsv, type ScreenerRow } from "@/lib/volatility/screener";
import { DerivedBadge, EmptyState, HelpTip, PanelHeader } from "./VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";

type Filter = "all" | "INDEX" | "STOCK";
type SortKey = "symbol" | "iv" | "change";

const GAP_MS = 700;
const LIVE_CYCLE_MS = 5 * 60_000;

function downloadCsv(name: string, text: string) {
  try {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download blocked */
  }
}

export interface VolScreenerProps {
  onSelectSymbol?: (symbol: string) => void;
}

export function VolScreener({ onSelectSymbol }: VolScreenerProps) {
  const [rows, setRows] = useState<Record<string, ScreenerRow>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [scanned, setScanned] = useState(0);
  const [running, setRunning] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [lastPass, setLastPass] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "change", dir: -1 });
  const runningRef = useRef(running);
  runningRef.current = running;

  // Rotating scan: two symbols at a time with a short gap, then wait for the next cycle while the market is open.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    // Both workers sleep concurrently, so track every pending timer, not just the last one.
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const queue = [...SCREENER_UNIVERSE];
    let done = 0;
    setScanned(0);
    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const t = setTimeout(() => {
          timers.delete(t);
          res();
        }, ms);
        timers.add(t);
      });
    const worker = async () => {
      while (!cancelled && queue.length) {
        const sym = queue.shift() as string;
        try {
          const row = await scanScreenerSymbol(sym);
          if (cancelled) return;
          setRows((m) => ({ ...m, [sym]: row }));
          setErrors((m) => {
            if (!(sym in m)) return m;
            const next = { ...m };
            delete next[sym];
            return next;
          });
        } catch (e) {
          if (cancelled) return;
          setErrors((m) => ({ ...m, [sym]: e instanceof Error ? e.message : "Unavailable" }));
        }
        done++;
        setScanned(done);
        await sleep(GAP_MS);
      }
    };
    (async () => {
      await Promise.all([worker(), worker()]);
      if (cancelled) return;
      setLastPass(Date.now());
      const session = getMarketSession();
      if (session === "open" || session === "pre-open") {
        await sleep(LIVE_CYCLE_MS);
        if (!cancelled && runningRef.current) setCycle((c) => c + 1);
      } else {
        setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, [running, cycle]);

  const all = useMemo(() => Object.values(rows), [rows]);
  const filtered = useMemo(() => all.filter((r) => filter === "all" || r.kind === filter), [all, filter]);
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sort.key === "symbol") return a.symbol.localeCompare(b.symbol) * sort.dir;
      const x = sort.key === "iv" ? a.iv : a.change;
      const y = sort.key === "iv" ? b.iv : b.change;
      // Rows without a change always sort last.
      if (x === null && y === null) return a.symbol.localeCompare(b.symbol);
      if (x === null) return 1;
      if (y === null) return -1;
      return (x - y) * sort.dir;
    });
  }, [filtered, sort]);
  const { gainers, losers } = useMemo(() => rankByIvChange(filtered, 5), [filtered]);
  const total = SCREENER_UNIVERSE.length;
  const errorCount = Object.keys(errors).length;
  const offline = errorCount >= Math.min(total, 6) && all.length === 0;

  const toggleSort = useCallback((key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "symbol" ? 1 : -1 })), []);
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  const exportCsv = () => downloadCsv(`iv-screener-${istDateString()}.csv`, screenerCsv(sorted, (ts) => `${formatDateIST(ts)} ${formatTimeIST(ts)}`));

  const leaderboard = (title: string, list: ScreenerRow[], up: boolean) => (
    <div className="min-w-0 rounded-tile border border-border bg-surface/50 p-3">
      <p className={`mb-2 flex items-center gap-1.5 text-label uppercase ${up ? "text-bearish" : "text-bullish"}`}>
        {up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}
        {title}
      </p>
      {list.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">{scanned < total && running ? "Scanning…" : "None yet"}</p>
      ) : (
        <ol className="space-y-1">
          {list.map((r) => (
            <li key={r.symbol} className="flex items-center justify-between gap-2 text-body">
              <button type="button" className="truncate font-medium hover:underline focus-visible:shadow-ember focus-visible:outline-none" onClick={() => onSelectSymbol?.(r.symbol)}>
                {r.symbol}
              </button>
              <span className="shrink-0 tabular-nums">
                {fmtVol(r.iv)} <span className={up ? "text-bearish" : "text-bullish"}>{fmtVolPts(r.change)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <Card>
      <PanelHeader
        icon={Radar}
        title="IV screener"
        subtitle={`ATM IV of the first expiry at least 7 days out, versus the same expiry at the previous session close (NSE bhavcopy). ${total} symbols, scanned two at a time.`}
        right={
          <>
            <DerivedBadge />
            <Button size="pill" variant="outline" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
              {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {running ? "Pause" : "Resume"}
            </Button>
            <Button size="pill" variant="outline" onClick={() => { setRunning(true); setCycle((c) => c + 1); }} disabled={running && scanned < total}>
              <RefreshCw aria-hidden="true" /> Rescan
            </Button>
            <Button size="pill" variant="outline" onClick={exportCsv} disabled={sorted.length === 0}>
              <Download aria-hidden="true" /> CSV
            </Button>
          </>
        }
      />
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1" aria-live="polite">
            <Progress value={(scanned / total) * 100} className="h-1.5 max-w-xs" aria-label="Scan progress" />
            <p className="mt-1 text-body-sm text-muted-foreground">
              {running ? `Scanning ${scanned} of ${total}` : `Scanned ${all.length} of ${total}`}
              {errorCount ? ` · ${errorCount} unavailable` : ""}
              {lastPass ? ` · last pass ${formatTimeIST(lastPass)}` : ""}
            </p>
          </div>
          <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="rounded-tab bg-muted p-0.5" aria-label="Filter">
            {(["all", "INDEX", "STOCK"] as Filter[]).map((f) => (
              <ToggleGroupItem key={f} value={f} className="h-7 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-card">
                {f === "all" ? "All" : f === "INDEX" ? "Indices" : "Stocks"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {offline ? (
          <EmptyState
            icon={WifiOff}
            title="Live chains unavailable"
            body="The screener needs the local proxy (npm run proxy) to reach NSE or Dhan. It does not show sample data."
            action={
              <Button size="sm" variant="outline" onClick={() => { setErrors({}); setRunning(true); setCycle((c) => c + 1); }}>
                <RefreshCw aria-hidden="true" /> Try again
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {leaderboard("Top IV gainers", gainers, true)}
              {leaderboard("Top IV losers", losers, false)}
            </div>
            <div className="overflow-x-auto rounded-tile border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead aria-sort={ariaSort("symbol")}>
                      <button type="button" className="uppercase focus-visible:shadow-ember focus-visible:outline-none" onClick={() => toggleSort("symbol")}>Symbol</button>
                    </TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Spot</TableHead>
                    <TableHead className="text-right" aria-sort={ariaSort("iv")}>
                      <button type="button" className="uppercase focus-visible:shadow-ember focus-visible:outline-none" onClick={() => toggleSort("iv")}>ATM IV</button>
                    </TableHead>
                    <TableHead className="text-right">Prev close</TableHead>
                    <TableHead className="text-right" aria-sort={ariaSort("change")}>
                      <button type="button" className="uppercase focus-visible:shadow-ember focus-visible:outline-none" onClick={() => toggleSort("change")}>Change</button>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        {running ? "Fetching the first chains…" : "No rows yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sorted.map((r) => (
                      <TableRow key={r.symbol}>
                        <TableCell className="font-medium">
                          <button type="button" className="hover:underline focus-visible:shadow-ember focus-visible:outline-none" onClick={() => onSelectSymbol?.(r.symbol)}>
                            {r.symbol}
                          </button>
                          {r.kind === "INDEX" ? <Badge variant="neutral" className="ml-1.5">Index</Badge> : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDateIST(r.expiry)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumberIN(r.spot, 2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtVol(r.iv, 2)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{r.prevIv === null ? "—" : fmtVol(r.prevIv, 2)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${r.change === null ? "text-muted-foreground" : r.change > 0 ? "text-bearish" : r.change < 0 ? "text-bullish" : ""}`}>
                          {fmtVolPts(r.change, 2)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
          <HelpTip text="Rising IV (red) means options got more expensive since yesterday's close; falling IV (green) means cheaper. A dash in Prev close means the bhavcopy for that day could not be fetched." />
          Comparing the same expiry on both days keeps the change free of roll effects.
        </p>
      </CardContent>
    </Card>
  );
}
