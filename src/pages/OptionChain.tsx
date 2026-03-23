import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getOptionChain, expiryDates, fnoStocks, getMaxPain } from "@/lib/mockData";

const underlyings = [
  { label: "NIFTY 50", value: "NIFTY" },
  { label: "BANK NIFTY", value: "BANKNIFTY" },
  { label: "FIN NIFTY", value: "FINNIFTY" },
  ...fnoStocks.map(s => ({ label: s, value: s })),
];

export default function OptionChain() {
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(searchParams.get("symbol") || "NIFTY");
  const [expiry, setExpiry] = useState(expiryDates[0].value);
  const [showGreeks, setShowGreeks] = useState(false);

  const { data: chain, spotPrice, lotSize } = useMemo(() => getOptionChain(symbol), [symbol]);
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);
  const atmStrike = useMemo(() => {
    const stepSize = symbol === "BANKNIFTY" ? 100 : symbol === "NIFTY" || symbol === "FINNIFTY" ? 50 : 25;
    return Math.round(spotPrice / stepSize) * stepSize;
  }, [spotPrice, symbol]);

  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(2) : "0";

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Option Chain</h1>
          <p className="text-sm text-muted-foreground">
            Spot: <span className="font-mono font-medium text-foreground">{spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            {" · "}Lot: <span className="font-mono">{lotSize}</span>
            {" · "}Max Pain: <span className="font-mono text-warning">{maxPain.toLocaleString("en-IN")}</span>
            {" · "}PCR: <span className="font-mono">{pcr}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {underlyings.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {expiryDates.map(e => <SelectItem key={e.value} value={e.value}>{e.label} ({e.daysToExpiry}d)</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Switch id="greeks" checked={showGreeks} onCheckedChange={setShowGreeks} />
            <Label htmlFor="greeks" className="text-xs">Greeks</Label>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                {showGreeks && <><TableHead className="text-right text-bullish">Delta</TableHead><TableHead className="text-right text-bullish">IV</TableHead></>}
                <TableHead className="text-right text-bullish">OI Chg</TableHead>
                <TableHead className="text-right text-bullish">OI</TableHead>
                <TableHead className="text-right text-bullish">Volume</TableHead>
                <TableHead className="text-right text-bullish">LTP</TableHead>
                <TableHead className="text-center font-bold bg-accent">STRIKE</TableHead>
                <TableHead className="text-left text-bearish">LTP</TableHead>
                <TableHead className="text-left text-bearish">Volume</TableHead>
                <TableHead className="text-left text-bearish">OI</TableHead>
                <TableHead className="text-left text-bearish">OI Chg</TableHead>
                {showGreeks && <><TableHead className="text-left text-bearish">IV</TableHead><TableHead className="text-left text-bearish">Delta</TableHead></>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {chain.map((row) => {
                const isATM = row.strikePrice === atmStrike;
                const isITMCall = row.strikePrice < spotPrice;
                const isITMPut = row.strikePrice > spotPrice;
                const isMaxPain = row.strikePrice === maxPain;

                return (
                  <TableRow
                    key={row.strikePrice}
                    className={`text-xs font-mono ${isATM ? "bg-primary/10 border-primary/30" : ""}`}
                  >
                    {showGreeks && (
                      <>
                        <TableCell className={`text-right ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.delta.toFixed(3)}</TableCell>
                        <TableCell className={`text-right ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.iv.toFixed(1)}</TableCell>
                      </>
                    )}
                    <TableCell className={`text-right ${isITMCall ? "bg-bullish/10" : ""} ${row.ce.oiChange > 0 ? "text-bullish" : "text-bearish"}`}>
                      {row.ce.oiChange > 0 ? "+" : ""}{(row.ce.oiChange / 1000).toFixed(1)}K
                    </TableCell>
                    <TableCell className={`text-right ${isITMCall ? "bg-bullish/10" : ""}`}>{(row.ce.oi / 1000).toFixed(1)}K</TableCell>
                    <TableCell className={`text-right ${isITMCall ? "bg-bullish/10" : ""}`}>{(row.ce.volume / 1000).toFixed(1)}K</TableCell>
                    <TableCell className={`text-right font-medium ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.ltp.toFixed(2)}</TableCell>
                    <TableCell className="text-center font-bold bg-accent">
                      <div className="flex items-center justify-center gap-1">
                        {row.strikePrice.toLocaleString("en-IN")}
                        {isATM && <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary text-primary">ATM</Badge>}
                        {isMaxPain && <Badge variant="outline" className="text-[9px] px-1 py-0 border-warning text-warning">MP</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className={`text-left font-medium ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.ltp.toFixed(2)}</TableCell>
                    <TableCell className={`text-left ${isITMPut ? "bg-bearish/10" : ""}`}>{(row.pe.volume / 1000).toFixed(1)}K</TableCell>
                    <TableCell className={`text-left ${isITMPut ? "bg-bearish/10" : ""}`}>{(row.pe.oi / 1000).toFixed(1)}K</TableCell>
                    <TableCell className={`text-left ${isITMPut ? "bg-bearish/10" : ""} ${row.pe.oiChange > 0 ? "text-bullish" : "text-bearish"}`}>
                      {row.pe.oiChange > 0 ? "+" : ""}{(row.pe.oiChange / 1000).toFixed(1)}K
                    </TableCell>
                    {showGreeks && (
                      <>
                        <TableCell className={`text-left ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.iv.toFixed(1)}</TableCell>
                        <TableCell className={`text-left ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.delta.toFixed(3)}</TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
