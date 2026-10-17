import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarDays, Clock, FlaskConical, Landmark, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CashFlowBars } from "@/components/participants/CashFlowBars";
import { FiiLongGauge } from "@/components/participants/FiiLongGauge";
import { MirrorChart } from "@/components/participants/MirrorChart";
import { ParticipantExplainer } from "@/components/participants/ParticipantExplainer";
import { ParticipantTable } from "@/components/participants/ParticipantTable";
import { PositioningChart } from "@/components/participants/PositioningChart";
import { DerivedBadge, EmptyState, HelpTip, Panel, PanelSkeleton, SourceBadge, Stat } from "@/components/participants/ui";
import { arrow, fmtContracts, fmtContractsFull, fmtPct, toneClass } from "@/components/participants/format";
import { useCashFlows, useParticipantsDashboard } from "@/components/participants/useParticipants";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatDateIST, formatTimeIST, isTradingDay, isValidIsoDate, nowIST } from "@/lib/options";
import { PUBLISH_WINDOW, latestExpectedDate, minPickerDate, publishState } from "@/lib/participantsApi";
import { cn } from "@/lib/utils";

const WINDOWS = ["20", "30", "60", "90"] as const;
type WindowDays = (typeof WINDOWS)[number];

function isoFromLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDateFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}


/**
 * The fetch error as a parenthetical for the sample-data banner, or "" when it only repeats what the
 * banner already says (for example "Participant data could not be loaded from NSE").
 */
function sampleReasonDetail(reason: string | null | undefined): string {
  const r = (reason ?? "").trim().replace(/\.$/, "");
  if (!r || /could not be loaded|unavailable|failed to load/i.test(r)) return "";
  return ` (reason: ${r})`;
}

