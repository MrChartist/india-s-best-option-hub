import { useMemo } from "react";
import { ArrowUpDown, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAllIndices, useLiveOptionChain } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { getATMIV } from "@/lib/oiUtils";
import { calculateExpectedMove } from "@/lib/volatility";

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * 1σ / 2σ expected range to the nearest expiry, built only from live inputs:
 * the symbol's own ATM IV + ATM straddle + days to expiry from its option chain.
 * NIFTY falls back to India VIX (its 30-day implied vol) when the chain is unavailable.
 */
export function ExpectedMoveWidget({ symbol }: { symbol: string }) {
  const { data: chain } = useLiveOptionChain(symbol);
  const { data: allIndices } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const vix = wsVix?.value ?? allIndices?.vix?.value ?? 0;

  const inputs = useMemo(() => {
    if (!chain?.chain.length || !chain.spotPrice) return null;
    const { atmIV, atmStrike } = getATMIV(chain.chain, chain.spotPrice);
    const atmRow = chain.chain.find((r) => r.strikePrice === atmStrike);
    const straddle = atmRow ? atmRow.ce.ltp + atmRow.pe.ltp : 0;
    const dte = chain.expiries?.[0]?.daysToExpiry;
    const usingVix = atmIV <= 0 && symbol === "NIFTY" && vix > 0;
    const iv = atmIV > 0 ? atmIV : usingVix ? vix : 0;
    if (!iv || dte === undefined) return null;
    return { spot: chain.spotPrice, iv, dte, straddle, ivSource: usingVix ? "India VIX" : "ATM IV" };
  }, [chain, vix, symbol]);

  const move = useMemo(() => (inputs ? calculateExpectedMove(inputs.spot, inputs.iv, inputs.dte) : null), [inputs]);

  if (!inputs || !move) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Target className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
          <p className="text-sm font-medium">{symbol} expected move</p>
          <p className="mt-1 text-xs text-muted-foreground">Needs a live option chain (connect data in Brokers &amp; Data)</p>
        </CardContent>
      </Card>
    );
  }

  const width = move.upperBound2SD - move.lowerBound2SD;
  const pct = (v: number) => ((v - move.lowerBound2SD) / width) * 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowUpDown className="h-4 w-4 text-primary" />
          Expected move · {symbol}
          <Badge variant="outline" className="ml-auto text-[11px]">{inputs.dte}D to expiry</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="glass-control rounded-xl p-3 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">±1σ</p>
            <p className="num font-mono text-xl font-semibold text-primary">±{fmt(move.expectedMove)}</p>
            <p className="num font-mono text-xs text-muted-foreground">{move.expectedMovePercent.toFixed(2)}%</p>
          </div>
          <div className="glass-control rounded-xl p-3 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">ATM straddle</p>
            <p className="num font-mono text-xl font-semibold">{inputs.straddle > 0 ? `₹${fmt(inputs.straddle)}` : "—"}</p>
            <p className="text-xs text-muted-foreground">CE + PE LTP</p>
          </div>
          <div className="glass-control rounded-xl p-3 text-center">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{inputs.ivSource}</p>
            <p className="num font-mono text-xl font-semibold">{inputs.iv.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">annualised</p>
          </div>
        </div>

        <div className="relative h-14 overflow-hidden rounded-xl bg-foreground/[0.05]">
          <div
            className="absolute inset-y-0 border-x border-primary/40 bg-primary/15"
            style={{ left: `${pct(move.lowerBound1SD)}%`, width: `${pct(move.upperBound1SD) - pct(move.lowerBound1SD)}%` }}
          />
          <div className="absolute inset-y-0 z-10 w-0.5 bg-foreground" style={{ left: `${pct(inputs.spot)}%` }}>
            <span className="num absolute -top-0.5 left-1/2 -translate-x-1/2 rounded bg-foreground px-1.5 font-mono text-[11px] text-background">
              {fmt(inputs.spot)}
            </span>
          </div>
          <span className="num absolute bottom-1 left-2 font-mono text-[11px] text-bearish">{fmt(move.lowerBound2SD)}</span>
          <span className="num absolute bottom-1 font-mono text-[11px] text-bearish" style={{ left: `${pct(move.lowerBound1SD)}%`, transform: "translateX(-50%)" }}>{fmt(move.lowerBound1SD)}</span>
          <span className="num absolute bottom-1 font-mono text-[11px] text-bullish" style={{ left: `${pct(move.upperBound1SD)}%`, transform: "translateX(-50%)" }}>{fmt(move.upperBound1SD)}</span>
          <span className="num absolute bottom-1 right-2 font-mono text-[11px] text-bullish">{fmt(move.upperBound2SD)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <span className="text-muted-foreground">1σ (68%) </span>
            <span className="num font-mono font-semibold">{fmt(move.lowerBound1SD)} – {fmt(move.upperBound1SD)}</span>
          </div>
          <div className="rounded-lg bg-foreground/[0.06] p-2.5">
            <span className="text-muted-foreground">2σ (95%) </span>
            <span className="num font-mono font-semibold">{fmt(move.lowerBound2SD)} – {fmt(move.upperBound2SD)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
