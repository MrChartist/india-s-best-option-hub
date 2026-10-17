/**
 * Position Tracker: manually tracked option positions, repriced live.
 *
 * CMP follows the live option-chain LTP (unless overridden), IV is solved from the CMP with Black-76,
 * Greeks are shown in rupees, delta is beta-weighted into NIFTY lots, P&L is net of round-trip charges,
 * and a scenario grid / payoff chart / management hints sit on top of the same repricing.
 * The Paper account switch runs the same analytics on the paper-trading account's open positions
 * (read-only here; trade them in Paper Trading).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookOpenCheck, Briefcase, CalendarClock, FlaskConical, Plus, Trash2, Wallet } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/PageHeader";
import { paperPositionsAsTracked } from "@/components/positions/paperAccount";
import { AddPositionForm } from "@/components/positions/AddPositionForm";
import { ChainFeed } from "@/components/positions/ChainFeed";
import { ImportExport } from "@/components/positions/ImportExport";
import { ManagementHints } from "@/components/positions/ManagementHints";
import { PortfolioPayoff } from "@/components/positions/PortfolioPayoff";
import { PortfolioTiles, UnderlyingGreeksTable } from "@/components/positions/PortfolioGreeks";
import { ClosedPositionsTable, PositionsTable, type PositionRow } from "@/components/positions/PositionsTable";
import { ScenarioGrid } from "@/components/positions/ScenarioGrid";
import { SettleDialog } from "@/components/positions/SettleDialog";
import { EduNote, EmptyState, Panel } from "@/components/positions/ui";
import { feedKey, feedSourceToQuote, isRealFeed, spotsFromFeeds, useChainFeeds, type QuoteSource } from "@/components/positions/helpers";
import { livePosition, managementHints, quoteFromChain, summarisePortfolio, type PositionLive } from "@/components/positions/analytics";
import { useBetas } from "@/components/positions/useBetas";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useNow } from "@/hooks/useNow";
import { formatINR, formatTimeIST, getExpiries, getLotSize, getMarketParams } from "@/lib/options";
import { PAPER_KEY, loadPaper } from "@/lib/paperTrading";
import {
  applyPositionUpdate,
  clearClosedPositions,
  closePosition as storeClose,
  getClosedPositions,
  getPositions,
  isExpired,
  positionExpiryIso,
  savePositions,
  settleExpired,
  type ClosedPosition,
  type TrackedPosition,
} from "@/lib/positionStore";

/** localStorage keys positionStore writes (kept in sync with src/lib/positionStore.ts). */
const POSITIONS_STORAGE_KEYS = new Set(["optionsdesk_positions", "optionsdesk_closed_positions"]);

type Account = "manual" | "paper";
const TILE_SKELETONS = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
const ACCOUNT_KEY = "mc_positions_account";

function readAccount(param: string | null): Account {
  if (param === "paper" || param === "manual") return param;
  try {
    return localStorage.getItem(ACCOUNT_KEY) === "paper" ? "paper" : "manual";
  } catch {
    return "manual";
  }
}

