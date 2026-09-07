import { Card, CardContent } from "@/components/ui/card";
import { useGlobalCues } from "@/hooks/useMarketData";
import type { GlobalCuesData } from "@/lib/marketApi";

const CUE_LABELS: Record<keyof GlobalCuesData, string> = {
  DOW: "Dow Jones",
  NASDAQ: "Nasdaq",
  SPX500: "S&P 500",
  NIKKEI: "Nikkei 225",
  HANGSENG: "Hang Seng",
  CRUDE_WTI: "Crude (WTI)",
  DXY: "Dollar Index",
};

const CUE_ORDER: (keyof GlobalCuesData)[] = ["DOW", "NASDAQ", "SPX500", "NIKKEI", "HANGSENG", "CRUDE_WTI", "DXY"];

// The pre-market ritual every Indian F&O trader runs: US close + Asian session
// + crude + dollar index, before deciding a directional bias for the day.
export function GlobalMarketCues() {
  const { data, isLoading } = useGlobalCues();
  const available = CUE_ORDER.filter((key) => data?.[key]);

  if (isLoading && available.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Loading global market cues...</CardContent>
      </Card>
    );
  }

  if (available.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">Global market cues unavailable right now.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {available.map((key) => {
        const cue = data![key]!;
        const isUp = (cue.changePercent ?? 0) >= 0;
        return (
          <Card key={key} className="overflow-hidden">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground truncate">{CUE_LABELS[key]}</p>
              <p className="text-sm font-semibold font-mono mt-0.5">
                {cue.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
              <p className={`text-xs font-mono ${cue.changePercent === null ? "text-muted-foreground" : isUp ? "text-bullish" : "text-bearish"}`}>
                {cue.changePercent === null ? "—" : `${isUp ? "+" : ""}${cue.changePercent.toFixed(2)}%`}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
