import { useState, useMemo, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Crosshair } from "lucide-react";
import { getOptionChain, expiryDates, fnoStocks, getMaxPain } from "@/lib/mockData";

const underlyings = [
  { label: "NIFTY 50", value: "NIFTY" },
  { label: "BANK NIFTY", value: "BANKNIFTY" },
  { label: "FIN NIFTY", value: "FINNIFTY" },
  { label: "MIDCAP NIFTY", value: "MIDCPNIFTY" },
  ...fnoStocks.map(s => ({ label: s, value: s })),
];

function OIBar({ value, max, side }: { value: number; max: number; side: "call" | "put" }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className={`h-3 rounded-sm ${side === "call" ? "bg-bullish/25" : "bg-bearish/25"}`} style={{ width: "60px" }}>
      <div
        className={`h-full rounded-sm ${side === "call" ? "bg-bullish/60" : "bg-bearish/60"}`}
        style={{ width: `${pct}%`, float: side === "call" ? "right" : "left" }}
      />
    </div>
  );
}

export default function OptionChain() {
  const [searchParams] = useSearchParams();
  const [symbol, setSymbol] = useState(searchParams.get("symbol") || "NIFTY");
  const [expiry, setExpiry] = useState(expiryDates[0].value);
  const [showGreeks, setShowGreeks] = useState(false);
  const [showBidAsk, setShowBidAsk] = useState(false);
  const atmRef = useRef<HTMLTableRowElement>(null);

  const { data: chain, spotPrice, lotSize, stepSize } = useMemo(() => getOptionChain(symbol), [symbol]);
  const maxPain = useMemo(() => getMaxPain(chain), [chain]);
  const atmStrike = useMemo(() => Math.round(spotPrice / stepSize) * stepSize, [spotPrice, stepSize]);

  const totalCEOI = chain.reduce((s, o) => s + o.ce.oi, 0);
  const totalPEOI = chain.reduce((s, o) => s + o.pe.oi, 0);
  const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI).toFixed(2) : "0";
  const maxOI = Math.max(...chain.map(o => Math.max(o.ce.oi, o.pe.oi)));

  const selectedExpiry = expiryDates.find(e => e.value === expiry);
  const totalCEVol = chain.reduce((s, o) => s + o.ce.volume, 0);
  const totalPEVol = chain.reduce((s, o) => s + o.pe.volume, 0);

  const scrollToATM = useCallback(() => {
    atmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Option Chain</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
            <span>Spot: <span className="font-mono font-medium text-foreground">{spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></span>
            <span>Lot: <span className="font-mono">{lotSize}</span></span>
            <span>Max Pain: <span className="font-mono text-warning">{maxPain.toLocaleString("en-IN")}</span></span>
            <span>PCR: <span className={`font-mono font-medium ${Number(pcr) > 1 ? "text-bullish" : "text-bearish"}`}>{pcr}</span></span>
            <span>Expiry: <span className="font-mono">{selectedExpiry?.daysToExpiry}d</span></span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {underlyings.map(u => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {expiryDates.map(e => <SelectItem key={e.value} value={e.value}>{e.label} ({e.daysToExpiry}d)</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={scrollToATM}>
            <Crosshair className="h-3 w-3" /> ATM
          </Button>
          <div className="flex items-center gap-1.5">
            <Switch id="greeks" checked={showGreeks} onCheckedChange={setShowGreeks} className="scale-75" />
            <Label htmlFor="greeks" className="text-[10px]">Greeks</Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch id="bidask" checked={showBidAsk} onCheckedChange={setShowBidAsk} className="scale-75" />
            <Label htmlFor="bidask" className="text-[10px]">Bid/Ask</Label>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <div className="bg-card rounded-lg border p-2 text-center">
          <p className="text-[9px] text-muted-foreground">Total CE OI</p>
          <p className="text-sm font-bold font-mono">{(totalCEOI / 100000).toFixed(1)}L</p>
        </div>
        <div className="bg-card rounded-lg border p-2 text-center">
          <p className="text-[9px] text-muted-foreground">Total PE OI</p>
          <p className="text-sm font-bold font-mono">{(totalPEOI / 100000).toFixed(1)}L</p>
        </div>
        <div className="bg-card rounded-lg border p-2 text-center">
          <p className="text-[9px] text-muted-foreground">CE Volume</p>
          <p className="text-sm font-bold font-mono">{(totalCEVol / 100000).toFixed(1)}L</p>
        </div>
        <div className="bg-card rounded-lg border p-2 text-center">
          <p className="text-[9px] text-muted-foreground">PE Volume</p>
          <p className="text-sm font-bold font-mono">{(totalPEVol / 100000).toFixed(1)}L</p>
        </div>
        <div className="bg-card rounded-lg border p-2 text-center">
          <p className="text-[9px] text-muted-foreground">ATM Straddle</p>
          <p className="text-sm font-bold font-mono text-warning">
            {(() => {
              const atm = chain.find(o => o.strikePrice === atmStrike);
              return atm ? (atm.ce.ltp + atm.pe.ltp).toFixed(2) : "—";
            })()}
          </p>
        </div>
        <div className="bg-card rounded-lg border p-2 text-center">
          <p className="text-[9px] text-muted-foreground">ATM IV</p>
          <p className="text-sm font-bold font-mono">
            {(() => {
              const atm = chain.find(o => o.strikePrice === atmStrike);
              return atm ? ((atm.ce.iv + atm.pe.iv) / 2).toFixed(1) + "%" : "—";
            })()}
          </p>
        </div>
      </div>

      {/* Option Chain Table */}
      <Card>
        <CardContent className="p-0 overflow-auto max-h-[65vh]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="text-[10px]">
                <TableHead className="text-center text-bullish" colSpan={showGreeks ? (showBidAsk ? 8 : 6) : (showBidAsk ? 6 : 4)}>
                  CALLS (CE)
                </TableHead>
                <TableHead className="text-center font-bold bg-accent">STRIKE</TableHead>
                <TableHead className="text-center text-bearish" colSpan={showGreeks ? (showBidAsk ? 8 : 6) : (showBidAsk ? 6 : 4)}>
                  PUTS (PE)
                </TableHead>
              </TableRow>
              <TableRow className="text-[10px]">
                {showGreeks && <><TableHead className="text-right text-bullish">Δ</TableHead><TableHead className="text-right text-bullish">IV</TableHead></>}
                {showBidAsk && <><TableHead className="text-right text-bullish">Bid</TableHead><TableHead className="text-right text-bullish">Ask</TableHead></>}
                <TableHead className="text-right text-bullish">OI Chg</TableHead>
                <TableHead className="text-right text-bullish">
                  <div className="flex items-center justify-end gap-1">OI <span className="text-[8px] text-muted-foreground">Bar</span></div>
                </TableHead>
                <TableHead className="text-right text-bullish">Vol</TableHead>
                <TableHead className="text-right text-bullish font-bold">LTP</TableHead>
                <TableHead className="text-center font-bold bg-accent w-[100px]">STRIKE</TableHead>
                <TableHead className="text-left text-bearish font-bold">LTP</TableHead>
                <TableHead className="text-left text-bearish">Vol</TableHead>
                <TableHead className="text-left text-bearish">
                  <div className="flex items-center gap-1"><span className="text-[8px] text-muted-foreground">Bar</span> OI</div>
                </TableHead>
                <TableHead className="text-left text-bearish">OI Chg</TableHead>
                {showBidAsk && <><TableHead className="text-left text-bearish">Bid</TableHead><TableHead className="text-left text-bearish">Ask</TableHead></>}
                {showGreeks && <><TableHead className="text-left text-bearish">IV</TableHead><TableHead className="text-left text-bearish">Δ</TableHead></>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {chain.map((row) => {
                const isATM = row.strikePrice === atmStrike;
                const isITMCall = row.strikePrice < spotPrice;
                const isITMPut = row.strikePrice > spotPrice;
                const isMaxPain = row.strikePrice === maxPain;
                const straddle = row.ce.ltp + row.pe.ltp;

                return (
                  <TableRow
                    key={row.strikePrice}
                    ref={isATM ? atmRef : undefined}
                    className={`text-[11px] font-mono ${isATM ? "bg-primary/10 border-y border-primary/30" : ""}`}
                  >
                    {showGreeks && (
                      <>
                        <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.delta.toFixed(3)}</TableCell>
                        <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.iv.toFixed(1)}</TableCell>
                      </>
                    )}
                    {showBidAsk && (
                      <>
                        <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.bidPrice.toFixed(2)}</TableCell>
                        <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.askPrice.toFixed(2)}</TableCell>
                      </>
                    )}
                    <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""} ${row.ce.oiChange > 0 ? "text-bullish" : "text-bearish"}`}>
                      {row.ce.oiChange > 0 ? "+" : ""}{(row.ce.oiChange / 1000).toFixed(1)}K
                    </TableCell>
                    <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""}`}>
                      <div className="flex items-center justify-end gap-1">
                        <span>{(row.ce.oi / 1000).toFixed(0)}K</span>
                        <OIBar value={row.ce.oi} max={maxOI} side="call" />
                      </div>
                    </TableCell>
                    <TableCell className={`text-right py-1.5 ${isITMCall ? "bg-bullish/10" : ""}`}>{(row.ce.volume / 1000).toFixed(1)}K</TableCell>
                    <TableCell className={`text-right py-1.5 font-medium ${isITMCall ? "bg-bullish/10" : ""}`}>{row.ce.ltp.toFixed(2)}</TableCell>
                    <TableCell className="text-center py-1.5 font-bold bg-accent">
                      <div className="flex items-center justify-center gap-1">
                        {row.strikePrice.toLocaleString("en-IN")}
                        {isATM && <Badge variant="outline" className="text-[8px] px-1 py-0 border-primary text-primary h-4">ATM</Badge>}
                        {isMaxPain && <Badge variant="outline" className="text-[8px] px-1 py-0 border-warning text-warning h-4">MP</Badge>}
                      </div>
                      <p className="text-[8px] text-muted-foreground">{straddle.toFixed(1)}</p>
                    </TableCell>
                    <TableCell className={`text-left py-1.5 font-medium ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.ltp.toFixed(2)}</TableCell>
                    <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""}`}>{(row.pe.volume / 1000).toFixed(1)}K</TableCell>
                    <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""}`}>
                      <div className="flex items-center gap-1">
                        <OIBar value={row.pe.oi} max={maxOI} side="put" />
                        <span>{(row.pe.oi / 1000).toFixed(0)}K</span>
                      </div>
                    </TableCell>
                    <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""} ${row.pe.oiChange > 0 ? "text-bullish" : "text-bearish"}`}>
                      {row.pe.oiChange > 0 ? "+" : ""}{(row.pe.oiChange / 1000).toFixed(1)}K
                    </TableCell>
                    {showBidAsk && (
                      <>
                        <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.bidPrice.toFixed(2)}</TableCell>
                        <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.askPrice.toFixed(2)}</TableCell>
                      </>
                    )}
                    {showGreeks && (
                      <>
                        <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.iv.toFixed(1)}</TableCell>
                        <TableCell className={`text-left py-1.5 ${isITMPut ? "bg-bearish/10" : ""}`}>{row.pe.delta.toFixed(3)}</TableCell>
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