export default function PositionTracker() {
  useDocumentTitle("Positions");
  const [params] = useSearchParams();
  const [account, setAccountRaw] = useState<Account>(() => readAccount(params.get("account")));
  const isPaper = account === "paper";
  const setAccount = (a: Account) => {
    setAccountRaw(a);
    try {
      localStorage.setItem(ACCOUNT_KEY, a);
    } catch {
      /* per-viewer convenience only */
    }
  };
  const [manualPositions, setPositions] = useState<TrackedPosition[]>(() => getPositions());
  const [paperPositions, setPaperPositions] = useState<TrackedPosition[]>(() => paperPositionsAsTracked(loadPaper()?.positions));
  const [paperRealised, setPaperRealised] = useState(0);
  const positions = isPaper ? paperPositions : manualPositions;
  const [closed, setClosed] = useState<ClosedPosition[]>(() => getClosedPositions());

  // Re-read the paper account when switching to it and whenever another tab saves it.
  useEffect(() => {
    if (!isPaper) return;
    const reload = () => {
      const paper = loadPaper();
      setPaperPositions(paperPositionsAsTracked(paper?.positions));
      setPaperRealised((paper?.trades ?? []).reduce((a, t) => a + t.realisedNet, 0));
    };
    reload();
    const onStorage = (e: StorageEvent) => e.key === PAPER_KEY && reload();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [isPaper]);
  // Re-read manual positions whenever another tab (or a flow outside this page) saves the store, so
  // the next persist() does not overwrite those changes with this tab's stale copy.
  useEffect(() => {
    const reload = () => {
      setPositions(getPositions());
      setClosed(getClosedPositions());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || POSITIONS_STORAGE_KEYS.has(e.key)) reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const [showAdd, setShowAdd] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [tab, setTab] = useState("positions");
  const [feeds, report] = useChainFeeds();
  const now = useNow(30_000);
  const r = getMarketParams().r;

  const persist = useCallback((next: TrackedPosition[]) => {
    setPositions(next);
    if (!savePositions(next)) toast.error("Could not save positions", { description: "Browser storage is full or blocked. Changes last until you close this tab." });
  }, []);

  // ── Feeds: one live chain per (symbol, expiry), plus NIFTY for beta weighting ──
  // Rolls to the next weekly once the current one passes 15:30 IST (`now` ticks on the shared,
  // boundary-aligned clock); the memo returns a string, so dependents only change on a rollover.
  const niftyExpiry = useMemo(() => getExpiries("NIFTY", now, 1)[0]?.date ?? "", [now]);
  const pairs = useMemo(() => {
    const set = new Map<string, { symbol: string; expiry: string }>();
    for (const p of positions) {
      const e = positionExpiryIso(p);
      set.set(feedKey(p.symbol, e), { symbol: p.symbol, expiry: e });
    }
    if (positions.length && ![...set.values()].some((x) => x.symbol === "NIFTY")) set.set(feedKey("NIFTY", niftyExpiry), { symbol: "NIFTY", expiry: niftyExpiry });
    return [...set.values()];
  }, [positions, niftyExpiry]);

  // Auto-update CMP from the live chain LTP (never from generated sample data, never over a manual price).
  useEffect(() => {
    let changed = false;
    const next = positions.map((p) => {
      if (p.cmpManual) return p;
      const f = feeds[feedKey(p.symbol, positionExpiryIso(p))];
      if (!isRealFeed(f) || !f.expiryMatch) return p;
      const q = quoteFromChain(f.chain, p.strike, p.type);
      if (!q || !(q.ltp > 0) || Math.abs(q.ltp - p.currentPrice) < 0.001) return p;
      changed = true;
      return applyPositionUpdate(p, { currentPrice: q.ltp });
    });
    if (changed) {
      if (isPaper) setPaperPositions(next);
      else persist(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new feed data only
  }, [feeds, isPaper]);

  const spotInfo = useMemo(() => spotsFromFeeds(feeds), [feeds]);
  const spots = useMemo(() => Object.fromEntries(Object.entries(spotInfo).map(([s, v]) => [s, v.spot])), [spotInfo]);
  const spotSources = useMemo(() => Object.fromEntries(Object.entries(spotInfo).map(([s, v]) => [s, { source: feedSourceToQuote(v.source, v.isLive), asOf: v.asOf }])), [spotInfo]);
  const sampleSpots = Object.entries(spotInfo).filter(([, v]) => v.source === "sample").map(([s]) => s);

  const live = useMemo(() => {
    const out: Record<string, PositionLive> = {};
    for (const p of positions) {
      const f = feeds[feedKey(p.symbol, positionExpiryIso(p))];
      const q = f?.expiryMatch ? quoteFromChain(f.chain, p.strike, p.type) : null;
      out[p.id] = livePosition(p, { spot: spots[p.symbol] ?? NaN, now, r, chainIvPct: q?.iv });
    }
    return out;
  }, [positions, feeds, spots, now, r]);

  const rows: PositionRow[] = useMemo(
    () =>
      positions.map((p) => {
        const f = feeds[feedKey(p.symbol, positionExpiryIso(p))];
        let source: QuoteSource = "entry";
        if (p.cmpManual) source = "manual";
        else if (isRealFeed(f) && f.expiryMatch && quoteFromChain(f.chain, p.strike, p.type)?.ltp) source = feedSourceToQuote(f.source, f.isLive);
        else if (Math.abs(p.currentPrice - p.entryPrice) > 1e-9) source = "delayed";
        return { p, live: live[p.id], quoteSource: source, quoteAsOf: source === "live" || source === "delayed" ? f?.asOf : undefined };
      }),
    [positions, feeds, live],
  );

  const symbols = useMemo(() => Array.from(new Set(positions.map((p) => p.symbol))), [positions]);
  const betaInfo = useBetas(symbols);
  const betas = useMemo(() => Object.fromEntries(Object.entries(betaInfo).map(([s, b]) => [s, b.beta])), [betaInfo]);
  const niftyLot = getLotSize("NIFTY", niftyExpiry) ?? 65;
  const summary = useMemo(() => summarisePortfolio(positions, live, { spots, betas, niftySpot: spots.NIFTY ?? NaN, niftyLot, now }), [positions, live, spots, betas, niftyLot, now]);
  const chains = useMemo(() => Object.fromEntries(Object.values(feeds).map((f) => [f.key, f.chain])), [feeds]);
  const hints = useMemo(() => managementHints({ positions, live, summary, chains, now, r, formatINR: (v) => formatINR(v, { decimals: 0 }) }), [positions, live, summary, chains, now, r]);
  const manualClosedNet = useMemo(() => closed.reduce((a, c) => a + (c.netPnl ?? c.realizedPnl), 0), [closed]);
  const closedNet = isPaper ? paperRealised : manualClosedNet;
  useEffect(() => {
    if (isPaper && tab === "closed") setTab("positions");
  }, [isPaper, tab]);
  const expired = useMemo(() => positions.filter((p) => isExpired(p, now)), [positions, now]);
  const loadingFeeds = pairs.some((x) => !feeds[feedKey(x.symbol, x.expiry)] || feeds[feedKey(x.symbol, x.expiry)].loading);
  const latestAsOf = Math.max(0, ...Object.values(feeds).map((f) => f.asOf || 0));

  // ── Actions ──
  const addPosition = (p: TrackedPosition) => {
    persist([...positions, p]);
    setShowAdd(false);
    toast.success(`Added ${p.action} ${p.symbol} ${p.strike} ${p.type}`);
  };
  const setCmp = (id: string, price: number) => persist(positions.map((p) => (p.id === id ? applyPositionUpdate(p, { currentPrice: price, cmpManual: true }) : p)));
  const resetCmp = (id: string) => persist(positions.map((p) => (p.id === id ? applyPositionUpdate(p, { cmpManual: false }) : p)));
  const editLots = (id: string, lots: number) => persist(positions.map((p) => (p.id === id ? applyPositionUpdate(p, { lots }) : p)));
  const removeOne = (id: string) => {
    const gone = positions.find((p) => p.id === id);
    persist(positions.filter((p) => p.id !== id));
    if (gone)
      toast("Position deleted", {
        description: `${gone.symbol} ${gone.strike} ${gone.type} removed without recording a trade.`,
        action: { label: "Undo", onClick: () => persist([...getPositions(), gone]) },
      });
  };
  const closeOne = (id: string, price: number) => {
    savePositions(positions);
    const res = storeClose(id, price);
    setPositions(res.active);
    setClosed(res.closed);
    const c = res.closed[res.closed.length - 1];
    if (c) toast.success("Position closed", { description: `Net ${formatINR(c.netPnl ?? c.realizedPnl, { decimals: 0 })} after ${formatINR(c.charges ?? 0, { decimals: 0 })} charges.` });
  };
  const settle = (s: Record<string, number>) => {
    savePositions(positions);
    const res = settleExpired(now, s);
    setPositions(res.active);
    setClosed(res.closed);
    setSettleOpen(false);
    toast.success(`Settled ${res.settled.length} position${res.settled.length === 1 ? "" : "s"} at expiry`);
  };
  const clearAll = () => {
    persist([]);
    toast("All open positions cleared");
  };

  const hasPositions = positions.length > 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      {pairs.map((x) => (
        <ChainFeed key={feedKey(x.symbol, x.expiry)} symbol={x.symbol} expiry={x.expiry} onUpdate={report} />
      ))}

      <PageHeader
        icon={Briefcase}
        eyebrow="Portfolio"
        title="Positions"
        description="Track your option positions with live repricing: Greeks in rupees, NIFTY-equivalent delta, P&L after charges, what-if scenarios and plain management hints."
        source={
          <>
            <ToggleGroup type="single" value={account} onValueChange={(v) => v && setAccount(v as Account)} aria-label="Account" size="sm" variant="outline" className="[&_svg]:size-3.5 [&>button]:gap-1.5">
              <ToggleGroupItem value="manual" aria-label="My tracked positions">
                <Briefcase aria-hidden="true" /> Tracked
              </ToggleGroupItem>
              <ToggleGroupItem value="paper" aria-label="Paper trading account">
                <Wallet aria-hidden="true" /> Paper
              </ToggleGroupItem>
            </ToggleGroup>
            {latestAsOf > 0 ? <span className="text-muted-foreground">Quotes {formatTimeIST(latestAsOf)}</span> : null}
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to={isPaper ? "/journal?source=paper" : "/journal"}>
                <BookOpenCheck aria-hidden="true" /> Journal
              </Link>
            </Button>
            {isPaper ? (
              <Button asChild size="sm">
                <Link to="/paper-trading">
                  <Wallet aria-hidden="true" /> Trade in Paper Trading
                </Link>
              </Button>
            ) : (
              <>
                <ImportExport
                  disabled={!hasPositions && closed.length === 0}
                  onImported={(res) => {
                    setPositions(res.active);
                    setClosed(res.closed);
                  }}
                />
                <Button size="sm" onClick={() => setShowAdd((s) => !s)} aria-expanded={showAdd}>
                  <Plus aria-hidden="true" /> Add position
                </Button>
              </>
            )}
          </>
        }
      />

      {isPaper ? (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-info/30 bg-wash-info px-3 py-2 text-body-sm text-foreground">
          <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <span>
            Showing your paper-trading account ({positions.length} open position{positions.length === 1 ? "" : "s"}). These are simulated trades, read-only here; exits, stops and targets live in{" "}
            <Link to="/paper-trading" className="font-semibold text-primary-ink underline-offset-4 hover:underline">Paper Trading</Link>.
          </span>
        </div>
      ) : null}

      {showAdd && !isPaper ? (
        <Panel title="New position" subtitle="Lot size and expiries follow the NSE/BSE contract calendar. Prices are per unit.">
          <AddPositionForm onAdd={addPosition} onCancel={() => setShowAdd(false)} />
        </Panel>
      ) : null}

      {sampleSpots.length ? (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-body-sm text-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            No live quotes for {sampleSpots.join(", ")}. Spots come from sample data, so Greeks, scenarios and margin are illustrative only. CMPs are not overwritten; set them by hand.
          </span>
        </div>
      ) : null}

      {expired.length && !isPaper ? (
        <div role="status" className="flex flex-col gap-2 rounded-tile border border-border bg-card px-3 py-2.5 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-body-sm">
            <CalendarClock className="h-4 w-4 text-warning" aria-hidden="true" />
            {expired.length} position{expired.length === 1 ? " has" : "s have"} passed expiry (15:30 IST).
          </span>
          <Button size="sm" variant="outline" onClick={() => setSettleOpen(true)}>
            Settle expired
          </Button>
        </div>
      ) : null}

      {!hasPositions && isPaper ? (
        <EmptyState icon={<Wallet className="h-8 w-8" aria-hidden="true" />} title="No open paper positions">
          <p>Place a trade in Paper Trading and its Greeks, scenarios, payoff and hints appear here.</p>
          <Button asChild size="sm" className="mt-3">
            <Link to="/paper-trading">Open Paper Trading</Link>
          </Button>
        </EmptyState>
      ) : !hasPositions ? (
        <EmptyState icon={<Briefcase className="h-8 w-8" aria-hidden="true" />} title="No open positions">
          <p>
            Add a position, import a JSON file, or send legs here from the <Link to="/strategy-builder" className="text-primary-ink underline-offset-4 hover:underline">Strategy Builder</Link>. Want to practise first? Try{" "}
            <Link to="/paper-trading" className="text-primary-ink underline-offset-4 hover:underline">Paper Trading</Link>.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setShowAdd(true)}>
            <Plus aria-hidden="true" /> Add your first position
          </Button>
        </EmptyState>
      ) : (
        <>
          {loadingFeeds && Object.keys(feeds).length === 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
              {TILE_SKELETONS.map((k) => (
                <Skeleton key={k} className="h-[76px] rounded-tile" />
              ))}
            </div>
          ) : (
            <PortfolioTiles summary={summary} closedNet={closedNet} />
          )}

          <Panel title="Management hints" subtitle="Rules of thumb, not instructions. Always weigh them against your plan.">
            <ManagementHints hints={hints} />
          </Panel>

          <Tabs value={tab} onValueChange={setTab} className="space-y-3">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="positions">Open ({positions.length})</TabsTrigger>
                <TabsTrigger value="greeks">Greeks by underlying</TabsTrigger>
                <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
                <TabsTrigger value="payoff">Payoff</TabsTrigger>
                {!isPaper ? <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger> : null}
              </TabsList>
            </div>

            <TabsContent value="positions" className="mt-0">
              <Panel
                title="Open positions"
                subtitle={isPaper ? "Paper account, marked to the live chain. Net P&L deducts entry and exit charges." : "Click a CMP to override it, or lots to resize. Net P&L deducts entry and exit charges."}
                bodyClassName="p-0"
                actions={
                  isPaper ? null : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-bearish">
                        <Trash2 aria-hidden="true" /> Clear all
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear all open positions?</AlertDialogTitle>
                        <AlertDialogDescription>This deletes {positions.length} open positions without recording any trades. Export first if you want a copy.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={clearAll}>Clear all</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  )
                }
              >
                <PositionsTable rows={rows} readOnly={isPaper} onSetCmp={setCmp} onResetCmp={resetCmp} onClose={closeOne} onRemove={removeOne} onEditLots={editLots} />
              </Panel>
            </TabsContent>

            <TabsContent value="greeks" className="mt-0">
              <Panel title="Greeks by underlying" subtitle="Delta in lots of each underlying and in NIFTY lots after beta weighting. Hedge = futures lots to flatten delta." bodyClassName="p-0">
                <UnderlyingGreeksTable summary={summary} betas={betaInfo} spotSources={spotSources} />
              </Panel>
            </TabsContent>

            <TabsContent value="scenarios" className="mt-0">
              <Panel title="Scenario grid" subtitle="Spot ±1/2/3% against IV ±5 points, every leg repriced with Black-76.">
                <ScenarioGrid positions={positions} live={live} spots={spots} r={r} now={now} />
              </Panel>
            </TabsContent>

            <TabsContent value="payoff" className="mt-0">
              <Panel title="Combined payoff" subtitle="T+0 uses each leg's live IV. The expiry line is the payoff at the nearest expiry.">
                <PortfolioPayoff positions={positions} live={live} spots={spots} r={r} now={now} />
              </Panel>
            </TabsContent>

            <TabsContent value="closed" className="mt-0">
              <Panel
                title="Closed positions"
                subtitle="Realised P&L after entry and exit charges (and STT on exercise for settled ITM longs)."
                bodyClassName="p-0"
                actions={
                  closed.length ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-bearish">
                          <Trash2 aria-hidden="true" /> Clear history
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Clear closed history?</AlertDialogTitle>
                          <AlertDialogDescription>This removes {closed.length} closed records from this browser.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              clearClosedPositions();
                              setClosed([]);
                            }}
                          >
                            Clear history
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null
                }
              >
                {closed.length ? <ClosedPositionsTable closed={closed} /> : <div className="p-4"><EmptyState title="No closed positions yet">Close or settle a position and it is recorded here with its charges.</EmptyState></div>}
              </Panel>
            </TabsContent>
          </Tabs>
        </>
      )}

      {closed.length && !hasPositions && !isPaper ? (
        <Panel title="Closed positions" bodyClassName="p-0">
          <ClosedPositionsTable closed={closed} />
        </Panel>
      ) : null}

      <SettleDialog open={settleOpen} onOpenChange={setSettleOpen} expired={expired} suggestedSpots={spots} now={now} onConfirm={settle} />

      <EduNote>Greeks use Black-76 on the forward with IV solved from the CMP. Margin is an estimate; your broker's figure will differ.</EduNote>
    </div>
  );
}
