import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Radio, Moon } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import { getCandleHistory, type CandleHistory } from "@/lib/localDatabase";
import { useChartData } from "@/hooks/useChartData";

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

// Placeholder pulsing sparkline when no data is available
function SparklinePlaceholder({ isPositive }: { isPositive: boolean }) {
  return (
    <div className="h-full w-full flex items-end gap-[2px] px-2 opacity-20">
      {Array.from({ length: 30 }).map((_, i) => {
        const height = 15 + Math.sin(i * 0.5) * 12 + Math.random() * 8;
        return (
          <div
            key={i}
            className={`flex-1 rounded-t-sm animate-pulse ${isPositive ? "bg-bullish" : "bg-bearish"}`}
            style={{ height: `${height}%`, animationDelay: `${i * 50}ms` }}
          />
        );
      })}
    </div>
  );
}

function IndexCard({ index, idx, isLive, onClick }: { index: IndexData; idx: number; isLive?: boolean; onClick: () => void }) {
  const isPositive = index.change >= 0;
  const [storedCandles, setStoredCandles] = useState<{ price: number }[] | null>(null);
  const [dbChecked, setDbChecked] = useState(false);

  // Detect after-hours: if market data exists but websocket is disconnected
  const isAfterHours = !isLive && index.ltp > 0;

  // Try to load stored candle data from IndexedDB
  useEffect(() => {
    const secId = SYMBOL_SEC_MAP[index.symbol];
    if (!secId) { setDbChecked(true); return; }

    getCandleHistory(secId, "5").then((history) => {
      if (history && history.candles.length > 0) {
        const recent = history.candles.slice(-75);
        setStoredCandles(recent.map((c) => ({ price: c.close })));
      }
      setDbChecked(true);
    }).catch(() => { setDbChecked(true); });
  }, [index.symbol]);

  // Fallback: fetch from Dhan historical API when IndexedDB is empty
  const { data: apiCandles } = useChartData(index.symbol, "1W", dbChecked && !storedCandles);

  // Use stored candles if available, otherwise use API candles, or empty
  const intraday = useMemo(() => {
    if (storedCandles && storedCandles.length > 0) return storedCandles;
    if (apiCandles && apiCandles.length > 0) return apiCandles.map(c => ({ price: c.close }));
    return [];
  }, [storedCandles, apiCandles]);

  const hasChart = intraday.length > 2;

  // Day range calculation
  const dayRange = index.high - index.low;
  const dayRangePosition = dayRange > 0 ? ((index.ltp - index.low) / dayRange) * 100 : 50;

  return (
    <Card className="cursor-pointer group hover:border-primary/20 transition-all duration-300 hover:shadow-card-hover relative overflow-hidden" onClick={onClick}>
      {/* Subtle background glow on hover */}
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">{index.name}</p>
              {isLive && <Radio className="h-3 w-3 text-bullish animate-pulse" />}
              {isAfterHours && (
                <span className="flex items-center gap-1 text-xs font-bold text-amber-500/90 uppercase tracking-wider">
                  <Moon className="h-3 w-3" />Closed
                </span>
              )}
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums tracking-tight transition-colors duration-300">
              {index.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className={`flex flex-col items-end gap-1`}>
            <div className={`flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-md shadow-sm ${isPositive ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {isPositive ? "+" : ""}{index.changePercent.toFixed(2)}%
            </div>
            <span className={`text-xs font-mono tabular-nums font-medium ${isPositive ? "text-bullish/80" : "text-bearish/80"}`}>
              {isPositive ? "+" : ""}{index.change.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Sparkline Chart or Placeholder */}
        <div className="h-[50px] -mx-2">
          {hasChart ? (
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
          ) : (
            <SparklinePlaceholder isPositive={isPositive} />
          )}
        </div>

        {/* OHLV Row + Day Range Bar */}
        <div className="space-y-1.5 mt-1">
          <div className="flex justify-between text-2xs text-muted-foreground font-mono tabular-nums">
            <span>O: {index.open.toLocaleString("en-IN")}</span>
            <span>H: {index.high.toLocaleString("en-IN")}</span>
            <span>L: {index.low.toLocaleString("en-IN")}</span>
          </div>
          {/* Day range progress bar */}
          {dayRange > 0 && (
            <div className="relative h-[3px] bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${isPositive ? "bg-bullish/40" : "bg-bearish/40"}`}
                style={{ width: `${dayRangePosition}%` }}
              />
              <div
                className={`absolute top-[-1px] h-[5px] w-[5px] rounded-full transition-all duration-500 ${isPositive ? "bg-bullish" : "bg-bearish"}`}
                style={{ left: `${Math.min(dayRangePosition, 97)}%` }}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
