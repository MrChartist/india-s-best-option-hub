import { Sigma } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateIST, formatStrike, type Greeks } from "@/lib/options";
import { cn } from "@/lib/utils";
import { MetricTip } from "./MetricTip";
import type { LegGreeksRow } from "./strategyAnalysis";

export interface GreeksTableProps {
  rows: LegGreeksRow[];
  net: Greeks;
  spot: number;
}

const fmt = (v: number, d: number) => {
  if (!Number.isFinite(v)) return "—";
  const r = Math.abs(v) < 0.5 * 10 ** -d ? 0 : v;
  return `${r < 0 ? "−" : r > 0 ? "+" : ""}${Math.abs(r).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d })}`;
};
const tone = (v: number) => (!Number.isFinite(v) || Math.abs(v) < 1e-9 ? "" : v > 0 ? "text-bullish" : "text-bearish");

export function GreeksTable({ rows, net, spot }: GreeksTableProps) {
  const notes: string[] = [];
  if (rows.length > 0) {
    const d = Math.abs(net.delta).toFixed(1);
    notes.push(net.delta >= 0 ? `Net long ${d} deltas: gains about ₹${d} per 1-point rise.` : `Net short ${d} deltas: gains about ₹${d} per 1-point fall.`);
    notes.push(net.gamma < 0 ? "Short gamma: large moves either way hurt; quiet markets help." : net.gamma > 0 ? "Long gamma: large moves help; quiet markets cost you time decay." : "Gamma neutral.");
    notes.push(net.theta >= 0 ? `Time decay earns about ₹${Math.abs(net.theta).toFixed(0)} a day.` : `Time decay costs about ₹${Math.abs(net.theta).toFixed(0)} a day.`);
    notes.push(net.vega >= 0 ? `Long vega: +1 IV point adds about ₹${Math.abs(net.vega).toFixed(0)}.` : `Short vega: +1 IV point costs about ₹${Math.abs(net.vega).toFixed(0)}.`);
  }
  const deltaPer1Pct = net.gamma * spot * 0.01; // change in position delta for a 1% move
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sigma className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Greeks
          <span className="text-xs font-normal text-muted-foreground">position, signed (SELL = −)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No active legs.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[420px] text-xs [&_td]:px-2 [&_th]:px-2">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8">Leg</TableHead>
                  <TableHead className="h-8 text-right">
                    <span className="inline-flex items-center gap-1">Delta <MetricTip label="Delta">Rupees gained per 1-point rise in the underlying, for the whole position.</MetricTip></span>
                  </TableHead>
                  <TableHead className="h-8 text-right">
                    <span className="inline-flex items-center gap-1">Gamma <MetricTip label="Gamma">Change in delta per 1-point move. Negative for option sellers.</MetricTip></span>
                  </TableHead>
                  <TableHead className="h-8 text-right">
                    <span className="inline-flex items-center gap-1">Theta ₹/day <MetricTip label="Theta">Rupees gained or lost per calendar day from time decay, other things equal.</MetricTip></span>
                  </TableHead>
                  <TableHead className="h-8 text-right">
                    <span className="inline-flex items-center gap-1">Vega ₹/pt <MetricTip label="Vega">Rupees gained per 1 percentage-point rise in implied volatility.</MetricTip></span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ id, leg, position }) => (
                  <TableRow key={id} className="font-num">
                    <TableCell className="whitespace-nowrap py-1.5 font-sans">
                      <span className={cn("mr-1 font-semibold", leg.side === "BUY" ? "text-bullish" : "text-bearish")}>{leg.side === "BUY" ? "B" : "S"}</span>
                      {leg.lots}× {leg.type === "FUT" ? "FUT" : `${formatStrike(leg.strike)} ${leg.type}`}
                      <span className="ml-1 text-[10px] text-muted-foreground">{formatDateIST(leg.expiry)}</span>
                    </TableCell>
                    <TableCell className={cn("py-1.5 text-right", tone(position.delta))}>{fmt(position.delta, 1)}</TableCell>
                    <TableCell className={cn("py-1.5 text-right", tone(position.gamma))}>{fmt(position.gamma, 3)}</TableCell>
                    <TableCell className={cn("py-1.5 text-right", tone(position.theta))}>{fmt(position.theta, 0)}</TableCell>
                    <TableCell className={cn("py-1.5 text-right", tone(position.vega))}>{fmt(position.vega, 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="font-num font-semibold">
                  <TableCell className="py-1.5 font-sans">Net</TableCell>
                  <TableCell className={cn("py-1.5 text-right", tone(net.delta))}>{fmt(net.delta, 1)}</TableCell>
                  <TableCell className={cn("py-1.5 text-right", tone(net.gamma))}>{fmt(net.gamma, 3)}</TableCell>
                  <TableCell className={cn("py-1.5 text-right", tone(net.theta))}>{fmt(net.theta, 0)}</TableCell>
                  <TableCell className={cn("py-1.5 text-right", tone(net.vega))}>{fmt(net.vega, 0)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        {notes.length > 0 && (
          <ul className="space-y-0.5 text-[11px] text-muted-foreground">
            {notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
            {Number.isFinite(deltaPer1Pct) && Math.abs(deltaPer1Pct) >= 0.5 && <li>• A 1% move changes position delta by about {fmt(Math.abs(deltaPer1Pct), 0).replace("+", "")}.</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
