/**
 * Open positions grouped by strategy (strategyId, else symbol + expiry), with live CMP, solved IV,
 * Greeks in rupees and P&L net of round-trip charges. Plus the closed-positions ledger.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FlaskConical, LogOut, RotateCcw, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dteLabel, formatDateIST, formatINR, formatNumberIN, formatPct, formatStrike } from "@/lib/options";
import { buildClosedPosition, type ClosedPosition, type TrackedPosition } from "@/lib/positionStore";
import { cn } from "@/lib/utils";
import { strategyKey, type PositionLive } from "./analytics";
import { signedClass, signedINR, type QuoteSource } from "./helpers";
import { HelpTip, SourceBadge } from "./ui";

export interface PositionRow {
  p: TrackedPosition;
  live: PositionLive;
  quoteSource: QuoteSource;
  quoteAsOf?: number;
}

function CmpCell({ row, onSet, onReset }: { row: PositionRow; onSet: (v: number) => void; onReset: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v >= 0) onSet(v);
    setEditing(false);
  };
  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={ref}
          type="number"
          inputMode="decimal"
          step="0.05"
          min={0}
          value={text}
          aria-label={`Current price for ${row.p.symbol} ${row.p.strike} ${row.p.type}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-7 w-20 px-1.5 text-body-sm"
        />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={commit} aria-label="Save price">
          <Check />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(false)} aria-label="Cancel">
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        className="rounded px-1 tabular-nums hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
        onClick={() => {
          setText(String(row.p.currentPrice));
          setEditing(true);
        }}
        aria-label={`Edit current price ${formatINR(row.p.currentPrice)}`}
        title="Click to override the price"
      >
        {formatNumberIN(row.p.currentPrice, 2)}
      </button>
      <SourceBadge source={row.quoteSource} asOf={row.quoteAsOf} />
      {row.p.cmpManual ? (
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onReset} aria-label="Use the live price again" title="Use the live price again">
          <RotateCcw className="!size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function CloseDialog({ position, defaultPrice, open, onOpenChange, onConfirm }: { position: TrackedPosition | null; defaultPrice: number; open: boolean; onOpenChange: (o: boolean) => void; onConfirm: (price: number) => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText(Number.isFinite(defaultPrice) ? String(defaultPrice) : "");
  }, [open, defaultPrice]);
  const price = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(price) && price >= 0;
  const preview = useMemo(() => (position && valid ? buildClosedPosition(position, price) : null), [position, price, valid]);
  if (!position) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Close {position.action === "BUY" ? "long" : "short"} {position.symbol} {formatStrike(position.strike)} {position.type}
          </DialogTitle>
          <DialogDescription>
            {position.lots} lot{position.lots === 1 ? "" : "s"} × {position.lotSize} · entry {formatINR(position.entryPrice)}. Charges for the entry and exit orders are deducted.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConfirm(price);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="close-price">Exit price (₹ per unit)</Label>
            <Input id="close-price" type="number" inputMode="decimal" step="0.05" min={0} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </div>
          {preview ? (
            <dl className="grid grid-cols-3 gap-2 rounded-tile border border-border bg-surface/60 p-3 text-body-sm">
              <div>
                <dt className="text-label uppercase text-muted-foreground">Gross</dt>
                <dd className={cn("font-num tabular-nums", signedClass(preview.grossPnl ?? 0))}>{signedINR(preview.grossPnl ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-label uppercase text-muted-foreground">Charges</dt>
                <dd className="font-num tabular-nums text-bearish">{formatINR(-(preview.charges ?? 0), { decimals: 0 })}</dd>
              </div>
              <div>
                <dt className="text-label uppercase text-muted-foreground">Net</dt>
                <dd className={cn("font-num font-semibold tabular-nums", signedClass(preview.netPnl ?? 0))}>{signedINR(preview.netPnl ?? 0)}</dd>
              </div>
            </dl>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Close position
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const fmtGreekINR = (v: number) => (Number.isFinite(v) ? signedINR(v) : "—");

export function PositionsTable({
  rows,
  onSetCmp,
  onResetCmp,
  onClose,
  onRemove,
  onEditLots,
  readOnly = false,
}: {
  rows: PositionRow[];
  /** Paper-account view: no CMP override, resize, close or delete (manage those in Paper Trading). */
  readOnly?: boolean;
  onSetCmp: (id: string, price: number) => void;
  onResetCmp: (id: string) => void;
  onClose: (id: string, price: number) => void;
  onRemove: (id: string) => void;
  onEditLots: (id: string, lots: number) => void;
}) {
  const [closing, setClosing] = useState<PositionRow | null>(null);
  const [editingLots, setEditingLots] = useState<{ id: string; text: string } | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, PositionRow[]>();
    for (const r of rows) {
      const k = strategyKey(r.p);
      const arr = m.get(k);
      if (arr) arr.push(r);
      else m.set(k, [r]);
    }
    return [...m.entries()].map(([key, list]) => ({
      key,
      list: list.sort((a, b) => a.p.strike - b.p.strike || a.p.type.localeCompare(b.p.type)),
      net: list.reduce((a, r) => a + r.live.netPnl, 0),
      theta: list.reduce((a, r) => a + (Number.isFinite(r.live.theta) ? r.live.theta : 0), 0),
    }));
  }, [rows]);

  const totals = useMemo(
    () => ({
      gross: rows.reduce((a, r) => a + r.live.grossPnl, 0),
      charges: rows.reduce((a, r) => a + r.live.charges, 0),
      net: rows.reduce((a, r) => a + r.live.netPnl, 0),
      theta: rows.reduce((a, r) => a + (Number.isFinite(r.live.theta) ? r.live.theta : 0), 0),
      vega: rows.reduce((a, r) => a + (Number.isFinite(r.live.vega) ? r.live.vega : 0), 0),
    }),
    [rows],
  );

  return (
    <>
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-surface">Contract</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Lots</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">CMP</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center gap-1">
                IV <HelpTip text="Implied volatility solved from the CMP with Black-76 on the forward. Falls back to the chain IV when the price cannot be inverted." />
              </span>
            </TableHead>
            <TableHead className="text-right">Δ lots</TableHead>
            <TableHead className="text-right">θ ₹/day</TableHead>
            <TableHead className="text-right">Vega ₹/pt</TableHead>
            <TableHead className="text-right">Gross P&L</TableHead>
            <TableHead className="text-right">
              <span className="inline-flex items-center gap-1">
                Net P&L <HelpTip text="Gross P&L minus charges for the entry order and an exit at the CMP (brokerage, STT, exchange, SEBI, stamp, GST)." />
              </span>
            </TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              {groups.length > 1 || g.list[0].p.tag ? (
                <TableRow className="bg-surface/50 hover:bg-surface/50">
                  <TableCell colSpan={13} className="py-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-body-sm">
                      <span className="font-semibold">{g.list[0].p.tag || `${g.list[0].p.symbol} · ${g.list[0].live.expiryIso ? formatDateIST(g.list[0].live.expiryIso) : "no expiry"}`}</span>
                      <span className="text-muted-foreground">{g.list.length} leg{g.list.length === 1 ? "" : "s"}</span>
                      <span className={cn("font-num tabular-nums", signedClass(g.net))}>net {signedINR(g.net)}</span>
                      <span className="font-num tabular-nums text-muted-foreground">θ {fmtGreekINR(g.theta)}/day</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : null}
              {g.list.map((r) => {
                const p = r.p;
                const l = r.live;
                const expLabel = l.expiryIso ? dteLabel(l.expiryIso) : "—";
                return (
                  <TableRow key={p.id} className={cn(l.expired && "opacity-70")}>
                    <TableCell className="sticky left-0 z-[1] bg-card font-semibold">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        {p.symbol} {formatStrike(p.strike)}
                        <Badge variant={p.type === "CE" ? "bearish" : "bullish"}>{p.type}</Badge>
                        {p.source === "sample" ? (
                          <Badge variant="warning" title="Entry priced off generated sample data, not a market quote." aria-label="Sample-priced entry">
                            <FlaskConical aria-hidden="true" />
                            SAMPLE
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.action === "BUY" ? "bullish" : "bearish"}>{p.action}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {readOnly ? (
                        <span title={`${p.lots} × ${p.lotSize} = ${formatNumberIN(p.lots * p.lotSize)} qty`}>
                          {p.lots}
                          <span className="ml-1 text-micro text-muted-foreground">×{p.lotSize}</span>
                        </span>
                      ) : editingLots?.id === p.id ? (
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          autoFocus
                          value={editingLots.text}
                          aria-label="Lots"
                          className="ml-auto h-7 w-16 px-1.5 text-body-sm"
                          onChange={(e) => setEditingLots({ id: p.id, text: e.target.value })}
                          onBlur={() => {
                            const n = Math.floor(Number(editingLots.text));
                            if (n > 0) onEditLots(p.id, n);
                            setEditingLots(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingLots(null);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="rounded px-1 hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
                          onClick={() => setEditingLots({ id: p.id, text: String(p.lots) })}
                          aria-label={`Edit lots (${p.lots})`}
                          title={`${p.lots} × ${p.lotSize} = ${formatNumberIN(p.lots * p.lotSize)} qty`}
                        >
                          {p.lots}
                          <span className="ml-1 text-micro text-muted-foreground">×{p.lotSize}</span>
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-body-sm">
                      {l.expiryIso ? (
                        <span className={cn(l.expired ? "text-warning" : expLabel.startsWith("Expiry today") ? "font-semibold text-warning" : "")}>
                          {formatDateIST(l.expiryIso)}
                          <span className="ml-1 text-muted-foreground">· {l.expired ? "expired" : expLabel}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Set expiry
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumberIN(p.entryPrice, 2)}</TableCell>
                    <TableCell className="text-right">
                      {readOnly ? (
                        <div className="flex items-center justify-end gap-1.5 tabular-nums">
                          {formatNumberIN(p.currentPrice, 2)}
                          <SourceBadge source={r.quoteSource} asOf={r.quoteAsOf} />
                        </div>
                      ) : (
                        <CmpCell row={r} onSet={(v) => onSetCmp(p.id, v)} onReset={() => onResetCmp(p.id)} />
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number.isFinite(l.iv) ? (
                        <span title={l.ivSource === "solved" ? "Solved from CMP" : l.ivSource === "chain" ? "From the chain" : "Stored IV"}>
                          {formatPct(l.iv * 100, { decimals: 1 })}
                          {l.ivSource !== "solved" ? <span className="ml-0.5 text-micro text-muted-foreground">{l.ivSource === "chain" ? "ch" : "st"}</span> : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", signedClass(l.deltaLots))}>{Number.isFinite(l.deltaLots) ? formatNumberIN(l.deltaLots, 2) : "—"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", signedClass(l.theta))}>{fmtGreekINR(l.theta)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", signedClass(l.vega))}>{fmtGreekINR(l.vega)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", signedClass(l.grossPnl))}>{signedINR(l.grossPnl)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className={cn("font-semibold", signedClass(l.netPnl))}>{signedINR(l.netPnl)}</div>
                      <div className="text-micro text-muted-foreground">chg {formatINR(l.charges, { decimals: 0 })}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className={cn("flex justify-end gap-1", readOnly && "hidden")}>
                        <Button variant="outline" size="pill" onClick={() => setClosing(r)} aria-label={`Close ${p.symbol} ${p.strike} ${p.type}`}>
                          <LogOut aria-hidden="true" /> Close
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-bearish" onClick={() => onRemove(p.id)} aria-label={`Delete ${p.symbol} ${p.strike} ${p.type} without recording`}>
                          <Trash2 className="!size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Fragment>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={8} className="sticky left-0 bg-surface text-label uppercase text-muted-foreground">
              Total · {rows.length} position{rows.length === 1 ? "" : "s"}
            </TableCell>
            <TableCell className={cn("text-right tabular-nums", signedClass(totals.theta))}>{fmtGreekINR(totals.theta)}</TableCell>
            <TableCell className={cn("text-right tabular-nums", signedClass(totals.vega))}>{fmtGreekINR(totals.vega)}</TableCell>
            <TableCell className={cn("text-right tabular-nums", signedClass(totals.gross))}>{signedINR(totals.gross)}</TableCell>
            <TableCell className="text-right tabular-nums">
              <div className={cn("font-bold", signedClass(totals.net))}>{signedINR(totals.net)}</div>
              <div className="text-micro font-normal text-muted-foreground">chg {formatINR(totals.charges, { decimals: 0 })}</div>
            </TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      <CloseDialog
        position={closing?.p ?? null}
        defaultPrice={closing?.p.currentPrice ?? NaN}
        open={!!closing}
        onOpenChange={(o) => !o && setClosing(null)}
        onConfirm={(price) => {
          if (closing) onClose(closing.p.id, price);
          setClosing(null);
        }}
      />
    </>
  );
}

export function ClosedPositionsTable({ closed }: { closed: ClosedPosition[] }) {
  const sorted = useMemo(() => [...closed].sort((a, b) => (b.exitDateIso ?? "").localeCompare(a.exitDateIso ?? "")), [closed]);
  const tot = useMemo(
    () => ({
      gross: closed.reduce((a, c) => a + (c.grossPnl ?? c.realizedPnl), 0),
      charges: closed.reduce((a, c) => a + (c.charges ?? 0), 0),
      net: closed.reduce((a, c) => a + (c.netPnl ?? c.realizedPnl), 0),
      wins: closed.filter((c) => (c.netPnl ?? c.realizedPnl) > 0).length,
    }),
    [closed],
  );
  return (
    <Table className="min-w-[860px]">
      <TableHeader>
        <TableRow>
          <TableHead className="sticky left-0 z-10 bg-surface">Contract</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Entry</TableHead>
          <TableHead className="text-right">Exit</TableHead>
          <TableHead>Closed</TableHead>
          <TableHead className="text-right">Gross</TableHead>
          <TableHead className="text-right">Charges</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="sticky left-0 z-[1] bg-card font-semibold">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                {c.symbol} {formatStrike(c.strike)} <Badge variant={c.type === "CE" ? "bearish" : "bullish"}>{c.type}</Badge>
                {c.source === "sample" ? (
                  <Badge variant="warning" title="Entry priced off generated sample data, not a market quote.">
                    SAMPLE
                  </Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={c.action === "BUY" ? "bullish" : "bearish"}>{c.action}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{formatNumberIN(c.lots * c.lotSize)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumberIN(c.entryPrice, 2)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumberIN(c.exitPrice, 2)}</TableCell>
            <TableCell className="whitespace-nowrap text-body-sm">
              {c.exitDateIso ? formatDateIST(c.exitDateIso) : c.exitDate}
              {c.closeReason === "expiry" ? (
                <Badge variant="info" className="ml-1.5" title={c.settlementSpot ? `Settled at spot ${formatNumberIN(c.settlementSpot, 2)}` : undefined}>
                  Expiry
                </Badge>
              ) : null}
            </TableCell>
            <TableCell className={cn("text-right tabular-nums", signedClass(c.grossPnl ?? c.realizedPnl))}>{signedINR(c.grossPnl ?? c.realizedPnl)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground" title={c.exerciseStt ? `Includes STT on exercise ${formatINR(c.exerciseStt)}` : undefined}>
              {c.charges !== undefined ? formatINR(c.charges, { decimals: 0 }) : "—"}
              {c.exerciseStt ? <span className="ml-1 text-micro text-warning">STT ex.</span> : null}
            </TableCell>
            <TableCell className={cn("text-right font-semibold tabular-nums", signedClass(c.netPnl ?? c.realizedPnl))}>{signedINR(c.netPnl ?? c.realizedPnl)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={6} className="sticky left-0 bg-surface text-label uppercase text-muted-foreground">
            {closed.length} closed · {closed.length ? Math.round((tot.wins / closed.length) * 100) : 0}% winners
          </TableCell>
          <TableCell className={cn("text-right tabular-nums", signedClass(tot.gross))}>{signedINR(tot.gross)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">{formatINR(tot.charges, { decimals: 0 })}</TableCell>
          <TableCell className={cn("text-right font-bold tabular-nums", signedClass(tot.net))}>{signedINR(tot.net)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
