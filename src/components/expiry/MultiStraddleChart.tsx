/**
 * Multi-straddle / strangle chart: up to four fixed-strike combos (ATM, ATM±n, strangles, next
 * expiry) plotted as combined premium over the session. Selections persist in localStorage.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Layers, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { axisProps, gridProps, legendStyle, seriesColor, tooltipCursor, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatDateIST, formatINR, formatPct } from "@/lib/options";
import type { ChainSnapshot } from "@/lib/snapshotStore";
import { cn } from "@/lib/utils";
import {
  COMBO_STORAGE_KEY,
  MAX_COMBOS,
  comboLabel,
  comboSeries,
  defaultCombos,
  hhmmIST,
  openingATM,
  parseCombos,
  signTone,
  type ComboSpec,
} from "./expiryMath";
import { DerivedBadge, EmptyState, ModeBadge, Panel } from "./ExpiryUi";
import { useExpirySession, type SessionMode } from "./useExpirySession";

interface Props {
  symbol: string;
  nearExpiry: string;
  nextExpiry: string;
  nearSnaps: ChainSnapshot[];
  nearMode: SessionMode;
  step: number;
  lotSize: number;
}

function storageKey(symbol: string) {
  return `${COMBO_STORAGE_KEY}:${symbol.toUpperCase()}`;
}

function loadCombos(symbol: string, step: number): ComboSpec[] {
  try {
    const raw = localStorage.getItem(storageKey(symbol));
    if (raw) {
      const parsed = parseCombos(JSON.parse(raw));
      if (parsed.length > 0) return parsed;
    }
  } catch {
    /* storage unavailable */
  }
  return defaultCombos(step);
}

function saveCombos(symbol: string, combos: ComboSpec[]) {
  try {
    localStorage.setItem(storageKey(symbol), JSON.stringify(combos));
  } catch {
    /* storage unavailable */
  }
}

/** Mounts the next-expiry data feed only when a combo needs it. */
function NextExpiryFeed({ symbol, expiry, forceSample, children }: { symbol: string; expiry: string; forceSample: boolean; children: (snaps: ChainSnapshot[], mode: SessionMode) => ReactNode }) {
  const s = useExpirySession(symbol, expiry, { forceSample });
  return <>{children(s.snaps, s.mode)}</>;
}

export function MultiStraddleChart(props: Props) {
  const { symbol, step, nextExpiry, nearMode } = props;
  const [combos, setCombos] = useState<ComboSpec[]>(() => loadCombos(symbol, step));
  useEffect(() => setCombos(loadCombos(symbol, step)), [symbol, step]);
  const update = useCallback(
    (next: ComboSpec[]) => {
      setCombos(next);
      saveCombos(symbol, next);
    },
    [symbol],
  );

  const needsNext = combos.some((c) => c.expiry === "next") && !!nextExpiry;
  if (needsNext) {
    return (
      <NextExpiryFeed symbol={symbol} expiry={nextExpiry} forceSample={nearMode === "sample"}>
        {(snaps, mode) => <MultiStraddleView {...props} combos={combos} onChange={update} nextSnaps={snaps} nextMode={mode} />}
      </NextExpiryFeed>
    );
  }
  return <MultiStraddleView {...props} combos={combos} onChange={update} nextSnaps={[]} nextMode="empty" />;
}

