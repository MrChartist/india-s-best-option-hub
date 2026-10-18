/**
 * Trade Journal: import broker tradebooks (Zerodha, Dhan, Upstox, Angel One) or use the paper account,
 * match fills FIFO into round trips, and see what actually pays after charges: gross vs net, charges
 * as a share of gross, expectancy by strategy, DTE, weekday and time of day, tags and notes, a P&L
 * calendar and an ITR-ready F&O turnover CSV. A bundled, clearly labelled sample tradebook lets you
 * explore before importing. Everything stays in this browser.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookOpenCheck, Briefcase, FileSpreadsheet, FlaskConical, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/PageHeader";
import { ProductCrossLink } from "@/components/brand/ProductCrossLink";
import { EdgeTable } from "@/components/journal/EdgeTable";
import { EquityCurve } from "@/components/journal/EquityCurve";
import { ImportPanel } from "@/components/journal/ImportPanel";
import { TradesTable } from "@/components/journal/TradesTable";
import { TurnoverCard } from "@/components/journal/TurnoverCard";
import { PnLCalendar } from "@/components/paper/PnLCalendar";
import { signedINR } from "@/components/positions/helpers";
import { EduNote, EmptyState, Panel, STAT_GROUP, Stat } from "@/components/positions/ui";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useNow } from "@/hooks/useNow";
import {
  SAMPLE_TRADEBOOK_NOTE,
  SOURCE_LABEL,
  combineGroups,
  dailyNet,
  equityCurve,
  fillsFromPaper,
  financialYear,
  financialYears,
  JOURNAL_KEY,
  loadJournal,
  matchRoundTrips,
  mergeFills,
  mergeGroupNotes,
  parseZerodha,
  sampleTradebook,
  saveJournal,
  summarise,
  type Annotation,
  type JournalFill,
  type JournalState,
} from "@/lib/journal";
import { formatINR, formatPct, istDateString } from "@/lib/options";
import { loadPaper } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";

type View = JournalState["view"];

function sampleFills(): JournalFill[] {
  return parseZerodha(sampleTradebook()).fills.map((f) => ({ ...f, id: f.id.replace(/^zerodha:/, "sample:"), source: "sample" as const }));
}

export default function Journal() {
  useDocumentTitle("Trade Journal");
  const [params, setParams] = useSearchParams();
  const [journal, setJournal] = useState<JournalState>(loadJournal);
  // A ?source= link picks the view for this visit only; it is not saved, so opening a link never
  // changes the view the journal remembers. Picking a view with the toggle saves it as usual.
  const [sessionView, setSessionView] = useState<View | null>(() => {
    const fromUrl = params.get("source");
    return fromUrl === "paper" || fromUrl === "sample" || fromUrl === "imported" ? fromUrl : null;
  });
  // Re-match when the IST date changes, so open options past expiry are settled in a tab left open overnight.
  const today = istDateString(useNow(60_000));
  // Skip the save that would echo a state just reloaded from another tab.
  const skipSave = useRef(false);
  const [period, setPeriod] = useState("all");
  const [tab, setTab] = useState("edge");
  const [unit, setUnit] = useState<"position" | "leg">("position");
  const [paperVersion, setPaperVersion] = useState(0);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (!saveJournal(journal) && journal.updatedAt > 0) toast.error("Could not save the journal", { description: "Browser storage is full or blocked." });
  }, [journal]);

  // Another tab saved the journal (an import, a tag): reload it so this tab's next save does not
  // overwrite that work with its older copy.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== JOURNAL_KEY) return;
      skipSave.current = true;
      setJournal(loadJournal());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!params.get("source")) return;
    const next = new URLSearchParams(params);
    next.delete("source");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on arrival
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === "mc_paper_v1" && setPaperVersion((v) => v + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const view = sessionView ?? journal.view;
  const setView = (v: View) => {
    setSessionView(null);
    setJournal((j) => ({ ...j, view: v, updatedAt: Date.now() }));
  };
  const isSample = view === "sample";

  const fills = useMemo(() => {
    if (view === "sample") return sampleFills();
    if (view === "paper") return fillsFromPaper(loadPaper());
    return journal.fills;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paperVersion re-reads the paper account
  }, [view, journal.fills, paperVersion]);

  const matched = useMemo(
    () => matchRoundTrips(fills, { assumeExpiredWorthless: journal.assumeExpiredWorthless }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` re-runs the match when the IST date rolls over
    [fills, journal.assumeExpiredWorthless, today],
  );
  const years = useMemo(() => financialYears(matched.trips), [matched.trips]);
  const activePeriod = period === "all" || years.includes(period) ? period : "all";
  const trips = useMemo(() => (activePeriod === "all" ? matched.trips : matched.trips.filter((t) => financialYear(t.exitDate) === activePeriod)), [matched.trips, activePeriod]);
  // Analytics count a multi-leg structure as one trade by default; "Legs" counts every contract.
  const units = useMemo(() => (unit === "position" ? combineGroups(trips) : trips), [trips, unit]);
  const unitNotes = useMemo(() => (unit === "position" ? mergeGroupNotes(trips, journal.annotations) : journal.annotations), [trips, unit, journal.annotations]);
  const s = useMemo(() => summarise(units), [units]);
  const curve = useMemo(() => equityCurve(units), [units]);
  const daily = useMemo(() => dailyNet(trips), [trips]);
  const lastMonth = useMemo(() => trips.reduce((a, t) => (t.exitDate > a ? t.exitDate : a), "").slice(0, 7) || undefined, [trips]);
  const assumed = trips.filter((t) => t.assumedExpiry).length;
  const grossWinners = useMemo(() => units.filter((t) => t.gross > 0).length, [units]);

  const annotate = (id: string, a: Annotation) =>
    setJournal((j) => {
      const annotations = { ...j.annotations };
      if (a.tags.length || a.note) annotations[id] = a;
      else delete annotations[id];
      return { ...j, annotations, updatedAt: Date.now() };
    });

  const sourceBadge = isSample ? (
    <Badge variant="warning" title={SAMPLE_TRADEBOOK_NOTE}>
      <FlaskConical aria-hidden="true" /> Sample tradebook · not real trades
    </Badge>
  ) : view === "paper" ? (
    <Badge variant="info">
      <Wallet aria-hidden="true" /> Paper account · simulated
    </Badge>
  ) : (
    <Badge variant="neutral">
      <FileSpreadsheet aria-hidden="true" /> Imported · {journal.fills.length} fills
    </Badge>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <PageHeader
        icon={BookOpenCheck}
        title="Trade Journal"
        description="Import your broker tradebook and see what really pays after charges: round trips, expectancy by strategy, DTE, weekday and time of day, a P&L calendar and an ITR-ready turnover CSV."
        source={
          <>
            {sourceBadge}
            <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Trades to analyse" size="sm">
              <ToggleGroupItem value="imported">
                <FileSpreadsheet aria-hidden="true" /> Imported
              </ToggleGroupItem>
              <ToggleGroupItem value="paper">
                <Wallet aria-hidden="true" /> Paper
              </ToggleGroupItem>
              <ToggleGroupItem value="sample">
                <FlaskConical aria-hidden="true" /> Sample
              </ToggleGroupItem>
            </ToggleGroup>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/position-tracker">
                <Briefcase aria-hidden="true" /> Positions
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/paper-trading">
                <Wallet aria-hidden="true" /> Paper Trading
              </Link>
            </Button>
          </>
        }
      />
      <ProductCrossLink id="tradeBook" campaign="journal" lead="Want a dedicated trading journal for NSE, MCX and F&O? Try" />

      {isSample ? (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-body-sm text-foreground">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            You are looking at a generated <strong>sample tradebook</strong> (NIFTY and BANKNIFTY, July to September 2026) in Zerodha's format. None of these trades are real. Import your own tradebook below or switch to your paper account.
          </span>
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Import a tradebook" subtitle="F&O tradebook CSV from Zerodha, Dhan, Upstox or Angel One. Re-importing the same file skips duplicates.">
          <ImportPanel
            imported={journal.fills.length}
            onImport={({ result, fileName }) => {
              setJournal((j) => {
                const m = mergeFills(j.fills, result.fills);
                toast.success(`Imported ${m.added} fill${m.added === 1 ? "" : "s"} from ${fileName}`, { description: m.duplicates ? `${m.duplicates} already in the journal were skipped.` : undefined });
                return { ...j, fills: m.fills, view: "imported", updatedAt: Date.now() };
              });
              setSessionView(null);
            }}
            onClear={() => {
              setJournal((j) => {
                const ids = new Set(matchRoundTrips(j.fills).trips.map((t) => t.id));
                const annotations = Object.fromEntries(Object.entries(j.annotations).filter(([k]) => !ids.has(k)));
                return { ...j, fills: [], annotations, updatedAt: Date.now() };
              });
              toast("Imported trades cleared");
            }}
          />
        </Panel>
        <Panel title="ITR turnover" subtitle="For your F&O business income schedule.">
          <TurnoverCard trips={matched.trips} sample={isSample} />
        </Panel>
      </div>

      {!fills.length ? (
        <EmptyState icon={<BookOpenCheck className="h-8 w-8" aria-hidden="true" />} title={view === "paper" ? "No paper trades yet" : "No trades imported yet"}>
          <p>
            {view === "paper" ? (
              <>
                Place trades in <Link to="/paper-trading" className="text-primary-ink underline-offset-4 hover:underline">Paper Trading</Link> and they appear here with their charges.
              </>
            ) : (
              "Import a tradebook CSV above, or explore the journal with the sample tradebook."
            )}
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setView("sample")}>
            <FlaskConical aria-hidden="true" /> Show the sample tradebook
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="journal-period" className="text-body-sm text-muted-foreground">
                Period
              </Label>
              <Select value={activePeriod} onValueChange={setPeriod}>
                <SelectTrigger id="journal-period" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  {years.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ToggleGroup type="single" value={unit} onValueChange={(v) => v && setUnit(v as "position" | "leg")} aria-label="Count trades by" size="sm">
                <ToggleGroupItem value="position" title="A multi-leg structure (for example an iron condor) counts as one trade">
                  Per position
                </ToggleGroupItem>
                <ToggleGroupItem value="leg" title="Every contract round trip counts as a trade">
                  Per leg
                </ToggleGroupItem>
              </ToggleGroup>
              <span className="text-body-sm text-muted-foreground">
                {unit === "position" ? `${units.length} position${units.length === 1 ? "" : "s"} · ` : ""}
                {trips.length} round trip{trips.length === 1 ? "" : "s"} · {fills.length} fill{fills.length === 1 ? "" : "s"} · {SOURCE_LABEL[isSample ? "sample" : view === "paper" ? "paper" : (journal.fills[0]?.source ?? "zerodha")]}
              </span>
            </div>
            {view !== "paper" ? (
              <div className="flex items-center gap-2">
                <Switch id="journal-assume" checked={journal.assumeExpiredWorthless} onCheckedChange={(v) => setJournal((j) => ({ ...j, assumeExpiredWorthless: v, updatedAt: Date.now() }))} />
                <Label htmlFor="journal-assume" className="text-body-sm font-normal">
                  Close expired open options at ₹0
                </Label>
              </div>
            ) : null}
          </div>

          {/* Four per row at most: eight across truncated the labels and sub-text at 1440px. */}
          <div className={cn(STAT_GROUP, "grid-cols-2 sm:grid-cols-4")}>
            <Stat label="Net P&L" value={signedINR(s.net)} tone={s.net > 0 ? "bullish" : s.net < 0 ? "bearish" : "muted"} sub={`gross ${signedINR(s.gross)}`} />
            <Stat label="Charges" value={formatINR(s.charges, { decimals: 0 })} tone={s.chargesPctOfGross > 40 ? "warning" : undefined} sub={Number.isFinite(s.chargesPctOfGross) ? `${formatPct(s.chargesPctOfGross, { decimals: 1 })} of gross` : "—"} help="Brokerage, STT, exchange transaction charges, SEBI fee, stamp duty and GST, from the dated charges table. Shown as a share of absolute gross P&L." />
            <Stat label="Expectancy" value={signedINR(s.expectancy)} tone={s.expectancy > 0 ? "bullish" : s.expectancy < 0 ? "bearish" : "muted"} sub={unit === "position" ? "net per position" : "net per round trip"} help={unit === "position" ? "Average net P&L per position (a multi-leg structure counts once), after charges." : "Average net P&L per round trip, after charges."} />
            <Stat label="Win rate" value={formatPct(s.winRate, { decimals: 0 })} sub={`${s.wins} won · ${s.losses} lost`} />
            <Stat label="Avg win / loss" value={`${signedINR(s.avgWin)}`} sub={`loss ${signedINR(s.avgLoss)}`} />
            <Stat label="Profit factor" value={Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : s.profitFactor === Infinity ? "∞" : "—"} sub="wins ÷ losses, net" />
            <Stat label="Max drawdown" value={formatINR(-s.maxDrawdown, { decimals: 0 })} tone={s.maxDrawdown > 0 ? "bearish" : "muted"} sub="peak to trough, net" />
            <Stat
              label="Eaten by charges"
              value={grossWinners > 0 ? String(s.eatenByCharges) : "—"}
              tone={s.eatenByCharges > 0 ? "warning" : "muted"}
              sub={grossWinners > 0 ? `of ${grossWinners} gross winner${grossWinners === 1 ? "" : "s"}` : "no gross profit"}
              help={`${unit === "position" ? "Positions" : "Round trips"} that made money before charges but lost money after them.`}
            />
          </div>

          {assumed > 0 ? (
            <p className="text-body-sm text-muted-foreground">
              * {assumed} option position{assumed === 1 ? " had" : "s had"} no closing trade and {assumed === 1 ? "is" : "are"} assumed to have expired worthless. If one settled in the money, its real P&L differs; turn the switch off to list them as open instead.
            </p>
          ) : null}
          {matched.open.length ? (
            <p className="text-body-sm text-muted-foreground">
              {matched.open.length} lot{matched.open.length === 1 ? " is" : "s are"} still open (not in the figures): {matched.open.slice(0, 4).map((o) => `${o.direction === "LONG" ? "long" : "short"} ${o.underlying} ${o.type === "FUT" ? "FUT" : `${o.strike} ${o.type}`}`).join(", ")}
              {matched.open.length > 4 ? "…" : ""}.
            </p>
          ) : null}

          <Tabs value={tab} onValueChange={setTab} className="space-y-3">
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList>
                <TabsTrigger value="edge">Edge</TabsTrigger>
                <TabsTrigger value="curve">Gross vs net</TabsTrigger>
                <TabsTrigger value="calendar">P&L calendar</TabsTrigger>
                <TabsTrigger value="trades" title="Every contract round trip, FIFO matched">
                  Trade log ({trips.length} round trip{trips.length === 1 ? "" : "s"})
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="edge" className="mt-0">
              <Panel title="Where your edge is" subtitle="Expectancy and charges per bucket, net of every charge. Small buckets are noisy; look for patterns across many trades." bodyClassName="p-0">
                <EdgeTable trips={units} notes={unitNotes} />
              </Panel>
            </TabsContent>
            <TabsContent value="curve" className="mt-0">
              <Panel title="Cumulative P&L, gross vs net" subtitle={unit === "position" ? "Positions in the order they closed (multi-leg structures as one)." : "Contract round trips in the order they closed."}>
                <EquityCurve data={curve} />
              </Panel>
            </TabsContent>
            <TabsContent value="calendar" className="mt-0">
              <Panel title="Daily net P&L">
                <PnLCalendar daily={daily} initialMonth={lastMonth} footnote="Net P&L of round trips by the IST date they closed, after entry and exit charges." />
              </Panel>
            </TabsContent>
            <TabsContent value="trades" className="mt-0">
              <Panel title="Trade log" subtitle="FIFO round trips. Legs entered within five minutes on one underlying are grouped into a strategy. Click Tags to add tags and notes." bodyClassName="p-0">
                <TradesTable trips={trips} notes={journal.annotations} onAnnotate={annotate} />
              </Panel>
            </TabsContent>
          </Tabs>
        </>
      )}

      <EduNote>Charges are recomputed from the dated rate table with your broker's flat fee and can differ slightly from your contract notes. Tax figures are an aid, not advice.</EduNote>
    </div>
  );
}
