import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ScrollRegion } from "@/components/ScrollRegion";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  PARTICIPANTS,
  PRODUCTS,
  PRODUCT_LABEL,
  clearingImbalance,
  productStats,
  type DataMode,
  type ParticipantVolRow,
  type ParticipantView,
  type Product,
} from "@/lib/participantsApi";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./ui";
import { PARTICIPANT_COLOR, arrow, fmtContracts, fmtContractsFull, fmtPct, fmtRatio, toneClass } from "./format";

type Metric = "oi" | "vol";

const SUBLABEL: Record<(typeof PARTICIPANTS)[number], string> = {
  FII: "Foreign investors",
  DII: "Domestic institutions",
  Pro: "Broker prop desks",
  Client: "Retail + HNI",
};

interface Props {
  views: ParticipantView[];
  vol: ParticipantVolRow[];
  volMode: DataMode | null;
  oiRowsForCheck: Parameters<typeof clearingImbalance>[0];
}

interface Line {
  participant: (typeof PARTICIPANTS)[number];
  long: number;
  short: number;
  net: number;
  longPct: number;
  lsRatio: number;
  changeNet: number | null;
  changeLongPct: number | null;
}

function LongBar({ pct, color }: { pct: number; color: string }) {
  const ok = Number.isFinite(pct);
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="font-num tabular-nums">{ok ? fmtPct(pct, 1) : "—"}</span>
      <span aria-hidden="true" className="relative hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${ok ? pct : 0}%`, background: color }}
        />
        <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
      </span>
    </div>
  );
}

