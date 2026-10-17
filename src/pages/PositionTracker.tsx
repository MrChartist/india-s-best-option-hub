/**
 * Position Tracker: manually tracked option positions, repriced live.
 *
 * CMP follows the live option-chain LTP (unless overridden), IV is solved from the CMP with Black-76,
 * Greeks are shown in rupees, delta is beta-weighted into NIFTY lots, P&L is net of round-trip charges,
 * and a scenario grid / payoff chart / management hints sit on top of the same repricing.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Briefcase, CalendarClock, FlaskConical, Plus, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { formatINR, formatTimeIST, getExpiries, getLotSize, getMarketParams } from "@/lib/options";
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

function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export default function PositionTracker() {
  useDocumentTitle("Positions");
  const [positions, setPositions] = useState<TrackedPosition[]>(() => getPositions());
  const [closed, setClosed] = useState<ClosedPosition[]>(() => getClosedPositions());
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
  const niftyExpiry = useMemo(() => getExpiries("NIFTY", new Date(), 1)[0]?.date ?? "", []);
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
    if (changed) persist(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new feed data only
  }, [feeds]);

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
  const closedNet = useMemo(() => closed.reduce((a, c) => a + (c.netPnl ?? c.realizedPnl), 0), [closed]);
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

      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-display">
            <Briefcase className="h-6 w-6 text-primary-ink" aria-hidden="true" />
            Positions
          </h1>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            Track your option positions with live repricing: Greeks in rupees, NIFTY-equivalent delta, P&L after charges, what-if scenarios and plain management hints.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {latestAsOf > 0 ? <span className="text-body-sm text-muted-foreground">Quotes {formatTimeIST(latestAsOf)}</span> : null}
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
        </div>
      </header>

      {showAdd ? (
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

      {expired.length ? (
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

      {!hasPositions ? (
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
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-[76px] rounded-tile" />
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
                <TabsTrigger value="closed">Closed ({closed.length})</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="positions" className="mt-0">
              <Panel
                title="Open positions"
                subtitle="Click a CMP to override it, or lots to resize. Net P&L deducts entry and exit charges."
                bodyClassName="p-0"
                actions={
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
                }
              >
                <PositionsTable rows={rows} onSetCmp={setCmp} onResetCmp={resetCmp} onClose={closeOne} onRemove={removeOne} onEditLots={editLots} />
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

      {closed.length && !hasPositions ? (
        <Panel title="Closed positions" bodyClassName="p-0">
          <ClosedPositionsTable closed={closed} />
        </Panel>
      ) : null}

      <SettleDialog open={settleOpen} onOpenChange={setSettleOpen} expired={expired} suggestedSpots={spots} now={now} onConfirm={settle} />

      <EduNote>Greeks use Black-76 on the forward with IV solved from the CMP. Margin is an estimate; your broker's figure will differ.</EduNote>
    </div>
  );
}
