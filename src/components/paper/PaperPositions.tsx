/** Open paper positions with MTM, editable SL / target and exit, plus the closed-trade log. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dteLabel, formatDateIST, formatINR, formatNumberIN } from "@/lib/options";
import type { PaperPosition, PaperTrade } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";
import { feedSourceToQuote, signedClass, signedINR } from "@/components/positions/helpers";
import { EmptyState, SourceBadge, STICKY_CELL } from "@/components/positions/ui";
import { ContextChips } from "./ContextChips";

function RiskInput({ value, label, onCommit }: { value?: number; label: string; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState(value !== undefined ? String(value) : "");
  useEffect(() => setText(value !== undefined ? String(value) : ""), [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) return value !== undefined && onCommit(null);
    const v = Number(t);
    if (Number.isFinite(v) && v > 0 && v !== value) onCommit(v);
    else if (!(Number.isFinite(v) && v > 0)) setText(value !== undefined ? String(value) : "");
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0.05}
      step="0.05"
      value={text}
      placeholder="—"
      aria-label={label}
      className="ml-auto h-7 w-20 px-1.5 text-right text-body-sm"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function PaperPositions({
  positions,
  onExit,
  onRisk,
  builderHref,
}: {
  positions: PaperPosition[];
  /** Strategy Builder link with every open leg on this underlying. */
  builderHref?: (symbol: string) => string;
  onExit: (key: string) => void;
  onRisk: (key: string, risk: { sl?: number | null; target?: number | null }) => void;
}) {
  const rows = useMemo(() => [...positions].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.expiry.localeCompare(b.expiry) || a.strike - b.strike), [positions]);
  const total = rows.reduce((a, p) => a + p.netLots * p.lotSize * ((p.ltp ?? p.avgPrice) - p.avgPrice), 0);
  if (!rows.length) {
    return (
      <div className="p-4">
        <EmptyState title="No open paper positions">Use the order ticket to buy or sell an option, or load a basket from the option chain.</EmptyState>
      </div>
    );
  }
  return (
    <Table className="min-w-[1040px]">
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-10 bg-surface">Contract</TableHead>
          <TableHead className="text-right">Net lots</TableHead>
          <TableHead className="text-right">Avg</TableHead>
          <TableHead className="text-right">LTP</TableHead>
          <TableHead className="text-right">MTM</TableHead>
          <TableHead className="text-right">Stop-loss</TableHead>
          <TableHead className="text-right">Target</TableHead>
          <TableHead>At entry</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const ltp = p.ltp ?? p.avgPrice;
          const mtm = p.netLots * p.lotSize * (ltp - p.avgPrice);
          return (
            <TableRow key={p.key}>
              <TableCell className={cn(STICKY_CELL, "font-semibold")}>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  {p.symbol} {formatNumberIN(p.strike)} <Badge variant={p.type === "CE" ? "bearish" : "bullish"}>{p.type}</Badge>
                </div>
                <div className="text-micro font-normal text-muted-foreground">
                  {formatDateIST(p.expiry)} · {dteLabel(p.expiry)}
                </div>
              </TableCell>
              <TableCell className={cn("text-right font-semibold tabular-nums", p.netLots > 0 ? "text-bullish" : "text-bearish")}>
                {p.netLots > 0 ? "+" : "−"}
                {Math.abs(p.netLots)}
                <span className="ml-1 text-micro font-normal text-muted-foreground">×{p.lotSize}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumberIN(p.avgPrice, 2)}</TableCell>
              <TableCell className="text-right tabular-nums">
                <div className="flex items-center justify-end gap-1.5">
                  {formatNumberIN(ltp, 2)}
                  <SourceBadge source={p.markSource ? feedSourceToQuote(p.markSource, p.markSource !== "cache") : "entry"} asOf={p.markAt} />
                </div>
              </TableCell>
              <TableCell className={cn("text-right font-semibold tabular-nums", signedClass(mtm))}>{signedINR(mtm)}</TableCell>
              <TableCell className="text-right">
                <RiskInput value={p.sl} label={`Stop-loss for ${p.symbol} ${p.strike} ${p.type}`} onCommit={(v) => onRisk(p.key, { sl: v })} />
              </TableCell>
              <TableCell className="text-right">
                <RiskInput value={p.target} label={`Target for ${p.symbol} ${p.strike} ${p.type}`} onCommit={(v) => onRisk(p.key, { target: v })} />
              </TableCell>
              <TableCell>
                <ContextChips context={p.context} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {builderHref ? (
                    <Button asChild variant="ghost" size="pill" title={`Open every ${p.symbol} paper leg in the Strategy Builder`}>
                      <Link to={builderHref(p.symbol)} aria-label={`Analyse ${p.symbol} paper positions in the Strategy Builder`}>
                        <LineChart aria-hidden="true" /> Analyse
                      </Link>
                    </Button>
                  ) : null}
                  <Button variant="outline" size="pill" onClick={() => onExit(p.key)} aria-label={`Exit ${p.symbol} ${p.strike} ${p.type} at market`}>
                    <LogOut aria-hidden="true" /> Exit
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4} className="sticky left-0 bg-surface text-label text-muted-foreground">
            Unrealised (before exit charges)
          </TableCell>
          <TableCell className={cn("text-right font-semibold tabular-nums", signedClass(total))}>{signedINR(total)}</TableCell>
          <TableCell colSpan={4} />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export function ClosedTrades({ trades }: { trades: PaperTrade[] }) {
  const list = useMemo(() => trades.filter((t) => t.kind === "SETTLEMENT" || Math.abs(t.realisedGross) > 0).sort((a, b) => b.ts - a.ts).slice(0, 300), [trades]);
  if (!list.length) {
    return (
      <div className="p-4">
        <EmptyState title="No closed trades yet">Trades that reduce or close a position, and expiry settlements, are listed here.</EmptyState>
      </div>
    );
  }
  return (
    <Table className="min-w-[820px]">
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Contract</TableHead>
          <TableHead>Exit</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Gross</TableHead>
          <TableHead className="text-right" title="Charges on this exit order, or STT on exercise for a settlement. Entry charges were booked when the position opened.">Exit charges</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead>At entry</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((t) => (
          <TableRow key={t.id}>
            <TableCell className="whitespace-nowrap text-body-sm">{formatDateIST(t.date)}</TableCell>
            <TableCell className="whitespace-nowrap font-semibold">
              {t.symbol} {formatNumberIN(t.strike)} {t.type}
              <span className="ml-1 text-micro font-normal text-muted-foreground">
                {t.lots}×{t.lotSize}
              </span>
            </TableCell>
            <TableCell>
              {t.kind === "SETTLEMENT" ? <Badge variant="info">Expiry</Badge> : <Badge variant={t.origin === "sl" ? "bearish" : t.origin === "target" ? "bullish" : "neutral"}>{t.origin === "sl" ? "Stop-loss" : t.origin === "target" ? "Target" : "Manual"}</Badge>}
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumberIN(t.price, 2)}</TableCell>
            <TableCell className={cn("text-right tabular-nums", signedClass(t.realisedGross))}>{signedINR(t.realisedGross)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{formatINR(t.charges)}</TableCell>
            <TableCell className={cn("text-right font-semibold tabular-nums", signedClass(t.realisedNet))}>{signedINR(t.realisedNet)}</TableCell>
            <TableCell>
              <ContextChips context={t.context} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
