import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { LineChart } from "lucide-react";
import type { ClosedPosition } from "@/lib/positionStore";

interface Props {
  closedPositions: ClosedPosition[];
}

// Real trade-journal metrics from CLOSED (realized) trades — distinct from the
// Portfolio Summary's Greeks/P&L cards above, which reflect currently-OPEN
// positions. Average R:R is deliberately not shown: this app doesn't capture a
// planned stop-loss/target at entry, so a real risk:reward ratio can't be
// honestly computed from realized P&L alone.
export function TradeJournalAnalytics({ closedPositions }: Props) {
  const stats = useMemo(() => {
    const wins = closedPositions.filter((p) => p.realizedPnl > 0);
    const losses = closedPositions.filter((p) => p.realizedPnl < 0);
    const grossProfit = wins.reduce((s, p) => s + p.realizedPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + p.realizedPnl, 0));
    const winRate = closedPositions.length > 0 ? Math.round((wins.length / closedPositions.length) * 100) : 0;
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Equity curve by close ORDER (closedPositions.push()'d chronologically) —
    // not by parsing exitDate, which is stored as a display string with no
    // year ("06 Sep") and would sort wrong across a year boundary.
    let cumulative = 0;
    const equityCurve = closedPositions.map((p, i) => {
      cumulative += p.realizedPnl;
      return { trade: i + 1, cumulative: Math.round(cumulative), exitDate: p.exitDate };
    });

    return { winRate, wins: wins.length, losses: losses.length, avgWin, avgLoss, profitFactor, equityCurve };
  }, [closedPositions]);

  if (closedPositions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <LineChart className="h-4 w-4 text-primary" /> Trade Journal Analytics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-md bg-accent/30 text-center">
            <p className="text-xs text-muted-foreground">Win Rate</p>
            <p className={`text-lg font-semibold font-mono ${stats.winRate >= 50 ? "text-bullish" : "text-bearish"}`}>{stats.winRate}%</p>
            <p className="text-xs text-muted-foreground/70">{stats.wins}W / {stats.losses}L</p>
          </div>
          <div className="p-3 rounded-md bg-accent/30 text-center">
            <p className="text-xs text-muted-foreground">Profit Factor</p>
            <p className={`text-lg font-semibold font-mono ${stats.profitFactor >= 1 ? "text-bullish" : "text-bearish"}`}>
              {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground/70">Gross profit ÷ gross loss</p>
          </div>
          <div className="p-3 rounded-md bg-accent/30 text-center">
            <p className="text-xs text-muted-foreground">Avg Win</p>
            <p className="text-lg font-semibold font-mono text-bullish">₹{stats.avgWin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          </div>
          <div className="p-3 rounded-md bg-accent/30 text-center">
            <p className="text-xs text-muted-foreground">Avg Loss</p>
            <p className="text-lg font-semibold font-mono text-bearish">₹{stats.avgLoss.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          </div>
        </div>

        {stats.equityCurve.length > 1 && (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" />
                <XAxis dataKey="trade" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} label={{ value: "Trade #", position: "insideBottom", offset: -2, fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px" }}
                  formatter={(v: number) => [`₹${v.toLocaleString("en-IN")}`, "Cumulative P&L"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.exitDate ? `Closed ${payload[0].payload.exitDate}` : ""}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Area type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
