import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { generateIntradayData } from "@/lib/mockData";

interface IndexData {
  symbol: string;
  name: string;
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

export function IndexCards({ indices }: Props) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {indices.map((index, idx) => (
        <IndexCard key={index.symbol} index={index} idx={idx} onClick={() => navigate(`/option-chain?symbol=${index.symbol}`)} />
      ))}
    </div>
  );
}

function IndexCard({ index, idx, onClick }: { index: IndexData; idx: number; onClick: () => void }) {
  const isPositive = index.change >= 0;
  const intraday = useMemo(() => generateIntradayData(index.prevClose, idx < 2 ? 0.5 + idx * 0.1 : 0.4), [index.prevClose, idx]);

  return (
    <Card className="cursor-pointer group hover:border-primary/30 transition-all hover:shadow-sm" onClick={onClick}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-2xs text-muted-foreground font-medium uppercase tracking-wider">{index.name}</p>
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
