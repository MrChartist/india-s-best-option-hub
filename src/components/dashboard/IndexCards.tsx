import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Radio } from "lucide-react";
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
  indices?: any[];
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
        const height = 22 + Math.sin(i * 0.52) * 13 + ((i * 7) % 9);
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
    <Card className="group relative min-h-[178px] cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover" onClick={onClick}>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <CardContent className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-1.5 flex items-center gap-1.5 truncate text-[11px] font-semibold uppercase leading-tight tracking-[0.05em] text-muted-foreground">
              <span className="truncate">{index.name}</span>
              {isLive && <Radio className="h-3 w-3 shrink-0 animate-pulse text-bullish" />}
            </p>
            <p className="num font-mono text-[26px] font-semibold leading-none">
              {index.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-xs font-semibold ${isPositive ? "bg-bullish/15 text-bullish" : "bg-bearish/15 text-bearish"}`}>
              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {isPositive ? "+" : ""}{index.changePercent.toFixed(2)}%
            </div>
            <span className={`num font-mono text-xs font-medium ${isPositive ? "text-bullish" : "text-bearish"}`}>
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

        {/* Open / High / Low + day-range position */}
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {([["Open", index.open], ["High", index.high], ["Low", index.low]] as const).map(([label, v]) => (
              <div key={label} className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="num truncate font-mono text-xs">{v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
              </div>
            ))}
          </div>
          {dayRange > 0 && (
            <div className="relative h-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 ${isPositive ? "bg-bullish/60" : "bg-bearish/60"}`}
                style={{ width: `${dayRangePosition}%` }}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