function MultiStraddleView({
  symbol,
  nearExpiry,
  nextExpiry,
  nearSnaps,
  nearMode,
  step,
  lotSize,
  combos,
  onChange,
  nextSnaps,
  nextMode,
}: Props & { combos: ComboSpec[]; onChange: (c: ComboSpec[]) => void; nextSnaps: ChainSnapshot[]; nextMode: SessionMode }) {
  const [view, setView] = useState<"rupees" | "pct">("rupees");
  const [perLot, setPerLot] = useState(false);
  const [kind, setKind] = useState<ComboSpec["kind"]>("straddle");
  const [offsetSteps, setOffsetSteps] = useState("1");
  const [expiryPick, setExpiryPick] = useState<ComboSpec["expiry"]>("near");

  const base = useMemo(() => openingATM(nearSnaps), [nearSnaps]);
  const s = step > 0 ? step : 50;
  const mult = perLot && lotSize > 0 ? lotSize : 1;

  const series = useMemo(
    () =>
      combos.map((c, i) => {
        const pts = comboSeries(c.expiry === "next" ? nextSnaps : nearSnaps, c, base);
        return { spec: c, color: seriesColor(i), label: comboLabel(c, Number.isFinite(base) ? base : undefined), pts, first: pts[0]?.value ?? NaN, last: pts[pts.length - 1]?.value ?? NaN };
      }),
    [combos, nearSnaps, nextSnaps, base],
  );

  const rows = useMemo(() => {
    const m = new Map<number, Record<string, number>>();
    series.forEach((x, i) => {
      for (const p of x.pts) {
        const row = m.get(p.ts) ?? { ts: p.ts };
        row[`c${i}`] = view === "pct" ? (x.first > 0 ? (p.value / x.first) * 100 : NaN) : p.value * mult;
        m.set(p.ts, row);
      }
    });
    return [...m.values()].sort((a, b) => a.ts - b.ts);
  }, [series, view, mult]);

  const add = () => {
    if (combos.length >= MAX_COMBOS) return;
    const n = Number(offsetSteps);
    const offset = kind === "strangle" ? Math.max(1, Math.abs(n)) * s : n * s;
    const id = `${kind}-${offset}-${expiryPick}-${Date.now().toString(36)}`;
    if (combos.some((c) => c.kind === kind && c.offset === offset && c.expiry === expiryPick)) return;
    onChange([...combos, { id, kind, offset, expiry: expiryPick }]);
  };

  const offsetChoices = kind === "strangle" ? [1, 2, 3, 4, 5, 6, 8, 10] : [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  const anyNext = combos.some((c) => c.expiry === "next");
  const hasData = series.some((x) => x.pts.length >= 2);

  return (
    <Panel
      title={
        <>
          <Layers className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Multi-straddle and strangle
          <ModeBadge mode={nearMode} />
          {anyNext && nextExpiry ? <ModeBadge mode={nextMode} reason={`Next expiry ${formatDateIST(nextExpiry)}`} /> : null}
        </>
      }
      subtitle={`Strikes fixed around the opening ATM${Number.isFinite(base) ? ` (${base})` : ""} · near ${nearExpiry ? formatDateIST(nearExpiry) : "—"}${nextExpiry ? ` · next ${formatDateIST(nextExpiry)}` : ""}`}
      actions={
        <>
          <ToggleGroup type="single" size="sm" value={view} onValueChange={(v) => v && setView(v as "rupees" | "pct")} aria-label="Scale">
            <ToggleGroupItem value="rupees">₹</ToggleGroupItem>
            <ToggleGroupItem value="pct">% of start</ToggleGroupItem>
          </ToggleGroup>
          {view === "rupees" ? (
            <ToggleGroup type="single" size="sm" value={perLot ? "lot" : "unit"} onValueChange={(v) => v && setPerLot(v === "lot")} aria-label="Units">
              <ToggleGroupItem value="unit">/unit</ToggleGroupItem>
              <ToggleGroupItem value="lot" disabled={!(lotSize > 0)}>/lot</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2" aria-label="Selected combinations">
        {series.map((x) => (
          <span key={x.spec.id} className="inline-flex items-center gap-1.5 rounded-capsule border border-separator bg-surface py-0.5 pl-2.5 pr-1 text-body-sm">
            <span className="h-2.5 w-2.5 rounded-capsule" style={{ background: x.color }} aria-hidden="true" />
            {x.label}
            <button
              type="button"
              onClick={() => onChange(combos.filter((c) => c.id !== x.spec.id))}
              className="inline-flex h-5 w-5 items-center justify-center rounded-capsule text-muted-foreground hover:bg-control-track hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
              aria-label={`Remove ${x.label}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Button variant="ghost" onClick={() => onChange(defaultCombos(s))}>
          <RotateCcw aria-hidden="true" /> Reset
        </Button>
      </div>

      <form
        className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-control-track p-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        aria-label="Add a combination"
      >
        <div className="grid gap-1">
          <Label htmlFor="combo-kind" className="text-label text-muted-foreground">Type</Label>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as ComboSpec["kind"]);
              setOffsetSteps(v === "strangle" ? "2" : "1");
            }}
          >
            <SelectTrigger id="combo-kind" className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="straddle">Straddle</SelectItem>
              <SelectItem value="strangle">Strangle</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="combo-offset" className="text-label text-muted-foreground">{kind === "strangle" ? "Width each side" : "Strike"}</Label>
          <Select value={offsetSteps} onValueChange={setOffsetSteps}>
            <SelectTrigger id="combo-offset" className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {offsetChoices.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {kind === "strangle" ? `±${n * s}` : n === 0 ? "ATM" : `ATM${n > 0 ? "+" : "−"}${Math.abs(n * s)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="combo-expiry" className="text-label text-muted-foreground">Expiry</Label>
          <Select value={expiryPick} onValueChange={(v) => setExpiryPick(v as ComboSpec["expiry"])}>
            <SelectTrigger id="combo-expiry" className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="near">Near{nearExpiry ? ` · ${formatDateIST(nearExpiry)}` : ""}</SelectItem>
              <SelectItem value="next" disabled={!nextExpiry}>Next{nextExpiry ? ` · ${formatDateIST(nextExpiry)}` : ""}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={combos.length >= MAX_COMBOS}>
          <Plus aria-hidden="true" /> Add
        </Button>
        <span className="text-body-sm text-muted-foreground">{combos.length}/{MAX_COMBOS} · saved in this browser</span>
      </form>

      {!hasData ? (
        <div className="mt-4">
          <EmptyState icon={<Layers className="h-6 w-6" aria-hidden="true" />} title="No history for these strikes yet">
            Combined premium is drawn from recorded snapshots of each expiry. It fills while this page is open in market hours.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-4 h-[280px] w-full" role="img" aria-label={`Combined premium over time for ${series.map((x) => x.label).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => hhmmIST(v)} {...axisProps} minTickGap={28} />
                <YAxis {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={(v: number) => (view === "pct" ? `${v.toFixed(0)}%` : v.toFixed(0))} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                  cursor={tooltipCursor}
                  labelFormatter={(v: number) => `${hhmmIST(v)} IST`}
                  formatter={(value: number, name: string) => [view === "pct" ? formatPct(value, { decimals: 1 }) : formatINR(value, { decimals: perLot ? 0 : 2 }), name]}
                />
                <Legend wrapperStyle={legendStyle} />
                {series.map((x, i) => (
                  <Line key={x.spec.id} type="linear" dataKey={`c${i}`} name={x.label} stroke={x.color} strokeWidth={i === 0 ? 2 : 1.5} strokeDasharray={x.spec.expiry === "next" ? "6 3" : undefined} dot={false} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Combination</TableHead>
                  <TableHead scope="col" className="text-right">Start</TableHead>
                  <TableHead scope="col" className="text-right">Now</TableHead>
                  <TableHead scope="col" className="text-right">Change</TableHead>
                  <TableHead scope="col" className="text-right">Per lot now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map((x) => {
                  const ch = x.last - x.first;
                  const pct = x.first > 0 ? (ch / x.first) * 100 : NaN;
                  return (
                    <TableRow key={x.spec.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-capsule" style={{ background: x.color }} aria-hidden="true" />
                          {x.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-num tabular-nums">{formatINR(x.first)}</TableCell>
                      <TableCell className="text-right font-num tabular-nums">{formatINR(x.last)}</TableCell>
                      <TableCell className={cn("text-right font-num tabular-nums", signTone(-ch))}>
                        {Number.isFinite(pct) ? formatPct(pct, { decimals: 1, signed: true }) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-num tabular-nums">{lotSize > 0 ? formatINR(x.last * lotSize, { decimals: 0 }) : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground">
            <DerivedBadge title="From snapshots" />
            Change is coloured from a seller&apos;s view: a falling premium shows green. Next-expiry lines are dashed. {symbol} strikes missing from a chain are skipped.
          </div>
        </>
      )}
    </Panel>
  );
}
