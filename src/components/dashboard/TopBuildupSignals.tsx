import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radar, ArrowRight } from "lucide-react";
import { useFuturesScanner } from "@/hooks/useMarketData";
import type { FuturesQuoteRow } from "@/lib/futuresUtils";

function TopList({ title, rows }: { title: string; rows: FuturesQuoteRow[] }) {
  return (
    <div className="flex-1 min-w-[200px]">
      <p className="text-xs text-muted-foreground mb-1.5">{title}</p>
      <div className="space-y-1">
        {rows.length === 0 && <p className="text-xs text-muted-foreground/50">None right now</p>}
        {rows.map((row) => (
          <div key={row.symbol} className="flex items-center justify-between text-xs font-mono px-2 py-1 rounded bg-accent/20">
            <span className="font-sans font-medium">{row.symbol}</span>
            <span className={(row.oiChangePercent ?? 0) >= 0 ? "text-bullish" : "text-bearish"}>
              {row.oiChangePercent !== null ? `${row.oiChangePercent >= 0 ? "+" : ""}${row.oiChangePercent.toFixed(1)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Replaces the old IV Rank dashboard widget, which ran on seeded-random data for
// a fixed 10-symbol list. This is real: top OI-buildup movers from the same
// futures-quotes feed that powers the full /scanner page.
export function TopBuildupSignals() {
  const { data, isLoading } = useFuturesScanner();
  const rows = data?.rows ?? [];

  const byAbsOiChange = (signal: FuturesQuoteRow["buildupSignal"]) =>
    rows
      .filter((r) => r.buildupSignal === signal)
      .sort((a, b) => Math.abs(b.oiChangePercent ?? 0) - Math.abs(a.oiChangePercent ?? 0))
      .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Radar className="h-4 w-4 text-primary" />
          Futures Buildup Scanner
          {data?.isLive && <Badge variant="outline" className="text-xs h-5 border-bullish/30 text-bullish">LIVE</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading live futures data...</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No live futures data available.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            <TopList title="Top Long Buildup" rows={byAbsOiChange("Long Buildup")} />
            <TopList title="Top Short Buildup" rows={byAbsOiChange("Short Buildup")} />
          </div>
        )}
        <Link to="/scanner" className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline w-fit">
          View full scanner ({rows.length} contracts) <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
