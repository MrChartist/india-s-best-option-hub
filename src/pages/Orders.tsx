import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListOrdered, Loader2, RefreshCw, X } from "lucide-react";
import { fetchOrders, cancelOrder } from "@/lib/marketApi";
import { isLiveTradingEnabled } from "@/lib/brokerConfig";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

const CANCELLABLE_STATUSES = new Set(["PENDING", "TRANSIT"]);

/** The Dhan order-book fields this page reads (Dhan's own response shape, read defensively). */
interface DhanOrderRow {
  orderId?: string;
  orderStatus?: string;
  tradingSymbol?: string;
  securityId?: string;
  transactionType?: string;
  quantity?: number;
  price?: number;
  createTime?: string;
  exchangeTime?: string;
}

const STATUS_COLOR: Record<string, string> = {
  TRADED: "text-bullish border-bullish/40",
  PENDING: "text-warning border-warning/40",
  TRANSIT: "text-warning border-warning/40",
  REJECTED: "text-bearish border-bearish/40",
  CANCELLED: "text-muted-foreground border-muted-foreground/40",
  EXPIRED: "text-muted-foreground border-muted-foreground/40",
};

// Real Dhan order book — today's orders only (Dhan's /v2/orders scope), same
// static-IP caveat as placing an order. Field names are read defensively
// (optional chaining, "—" fallbacks) since this reflects Dhan's own response
// shape rather than something this app normalizes.
export default function Orders() {
  useDocumentTitle("Orders");
  const queryClient = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const liveOn = isLiveTradingEnabled();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["dhan-orders"],
    queryFn: fetchOrders,
    refetchInterval: 15000,
    retry: 1,
    // With Live Trading off no real orders exist, so there is nothing to poll for.
    enabled: liveOn,
  });

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      await cancelOrder(orderId);
      toast.success(`Order ${orderId} cancelled`);
      queryClient.invalidateQueries({ queryKey: ["dhan-orders"] });
    } catch (e) {
      toast.error(`Could not cancel order: ${(e as Error).message}`);
    } finally {
      setCancellingId(null);
    }
  };

  const rows = (Array.isArray(orders) ? orders : []) as DhanOrderRow[];

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      <PageHeader
        icon={ListOrdered}
        eyebrow="Trade"
        title="Orders"
        description="Today's Dhan order book. Real orders only, not paper positions."
        source={
          liveOn ? (
            <Badge variant="outline" className="border-bearish/40 text-bearish">Live trading on</Badge>
          ) : (
            <Badge variant="outline">Live trading off</Badge>
          )
        }
        actions={
          <Button variant="outline" size="sm"  onClick={() => queryClient.invalidateQueries({ queryKey: ["dhan-orders"] })}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
        }
      />

      {!liveOn && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="py-3 text-body-sm text-muted-foreground">
            Live Trading is off, so no real orders are being placed — this page will stay empty. Paper positions live in Position Tracker instead.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0 overflow-auto">
          {liveOn && isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-body">Loading orders...</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-body">
              No orders today — or Dhan rejected the request (check your connection in Broker Settings; remember order APIs need a static IP whitelisted with Dhan).
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="text-body-sm">
                  <TableHead>Order ID</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o, i) => {
                  const status = o?.orderStatus || "—";
                  return (
                    <TableRow key={o?.orderId ?? i} className="text-body-sm font-mono">
                      <TableCell>{o?.orderId || "—"}</TableCell>
                      <TableCell className="font-sans">{o?.tradingSymbol || o?.securityId || "—"}</TableCell>
                      <TableCell className={o?.transactionType === "BUY" ? "text-bullish" : "text-bearish"}>{o?.transactionType || "—"}</TableCell>
                      <TableCell className="text-right">{o?.quantity ?? "—"}</TableCell>
                      <TableCell className="text-right">{typeof o?.price === "number" && Number.isFinite(o.price) ? o.price.toFixed(2) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-body-sm ${STATUS_COLOR[status] || ""}`}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{o?.createTime || o?.exchangeTime || "—"}</TableCell>
                      <TableCell className="text-center">
                        {CANCELLABLE_STATUSES.has(status) && (
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                            disabled={cancellingId === o?.orderId}
                            onClick={() => o.orderId && handleCancel(o.orderId)}
                            title="Cancel order"
                            aria-label={`Cancel order ${o?.orderId ?? ""}`}
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
