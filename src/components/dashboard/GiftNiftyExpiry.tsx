/**
 * Expiry calendar for the dashboard: next NSE/BSE index expiries (weekly vs monthly, lot size,
 * countdown to 15:30 IST) and approximate MCX commodity expiries.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Factory } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useExpiryList } from "@/hooks/useMarketData";
import { formatDateIST, formatNumberIN } from "@/lib/options";
import { cn } from "@/lib/utils";
import { buildIndexExpiryRows, buildMcxExpiryRows } from "./dashboardModel";
import { DataStatus } from "./DataState";
import { useDensityClasses } from "./density";
import { useNow } from "./useNow";
import { useScrollFocusable } from "@/hooks/useScrollFocusable";

const dayMonth = (iso: string) => (iso ? formatDateIST(iso).replace(/ \d{4}$/, "") : "—");
const weekday = (iso: string) => (iso ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()] : "");

export function GiftNiftyExpiry() {
  const scrollRef0 = useScrollFocusable();
  const scrollRef1 = useScrollFocusable();
  const d = useDensityClasses();
  const now = useNow(60_000);
  const nifty = useExpiryList("NIFTY");
  const bnf = useExpiryList("BANKNIFTY");

  const rows = useMemo(
    () =>
      buildIndexExpiryRows(now, {
        NIFTY: nifty.data?.isLive ? nifty.data.expiries[0]?.value : undefined,
        BANKNIFTY: bnf.data?.isLive ? bnf.data.expiries[0]?.value : undefined,
      }),
    [now, nifty.data, bnf.data],
  );
  const mcx = useMemo(() => buildMcxExpiryRows(now), [now]);
  const anyDerived = rows.some((r) => r.basis === "derived");
  // The expiry list falls back from Dhan to the NSE option chain: name whichever answered.
  const liveSource = [...new Set([nifty.data, bnf.data].filter((x) => x?.isLive).map((x) => (x?.source === "dhan" ? "Dhan" : "NSE")))].join(" / ") || "NSE";

  return (
    <div className={cn("grid lg:grid-cols-5", d.gap)}>
      <Card className="overflow-hidden lg:col-span-3">
        <div className={cn("flex flex-wrap items-center gap-2", d.headPad)}>
          <CalendarClock className="h-4 w-4 text-warning" aria-hidden="true" />
          <h3 className="font-display text-headline">Index expiries</h3>
          <div className="ml-auto flex items-center gap-1.5">
            {anyDerived ? <DataStatus status="derived" reason="Dates follow SEBI expiry rules and the NSE/BSE holiday calendar where the live expiry list is not available." /> : <DataStatus status="live" source={liveSource} />}
          </div>
        </div>
        <div ref={scrollRef0} className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">Next expiry for each index underlying</caption>
            <thead>
              <tr className="text-left text-label text-muted-foreground [&>th]:hairline-b">
                <th scope="col" className={cn("px-4 font-semibold", d.cell)}>Contract</th>
                <th scope="col" className={cn("hidden px-2 font-semibold sm:table-cell", d.cell)}>Type</th>
                <th scope="col" className={cn("hidden px-2 text-right font-semibold sm:table-cell", d.cell)}>Lot</th>
                <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>Expiry</th>
                <th scope="col" className={cn("px-4 text-right font-semibold", d.cell)}>Time left</th>
              </tr>
            </thead>
            <tbody className="zebra-rows">
              {rows.map((r) => (
                <tr key={r.symbol} className="hover:bg-control-track">
                  <th scope="row" className={cn("px-4 text-left font-medium", d.cell)}>
                    <Link to={`/option-chain?symbol=${r.symbol}`} className="rounded-sm hover:underline focus-visible:shadow-focus focus-visible:outline-none" aria-label={`Open ${r.symbol} option chain`}>
                      {r.symbol}
                    </Link>
                    <span className="ml-1.5 text-micro text-muted-foreground">{r.exchange}</span>
                  </th>
                  <td className={cn("hidden px-2 sm:table-cell", d.cell)}>
                    <Badge variant={r.type === "weekly" ? "info" : "neutral"}>{r.type}</Badge>
                  </td>
                  <td className={cn("hidden px-2 text-right font-num tabular-nums sm:table-cell", d.cell)} title={r.verify ? "Lot size from the 2026 contract table; verify against the latest exchange circular" : undefined}>
                    {r.lotSize ? formatNumberIN(r.lotSize) : "—"}
                    {r.verify ? <span className="text-muted-foreground" aria-label="to verify">*</span> : null}
                  </td>
                  <td className={cn("px-2 text-right font-num tabular-nums text-muted-foreground", d.cell)}>
                    <time dateTime={r.date}>
                      {weekday(r.date)} {dayMonth(r.date)}
                    </time>
                  </td>
                  <td className={cn("px-4 text-right", d.cell)}>
                    <span className={cn("inline-flex rounded-chip px-1.5 py-0.5 font-num text-body-sm font-medium tabular-nums", r.urgent ? "bg-wash-loss text-bearish" : "bg-wash-warning text-warning")}>{r.dte}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-body-sm text-muted-foreground">
          NIFTY weekly: Tuesday. SENSEX weekly: Thursday. Others are monthly. Expiry at 15:30 IST. * Lot sizes from the 2026 contract table; verify with the exchange.
        </p>
      </Card>

      <Card className="overflow-hidden lg:col-span-2">
        <div className={cn("flex flex-wrap items-center gap-2", d.headPad)}>
          <Factory className="h-4 w-4 text-warning" aria-hidden="true" />
          <h3 className="font-display text-headline">MCX futures</h3>
          <div className="ml-auto">
            <DataStatus status="derived" reason="Approximate rule-based dates. MCX holidays and contract-specific changes are not applied; check the MCX contract calendar." />
          </div>
        </div>
        <div ref={scrollRef1} className="overflow-x-auto">
          <table className="w-full text-body">
            <caption className="sr-only">Approximate next MCX futures expiries</caption>
            <thead>
              <tr className="text-left text-label text-muted-foreground [&>th]:hairline-b">
                <th scope="col" className={cn("px-4 font-semibold", d.cell)}>Contract</th>
                <th scope="col" className={cn("hidden px-2 text-right font-semibold sm:table-cell", d.cell)}>Lot</th>
                <th scope="col" className={cn("px-2 text-right font-semibold", d.cell)}>Approx. expiry</th>
                <th scope="col" className={cn("px-4 text-right font-semibold", d.cell)}>Left</th>
              </tr>
            </thead>
            <tbody className="zebra-rows">
              {mcx.map((r) => (
                <tr key={r.symbol}>
                  <th scope="row" className={cn("px-4 text-left font-medium", d.cell)}>
                    {r.symbol}
                    <span className="block text-body-sm font-normal text-muted-foreground">{r.rule}</span>
                  </th>
                  <td className={cn("hidden px-2 text-right font-num tabular-nums text-muted-foreground sm:table-cell", d.cell)}>{r.unit}</td>
                  <td className={cn("px-2 text-right font-num tabular-nums", d.cell)}>
                    <time dateTime={r.date}>
                      {weekday(r.date)} {dayMonth(r.date)}
                    </time>
                  </td>
                  <td className={cn("px-4 text-right font-num text-body-sm tabular-nums text-muted-foreground", d.cell)}>{r.dte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-body-sm text-muted-foreground">Approximate dates for orientation only. Options on MCX futures usually expire a few days earlier.</p>
      </Card>
    </div>
  );
}
