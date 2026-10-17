import { useMemo } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Ban, CalendarDays, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { addTradingDays, formatDateIST, formatNumberIN, istDateString } from "@/lib/options";
import { banCalendar, banOutlook, banSince, nearBanList, type MwplRow } from "@/lib/screener/ban";
import type { BanData } from "@/lib/screener/banList";
import { MWPL_BAN_PCT, MWPL_DANGER_PCT, MWPL_EXIT_PCT, MWPL_NEAR_PCT, mwplStatus } from "@/lib/screener/metrics";
import { EmptyState, FeedBadge, MwplMeter, PanelHeader } from "./ScreenerUi";

function Chip({ symbol, tone }: { symbol: string; tone: "bearish" | "bullish" | "warning" | "neutral" }) {
  return <Badge variant={tone}>{symbol}</Badge>;
}

/** `pageSample`: the whole screener is in sample mode, so the page header already carries the one sample label. */
export function BanListPanel({ data, pageSample = false }: { data: BanData; pageSample?: boolean }) {
  const { ban, banMeta, mwpl, mwplMeta, history } = data;
  const banned = useMemo(() => ban?.symbols ?? [], [ban]);
  const mwplMap = useMemo(() => new Map(mwpl.map((m) => [m.symbol, m])), [mwpl]);
  const near = useMemo(() => nearBanList(mwpl, banned, MWPL_NEAR_PCT), [mwpl, banned]);
  const danger = near.filter((n) => n.mwplPct >= MWPL_DANGER_PCT);
  const entering = near.filter((n) => n.mwplPct >= MWPL_BAN_PCT);
  const exiting = banned.filter((s) => {
    const m = mwplMap.get(s);
    return m !== undefined && m.mwplPct < MWPL_EXIT_PCT;
  });
  const calendar = useMemo(() => banCalendar(history, 10).reverse(), [history]);
  const isSample = banMeta?.source === "sample";
  const nextSession = ban?.date ? addTradingDays(ban.date, 1) : addTradingDays(istDateString(), 1);

  if (data.isLoading) {
    return (
      <Card className="p-4" aria-busy="true">
        <div className="h-40 animate-pulse rounded-md bg-muted" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {danger.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-tile border border-bearish/40 bg-wash-loss px-3 py-2.5 text-body-sm text-bearish"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              {danger.length} {danger.length === 1 ? "stock is" : "stocks are"} above {MWPL_DANGER_PCT}% of MWPL
              {mwplMeta?.source === "sample" && !pageSample ? " (sample data)" : ""}
            </p>
            <p className="mt-0.5">
              {danger.map((d) => `${d.symbol} ${d.mwplPct.toFixed(1)}%`).join(" · ")}. At {MWPL_BAN_PCT}% NSE moves a
              stock into the ban period and only position-reducing trades are allowed. New positions taken in a ban
              attract penalties.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <PanelHeader
            title="In ban today"
            icon={<Ban className="h-4 w-4 text-bearish" aria-hidden="true" />}
            help={`NSE puts a stock in the F&O ban when combined OI crosses ${MWPL_BAN_PCT}% of MWPL. It stays until OI falls below ${MWPL_EXIT_PCT}% at the end of a day.`}
          >
            {pageSample ? null : <FeedBadge meta={banMeta} eod />}
            {ban?.date ? (
              <span className="text-body-sm text-muted-foreground">For {formatDateIST(ban.date)}</span>
            ) : null}
          </PanelHeader>
          {banned.length === 0 ? (
            <EmptyState title="No stocks in the ban period" body="NSE's ban list for this trade date is empty." />
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-body-sm">
                <caption className="sr-only">Stocks in the F&amp;O ban period</caption>
                <thead>
                  <tr className="border-b border-border text-label uppercase text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-left">
                      Symbol
                    </th>
                    <th scope="col" className="px-2 py-2 text-left">
                      MWPL
                    </th>
                    <th scope="col" className="px-2 py-2 text-left">
                      In ban since
                    </th>
                    <th scope="col" className="px-4 py-2 text-left">
                      Next session
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {banned.map((s) => {
                    const m = mwplMap.get(s)?.mwplPct ?? null;
                    const o = banOutlook(m, true);
                    const since = isSample ? null : banSince(s, history);
                    return (
                      <tr key={s} className="border-b border-border/60">
                        <th scope="row" className="px-4 py-2 text-left font-semibold">
                          {s}
                        </th>
                        <td className="px-2">
                          <MwplMeter pct={m} status={m === null ? "BAN" : mwplStatus(m, false)} />
                        </td>
                        <td
                          className="px-2 text-muted-foreground"
                          title="First day this device saw the stock in the ban list"
                        >
                          {since ? formatDateIST(since) : "—"}
                        </td>
                        <td className="px-4">
                          <Badge variant={o.tone}>{o.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <PanelHeader
            title="Near ban (≥80% MWPL)"
            icon={<AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />}
            help="Stocks not yet in the ban whose combined open interest uses 80% or more of the market-wide position limit. Figures come from NSE's end-of-day combined OI file."
          >
            {pageSample ? null : <FeedBadge meta={mwplMeta} eod />}
          </PanelHeader>
          {near.length === 0 ? (
            <EmptyState title="Nothing near the ban" body="No stock outside the ban is at or above 80% of MWPL." />
          ) : (
            <ul className="divide-y divide-border/60">
              {near.slice(0, 15).map((n) => {
                const o = banOutlook(n.mwplPct, false);
                const row: MwplRow | undefined = mwplMap.get(n.symbol);
                return (
                  <li key={n.symbol} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-body-sm">
                    <span className="w-28 font-semibold">{n.symbol}</span>
                    <MwplMeter pct={n.mwplPct} status={mwplStatus(n.mwplPct, false)} />
                    <Badge variant={o.tone}>{o.label}</Badge>
                    {row?.limitNextDay ? (
                      <span
                        className="ml-auto text-micro text-muted-foreground"
                        title="Limit for the next day as published by NSE"
                      >
                        Limit next day {formatNumberIN(row.limitNextDay)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <PanelHeader
          title="Ban calendar"
          icon={<CalendarDays className="h-4 w-4 text-primary-ink" aria-hidden="true" />}
          help="Entries and exits between the ban lists this device has seen, plus what the MWPL numbers point to for the next session. History builds up as you visit; it is kept only in this browser."
        />
        <div className="grid gap-4 p-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <section aria-label="Next session outlook" className="rounded-tile border border-border bg-background/60 p-3">
            <h3 className="text-label uppercase text-muted-foreground">Next session · {formatDateIST(nextSession)}</h3>
            <div className="mt-2 space-y-2 text-body-sm">
              <div>
                <p className="flex items-center gap-1 font-medium text-bearish">
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  Likely to enter
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {entering.length ? (
                    entering.map((e) => <Chip key={e.symbol} symbol={e.symbol} tone="bearish" />)
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </div>
              </div>
              <div>
                <p className="flex items-center gap-1 font-medium text-bullish">
                  <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />
                  Likely to exit (below {MWPL_EXIT_PCT}%)
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {exiting.length ? (
                    exiting.map((s) => <Chip key={s} symbol={s} tone="bullish" />)
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </div>
              </div>
              <p className="text-micro text-muted-foreground">
                Based on the latest end-of-day MWPL file. NSE publishes the final list each evening.
              </p>
            </div>
          </section>
          <section aria-label="Observed ban history">
            {isSample ? (
              <EmptyState
                title="History needs live data"
                body="The ban calendar records the real NSE list each day you open the screener. Sample data is never stored."
              />
            ) : calendar.length === 0 ? (
              <EmptyState title="No history yet" body="Come back on the next trading day to see entries and exits." />
            ) : (
              <ol className="space-y-2">
                {calendar.map((d) => (
                  <li
                    key={d.date}
                    className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-tile border border-border/60 px-3 py-2 text-body-sm"
                  >
                    <time dateTime={d.date} className="font-medium">
                      {formatDateIST(d.date)}
                    </time>
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-muted-foreground">{d.symbols.length} in ban</span>
                      {d.entered.map((s) => (
                        <Badge key={`in-${s}`} variant="bearish">
                          + {s}
                        </Badge>
                      ))}
                      {d.exited.map((s) => (
                        <Badge key={`out-${s}`} variant="bullish">
                          − {s}
                        </Badge>
                      ))}
                      {d.entered.length === 0 && d.exited.length === 0 ? (
                        <span className="text-muted-foreground">No change</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </Card>
    </div>
  );
}
