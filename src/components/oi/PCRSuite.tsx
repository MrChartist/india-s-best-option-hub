import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateIST } from "@/lib/options";
import { PCR_BANDS, pcrSignal, type PCRResult } from "@/lib/oiUtils";
import { cn } from "@/lib/utils";
import { EmptyState, ModuleHeader, StatTile } from "./shared";
import { fmtOI, fmtRatio } from "./format";
import type { ExpiryRow } from "./MaxPainTable";

const GAUGE_MAX = 2;
const pct = (v: number) => `${(Math.min(Math.max(v, 0), GAUGE_MAX) / GAUGE_MAX) * 100}%`;

/** Horizontal PCR gauge with the pcrSignal bands. */
function PCRGauge({ value }: { value: number }) {
  const bands = [
    { from: 0, to: PCR_BANDS.low, cls: "bg-bearish/25", label: "Call heavy" },
    { from: PCR_BANDS.low, to: PCR_BANDS.high, cls: "bg-muted-foreground/15", label: "Balanced" },
    { from: PCR_BANDS.high, to: PCR_BANDS.extreme, cls: "bg-bullish/25", label: "Put heavy" },
    { from: PCR_BANDS.extreme, to: GAUGE_MAX, cls: "bg-warning/30", label: "Extreme" },
  ];
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-capsule" role="meter" aria-valuemin={0} aria-valuemax={GAUGE_MAX} aria-valuenow={value} aria-label="Put-call ratio on the signal scale">
        {bands.map((b) => (
          <div key={b.label} className={cn("absolute inset-y-0", b.cls)} style={{ left: pct(b.from), width: `calc(${pct(b.to)} - ${pct(b.from)})` }} />
        ))}
        {value > 0 && <div className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-capsule bg-foreground" style={{ left: pct(value) }} />}
      </div>
      <div className="relative mt-1 h-4 font-num text-[11px] text-muted-foreground" aria-hidden="true">
        <span className="absolute left-0">0</span>
        {[PCR_BANDS.low, PCR_BANDS.high, PCR_BANDS.extreme].map((v) => (
          <span key={v} className="absolute -translate-x-1/2" style={{ left: pct(v) }}>
            {v}
          </span>
        ))}
        <span className="absolute right-0">{GAUGE_MAX}+</span>
      </div>
    </div>
  );
}

function combine(rows: ExpiryRow[]): PCRResult | null {
  if (rows.length < 2) return null;
  let ceOI = 0, peOI = 0, ceVol = 0, peVol = 0, ceChg = 0, peChg = 0;
  for (const r of rows) {
    ceOI += r.pcr.totalCEOI;
    peOI += r.pcr.totalPEOI;
    ceVol += r.pcr.totalCEVol;
    peVol += r.pcr.totalPEVol;
    ceChg += r.pcr.totalCEOIChg;
    peChg += r.pcr.totalPEOIChg;
  }
  const pcrOI = ceOI > 0 ? Math.round((peOI / ceOI) * 100) / 100 : 0;
  const s = pcrSignal(pcrOI);
  return {
    pcrOI,
    pcrVolume: ceVol > 0 ? Math.round((peVol / ceVol) * 100) / 100 : 0,
    pcrChgOI: ceChg > 0 && peChg > 0 ? Math.round((peChg / ceChg) * 100) / 100 : null,
    pcrPremium: null,
    totalCEOI: ceOI,
    totalPEOI: peOI,
    totalCEVol: ceVol,
    totalPEVol: peVol,
    totalCEOIChg: ceChg,
    totalPEOIChg: peChg,
    signal: s.label,
    signalColor: s.className,
    signalTone: s.tone,
  };
}

/**
 * The PCR family for the selected expiry (OI, volume, change-in-OI and traded-premium PCR) plus the
 * same readings for every listed expiry.
 */
