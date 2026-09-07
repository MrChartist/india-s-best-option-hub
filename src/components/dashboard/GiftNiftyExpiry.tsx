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
      <Card className="border-primary/20 hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" /> GIFT Nifty (SGX)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {giftNifty && giftNifty.lastPrice > 0 ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold font-mono">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
                <span className={`text-base font-mono font-medium ${giftNifty.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                  {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)} ({giftNifty.changePercent.toFixed(2)}%)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-md bg-accent/50 border border-border/70">
                  <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Contracts</p>
                  <p className="font-mono font-semibold text-sm">{giftNifty.contractsTraded?.toLocaleString("en-IN") || "—"}</p>
                </div>
                <div className="p-2.5 rounded-md bg-accent/50 border border-border/70">
                  <p className="text-muted-foreground uppercase tracking-wider mb-0.5">Expiry</p>
                  <p className="font-mono font-semibold text-sm">{giftNifty.expiry || "—"}</p>
                </div>
              </div>
              {indicativeNifty && (
                <div className="p-2.5 rounded-md bg-accent/30 text-xs border border-border/70 flex flex-wrap gap-x-3 gap-y-1 items-center">
                  <span className="text-muted-foreground">Nifty Close: </span>
                  <span className="font-mono font-semibold">{indicativeNifty.value.toLocaleString("en-IN")}</span>
                  <span className="text-muted-foreground ml-auto">Gap: </span>
                  <span className={`font-mono font-semibold text-sm ${(giftNifty.lastPrice - indicativeNifty.value) >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {(giftNifty.lastPrice - indicativeNifty.value) >= 0 ? "+" : ""}{(giftNifty.lastPrice - indicativeNifty.value).toFixed(0)} pts
                  </span>
                </div>
              )}
              {giftNifty.timestamp && <p className="text-xs text-muted-foreground font-mono">{giftNifty.timestamp}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">GIFT Nifty data unavailable</p>
          )}
        </CardContent>
      </Card>

      {/* NSE Expiry */}
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-warning" /> NSE F&O Expiry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-xs border-b-white/5">
                <TableHead className="h-9 px-5">Contract</TableHead>
                <TableHead className="h-9">Type</TableHead>
                <TableHead className="h-9">Lot</TableHead>
                <TableHead className="h-9 text-right">Expiry</TableHead>
                <TableHead className="h-9 text-right px-5">Time Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nearestExpiries.filter((c) => c.exchange === "NSE").map((c) => {
                const isUrgent = c.timeLeft.startsWith("0d") || c.timeLeft.includes("h left");
                return (
                  <TableRow key={c.symbol} className="text-sm font-mono cursor-pointer hover:bg-accent/50 border-b-white/5" onClick={() => navigate(`/option-chain?symbol=${c.symbol}`)}>
                    <TableCell className="font-sans font-medium py-2 px-5">{c.symbol}</TableCell>
                    <TableCell className="text-muted-foreground py-2">{c.type}</TableCell>
                    <TableCell className="py-2">{c.lotSize}</TableCell>
                    <TableCell className="text-right text-muted-foreground py-2">{c.expiry ? new Date(c.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</TableCell>
                    <TableCell className="text-right py-2 px-5">
                      <span className={`px-2 py-1 rounded-md text-xs font-medium ${isUrgent ? "bg-bearish/15 text-bearish font-semibold" : "bg-warning/10 text-warning"}`}>{c.timeLeft}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* MCX Expiry */}
      <Card className="hover:shadow-card-hover transition-all duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-warning" /> MCX Commodity Expiry
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="text-xs border-b-white/5">
                <TableHead className="h-9 px-5">Contract</TableHead>
                <TableHead className="h-9">Type</TableHead>
                <TableHead className="h-9">Lot</TableHead>
                <TableHead className="h-9 text-right">Expiry</TableHead>
                <TableHead className="h-9 text-right px-5">Time Left</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nearestExpiries.filter((c) => c.exchange === "MCX").map((c) => (
                <TableRow key={c.symbol} className="text-sm font-mono border-b-white/5 hover:bg-accent/30 transition-colors">
                  <TableCell className="font-sans font-medium py-2 px-5">{c.symbol}</TableCell>
                  <TableCell className="text-muted-foreground py-2">{c.type}</TableCell>
                  <TableCell className="py-2">{c.lotSize}</TableCell>
                  <TableCell className="text-right text-muted-foreground py-2">{c.expiry ? new Date(c.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</TableCell>
                  <TableCell className="text-right py-2 px-5">
                    <span className="px-2 py-1 rounded-md text-xs bg-accent/80 text-muted-foreground font-medium">{c.timeLeft}</span>
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
