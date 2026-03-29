import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Radio } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import { getCandleHistory, type CandleHistory } from "@/lib/localDatabase";

interface IndexData {
  name: string;
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
}

interface Props {
  indices: IndexData[];
}

// Map index symbols to their Dhan security IDs
const SYMBOL_SEC_MAP: Record<string, string> = {
  NIFTY: "13",
  BANKNIFTY: "25",
  FINNIFTY: "27",
  MIDCPNIFTY: "442",
};

export function IndexCards({ indices }: Props) {
  const navigate = useNavigate();
  const wsConnected = useWebSocketStatus();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {indices.map((index, idx) => (
        <IndexCard key={index.symbol} index={index} idx={idx} isLive={wsConnected} onClick={() => navigate(`/option-chain?symbol=${index.symbol}`)} />
      ))}
    </div>
  );
}

function IndexCard({ index, idx, isLive, onClick }: { index: IndexData; idx: number; isLive?: boolean; onClick: () => void }) {
  const isPositive = index.change >= 0;
  const [storedCandles, setStoredCandles] = useState<{ price: number }[] | null>(null);

  // Try to load stored candle data from IndexedDB
  useEffect(() => {
    const secId = SYMBOL_SEC_MAP[index.symbol];
    if (!secId) return;

    getCandleHistory(secId, "5").then((history) => {
      if (history && history.candles.length > 0) {
        // Use last 75 candles (about 1 trading day of 5-min candles)
        const recent = history.candles.slice(-75);
        setStoredCandles(recent.map((c) => ({ price: c.close })));
      }
    }).catch(() => { /* IndexedDB not available */ });
  }, [index.symbol]);

  // Use stored candles if available, otherwise show empty sparkline
  const intraday = useMemo(() => {
    if (storedCandles && storedCandles.length > 0) return storedCandles;
    // No mock — return empty so sparkline is blank
    return [];
  }, [storedCandles]);

  return (
    <Card className="cursor-pointer group hover:border-primary/30 transition-all hover:shadow-sm" onClick={onClick}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-1">
              <p className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">{index.name}</p>
              {isLive && <Radio className="h-2 w-2 text-bullish animate-pulse" />}
              {storedCandles && <span className="text-[8px] text-primary/50 uppercase tracking-wider">DB</span>}
            </div>
            <p className="text-xl font-bold font-mono tabular-nums tracking-tight">{index.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
          </div>
          <div className={`flex items-center gap-1 text-2xs font-mono px-2 py-0.5 rounded-md ${isPositive ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
            {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPositive ? "+" : ""}{index.changePercent.toFixed(2)}%
          </div>
        </div>
        <div className="h-[50px] -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={intraday}>
              <defs>
                <linearGradient id={`grad-${index.symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={isPositive ? "hsl(var(--bullish))" : "hsl(var(--bearish))"} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={isPositive ? "hsl(var(--bullish))" : "hsl(var(--bearish))"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="price" stroke={isPositive ? "hsl(var(--bullish))" : "hsl(var(--bearish))"} fill={`url(#grad-${index.symbol})`} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-between text-2xs text-muted-foreground font-mono tabular-nums mt-1">
          <span>O: {index.open.toLocaleString("en-IN")}</span>
          <span>H: {index.high.toLocaleString("en-IN")}</span>
          <span>L: {index.low.toLocaleString("en-IN")}</span>
        </div>
      </CardContent>
    </Card>
  );
}
