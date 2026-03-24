import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { futuresData, generateVIXHistory } from "@/lib/mockData";
import { Globe, Activity } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
  Cell, ReferenceLine, AreaChart, Area,
} from "recharts";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  fontSize: "11px",
};

export function FuturesVIX() {
  const vixHistory = useMemo(() => generateVIXHistory(), []);

  const futuresPremiumChart = useMemo(() => {
    return futuresData.map((f) => ({
      label: `${f.symbol} ${f.expiry}`,
      premium: f.premium,
      premiumPct: f.premiumPercent,
    }));
  }, []);

  return (
    <div className="grid lg:grid-cols-3 gap-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Futures Premium / Discount</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[160px] mb-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={futuresPremiumChart} layout="vertical" barSize={18}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={110} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`₹${value.toFixed(2)}`, "Premium"]} />
                  <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
                  <Bar dataKey="premium" name="Premium" radius={[0, 4, 4, 0]}>
                    {futuresPremiumChart.map((entry, i) => (
                      <Cell key={i} fill={entry.premium >= 0 ? "hsl(var(--bullish) / 0.7)" : "hsl(var(--bearish) / 0.7)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="text-[10px]">
                  <TableHead className="h-7">Symbol</TableHead>
                  <TableHead className="h-7">Expiry</TableHead>
                  <TableHead className="h-7 text-right">Spot</TableHead>
                  <TableHead className="h-7 text-right">Futures</TableHead>
                  <TableHead className="h-7 text-right">Premium</TableHead>
                  <TableHead className="h-7 text-right">OI Chg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {futuresData.map((f, i) => (
                  <TableRow key={i} className="text-xs font-mono">
                    <TableCell className="font-medium font-sans py-1.5">{f.symbol}</TableCell>
                    <TableCell className="text-muted-foreground py-1.5">{f.expiry}</TableCell>
                    <TableCell className="text-right py-1.5">{f.spotPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right py-1.5">{f.futuresPrice.toLocaleString("en-IN")}</TableCell>
                    <TableCell className={`text-right font-medium py-1.5 ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.premium >= 0 ? "+" : ""}₹{f.premium.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right py-1.5 ${f.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {f.oiChange >= 0 ? "+" : ""}{(f.oiChange / 100000).toFixed(1)}L
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> India VIX (30D)</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={vixHistory}>
                <defs>
                  <linearGradient id="vixGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} domain={["auto", "auto"]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="vix" stroke="hsl(var(--warning))" fill="url(#vixGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {/* Basis Summary */}
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-medium">Basis Summary</p>
            {futuresData.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-center justify-between p-1.5 rounded-md bg-accent/30">
                <span className="text-[10px] font-medium">{f.symbol}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono font-bold ${f.premium >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {f.premium >= 0 ? "Premium" : "Discount"}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${f.premium >= 0 ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
                    {f.premium >= 0 ? "+" : ""}{f.premiumPercent.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
