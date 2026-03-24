import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { topGainers, topLosers } from "@/lib/mockData";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export function TopMovers() {
  const navigate = useNavigate();

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-bullish" /> Top Gainers
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="h-7">Symbol</TableHead>
                <TableHead className="h-7">Sector</TableHead>
                <TableHead className="h-7 text-right">LTP</TableHead>
                <TableHead className="h-7 text-right">Chg%</TableHead>
                <TableHead className="h-7 text-right">Vol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topGainers.map((s) => (
                <TableRow key={s.symbol} className="text-xs font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${s.symbol}`)}>
                  <TableCell className="font-medium font-sans py-1.5">{s.symbol}</TableCell>
                  <TableCell className="text-muted-foreground font-sans text-[10px] py-1.5">{s.sector}</TableCell>
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
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="h-7">Symbol</TableHead>
                <TableHead className="h-7">Sector</TableHead>
                <TableHead className="h-7 text-right">LTP</TableHead>
                <TableHead className="h-7 text-right">Chg%</TableHead>
                <TableHead className="h-7 text-right">Vol</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topLosers.map((s) => (
                <TableRow key={s.symbol} className="text-xs font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${s.symbol}`)}>
                  <TableCell className="font-medium font-sans py-1.5">{s.symbol}</TableCell>
                  <TableCell className="text-muted-foreground font-sans text-[10px] py-1.5">{s.sector}</TableCell>
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
