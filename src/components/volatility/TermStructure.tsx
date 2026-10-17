import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { axisProps, chartColors, gridProps, tooltipCursor, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { calendarDaysBetween, formatDateIST, istDateString } from "@/lib/options";
import type { TermPoint, TermShape } from "@/lib/volatility/surface";
import { DerivedBadge, EmptyState, HelpTip, LegendChip, PanelHeader, SampleBadge } from "./VolUi";
import { fmtVol, fmtVolPts } from "@/lib/volatility/format";
import type { PrevSessionData } from "./useVolatility";

export interface TermStructureProps {
  symbol: string;
  term: TermPoint[];
  shape: { shape: TermShape; slope: number };
  iv30: number;
  isSample: boolean;
  prev: PrevSessionData | null | undefined;
}

const SHAPE_COPY: Record<TermShape, { label: string; variant: "bullish" | "bearish" | "neutral"; icon: typeof TrendingUp; text: string }> = {
  contango: { label: "Contango", variant: "bullish", icon: TrendingUp, text: "Longer expiries carry higher IV than near ones. This is the usual calm-market shape." },
  backwardation: { label: "Backwardation", variant: "bearish", icon: TrendingDown, text: "Near expiries carry higher IV than later ones. The market is pricing near-term stress or an event." },
  flat: { label: "Flat", variant: "neutral", icon: Minus, text: "IV is about the same across expiries." },
  unknown: { label: "Shape unknown", variant: "neutral", icon: Minus, text: "Need at least two expiries with usable IV." },
};

export function TermStructure({ symbol, term, shape, iv30, isSample, prev }: TermStructureProps) {
  const today = istDateString();
  const ydayByExpiry = useMemo(() => new Map((prev?.iv?.term ?? []).map((t) => [t.expiry, t.atmIv])), [prev]);
  const ydaySeries = useMemo(
    () =>
      isSample
        ? []
        : (prev?.iv?.term ?? [])
            .map((t) => ({ dte: calendarDaysBetween(today, t.expiry), iv: t.atmIv }))
            .filter((p) => p.dte >= 0)
            .sort((a, b) => a.dte - b.dte),
    [prev, today, isSample],
  );
  const nowSeries = useMemo(() => term.map((t) => ({ dte: t.dte, iv: t.atmIv, expiry: t.expiry })), [term]);
  const fwdSeries = useMemo(() => term.filter((t) => t.fwdVol !== null).map((t) => ({ dte: t.dte, iv: t.fwdVol as number })), [term]);

  if (term.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarRange} title="No term structure" body="The multi-expiry chain did not return usable ATM IVs." />
      </Card>
    );
  }
  const s = SHAPE_COPY[shape.shape];
  const ShapeIcon = s.icon;

  return (
    <Card>
      <PanelHeader
        icon={CalendarRange}
        title={`${symbol} term structure`}
        subtitle="ATM IV by days to expiry, with forward vol between consecutive expiries."
        right={
          <>
            <Badge variant={s.variant}>
              <ShapeIcon aria-hidden="true" />
              {s.label}
              {Number.isFinite(shape.slope) ? ` ${fmtVolPts(shape.slope)}` : ""}
            </Badge>
            <Badge variant="info">IV30 {fmtVol(iv30)}</Badge>
            {isSample ? <SampleBadge /> : <DerivedBadge />}
          </>
        }
      />
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
          <HelpTip text="Forward vol is the IV the market implies for the period between two expiries: √((σ₂²T₂ − σ₁²T₁)/(T₂ − T₁)). A missing value means the two IVs imply negative variance, usually a sign of stale quotes." />
          {s.text}
        </p>
        <div className="h-[300px]" role="img" aria-label="ATM implied volatility by days to expiry">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 10, right: 12, bottom: 0, left: -10 }}>
              <CartesianGrid {...gridProps} />
              <XAxis type="number" dataKey="dte" {...axisProps} domain={[0, "dataMax"]} tickFormatter={(v: number) => `${v}d`} allowDuplicatedCategory={false} />
              <YAxis type="number" dataKey="iv" {...axisProps} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                cursor={tooltipCursor}
                labelFormatter={(v: number) => `${v} days to expiry`}
                formatter={(v: number, name: string) => [fmtVol(v, 2), name]}
              />
              <Line data={nowSeries} dataKey="iv" name={isSample ? "ATM IV (sample)" : "ATM IV now"} stroke={chartColors.iv} strokeWidth={2.25} dot={{ r: 3 }} isAnimationActive={false} />
              {ydaySeries.length > 1 ? (
                <Line data={ydaySeries} dataKey="iv" name="ATM IV yesterday (bhavcopy)" stroke={chartColors.muted} strokeDasharray="5 4" strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
              ) : null}
              {fwdSeries.length > 0 ? (
                <Line data={fwdSeries} dataKey="iv" name="Forward vol" type="stepBefore" stroke={chartColors.spot} strokeWidth={1.25} strokeDasharray="2 3" dot={{ r: 2 }} isAnimationActive={false} />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-4">
          <LegendChip color={chartColors.iv} label="ATM IV now" />
          {ydaySeries.length > 1 ? <LegendChip color={chartColors.muted} label={`Yesterday (${formatDateIST(prev?.date ?? "")})`} dashed /> : null}
          <LegendChip color={chartColors.spot} label="Forward vol" dashed />
        </div>

        <div className="overflow-x-auto rounded-tile border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">DTE</TableHead>
                <TableHead className="text-right">ATM IV</TableHead>
                <TableHead className="text-right">vs yday</TableHead>
                <TableHead className="text-right">Fwd vol</TableHead>
                <TableHead className="text-right">RR25</TableHead>
                <TableHead className="text-right">BF25</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {term.map((t) => {
                const y = ydayByExpiry.get(t.expiry);
                const d = y !== undefined && !isSample ? t.atmIv - y : NaN;
                return (
                  <TableRow key={t.expiry}>
                    <TableCell className="whitespace-nowrap font-medium">{formatDateIST(t.expiry)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.dte}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtVol(t.atmIv, 2)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${!Number.isFinite(d) ? "text-muted-foreground" : d > 0 ? "text-bearish" : "text-bullish"}`}>{fmtVolPts(d, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.fwdVol === null ? "—" : fmtVol(t.fwdVol, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtVolPts(t.rr25, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtVolPts(t.bf25, 2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
