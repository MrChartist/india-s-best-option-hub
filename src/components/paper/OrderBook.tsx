/** Open orders (cancel) and order history with fill price, charges, origin and quote source. */
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateIST, formatINR, formatNumberIN, formatTimeIST } from "@/lib/options";
import type { OrderStatus, PaperOrder } from "@/lib/paperTrading";
import { EmptyState } from "@/components/positions/ui";
import { ContextChips } from "./ContextChips";

const STATUS_VARIANT: Record<OrderStatus, "info" | "bullish" | "neutral" | "bearish"> = { OPEN: "info", FILLED: "bullish", CANCELLED: "neutral", REJECTED: "bearish" };
const ORIGIN_LABEL: Record<PaperOrder["origin"], string> = { ticket: "Ticket", basket: "Basket", sl: "Stop-loss", target: "Target", "square-off": "Exit" };

export function OrderBook({ orders, onCancel }: { orders: PaperOrder[]; onCancel: (id: string) => void }) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const open = useMemo(() => orders.filter((o) => o.status === "OPEN"), [orders]);
  const list = useMemo(() => (filter === "open" ? open : [...orders]).sort((a, b) => b.createdAt - a.createdAt).slice(0, 300), [filter, open, orders]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as "open" | "all")} aria-label="Order filter" size="sm">
          <ToggleGroupItem value="open" className="px-2.5 text-body-sm">
            Open ({open.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className="px-2.5 text-body-sm">
            All ({orders.length})
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-body-sm text-muted-foreground">Limit orders are checked on every quote update.</p>
      </div>
      {list.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState title={filter === "open" ? "No open orders" : "No orders yet"}>{filter === "open" ? "Limit orders that have not filled show up here." : "Place an order from the ticket."}</EmptyState>
        </div>
      ) : (
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Lots</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>At entry</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="whitespace-nowrap text-body-sm text-muted-foreground">
                  {formatDateIST(o.createdAt)}
                  <br />
                  {formatTimeIST(o.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-semibold">
                  {o.symbol} {formatNumberIN(o.strike)} <Badge variant={o.type === "CE" ? "bearish" : "bullish"}>{o.type}</Badge>
                  <div className="text-micro font-normal text-muted-foreground">{formatDateIST(o.expiry)}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={o.side === "BUY" ? "bullish" : "bearish"}>{o.side}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.lots}
                  <span className="ml-1 text-micro text-muted-foreground">×{o.lotSize}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-body-sm">
                  {o.orderType === "LIMIT" ? `Limit ${formatNumberIN(o.limitPrice ?? NaN, 2)}` : "Market"}
                  <div className="text-micro text-muted-foreground">{ORIGIN_LABEL[o.origin]}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.fillPrice !== undefined ? formatNumberIN(o.fillPrice, 2) : "—"}
                  {o.quoteSource === "sample" ? (
                    <Badge variant="warning" className="ml-1">
                      Sample
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{o.charges !== undefined ? formatINR(o.charges) : "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[o.status]} title={o.reason}>
                    {o.status}
                  </Badge>
                  {o.reason && o.status !== "FILLED" ? <div className="max-w-[220px] text-micro text-muted-foreground">{o.reason}</div> : null}
                </TableCell>
                <TableCell>
                  <ContextChips context={o.context} />
                </TableCell>
                <TableCell className="text-right">
                  {o.status === "OPEN" ? (
                    <Button variant="outline" size="pill" onClick={() => onCancel(o.id)} aria-label={`Cancel ${o.side} ${o.symbol} ${o.strike} ${o.type}`}>
                      <X aria-hidden="true" /> Cancel
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
