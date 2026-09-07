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
  indices?: any[];
}

interface Props {
  indices: IndexData[];
  /** True when NSE is officially in session. Used for the "Closed" badge —
   *  deliberately NOT derived from websocket connection status, since a brief
   *  WS drop during live market hours must not be mislabeled as "market closed". */
  isMarketOpen?: boolean;
}

// Map index symbols to their Dhan security IDs
const SYMBOL_SEC_MAP: Record<string, string> = {
  NIFTY: "13",
  BANKNIFTY: "25",
  FINNIFTY: "27",
  MIDCPNIFTY: "442",
};

export function IndexCards({ indices, isMarketOpen }: Props) {
  const navigate = useNavigate();
  const wsConnected = useWebSocketStatus();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {indices.map((index, idx) => (
        <IndexCard
          key={index.symbol}
          index={index}
          idx={idx}
          isLive={wsConnected}
          isMarketOpen={isMarketOpen}
          onClick={() => navigate(`/option-chain?symbol=${index.symbol}`)}
        />
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

function IndexCard({ index, idx, isLive, isMarketOpen, onClick }: { index: IndexData; idx: number; isLive?: boolean; isMarketOpen?: boolean; onClick: () => void }) {
  // Defensive fallbacks: `index` can come straight from a live WebSocket tick
  // or a partially-merged polling record. ltp/change/changePercent don't carry
  // fallbacks upstream, so a malformed tick with a missing field used to throw
  // (undefined.toFixed / undefined.toLocaleString) and — since there's a single
  // ErrorBoundary around the whole dashboard — take down every other widget too.
  const ltp = index.ltp ?? 0;
  const change = index.change ?? 0;
  const changePercent = index.changePercent ?? 0;
  const open = index.open ?? ltp;
  const high = index.high ?? ltp;
  const low = index.low ?? ltp;

  const isPositive = change >= 0;
  const [storedCandles, setStoredCandles] = useState<{ price: number }[] | null>(null);
  const [dbChecked, setDbChecked] = useState(false);

  // "Closed" badge reflects the actual NSE market session, not websocket
  // connectivity — a brief WS reconnect during market hours must not read as
  // "market closed" while REST polling is still delivering live prices.
  const isAfterHours = isMarketOpen === false && ltp > 0;

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
  const dayRange = high - low;
  const dayRangePosition = dayRange > 0 ? ((ltp - low) / dayRange) * 100 : 50;

  return (
    <Card className="cursor-pointer min-h-[178px] hover:border-primary/20 transition-all duration-200 hover:shadow-card-hover" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="max-w-[180px] text-xs leading-tight text-muted-foreground font-semibold uppercase tracking-wider">{index.name}</p>
              {isLive && <Radio className="h-3 w-3 text-bullish animate-pulse" />}
              {isAfterHours && (
                <span className="flex items-center gap-1 text-xs font-semibold text-warning uppercase tracking-wider">
                  <Moon className="h-3 w-3" />Closed
                </span>
              )}
            </div>
            <p className="text-xl font-semibold font-mono tabular-nums leading-none">
              {ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className={`flex flex-col items-end gap-1`}>
            <div className={`flex items-center gap-1 text-xs font-mono px-2 py-1 rounded-md ${isPositive ? "bg-bullish/10 text-bullish" : "bg-bearish/10 text-bearish"}`}>
              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {isPositive ? "+" : ""}{changePercent.toFixed(2)}%
            </div>
            <span className={`text-xs font-mono tabular-nums font-medium ${isPositive ? "text-bullish/80" : "text-bearish/80"}`}>
              {isPositive ? "+" : ""}{change.toFixed(2)}
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
            <span>O: {open.toLocaleString("en-IN")}</span>
            <span>H: {high.toLocaleString("en-IN")}</span>
            <span>L: {low.toLocaleString("en-IN")}</span>
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
