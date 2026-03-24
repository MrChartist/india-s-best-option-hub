import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plane, CalendarClock } from "lucide-react";

interface ExpiryContract {
  symbol: string;
  exchange: string;
  lotSize: number;
  type: string;
  expiry: string;
  timeLeft: string;
}

interface GiftNiftyData {
  lastPrice: number;
  change: number;
  changePercent: number;
  contractsTraded?: number;
  expiry?: string;
  timestamp?: string;
}

interface Props {
  giftNifty: GiftNiftyData | null | undefined;
  indicativeNifty?: { value: number } | null;
  nearestExpiries: ExpiryContract[];
}

export function GiftNiftyExpiry({ giftNifty, indicativeNifty, nearestExpiries }: Props) {
  const navigate = useNavigate();

  return (
    <div className="grid lg:grid-cols-3 gap-3">
      {/* GIFT Nifty */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plane className="h-4 w-4 text-primary" /> GIFT Nifty (SGX)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          {giftNifty && giftNifty.lastPrice > 0 ? (
            <div className="space-y-2.5">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold font-mono">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
                <span className={`text-sm font-mono font-medium ${giftNifty.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)} ({giftNifty.changePercent.toFixed(2)}%)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="p-2 rounded-md bg-accent/50">
                  <p className="text-muted-foreground">Contracts</p>
                  <p className="font-mono font-bold">{giftNifty.contractsTraded?.toLocaleString("en-IN") || "—"}</p>
                </div>
                <div className="p-2 rounded-md bg-accent/50">
                  <p className="text-muted-foreground">Expiry</p>
                  <p className="font-mono font-bold">{giftNifty.expiry || "—"}</p>
                </div>
              </div>
              {indicativeNifty && (
                <div className="p-2 rounded-md bg-accent/30 text-[10px]">
                  <span className="text-muted-foreground">Nifty Close: </span>
                  <span className="font-mono font-bold">{indicativeNifty.value.toLocaleString("en-IN")}</span>
                  <span className="text-muted-foreground ml-2">Gap: </span>
                  <span className={`font-mono font-bold ${(giftNifty.lastPrice - indicativeNifty.value) >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {(giftNifty.lastPrice - indicativeNifty.value) >= 0 ? "+" : ""}{(giftNifty.lastPrice - indicativeNifty.value).toFixed(0)} pts
                  </span>
                </div>
              )}
              {giftNifty.timestamp && <p className="text-[9px] text-muted-foreground font-mono">{giftNifty.timestamp}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">GIFT Nifty data unavailable</p>
          )}
        </CardContent>
      </Card>

      {/* NSE Expiry */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-warning" /> NSE F&O Expiry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="h-7">Contract</TableHead>
                <TableHead className="h-7">Type</TableHead>
                <TableHead className="h-7">Lot</TableHead>
                <TableHead className="h-7 text-right">Expiry</TableHead>
                <TableHead className="h-7 text-right">Time Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nearestExpiries.filter((c) => c.exchange === "NSE").map((c) => {
                const isUrgent = c.timeLeft.startsWith("0d") || c.timeLeft.includes("h left");
                return (
                  <TableRow key={c.symbol} className="text-[11px] font-mono cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/option-chain?symbol=${c.symbol}`)}>
                    <TableCell className="font-sans font-medium py-1.5">{c.symbol}</TableCell>
                    <TableCell className="text-muted-foreground py-1.5">{c.type}</TableCell>
                    <TableCell className="py-1.5">{c.lotSize}</TableCell>
                    <TableCell className="text-right text-muted-foreground py-1.5">{c.expiry ? new Date(c.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</TableCell>
                    <TableCell className="text-right py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] ${isUrgent ? "bg-bearish/15 text-bearish font-bold" : "bg-warning/10 text-warning"}`}>{c.timeLeft}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* MCX Expiry */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-warning" /> MCX Commodity Expiry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px]">
                <TableHead className="h-7">Contract</TableHead>
                <TableHead className="h-7">Type</TableHead>
                <TableHead className="h-7">Lot</TableHead>
                <TableHead className="h-7 text-right">Expiry</TableHead>
                <TableHead className="h-7 text-right">Time Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nearestExpiries.filter((c) => c.exchange === "MCX").map((c) => (
                <TableRow key={c.symbol} className="text-[11px] font-mono">
                  <TableCell className="font-sans font-medium py-1.5">{c.symbol}</TableCell>
                  <TableCell className="text-muted-foreground py-1.5">{c.type}</TableCell>
                  <TableCell className="py-1.5">{c.lotSize}</TableCell>
                  <TableCell className="text-right text-muted-foreground py-1.5">{c.expiry ? new Date(c.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</TableCell>
                  <TableCell className="text-right py-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-accent text-muted-foreground">{c.timeLeft}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
