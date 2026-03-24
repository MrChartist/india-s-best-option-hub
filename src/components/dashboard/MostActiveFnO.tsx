import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { mostActiveFnO } from "@/lib/mockData";
import { Zap } from "lucide-react";

export function MostActiveFnO() {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2"><Zap className="h-4 w-4 text-warning" /> Most Active F&O</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-1">
        <Table>
          <TableHeader>
            <TableRow className="text-[10px]">
              <TableHead className="h-7">Symbol</TableHead>
              <TableHead className="h-7 text-right">LTP</TableHead>
              <TableHead className="h-7 text-right">Chg%</TableHead>
              <TableHead className="h-7 text-right">Volume</TableHead>
              <TableHead className="h-7 text-right">OI</TableHead>
              <TableHead className="h-7 text-right">OI Chg</TableHead>
              <TableHead className="h-7">Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mostActiveFnO.map((stock) => {
              const interpretationColor: Record<string, string> = {
                "Long Buildup": "text-bullish",
                "Short Buildup": "text-bearish",
                "Long Unwinding": "text-bearish",
                "Short Covering": "text-bullish",
              };
              return (
                <TableRow key={stock.symbol} className="text-xs font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${stock.symbol}`)}>
                  <TableCell className="font-medium font-sans py-1.5">{stock.symbol}</TableCell>
                  <TableCell className="text-right py-1.5">{stock.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell className={`text-right py-1.5 ${stock.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {stock.changePercent >= 0 ? "+" : ""}{stock.changePercent.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right py-1.5">{(stock.volume / 100000).toFixed(1)}L</TableCell>
                  <TableCell className="text-right py-1.5">{(stock.oi / 100000).toFixed(1)}L</TableCell>
                  <TableCell className={`text-right py-1.5 ${stock.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {stock.oiChange >= 0 ? "+" : ""}{(stock.oiChange / 100000).toFixed(1)}L
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Badge variant="outline" className={`text-[9px] ${interpretationColor[stock.oiInterpretation] || ""}`}>
                      {stock.oiInterpretation}
                    </Badge>
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
