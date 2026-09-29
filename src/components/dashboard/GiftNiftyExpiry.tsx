import { useNavigate } from "react-router-dom";
import { CalendarClock, Plane } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useExpiryList } from "@/hooks/useMarketData";
import { cn } from "@/lib/utils";

const EXPIRY_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

interface GiftNiftyData {
  lastPrice: number;
  change: number;
  changePercent: number;
  contractsTraded?: number;
  expiry?: string;
  timestamp?: string;
}

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function ExpiryRow({ symbol }: { symbol: string }) {
  const navigate = useNavigate();
  const { data } = useExpiryList(symbol);
  const [next, following] = data?.expiries ?? [];

  return (
    <TableRow className="cursor-pointer" onClick={() => navigate(`/option-chain?symbol=${symbol}`)}>
      <TableCell className="px-5 py-2.5 font-sans font-medium">{symbol}</TableCell>
      <TableCell className="num py-2.5 font-mono">{next ? dayMonth(next.value) : "—"}</TableCell>
      <TableCell className="py-2.5 text-right">
        {next ? (
          <span
            className={cn(
              "num rounded-full px-2.5 py-1 font-mono text-xs font-semibold",
              next.daysToExpiry <= 1 ? "bg-bearish/15 text-bearish" : "bg-warning/15 text-warning",
            )}
          >
            {next.daysToExpiry === 0 ? "Today" : `${next.daysToExpiry}d`}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="num px-5 py-2.5 text-right font-mono text-muted-foreground">
        {following ? dayMonth(following.value) : "—"}
      </TableCell>
    </TableRow>
  );
}

export function GiftNiftyExpiry({
  giftNifty,
  indicativeNifty,
}: {
  giftNifty: GiftNiftyData | null | undefined;
  indicativeNifty?: { value: number } | null;
}) {
  const gap = giftNifty && indicativeNifty ? giftNifty.lastPrice - indicativeNifty.value : null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plane className="h-4 w-4 text-primary" /> GIFT Nifty
          </CardTitle>
        </CardHeader>
        <CardContent>
          {giftNifty && giftNifty.lastPrice > 0 ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="num font-mono text-3xl font-semibold">{giftNifty.lastPrice.toLocaleString("en-IN")}</span>
                <span className={cn("num font-mono text-base font-medium", giftNifty.change >= 0 ? "text-bullish" : "text-bearish")}>
                  {giftNifty.change >= 0 ? "+" : ""}{giftNifty.change.toFixed(0)} ({giftNifty.changePercent.toFixed(2)}%)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="glass-control rounded-xl p-3">
                  <p className="mb-0.5 uppercase tracking-wider text-muted-foreground">Contracts</p>
                  <p className="num font-mono text-sm font-semibold">{giftNifty.contractsTraded?.toLocaleString("en-IN") || "—"}</p>
                </div>
                <div className="glass-control rounded-xl p-3">
                  <p className="mb-0.5 uppercase tracking-wider text-muted-foreground">Expiry</p>
                  <p className="num font-mono text-sm font-semibold">{giftNifty.expiry || "—"}</p>
                </div>
                <div className="glass-control rounded-xl p-3">
                  <p className="mb-0.5 uppercase tracking-wider text-muted-foreground">Gap vs close</p>
                  <p className={cn("num font-mono text-sm font-semibold", gap === null ? "" : gap >= 0 ? "text-bullish" : "text-bearish")}>
                    {gap === null ? "—" : `${gap >= 0 ? "+" : ""}${gap.toFixed(0)} pts`}
                  </p>
                </div>
              </div>
              {giftNifty.timestamp && <p className="num font-mono text-xs text-muted-foreground">{giftNifty.timestamp}</p>}
            </div>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">GIFT Nifty data unavailable</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="h-4 w-4 text-warning" /> Index expiries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 px-5">Index</TableHead>
                <TableHead className="h-9">Next</TableHead>
                <TableHead className="h-9 text-right">In</TableHead>
                <TableHead className="h-9 px-5 text-right">Following</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXPIRY_INDICES.map((s) => <ExpiryRow key={s} symbol={s} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
