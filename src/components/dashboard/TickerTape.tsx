import { useNavigate } from "react-router-dom";
import { marketStats } from "@/lib/mockData";
import { Plane } from "lucide-react";

interface IndexData {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
}

interface Props {
  indices: IndexData[];
  giftNifty?: {
    lastPrice: number;
    change: number;
    changePercent: number;
  } | null;
}

export function TickerTape({ indices, giftNifty }: Props) {
  const navigate = useNavigate();
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {indices.map((idx) => {
        const pos = idx.change >= 0;
        return (
          <div
            key={idx.symbol}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border shrink-0 cursor-pointer hover:border-primary/30 transition-colors"
            onClick={() => navigate(`/option-chain?symbol=${idx.symbol}`)}
          >
            <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">{idx.symbol}</span>
            <span className="text-sm font-bold font-mono tabular-nums">{idx.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            <span className={`text-2xs font-mono tabular-nums font-medium ${pos ? "text-bullish" : "text-bearish"}`}>
              {pos ? "▲" : "▼"} {Math.abs(idx.changePercent).toFixed(2)}%
            </span>
          </div>
        );
      })}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card border border-border shrink-0">
        <span className="text-2xs font-medium text-muted-foreground uppercase tracking-wider">VIX</span>
        <span className="text-sm font-bold font-mono tabular-nums">{marketStats.indiaVix}</span>
        <span className={`text-2xs font-mono tabular-nums font-medium ${marketStats.vixChange < 0 ? "text-bullish" : "text-bearish"}`}>
          {marketStats.vixChange < 0 ? "▼" : "▲"} {Math.abs(marketStats.vixChange).toFixed(2)}%
        </span>
      </div>
      {giftNifty && giftNifty.lastPrice > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/15 shrink-0">
          <Plane className="h-3 w-3 text-primary" />
          <span className="text-2xs font-medium text-primary uppercase tracking-wider">GIFT</span>
          <span className="text-sm font-bold font-mono tabular-nums">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
          <span className={`text-2xs font-mono tabular-nums font-medium ${giftNifty.change >= 0 ? "text-bullish" : "text-bearish"}`}>
            {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)} ({giftNifty.changePercent.toFixed(2)}%)
          </span>
        </div>
      )}
    </div>
  );
}
