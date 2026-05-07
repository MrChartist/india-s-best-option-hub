import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useFnOStocks } from "@/hooks/useMarketData";
import { Zap, Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";

export function MostActiveFnO() {
  const navigate = useNavigate();
  const { data, isLoading } = useFnOStocks();
  const mostActive = data?.mostActive || [];
  const isLive = data?.isLive || false;
  const source = (data as any)?.source || "none";
  const hasOI = source === "nse" || source === "database";

  const interpretationColor: Record<string, string> = {
    "Long Buildup": "text-bullish",
    "Short Buildup": "text-bearish",
    "Long Unwinding": "text-bearish",
    "Short Covering": "text-bullish",
    "Neutral": "text-muted-foreground",
  };

  if (mostActive.length === 0 && !isLoading) {
    return (
      <Card className="hover:shadow-card-hover transition-all duration-300">
        <CardContent className="py-8 text-center">
          <Zap className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2 drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]" />
          <p className="text-base font-semibold text-muted-foreground">No active F&O data available</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Data loads during market hours</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-card-hover transition-all duration-300">
      <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-warning/5 to-transparent">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-5 w-5 text-warning drop-shadow-[0_0_8px_rgba(255,165,0,0.5)]" /> Most Active F&O
          <span className="text-xs text-muted-foreground font-normal ml-1">
            ({mostActive.length} stocks)
          </span>
          {isLive && (
            <Badge variant="outline" className="text-[10px] h-5 px-2 border-bullish/30 text-bullish ml-auto gap-1">
              {source === "nse" ? "NSE LIVE" : "TRADINGVIEW"}
            </Badge>
          )}
          {isLoading && <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        <Table>
          <TableHeader>
            <TableRow className="text-xs border-b-white/5">
              <TableHead className="h-9 px-5">Symbol</TableHead>
              <TableHead className="h-9 text-right">LTP</TableHead>
              <TableHead className="h-9 text-right">Chg%</TableHead>
              <TableHead className="h-9 text-right">Volume</TableHead>
              {hasOI && <TableHead className="h-9 text-right">OI</TableHead>}
              {hasOI && <TableHead className="h-9 text-right">OI Chg</TableHead>}
              <TableHead className="h-9 text-right">Week %</TableHead>
              <TableHead className="h-9 px-5">Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mostActive.map((stock: any) => {
              const chgPct = stock.changePercent || 0;
              const weekChg = stock.weekChange || 0;
              return (
                <TableRow
                  key={stock.symbol}
                  className={`text-sm font-mono cursor-pointer transition-all duration-150 group border-b-white/5 border-l-2 border-l-transparent ${chgPct >= 0 ? "hover:bg-bullish/[0.03] hover:border-l-bullish/50" : "hover:bg-bearish/[0.03] hover:border-l-bearish/50"}`}
                  onClick={() => navigate(`/option-chain?symbol=${stock.symbol}`)}
                >
                  <TableCell className="font-medium font-sans py-2 px-5">
                    <div className="flex items-center gap-1.5">
                      {chgPct >= 0 ? (
                        <ArrowUpRight className="h-4 w-4 text-bullish shrink-0" />
                      ) : (
                        <ArrowDownRight className="h-4 w-4 text-bearish shrink-0" />
                      )}
                      {stock.symbol}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2 text-foreground font-semibold">
                    {stock.ltp?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right py-2 font-bold ${chgPct >= 0 ? "text-bullish drop-shadow-[0_0_3px_rgba(0,255,100,0.2)]" : "text-bearish drop-shadow-[0_0_3px_rgba(255,50,50,0.2)]"}`}>
                    {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right py-2 text-muted-foreground">
                    {stock.volume >= 10000000 ? `${(stock.volume / 10000000).toFixed(1)}Cr` :
                     stock.volume >= 100000 ? `${(stock.volume / 100000).toFixed(1)}L` :
                     `${(stock.volume / 1000).toFixed(0)}K`}
                  </TableCell>
                  {hasOI && (
                    <TableCell className="text-right py-2 font-medium">
                      {((stock.oi || stock.openInterest || 0) / 100000).toFixed(1)}L
                    </TableCell>
                  )}
                  {hasOI && (
                    <TableCell className={`text-right py-2 ${(stock.oiChange || 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {(stock.oiChange || 0) >= 0 ? "+" : ""}{((stock.oiChange || 0) / 100000).toFixed(1)}L
                    </TableCell>
                  )}
                  <TableCell className={`text-right py-2 ${weekChg >= 0 ? "text-bullish/80" : "text-bearish/80"}`}>
                    {weekChg >= 0 ? "+" : ""}{weekChg.toFixed(1)}%
                  </TableCell>
                  <TableCell className="py-2 px-5">
                    {hasOI ? (
                      <Badge variant="outline" className={`text-[10px] py-1 font-medium bg-background/50 ${interpretationColor[stock.oiInterpretation] || ""}`}>
                        {stock.oiInterpretation}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={`text-[10px] py-1 font-medium bg-background/50 ${chgPct >= 0 ? "text-bullish" : "text-bearish"}`}>
                        {chgPct > 2 ? "Strong Buy" : chgPct > 0 ? "Bullish" : chgPct > -2 ? "Bearish" : "Strong Sell"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
