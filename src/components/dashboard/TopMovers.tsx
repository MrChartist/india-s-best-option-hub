import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFnOStocks } from "@/hooks/useMarketData";
import { ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function TopMovers() {
  const navigate = useNavigate();
  const { data, isLoading } = useFnOStocks();
  const gainers = data?.gainers || [];
  const losers = data?.losers || [];
  const isLive = data?.isLive || false;

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-bullish" /> Top Gainers
            {isLive && <Badge variant="outline" className="text-[8px] h-4 px-1 border-bullish/30 text-bullish ml-auto">LIVE</Badge>}
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
                <TableHead className="h-7 text-right">Vol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gainers.map((s: any) => (
                <TableRow key={s.symbol} className="text-xs font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${s.symbol}`)}>
                  <TableCell className="font-medium font-sans py-1.5">{s.symbol}</TableCell>
                  <TableCell className="text-right py-1.5">{s.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <span className="bg-bullish/10 text-bullish px-1.5 py-0.5 rounded text-[10px]">+{s.changePercent.toFixed(2)}%</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground py-1.5">{(s.volume / 100000).toFixed(1)}L</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowDownRight className="h-4 w-4 text-bearish" /> Top Losers
            {isLive && <Badge variant="outline" className="text-[8px] h-4 px-1 border-bearish/30 text-bearish ml-auto">LIVE</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="h-7">Symbol</TableHead>
                <TableHead className="h-7 text-right">LTP</TableHead>
                <TableHead className="h-7 text-right">Chg%</TableHead>
                <TableHead className="h-7 text-right">Vol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {losers.map((s: any) => (
                <TableRow key={s.symbol} className="text-xs font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${s.symbol}`)}>
                  <TableCell className="font-medium font-sans py-1.5">{s.symbol}</TableCell>
                  <TableCell className="text-right py-1.5">{s.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <span className="bg-bearish/10 text-bearish px-1.5 py-0.5 rounded text-[10px]">{s.changePercent.toFixed(2)}%</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground py-1.5">{(s.volume / 100000).toFixed(1)}L</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
