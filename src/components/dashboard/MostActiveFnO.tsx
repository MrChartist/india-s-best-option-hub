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
      <Card>
        <CardContent className="py-8 text-center">
          <Zap className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No active F&O data available</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1">Data loads during market hours</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Zap className="h-4 w-4 text-warning" /> Most Active F&O
          <span className="text-[9px] text-muted-foreground font-normal ml-1">
            ({mostActive.length} stocks)
          </span>
          {isLive && (
            <Badge variant="outline" className="text-[8px] h-4 px-1 border-bullish/30 text-bullish ml-auto gap-1">
              {source === "nse" ? "NSE LIVE" : "TRADINGVIEW"}
            </Badge>
          )}
          {isLoading && <Loader2 className="h-3 w-3 animate-spin ml-auto text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        <Table>
          <TableHeader>
            <TableRow className="text-[10px]">
              <TableHead className="h-7">Symbol</TableHead>
              <TableHead className="h-7 text-right">LTP</TableHead>
              <TableHead className="h-7 text-right">Chg%</TableHead>
              <TableHead className="h-7 text-right">Volume</TableHead>
              {hasOI && <TableHead className="h-7 text-right">OI</TableHead>}
              {hasOI && <TableHead className="h-7 text-right">OI Chg</TableHead>}
              <TableHead className="h-7 text-right">Week %</TableHead>
              <TableHead className="h-7">Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mostActive.map((stock: any) => {
              const chgPct = stock.changePercent || 0;
              const weekChg = stock.weekChange || 0;
              return (
                <TableRow
                  key={stock.symbol}
                  className="text-xs font-mono cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => navigate(`/option-chain?symbol=${stock.symbol}`)}
                >
                  <TableCell className="font-medium font-sans py-1.5">
                    <div className="flex items-center gap-1">
                      {chgPct >= 0 ? (
                        <ArrowUpRight className="h-3 w-3 text-bullish shrink-0" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3 text-bearish shrink-0" />
                      )}
                      {stock.symbol}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-1.5">
                    {stock.ltp?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className={`text-right py-1.5 font-medium ${chgPct >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right py-1.5">
                    {stock.volume >= 10000000 ? `${(stock.volume / 10000000).toFixed(1)}Cr` :
                     stock.volume >= 100000 ? `${(stock.volume / 100000).toFixed(1)}L` :
                     `${(stock.volume / 1000).toFixed(0)}K`}
                  </TableCell>
                  {hasOI && (
                    <TableCell className="text-right py-1.5">
                      {((stock.oi || stock.openInterest || 0) / 100000).toFixed(1)}L
                    </TableCell>
                  )}
                  {hasOI && (
                    <TableCell className={`text-right py-1.5 ${(stock.oiChange || 0) >= 0 ? "text-bullish" : "text-bearish"}`}>
                      {(stock.oiChange || 0) >= 0 ? "+" : ""}{((stock.oiChange || 0) / 100000).toFixed(1)}L
                    </TableCell>
                  )}
                  <TableCell className={`text-right py-1.5 ${weekChg >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {weekChg >= 0 ? "+" : ""}{weekChg.toFixed(1)}%
                  </TableCell>
                  <TableCell className="py-1.5">
                    {hasOI ? (
                      <Badge variant="outline" className={`text-[9px] ${interpretationColor[stock.oiInterpretation] || ""}`}>
                        {stock.oiInterpretation}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={`text-[9px] ${chgPct >= 0 ? "text-bullish" : "text-bearish"}`}>
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
