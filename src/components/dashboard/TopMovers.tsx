import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFnOStocks } from "@/hooks/useMarketData";
import { ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MiniChart } from "@/components/MiniChart";

export function TopMovers() {
  const navigate = useNavigate();
  const { data, isLoading } = useFnOStocks();
  const gainers = data?.gainers || [];
  const losers = data?.losers || [];
  const isLive = data?.isLive || false;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card className="overflow-hidden hover:shadow-card-hover transition-all duration-300">
        <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-bullish/5 to-transparent">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-bullish drop-shadow-[0_0_8px_rgba(0,255,100,0.5)]" /> Top Gainers
            <span className="text-xs text-muted-foreground font-normal">({gainers.length})</span>
            {isLive && <Badge variant="outline" className="text-[10px] h-5 px-2 border-bullish/30 text-bullish ml-auto">LIVE</Badge>}
            {isLoading && <Loader2 className="h-4 w-4 animate-spin ml-auto text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-xs border-b-white/5">
                <TableHead className="h-9 text-muted-foreground">Symbol</TableHead>
                <TableHead className="h-9 text-right text-muted-foreground">LTP</TableHead>
                <TableHead className="h-9 text-right text-muted-foreground">Chg%</TableHead>
                <TableHead className="h-9 text-center text-muted-foreground">Chart</TableHead>
                <TableHead className="h-9 text-right text-muted-foreground">Vol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gainers.map((s: any) => (
                <TableRow
                  key={s.symbol}
                  className="text-sm font-mono cursor-pointer hover:bg-bullish/[0.04] transition-all duration-150 group border-b-white/5 border-l-2 border-l-transparent hover:border-l-bullish"
                  onClick={() => navigate(`/option-chain?symbol=${s.symbol}`)}
                >
                  <TableCell className="font-medium font-sans py-2 px-4">
                    <div className="flex items-center gap-1.5">
                      <ArrowUpRight className="h-4 w-4 text-bullish shrink-0 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-[0_0_5px_rgba(0,255,100,0.5)]" />
                      {s.symbol}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2 text-foreground">{s.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right py-2">
                    <span className="bg-bullish/10 text-bullish px-2 py-1 rounded-md text-xs shadow-[inset_0_0_10px_rgba(0,255,100,0.1)] font-medium">+{s.changePercent.toFixed(2)}%</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-center">
                    <div className="inline-block drop-shadow-[0_0_3px_rgba(0,255,100,0.3)]"><MiniChart symbol={s.symbol} width={70} height={26} /></div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground py-2 px-4">{(s.volume / 100000).toFixed(1)}L</TableCell>
                </TableRow>
              ))}
              {gainers.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6 border-b-0">No data available</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="overflow-hidden hover:shadow-card-hover transition-all duration-300">
        <CardHeader className="pb-3 pt-4 px-5 bg-gradient-to-r from-bearish/5 to-transparent">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowDownRight className="h-5 w-5 text-bearish drop-shadow-[0_0_8px_rgba(255,50,50,0.5)]" /> Top Losers
            <span className="text-xs text-muted-foreground font-normal">({losers.length})</span>
            {isLive && <Badge variant="outline" className="text-[10px] h-5 px-2 border-bearish/30 text-bearish ml-auto">LIVE</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-xs border-b-white/5">
                <TableHead className="h-9 text-muted-foreground">Symbol</TableHead>
                <TableHead className="h-9 text-right text-muted-foreground">LTP</TableHead>
                <TableHead className="h-9 text-right text-muted-foreground">Chg%</TableHead>
                <TableHead className="h-9 text-center text-muted-foreground">Chart</TableHead>
                <TableHead className="h-9 text-right text-muted-foreground">Vol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {losers.map((s: any) => (
                <TableRow
                  key={s.symbol}
                  className="text-sm font-mono cursor-pointer hover:bg-bearish/[0.04] transition-all duration-150 group border-b-white/5 border-l-2 border-l-transparent hover:border-l-bearish"
                  onClick={() => navigate(`/option-chain?symbol=${s.symbol}`)}
                >
                  <TableCell className="font-medium font-sans py-2 px-4">
                    <div className="flex items-center gap-1.5">
                      <ArrowDownRight className="h-4 w-4 text-bearish shrink-0 opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-[0_0_5px_rgba(255,50,50,0.5)]" />
                      {s.symbol}
                    </div>
                  </TableCell>
                  <TableCell className="text-right py-2 text-foreground">{s.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right py-2">
                    <span className="bg-bearish/10 text-bearish px-2 py-1 rounded-md text-xs shadow-[inset_0_0_10px_rgba(255,50,50,0.1)] font-medium">{s.changePercent.toFixed(2)}%</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-center">
                    <div className="inline-block drop-shadow-[0_0_3px_rgba(255,50,50,0.3)]"><MiniChart symbol={s.symbol} width={70} height={26} /></div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground py-2 px-4">{(s.volume / 100000).toFixed(1)}L</TableCell>
                </TableRow>
              ))}
              {losers.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6 border-b-0">No data available</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