export default function Participants() {
  useDocumentTitle("FII / DII Positioning");
  const [params, setParams] = useSearchParams();
  const [pickerOpen, setPickerOpen] = useState(false);

  const today = nowIST().date;
  const dateParam = params.get("date");
  const date = dateParam && isValidIsoDate(dateParam) && dateParam <= today ? dateParam : null;
  const daysParam = params.get("days");
  const days: WindowDays = (WINDOWS as readonly string[]).includes(daysParam ?? "") ? (daysParam as WindowDays) : "30";

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params);
      if (value === null) next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const q = useParticipantsDashboard(date, Number(days));
  const cash = useCashFlows();
  const d = q.data;

  const pub = publishState();
  const minDate = useMemo(() => minPickerDate(), []);
  const disabledDay = useCallback(
    (day: Date) => {
      const iso = isoFromLocalDate(day);
      return iso > today || iso < minDate || !isTradingDay(iso);
    },
    [today, minDate],
  );

  const fii = d?.views.find((v) => v.participant === "FII");
  const client = d?.views.find((v) => v.participant === "Client");
  const fiiFut = fii?.products.futIdx;

  const refresh = () => {
    void q.refetch();
    void cash.refetch();
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-1.5 py-1 sm:px-0">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-display">
            <Landmark className="h-6 w-6 text-primary-ink" aria-hidden="true" />
            FII / DII Positioning
          </h1>
          <p className="mt-1 max-w-2xl text-body text-muted-foreground">
            Who holds which side of NSE F&amp;O: participant-wise open interest and volume for FIIs, DIIs, prop desks and Clients, with FII index-futures long %, the Client vs FII mirror and cash-market flows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d ? <SourceBadge mode={d.mode} detail={d.reason} /> : null}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" aria-label={`Choose date. Showing ${date ? formatDateIST(date) : "latest"}`}>
                <CalendarDays aria-hidden="true" />
                {date ? formatDateIST(date) : "Latest"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date ? localDateFromIso(date) : d ? localDateFromIso(d.date) : undefined}
                defaultMonth={date ? localDateFromIso(date) : undefined}
                onSelect={(day) => {
                  if (!day) return;
                  const iso = isoFromLocalDate(day);
                  setParam("date", iso);
                  setPickerOpen(false);
                }}
                disabled={disabledDay}
                initialFocus
              />
              <div className="flex items-center justify-between gap-2 border-t border-border p-2">
                <p className="text-body-sm text-muted-foreground">Trading days only</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setParam("date", null);
                    setPickerOpen(false);
                  }}
                >
                  Latest
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <ToggleGroup type="single" value={days} onValueChange={(v) => v && setParam("days", v === "30" ? null : v)} aria-label="History window">
            {WINDOWS.map((w) => (
              <ToggleGroupItem key={w} value={w} size="sm" className="h-8 px-2.5 text-xs">
                {w}D
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button variant="outline" size="sm" onClick={refresh} disabled={q.isFetching} aria-label="Refresh data">
            <RefreshCw className={cn(q.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </header>

      {/* Publication status */}
      {d && (d.awaitingPublication || (!date && pub !== "published" && pub !== "non-trading-day" && d.date < today)) ? (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-info/30 bg-wash-info px-3 py-2 text-body-sm text-info">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Today&apos;s file not yet published.</span> NSE usually releases participant-wise OI between {PUBLISH_WINDOW.fromHour}:00 and {PUBLISH_WINDOW.toHour}:00 IST
            {pub === "in-window" ? " (the window is open now; refresh in a few minutes)" : ""}. Showing {formatDateIST(d.date)}.
          </p>
        </div>
      ) : null}

      {d && d.fellBack && !d.awaitingPublication && d.mode !== "sample" ? (
        <div role="status" className="flex items-start gap-2 rounded-tile border border-border bg-surface px-3 py-2 text-body-sm text-muted-foreground">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            No participant file was found for {date ? formatDateIST(date) : "that date"}. Showing the closest earlier session, {formatDateIST(d.date)}.
          </p>
        </div>
      ) : null}

      {d && d.mode === "sample" ? (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-semibold">Sample data.</span> NSE participant files could not be loaded{sampleReasonDetail(d.reason)}, so every F&amp;O number below is simulated for illustration. It is not market data. Start the proxy server and refresh to load the real files.
          </p>
        </div>
      ) : null}

      {q.isError && !d ? (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" aria-hidden="true" />}
          title="Could not load participant data"
          action={
            <Button size="sm" onClick={refresh}>
              Try again
            </Button>
          }
        >
          Something went wrong while building the page. Please try again.
        </EmptyState>
      ) : null}

      {/* Headline stats */}
      <section aria-label="Headline positioning" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="FII idx fut long %"
          value={fiiFut ? fmtPct(fiiFut.longPct, 1) : "—"}
          hint={fiiFut?.change && Number.isFinite(fiiFut.change.longPct) ? `${arrow(fiiFut.change.longPct)} ${fmtPct(fiiFut.change.longPct, 2, true).replace("%", " pts")}` : d ? formatDateIST(d.date) : "Loading"}
          tone={fiiFut?.change ? toneClass(fiiFut.change.longPct) : undefined}
        />
        <Stat label="FII idx fut net" value={fiiFut ? fmtContracts(fiiFut.net, true) : "—"} tone={fiiFut ? toneClass(fiiFut.net) : undefined} hint={fiiFut?.change ? `${arrow(fiiFut.change.net)} ${fmtContracts(fiiFut.change.net, true)} on day` : "Contracts"} />
        <Stat label="Client idx fut net" value={client ? fmtContracts(client.products.futIdx.net, true) : "—"} tone={client ? toneClass(client.products.futIdx.net) : undefined} hint={client?.products.futIdx.change ? `${arrow(client.products.futIdx.change.net)} ${fmtContracts(client.products.futIdx.change.net, true)} on day` : "Contracts"} />
        <Stat label="FII idx calls net" value={fii ? fmtContracts(fii.products.optIdxCall.net, true) : "—"} tone={fii ? toneClass(fii.products.optIdxCall.net) : undefined} hint={fii ? `Long ${fmtPct(fii.products.optIdxCall.longPct, 1)}` : undefined} />
        <Stat label="FII idx puts net" value={fii ? fmtContracts(fii.products.optIdxPut.net, true) : "—"} tone={fii ? toneClass(-fii.products.optIdxPut.net) : undefined} hint={fii ? `Long ${fmtPct(fii.products.optIdxPut.longPct, 1)}` : undefined} help="Shown red when FIIs are net long puts, since buying puts is a bearish or hedging position." />
        <Stat label="Session" value={d ? formatDateIST(d.date) : "—"} hint={d?.mode === "live" ? `File for ${d.date}` : d?.mode === "cache" ? "Saved copy" : d ? "Simulated" : "Loading"} />
      </section>

      {!d ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <PanelSkeleton height={260} label="Loading FII long gauge" />
          <PanelSkeleton height={260} label="Loading participant table" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel
              id="fii-long"
              title={
                <span className="inline-flex items-center gap-1.5">
                  FII index futures long %
                  <HelpTip text="FII long contracts ÷ (long + short) in index futures. Below 10% or above 90% is an extreme." />
                </span>
              }
              subtitle="Share of FII index-futures positions that are long"
              actions={d.historyMode === "sample" ? <SourceBadge mode="sample" /> : <DerivedBadge />}
            >
              <FiiLongGauge longPct={fiiFut?.longPct ?? NaN} changePts={fiiFut?.change?.longPct ?? null} series={d.series} date={d.date} />
            </Panel>

            <Panel id="fii-stats" title="FII summary by segment" subtitle="Open interest and day volume, contracts" actions={d.mode === "sample" ? <SourceBadge mode="sample" /> : d.fiiStatsDerived ? <DerivedBadge /> : <SourceBadge mode={d.mode} label="NSE · fii-stats" />}>
              {d.fiiStats.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">No FII row in this file.</p>
              ) : (
                <div className="-mx-4 overflow-x-auto sm:mx-0">
                  <Table className="min-w-[440px] text-body">
                    <caption className="sr-only">FII open interest and volume by segment</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-label uppercase">Segment</TableHead>
                        <TableHead className="text-right text-label uppercase">Net OI</TableHead>
                        <TableHead className="text-right text-label uppercase">Long %</TableHead>
                        <TableHead className="text-right text-label uppercase">Net vol</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.fiiStats.map((s) => {
                        const isPut = s.segment === "Index Puts";
                        return (
                          <TableRow key={s.segment}>
                            <TableCell className="whitespace-nowrap font-medium">{s.segment}</TableCell>
                            <TableCell className={cn("text-right font-num tabular-nums", toneClass(isPut ? -s.netOi : s.netOi))} title={fmtContractsFull(s.netOi, true)}>
                              {fmtContracts(s.netOi, true)}
                            </TableCell>
                            <TableCell className="text-right font-num tabular-nums">{fmtPct(s.longPct, 1)}</TableCell>
                            <TableCell className={cn("text-right font-num tabular-nums", s.netVol === null ? "text-muted-foreground" : toneClass(isPut ? -s.netVol : s.netVol))} title={s.netVol === null ? "Volume file unavailable" : fmtContractsFull(s.netVol, true)}>
                              {s.netVol === null ? "—" : fmtContracts(s.netVol, true)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="mt-2 text-body-sm text-muted-foreground">Net vol is contracts bought minus sold on the day. Put rows are coloured by direction: net long puts is bearish.</p>
            </Panel>
          </div>

          <Panel id="participant-table" title="Participant-wise positions" subtitle={`All four participants, ${formatDateIST(d.date)}${d.prevOi.length ? ` · change vs ${formatDateIST(d.prevOi[0].date)}` : ""}`} actions={<SourceBadge mode={d.mode} detail={d.reason} />}>
            <ParticipantTable views={d.views} vol={d.vol} volMode={d.volMode} oiRowsForCheck={d.oi} />
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel id="fii-options" title="FII index options" subtitle="Calls and puts, long vs short" actions={d.mode === "sample" ? <SourceBadge mode="sample" /> : <DerivedBadge />}>
              <PositioningChart views={d.views} history={d.history} initialParticipant="FII" fixed />
            </Panel>
            <Panel id="pro-positioning" title="Pro and other participants" subtitle="Prop desks by default; switch to compare" actions={d.mode === "sample" ? <SourceBadge mode="sample" /> : <DerivedBadge />}>
              <PositioningChart views={d.views} history={d.history} initialParticipant="Pro" />
            </Panel>
          </div>

          <Panel id="mirror" title="Client vs FII mirror" subtitle={`Net index positions over the last ${d.series.length} sessions`} actions={d.historyMode === "sample" ? <SourceBadge mode="sample" /> : <SourceBadge mode={d.historyMode} label={`${d.series.length}D history`} detail={`${d.storedDays} day${d.storedDays === 1 ? "" : "s"} saved in this browser. The proxy serves up to 60 days; older days come from your saved copy.`} />}>
            <MirrorChart series={d.series} />
          </Panel>
        </>
      )}

      <Panel
        id="cash-flows"
        title="Cash market: FII / DII flows"
        subtitle="Net buying (+) or selling (−) of shares, ₹ crore"
        actions={cash.data ? <SourceBadge mode={cash.data.mode} label={cash.data.mode === "live" ? "NSE · saved daily" : undefined} detail={cash.data.reason} /> : null}
      >
        {cash.isLoading ? (
          <PanelSkeleton height={240} label="Loading cash flows" />
        ) : cash.data ? (
          <>
            {cash.data.mode === "sample" ? (
              <p role="alert" className="mb-3 flex items-start gap-2 rounded-tile border border-warning/40 bg-wash-warning px-3 py-2 text-body-sm text-warning">
                <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Sample data: the FII / DII feed is unavailable and nothing is saved in this browser yet. These flows are simulated.
              </p>
            ) : null}
            <CashFlowBars days={cash.data.data} isSample={cash.data.mode === "sample"} />
          </>
        ) : (
          <EmptyState title="No cash-flow data">The FII / DII feed did not respond.</EmptyState>
        )}
      </Panel>

      <Panel id="learn" title="How to read this page">
        <ParticipantExplainer />
      </Panel>

      <footer className="space-y-1 pb-4 text-body-sm text-muted-foreground">
        <p>
          Source: NSE Clearing participant-wise OI and volume files (published after the close, usually {PUBLISH_WINDOW.fromHour}:00–{PUBLISH_WINDOW.toHour}:00 IST) and NSE provisional FII / DII cash data. Latest expected file: {formatDateIST(latestExpectedDate())}. Page checked at {formatTimeIST(new Date())}.
        </p>
        <p className="font-medium">Data for education and research. Not investment advice.</p>
      </footer>
    </div>
  );
}
