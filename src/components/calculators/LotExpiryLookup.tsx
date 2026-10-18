import { useMemo, useState } from "react";
import { CalendarClock, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LOT_SIZE_HISTORY, PROVISIONAL_HOLIDAY_YEARS, formatDateIST, formatNumberIN, getContractSpec, type ContractSpec } from "@/lib/options";
import { cn } from "@/lib/utils";
import { WEEKDAY_NAME, searchSpecs, upcomingExpiries } from "./calcLogic";
import { Callout, KV, Panel } from "./CalcUi";

function expiryRule(s: ContractSpec): string {
  const day = WEEKDAY_NAME[s.expiryWeekday] ?? "—";
  return s.weekly ? `Weekly ${day} + monthly last ${day}` : `Monthly, last ${day}`;
}

export default function LotExpiryLookup() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("NIFTY");
  const results = useMemo(() => searchSpecs(query), [query]);
  const spec = getContractSpec(selected);
  const expiries = useMemo(() => upcomingExpiries(selected, new Date(), 6), [selected]);
  const history = LOT_SIZE_HISTORY[selected] ?? [];
  const provisional = expiries.some((e) => PROVISIONAL_HOLIDAY_YEARS.includes(Number(e.date.slice(0, 4))));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Panel title="Contract specifications" description="Lot size, strike step, freeze quantity and expiry rule for NSE and BSE F&O contracts.">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search symbol or company, e.g. RELIANCE or bank" className="pl-9" aria-label="Search contracts" />
        </div>
        <p className="mt-2 text-body-sm text-muted-foreground" aria-live="polite">
          {results.length} contract{results.length === 1 ? "" : "s"}
        </p>

        {results.length === 0 ? (
          <p className="mt-4 text-body text-muted-foreground">No contract matches “{query}”. Only F&O-eligible symbols are listed.</p>
        ) : (
          <div className="mt-2 max-h-[560px] overflow-auto rounded-md border border-separator">
            <table className="w-full text-body">
              <caption className="sr-only">Contract specifications</caption>
              <thead className="sticky top-0 z-10 bg-surface [&_th]:shadow-[inset_0_calc(-1*var(--hairline))_0_hsl(var(--separator-strong))]">
                <tr className="hairline-b text-left">
                  <th scope="col">Symbol</th>
                  <th scope="col" className="text-right">Lot</th>
                  <th scope="col" className="hidden text-right sm:table-cell">Step</th>
                  <th scope="col" className="hidden text-right md:table-cell">Freeze</th>
                  <th scope="col">Expiry</th>
                </tr>
              </thead>
              <tbody className="zebra-rows">
                {results.map((s) => {
                  const active = s.symbol === selected;
                  return (
                    <tr
                      key={s.symbol}
                      tabIndex={0}
                      aria-current={active ? "true" : undefined}
                      onClick={() => setSelected(s.symbol)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected(s.symbol);
                        }
                      }}
                      className={cn("cursor-default transition-colors duration-fast hover:bg-control-track focus-visible:bg-control-track focus-visible:outline-none", active && "bg-selection-unfocused hover:bg-selection-unfocused [&>td:first-child]:shadow-[inset_2px_0_0_hsl(var(--primary))]")}
                    >
                      <td className="py-1.5">
                        <div className="font-semibold">{s.symbol}</div>
                        <div className="truncate text-body-sm text-muted-foreground">{s.name ?? (s.kind === "INDEX" ? "Index" : "Stock")}</div>
                      </td>
                      <td className="py-1.5 text-right">{formatNumberIN(s.lotSize)}</td>
                      <td className="hidden py-1.5 text-right sm:table-cell">{formatNumberIN(s.strikeStep, 2)}</td>
                      <td className="hidden py-1.5 text-right md:table-cell">{s.freezeQty ? formatNumberIN(s.freezeQty) : "—"}</td>
                      <td className="py-1.5">
                        <Badge variant={s.weekly ? "info" : "neutral"}>{s.weekly ? "Weekly" : "Monthly"}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="min-w-0 space-y-4 lg:sticky lg:top-3 lg:self-start">
        {spec ? (
          <>
            <Panel
              title={spec.symbol}
              description={spec.name}
              actions={
                <>
                  <Badge variant="outline">{spec.exchange}</Badge>
                  <Badge variant={spec.kind === "INDEX" ? "default" : "neutral"}>{spec.kind === "INDEX" ? "Index" : "Stock"}</Badge>
                </>
              }
            >
              <div className="divide-y divide-separator">
                <KV k="Lot size" v={`${formatNumberIN(spec.lotSize)} units`} strong />
                <KV k="Effective from" v={formatDateIST(spec.effectiveFrom)} />
                <KV k="Strike step" v={formatNumberIN(spec.strikeStep, 2)} />
                <KV k="Tick size" v={`₹${formatNumberIN(spec.tickSize, 2)}`} />
                <KV k="Freeze quantity" v={spec.freezeQty ? `${formatNumberIN(spec.freezeQty)} (${formatNumberIN(Math.floor(spec.freezeQty / spec.lotSize))} lots)` : "—"} />
                <KV k="Expiry rule" v={expiryRule(spec)} />
              </div>
              {history.length > 1 ? (
                <div className="mt-3">
                  <div className="text-label text-muted-foreground">Lot size history</div>
                  <ol className="mt-1 flex flex-wrap gap-1.5">
                    {history.map((h) => (
                      <li key={h.from}>
                        <Badge variant={h.lotSize === spec.lotSize && h.from === spec.effectiveFrom ? "default" : "neutral"}>
                          {formatNumberIN(h.lotSize)} from {formatDateIST(h.from)}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {spec.verify ? <p className="mt-3 text-body-sm text-muted-foreground">Exchanges revise lot sizes periodically. Verify against the latest NSE/BSE circular.</p> : null}
            </Panel>

            <Panel title="Next 6 expiries" actions={<CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}>
              {expiries.length === 0 ? (
                <p className="text-body text-muted-foreground">No upcoming expiries found.</p>
              ) : (
                <ul className="divide-y divide-separator overflow-hidden rounded-md border border-separator">
                  {expiries.map((e) => (
                    <li key={e.date} className={cn("px-3 py-2", e.shiftedFrom && "bg-wash-warning")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-num font-semibold tabular-nums">{formatDateIST(e.date)}</span>
                        <Badge variant={e.type === "monthly" ? "default" : "info"}>{e.type === "monthly" ? "Monthly" : "Weekly"}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap justify-between gap-x-3 text-body-sm text-muted-foreground">
                        <span>
                          {e.dte === 0 ? "Today" : `${e.dte} day${e.dte === 1 ? "" : "s"}`} · {e.tradingDte} trading
                        </span>
                        {e.lotSize && e.lotSize !== spec.lotSize ? <span>Lot {formatNumberIN(e.lotSize)}</span> : null}
                      </div>
                      {e.shiftedFrom ? (
                        <p className="mt-1 text-body-sm font-medium text-warning">Moved from {formatDateIST(e.shiftedFrom)} (holiday) to the previous trading day.</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {provisional ? (
                <Callout tone="warning" className="mt-3">
                  The holiday calendar for {PROVISIONAL_HOLIDAY_YEARS.join(", ")} is provisional; expiry dates in that year may change.
                </Callout>
              ) : null}
            </Panel>
          </>
        ) : (
          <Panel title="Select a contract">
            <p className="text-body text-muted-foreground">Pick a symbol from the list.</p>
          </Panel>
        )}
      </div>
    </div>
  );
}
