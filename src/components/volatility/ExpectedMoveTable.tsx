import { useMemo } from "react";
import { Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateIST, formatINR, formatNumberIN, formatPct } from "@/lib/options";
import { ivMoveHitRate, type SpotIvRow } from "@/lib/volatility/history";
import type { ExpectedMoveRow } from "@/lib/volatility/surface";
import { DerivedBadge, EmptyState, HelpTip, PanelHeader, SampleBadge } from "./VolUi";
import { fmtVol } from "@/lib/volatility/format";

export interface ExpectedMoveTableProps {
  symbol: string;
  spot: number;
  rows: ExpectedMoveRow[];
  isSample: boolean;
  /** Daily spot + IV history for the hit-rate back-test. */
  hitRows: SpotIvRow[];
  hitLabel: string;
}

const n0 = (v: number) => formatNumberIN(v, 0);

export function ExpectedMoveTable({ symbol, spot, rows, isSample, hitRows, hitLabel }: ExpectedMoveTableProps) {
  const hits = useMemo(() => new Map(rows.map((r) => [r.expiry, ivMoveHitRate(hitRows, Math.max(1, r.tradingDte))])), [rows, hitRows]);
  const front = rows.find((r) => r.dte >= 1) ?? rows[0];

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={Target} title="No expected move" body="Needs at least one expiry with a usable ATM IV and straddle." />
      </Card>
    );
  }

  // Visual band for the front expiry.
  const lo2 = front.iv2.lower;
  const hi2 = front.iv2.upper;
  const span = hi2 - lo2 || 1;
  const at = (x: number) => `${Math.min(100, Math.max(0, ((x - lo2) / span) * 100))}%`;

  return (
    <Card>
      <PanelHeader
        icon={Target}
        title={`${symbol} expected move by expiry`}
        subtitle="IV move uses log-space bounds F·e^(±kσ√T). Straddle move is 0.85 × the ATM straddle (mid prices when quotes exist)."
        right={isSample ? <SampleBadge /> : <DerivedBadge />}
      />
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="rounded-tile border border-border bg-surface/50 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-body font-semibold">
              {formatDateIST(front.expiry)} · {front.dte} day{front.dte === 1 ? "" : "s"}
            </p>
            <p className="text-body-sm text-muted-foreground">
              1σ ±{n0(front.iv1.move)} ({formatPct(front.iv1.pct)}) · straddle ±{n0(front.straddleMove.move)}
            </p>
          </div>
          <div className="relative h-9 rounded-md bg-muted" role="img" aria-label={`2 sigma range ${n0(lo2)} to ${n0(hi2)}, 1 sigma range ${n0(front.iv1.lower)} to ${n0(front.iv1.upper)}, spot ${n0(spot)}`}>
            <div className="absolute inset-y-0 rounded-md bg-info/15" style={{ left: at(front.iv1.lower), right: `calc(100% - ${at(front.iv1.upper)})` }} />
            {Number.isFinite(front.straddleMove.lower) ? (
              <div className="absolute inset-y-2 rounded-sm border border-dashed border-primary/70" style={{ left: at(front.straddleMove.lower), right: `calc(100% - ${at(front.straddleMove.upper)})` }} />
            ) : null}
            <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: at(spot) }} />
          </div>
          <div className="mt-1 flex justify-between text-body-sm tabular-nums text-muted-foreground">
            <span>{n0(lo2)}</span>
            <span className="text-bearish">{n0(front.iv1.lower)}</span>
            <span className="font-semibold text-foreground">{n0(spot)}</span>
            <span className="text-bullish">{n0(front.iv1.upper)}</span>
            <span>{n0(hi2)}</span>
          </div>
          <p className="mt-1 text-body-sm text-muted-foreground">Shaded: 1σ IV range. Dashed: straddle range. Ends: 2σ.</p>
        </div>

        <div className="overflow-x-auto rounded-tile border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">DTE</TableHead>
                <TableHead className="text-right">ATM IV</TableHead>
                <TableHead className="text-right">1σ move</TableHead>
                <TableHead className="text-right">1σ range</TableHead>
                <TableHead className="text-right">2σ range</TableHead>
                <TableHead className="text-right">Straddle</TableHead>
                <TableHead className="text-right">Straddle move</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Ratio <HelpTip text="Straddle move ÷ 1σ IV move. Around 0.8 is normal (0.85 × straddle ≈ the mean absolute move, which is about 0.8σ). Much higher means the straddle prices extra event risk." />
                  </span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    1σ hit rate <HelpTip text={`How often the close after the same number of trading days stayed inside the 1σ IV move, using ${hitLabel}. A well-calibrated 1σ band holds about 68% of the time.`} />
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const h = hits.get(r.expiry);
                return (
                  <TableRow key={r.expiry}>
                    <TableCell className="whitespace-nowrap font-medium">{formatDateIST(r.expiry)}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.dte}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtVol(r.atmIv)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      ±{n0(r.iv1.move)} <span className="text-muted-foreground">({formatPct(r.iv1.pct)})</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{n0(r.iv1.lower)} – {n0(r.iv1.upper)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{n0(r.iv2.lower)} – {n0(r.iv2.upper)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatINR(r.straddle)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number.isFinite(r.straddleMove.move) ? `±${n0(r.straddleMove.move)}` : "—"} <span className="text-muted-foreground">({formatPct(r.straddleMove.pct)})</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{Number.isFinite(r.ratio) ? r.ratio.toFixed(2) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {h && h.n >= 10 && Number.isFinite(h.rate) ? (
                        <>
                          {formatPct(h.rate * 100, { decimals: 0 })} <span className="text-muted-foreground">n={h.n}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground" title="Fewer than 10 past windows">Insufficient ({h?.n ?? 0})</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-body-sm text-muted-foreground">
          Hit rate source: {hitLabel} ({hitRows.length} days). Past hit rates describe history, not the future.
        </p>
      </CardContent>
    </Card>
  );
}