export function PCRSuite({ rows, selected, onSelect }: { rows: ExpiryRow[]; selected: string; onSelect: (expiry: string) => void }) {
  const current = rows.find((r) => r.expiry === selected) ?? rows[0];
  const all = combine(rows);
  if (!current) {
    return (
      <Card>
        <EmptyState icon={<Scale className="h-5 w-5" />} title="No chain to compute PCR" />
      </Card>
    );
  }
  const p = current.pcr;
  const sig = pcrSignal(p.pcrOI);
  const tableRows: Array<{ key: string; label: string; pcr: PCRResult; expiry?: string; sample?: boolean }> = [
    ...rows.map((r) => ({ key: r.expiry, label: formatDateIST(r.expiry), pcr: r.pcr, expiry: r.expiry, sample: r.sample })),
    ...(all ? [{ key: "all", label: "All listed", pcr: all }] : []),
  ];

  return (
    <Card className="overflow-hidden">
      <ModuleHeader
        icon={<Scale className="h-4 w-4 text-primary-ink" />}
        title="Put-call ratio suite"
        hint={`${formatDateIST(current.expiry)} expiry. OI PCR drives the signal; the others show where today's activity is.`}
        right={current.sample ? <Badge variant="warning">Sample data</Badge> : undefined}
      />
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-3 rounded-tile border border-border bg-surface/60 p-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-label uppercase text-muted-foreground">PCR (OI)</p>
                <p className={cn("font-num text-num-hero", sig.className)}>{fmtRatio(p.pcrOI)}</p>
              </div>
              <Badge variant={sig.tone === "neutral" ? "neutral" : sig.tone}>{sig.label}</Badge>
            </div>
            <PCRGauge value={p.pcrOI} />
            <p className="text-xs text-muted-foreground">{sig.description}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Volume PCR" value={fmtRatio(p.pcrVolume)} sub={`Put ${fmtOI(p.totalPEVol)} · Call ${fmtOI(p.totalCEVol)}`} />
            <StatTile
              label="Change-in-OI PCR"
              value={fmtRatio(p.pcrChgOI)}
              sub={p.pcrChgOI === null ? "Needs OI added on both sides" : `Put +${fmtOI(p.totalPEOIChg)} · Call +${fmtOI(p.totalCEOIChg)}`}
            />
            <StatTile label="Premium PCR" value={fmtRatio(p.pcrPremium)} sub={p.pcrPremium === null ? "Not available from this source" : "Traded premium, puts ÷ calls"} />
            <StatTile label="Open interest" value={`${fmtOI(p.totalPEOI)} / ${fmtOI(p.totalCEOI)}`} sub="Put / call" />
          </div>
        </div>

        <div className="overflow-x-auto rounded-tile border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-label uppercase">Expiry</TableHead>
                <TableHead className="text-right text-label uppercase">OI</TableHead>
                <TableHead className="text-right text-label uppercase">Volume</TableHead>
                <TableHead className="text-right text-label uppercase">ΔOI</TableHead>
                <TableHead className="text-right text-label uppercase">Premium</TableHead>
                <TableHead className="text-label uppercase">Reading</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((r) => {
                const s = pcrSignal(r.pcr.pcrOI);
                const active = r.expiry === current.expiry;
                return (
                  <TableRow key={r.key} className={cn("font-num text-xs", active && "bg-wash-brand/55", !r.expiry && "font-semibold")}>
                    <TableCell className="whitespace-nowrap">
                      {r.expiry ? (
                        <button type="button" onClick={() => onSelect(r.expiry as string)} className="rounded-chip font-semibold hover:text-primary-ink focus-visible:shadow-ember focus-visible:outline-none">
                          {r.label}
                        </button>
                      ) : (
                        r.label
                      )}
                      {r.sample && <Badge variant="warning" className="ml-1.5">Sample</Badge>}
                    </TableCell>
                    <TableCell className={cn("text-right font-semibold", s.className)}>{fmtRatio(r.pcr.pcrOI)}</TableCell>
                    <TableCell className="text-right">{fmtRatio(r.pcr.pcrVolume)}</TableCell>
                    <TableCell className="text-right">{fmtRatio(r.pcr.pcrChgOI)}</TableCell>
                    <TableCell className="text-right">{fmtRatio(r.pcr.pcrPremium)}</TableCell>
                    <TableCell>
                      <Badge variant={s.tone === "neutral" ? "neutral" : s.tone}>{s.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Bands: below {PCR_BANDS.low} call heavy, {PCR_BANDS.low} to {PCR_BANDS.high} balanced, above {PCR_BANDS.high} put heavy, above {PCR_BANDS.extreme} extreme (contrarian). Premium PCR uses LTP × volume.
        </p>
      </CardContent>
    </Card>
  );
}