export function ParticipantTable({ views, vol, volMode, oiRowsForCheck }: Props) {
  const [product, setProduct] = useState<Product>("futIdx");
  const [metric, setMetric] = useState<Metric>("oi");
  const hasVol = vol.length > 0;
  const m: Metric = metric === "vol" && hasVol ? "vol" : "oi";

  const lines: Line[] = useMemo(() => {
    if (m === "vol") {
      return PARTICIPANTS.flatMap((p) => {
        const r = vol.find((x) => x.participant === p);
        if (!r) return [];
        const s = productStats(r, product);
        return [
          {
            participant: p,
            long: s.long,
            short: s.short,
            net: s.net,
            longPct: s.longPct,
            lsRatio: s.lsRatio,
            changeNet: null,
            changeLongPct: null,
          },
        ];
      });
    }
    return views.map((v) => {
      const s = v.products[product];
      return {
        participant: v.participant,
        long: s.long,
        short: s.short,
        net: s.net,
        longPct: s.longPct,
        lsRatio: s.lsRatio,
        changeNet: s.change?.net ?? null,
        changeLongPct: s.change?.longPct ?? null,
      };
    });
  }, [m, vol, views, product]);

  const totalLong = lines.reduce((s, l) => s + l.long, 0);
  const totalShort = lines.reduce((s, l) => s + l.short, 0);
  const imbalance = m === "oi" ? clearingImbalance(oiRowsForCheck) : 0;
  const longLabel = m === "oi" ? "Long" : "Bought";
  const shortLabel = m === "oi" ? "Short" : "Sold";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-1 overflow-x-auto px-1">
          <ToggleGroup
            type="single"
            value={product}
            onValueChange={(v) => v && setProduct(v as Product)}
            aria-label="Product"
            className="w-max justify-start"
          >
            {PRODUCTS.map((p) => (
              <ToggleGroupItem key={p} value={p} size="sm" className="h-8 px-2.5 text-xs">
                {PRODUCT_LABEL[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          {m === "vol" && volMode ? <SourceBadge mode={volMode} /> : null}
          <ToggleGroup type="single" value={m} onValueChange={(v) => v && setMetric(v as Metric)} aria-label="Measure">
            <ToggleGroupItem value="oi" size="sm" className="h-8 px-2.5 text-xs">
              Open interest
            </ToggleGroupItem>
            <ToggleGroupItem
              value="vol"
              size="sm"
              className="h-8 px-2.5 text-xs"
              disabled={!hasVol}
              title={hasVol ? undefined : "Volume file not available for this date"}
            >
              Volume
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <ScrollRegion
        label={`${PRODUCT_LABEL[product]} by participant`}
        className="relative -mx-4 w-auto sm:mx-0 [&>div]:w-max [&>div]:min-w-full [&>div]:overflow-visible"
      >
        <Table className="min-w-[640px] text-body">
          <caption className="sr-only">
            {PRODUCT_LABEL[product]} {m === "oi" ? "open interest" : "volume"} by participant, in contracts
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead className="text-label uppercase">Participant</TableHead>
              <TableHead className="text-right text-label uppercase">{longLabel}</TableHead>
              <TableHead className="text-right text-label uppercase">{shortLabel}</TableHead>
              <TableHead className="text-right text-label uppercase">Net</TableHead>
              {m === "oi" ? <TableHead className="text-right text-label uppercase">Net chg</TableHead> : null}
              <TableHead className="text-right text-label uppercase">{m === "oi" ? "Long %" : "Buy %"}</TableHead>
              {m === "oi" ? <TableHead className="text-right text-label uppercase">Long % chg</TableHead> : null}
              <TableHead className="text-right text-label uppercase">L/S</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.participant}>
                <TableCell className="whitespace-nowrap font-medium">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: PARTICIPANT_COLOR[l.participant] }}
                    />
                    <span>{l.participant}</span>
                    <span className="hidden text-body-sm text-muted-foreground lg:inline">
                      {SUBLABEL[l.participant]}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right font-num tabular-nums" title={fmtContractsFull(l.long)}>
                  {fmtContracts(l.long)}
                </TableCell>
                <TableCell className="text-right font-num tabular-nums" title={fmtContractsFull(l.short)}>
                  {fmtContracts(l.short)}
                </TableCell>
                <TableCell
                  className={cn("text-right font-num font-semibold tabular-nums", toneClass(l.net))}
                  title={fmtContractsFull(l.net, true)}
                >
                  {fmtContracts(l.net, true)}
                </TableCell>
                {m === "oi" ? (
                  <TableCell className={cn("text-right font-num tabular-nums", toneClass(l.changeNet ?? NaN))}>
                    {l.changeNet === null ? "—" : `${arrow(l.changeNet)} ${fmtContracts(l.changeNet, true)}`.trim()}
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <LongBar pct={l.longPct} color={PARTICIPANT_COLOR[l.participant]} />
                </TableCell>
                {m === "oi" ? (
                  <TableCell className={cn("text-right font-num tabular-nums", toneClass(l.changeLongPct ?? NaN))}>
                    {l.changeLongPct === null || !Number.isFinite(l.changeLongPct)
                      ? "—"
                      : `${fmtPct(l.changeLongPct, 2, true).replace("%", "")} pts`}
                  </TableCell>
                ) : null}
                <TableCell className="text-right font-num tabular-nums">{fmtRatio(l.lsRatio)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="text-label uppercase text-muted-foreground">Market total</TableCell>
              <TableCell className="text-right font-num tabular-nums">{fmtContracts(totalLong)}</TableCell>
              <TableCell className="text-right font-num tabular-nums">{fmtContracts(totalShort)}</TableCell>
              <TableCell className="text-right font-num tabular-nums text-muted-foreground">
                {fmtContracts(totalLong - totalShort, true)}
              </TableCell>
              <TableCell colSpan={m === "oi" ? 4 : 2} className="text-right text-body-sm text-muted-foreground">
                {m === "oi" ? "Every long has a short: totals should match." : "Contracts traded on the day."}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </ScrollRegion>

      {imbalance > 0.005 ? (
        <p role="note" className="flex items-start gap-2 text-body-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Longs and shorts differ by {fmtPct(imbalance * 100, 1)} in at least one product. The source file may be
          incomplete.
        </p>
      ) : null}
      <p className="text-body-sm text-muted-foreground">
        Figures are in contracts. Hover a number for the exact count. L/S is long ÷ short.
      </p>
    </div>
  );
}
