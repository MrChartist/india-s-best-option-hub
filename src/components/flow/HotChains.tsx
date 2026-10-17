import { useMemo, useState } from "react";
import { Trophy, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateIST, formatNumberIN, formatPct, formatStrike } from "@/lib/options";
import { hottestChains, topPremiumContracts, type FlowPrint } from "@/lib/flow";
import { cn } from "@/lib/utils";
import { DerivedBadge, EmptyState, Panel, SampleBadge } from "./FlowUi";
import { fmtRs, signClass } from "./format";
import { useOiSpurts } from "./useFlow";

/** Hottest underlyings by premium, with the call/put split. */
export function HotChains({ prints, isSample }: { prints: FlowPrint[]; isSample: boolean }) {
  const chains = useMemo(() => hottestChains(prints), [prints]);
  const max = chains[0]?.premium ?? 0;
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          <Trophy className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Hottest chains
        </span>
      }
      subtitle="Premium traded per underlying in the derived flow"
      actions={isSample ? <SampleBadge /> : <DerivedBadge />}
    >
      {chains.length === 0 ? (
        <EmptyState title="No flow yet">Premium per underlying appears once the tape has prints.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {chains.map((c) => (
            <li key={c.symbol}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{c.symbol}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{fmtRs(c.premium)}</span>
                  <span className={cn("ml-2 text-body-sm", signClass(c.net))} title="Net = (calls bought − sold) − (puts bought − sold)">
                    net {fmtRs(c.net, true)}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex h-2 overflow-hidden rounded-capsule bg-muted" style={{ width: `${max > 0 ? Math.max(8, (c.premium / max) * 100) : 0}%` }} role="img" aria-label={`Calls ${formatPct(c.callShare * 100, { decimals: 0 })}, puts ${formatPct((1 - c.callShare) * 100, { decimals: 0 })}`}>
                <span className="h-full bg-bullish" style={{ width: `${(c.callShare || 0) * 100}%` }} />
                <span className="h-full flex-1 bg-bearish" />
              </div>
              <p className="mt-0.5 text-micro uppercase text-muted-foreground">
                Calls {fmtRs(c.cePremium)} · Puts {fmtRs(c.pePremium)} · {formatNumberIN(c.prints)} prints
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Contracts ranked by premium across the session. */
export function TopContracts({ prints, isSample }: { prints: FlowPrint[]; isSample: boolean }) {
  const rows = useMemo(() => topPremiumContracts(prints, 12), [prints]);
  return (
    <Panel title="Top-premium contracts" subtitle="Summed across every interval today" actions={isSample ? <SampleBadge /> : <DerivedBadge />}>
      {rows.length === 0 ? (
        <EmptyState title="No contracts yet">Contracts appear here once the tape has prints.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-body-sm">
            <caption className="sr-only">Top contracts by premium</caption>
            <thead className="text-left text-label uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-2">#</th>
                <th scope="col" className="py-1.5 pr-2">Contract</th>
                <th scope="col" className="py-1.5 pr-2 text-right">Premium</th>
                <th scope="col" className="py-1.5 pr-2 text-right">Net</th>
                <th scope="col" className="py-1.5 pr-2 text-right">Contracts</th>
                <th scope="col" className="py-1.5 text-right">OI chg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2">
                    <span className="font-semibold">{r.symbol}</span> <span className="tabular-nums">{formatStrike(r.strike)}</span> <span className={r.type === "CE" ? "text-bullish" : "text-bearish"}>{r.type}</span>
                    <span className="ml-1.5 text-muted-foreground">{formatDateIST(r.expiry).replace(/ \d{4}$/, "")}</span>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{fmtRs(r.premium)}</td>
                  <td className={cn("py-1.5 pr-2 text-right tabular-nums", signClass(r.net))}>{fmtRs(r.net, true)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{formatNumberIN(r.dVol)}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", signClass(r.dOI))}>
                    {r.dOI > 0 ? "+" : ""}
                    {formatNumberIN(r.dOI)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const CATEGORY_VARIANT: Record<string, "bullish" | "bearish" | "info" | "warning"> = {
  "Long build-up": "bullish",
  "Short build-up": "bearish",
  "Short covering": "info",
  "Long unwinding": "warning",
};

/** NSE OI spurts (live analysis) via the proxy. */
export function OiSpurts() {
  const [type, setType] = useState<"contracts" | "underlyings">("contracts");
  const q = useOiSpurts(type);
  const rows = (q.data?.rows ?? []).slice().sort((a, b) => Math.abs(b.chgOiPct) - Math.abs(a.chgOiPct)).slice(0, 15);
  const meta = q.data?.meta;
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          <Zap className="h-4 w-4 text-primary-ink" aria-hidden="true" /> OI spurts
        </span>
      }
      subtitle="Largest OI changes published by NSE"
      actions={
        <div className="flex gap-1" role="tablist" aria-label="OI spurts view">
          {(["contracts", "underlyings"] as const).map((t) => (
            <Button key={t} role="tab" aria-selected={t === type} size="pill" variant={t === type ? "default" : "outline"} onClick={() => setType(t)}>
              {t === "contracts" ? "Contracts" : "Underlyings"}
            </Button>
          ))}
        </div>
      }
    >
      {q.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="OI spurts unavailable">
          {meta?.reason ? `The proxy could not fetch NSE OI spurts (${meta.reason}). ` : "NSE returned no rows. "}Start the local proxy (npm run proxy) for live data. No sample is shown here.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          <p className="text-body-sm text-muted-foreground">
            Source: NSE{meta?.stale ? " (cached copy)" : ""} via your local proxy.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-body-sm">
              <caption className="sr-only">NSE OI spurts by {type}</caption>
              <thead className="text-left text-label uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1.5 pr-2">{type === "contracts" ? "Contract" : "Underlying"}</th>
                  <th scope="col" className="py-1.5 pr-2 text-right">OI</th>
                  <th scope="col" className="py-1.5 pr-2 text-right">OI chg</th>
                  <th scope="col" className="py-1.5 pr-2 text-right">LTP</th>
                  <th scope="col" className="py-1.5 text-right">Build-up</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={`${r.symbol}-${r.strike ?? ""}-${r.optionType ?? ""}-${r.expiry ?? ""}-${i}`}>
                    <td className="whitespace-nowrap py-1.5 pr-2">
                      <span className="font-semibold">{r.symbol}</span>
                      {r.strike ? <span className="ml-1 tabular-nums">{formatStrike(r.strike)}</span> : null}
                      {r.optionType ? <span className="ml-1">{r.optionType}</span> : null}
                      {r.expiry ? <span className="ml-1.5 text-muted-foreground">{r.expiry}</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatNumberIN(r.latestOi)}</td>
                    <td className={cn("py-1.5 pr-2 text-right tabular-nums", signClass(r.chgOi))}>{formatPct(r.chgOiPct, { decimals: 1, signed: true })}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.ltp !== undefined ? formatNumberIN(r.ltp, 2) : "—"}
                      {r.pChange !== undefined ? <span className={cn("ml-1", signClass(r.pChange))}>{formatPct(r.pChange, { decimals: 1, signed: true })}</span> : null}
                    </td>
                    <td className="py-1.5 text-right">{r.category ? <Badge variant={CATEGORY_VARIANT[r.category] ?? "neutral"}>{r.category}</Badge> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
