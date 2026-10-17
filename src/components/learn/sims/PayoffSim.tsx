import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Layers, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { axisProps, chartColors, gridProps, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import {
  breakevens,
  dteLabel,
  forwardFromSpot,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  formatStrike,
  getExpiries,
  getLotSize,
  getStrikeStep,
  maxProfitLoss,
  netPremium,
  payoffDateKey,
  payoffSeries,
  probabilityOfProfit,
  spotGrid,
  timeToExpiryYears,
  type Leg,
  type OptionType,
  type Side,
} from "@/lib/options";
import { cn } from "@/lib/utils";
import { useSimSpot } from "../simSpot";
import { atmIndex, makeLeg, PRESETS, presetTemplate, pnlTone, strikeLadder, type PresetId } from "./simLogic";
import { SimCard, SimSegmented, SimSlider, SimStat } from "./SimUi";

const SYMBOL = "NIFTY";
const MAX_LEGS = 6;
const TYPE_OPTIONS = [
  { value: "CE", label: "Call (CE)" },
  { value: "PE", label: "Put (PE)" },
] as const;
const SIDE_OPTIONS = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
] as const;

/** Build a payoff by clicking strikes. Premiums are model fair values on the current (or sample) NIFTY spot. */
export default function PayoffSim() {
  const { spot } = useSimSpot();
  const [now] = useState(() => new Date());
  const expiries = useMemo(() => getExpiries(SYMBOL, now, 3), [now]);
  const [expiry, setExpiry] = useState<string>(() => expiries[0]?.date ?? "");
  const [type, setType] = useState<OptionType>("CE");
  const [side, setSide] = useState<Side>("BUY");
  const [ivPct, setIvPct] = useState(13);
  const [legs, setLegsRaw] = useState<Leg[]>([]);
  // Until the learner edits anything, keep one long ATM call loaded (re-centred if the spot changes).
  const touched = useRef(false);
  const setLegs = useCallback((next: SetStateAction<Leg[]>) => {
    touched.current = true;
    setLegsRaw(next);
  }, []);
  const ladderRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const strikesLabelId = `${uid}-strikes`;
  const legLimitId = `${uid}-leg-limit`;
  const atLegLimit = legs.length >= MAX_LEGS;
  const fillId = `${uid}-fill`.replace(/:/g, "");
  const strokeId = `${uid}-stroke`.replace(/:/g, "");

  const step = getStrikeStep(SYMBOL);
  const lotSize = getLotSize(SYMBOL, expiry) ?? 65;
  const ladder = useMemo(() => strikeLadder(spot, step, 10), [spot, step]);
  const atm = Math.round(spot / step) * step;
  const sigma = ivPct / 100;

  const build = (t: OptionType, sd: Side, strike: number, lots = 1) =>
    makeLeg({ symbol: SYMBOL, type: t, side: sd, strike, expiry, lotSize, spot, sigma, now, lots });

  useEffect(() => {
    if (touched.current || !(atm > 0) || !expiry) return;
    setLegsRaw([makeLeg({ symbol: SYMBOL, type: "CE", side: "BUY", strike: atm, expiry, lotSize, spot, sigma, now, lots: 1 })]);
    // Only re-seed when the ATM strike or expiry moves; IV edits mark the sim as touched via Reprice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atm, expiry]);

  // Centre the strike scroller on ATM without scrolling the page.
  useLayoutEffect(() => {
    const el = ladderRef.current;
    const i = atmIndex(ladder, spot);
    const btn = i >= 0 ? (el?.children[i] as HTMLElement | undefined) : undefined;
    if (!el || !btn) return;
    el.scrollLeft = Math.max(0, btn.offsetLeft - el.offsetLeft - (el.clientWidth - btn.offsetWidth) / 2);
  }, [ladder, spot]);

  const addLeg = (strike: number) => {
    setLegs((cur) => {
      const same = cur.find((l) => l.type === type && l.side === side && l.strike === strike);
      if (same) return cur.map((l) => (l === same ? { ...l, lots: Math.min(l.lots + 1, 20) } : l));
      if (cur.length >= MAX_LEGS) return cur;
      return [...cur, build(type, side, strike)];
    });
  };

  const loadPreset = (id: PresetId) => setLegs(presetTemplate(id).map((t) => build(t.type, t.side, atm + t.offset * step)));

  const changeExpiry = (d: string) => {
    setExpiry(d);
    setLegs((cur) => cur.map((l) => ({ ...makeLeg({ symbol: SYMBOL, type: l.type as OptionType, side: l.side, strike: l.strike, expiry: d, lotSize: getLotSize(SYMBOL, d) ?? lotSize, spot, sigma, now, lots: l.lots }), id: l.id })));
  };

  const repriceAll = () => setLegs((cur) => cur.map((l) => ({ ...build(l.type as OptionType, l.side, l.strike, l.lots), id: l.id })));

  const analysis = useMemo(() => {
    if (legs.length === 0) return null;
    const grid = spotGrid(legs, spot, { pctRange: 0.06, points: 121 });
    const series = payoffSeries(legs, grid, { dates: [now], now, spot });
    const key = payoffDateKey(now);
    const data = series.map((r) => ({ spot: r.spot, expiry: r.expiry, today: r[key] }));
    const T = timeToExpiryYears(expiry, now);
    const F = forwardFromSpot(spot, T, 0.065);
    return {
      data,
      bes: breakevens(legs),
      mpl: maxProfitLoss(legs),
      net: netPremium(legs),
      pop: probabilityOfProfit(legs, { F, T, sigma }),
    };
  }, [legs, spot, now, expiry, sigma]);

  const gradientOffset = useMemo(() => {
    if (!analysis) return 0.5;
    const vals = analysis.data.map((d) => d.expiry);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  }, [analysis]);

  const expiryOptions = expiries.map((e) => ({ value: e.date, label: `${formatDateIST(e.date).replace(/ \d{4}$/, "")}${e.type === "monthly" ? " (M)" : ""}` }));

  return (
    <SimCard title="Payoff builder" icon={<Layers className="h-4 w-4" />}>
      <div className="flex flex-wrap items-end gap-4">
        <SimSegmented label="Option" value={type} options={TYPE_OPTIONS} onChange={setType} />
        <SimSegmented label="Side" value={side} options={SIDE_OPTIONS} onChange={setSide} />
        {expiryOptions.length > 0 ? <SimSegmented label={`Expiry · ${dteLabel(expiry, now)}`} value={expiry} options={expiryOptions} onChange={changeExpiry} /> : null}
        <div className="w-full sm:w-56">
          <SimSlider label="IV for pricing" value={ivPct} min={6} max={40} step={0.5} onChange={setIvPct} format={(v) => formatPct(v, { decimals: 1 })} />
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-1.5 text-label uppercase text-muted-foreground" id={strikesLabelId}>
          Click a strike to {side === "BUY" ? "buy" : "sell"} a {type === "CE" ? "call" : "put"} · NIFTY lot {lotSize}
        </p>
        {atLegLimit ? (
          <p id={legLimitId} role="status" className="mb-1.5 text-body-sm text-foreground">
            Max {MAX_LEGS} legs. Remove one or Clear to add more.
          </p>
        ) : null}
        <div
          ref={ladderRef}
          role="group"
          aria-labelledby={strikesLabelId}
          aria-describedby={atLegLimit ? legLimitId : undefined}
          className="relative -mx-1 flex snap-x snap-mandatory scroll-px-1 gap-1 overflow-x-auto overscroll-x-contain px-1 pb-2"
        >
          {ladder.map((k) => {
            const inUse = legs.some((l) => l.strike === k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => addLeg(k)}
                disabled={atLegLimit && !legs.some((l) => l.type === type && l.side === side && l.strike === k)}
                aria-label={`${side === "BUY" ? "Buy" : "Sell"} ${formatStrike(k)} ${type}`}
                className={cn(
                  "shrink-0 snap-center rounded-pill border px-2 py-1.5 font-num text-body-sm tabular-nums transition-colors duration-fast focus-visible:shadow-ember focus-visible:outline-none disabled:opacity-40",
                  k === atm ? "border-primary/60 bg-wash-brand text-primary-ink" : "border-border bg-surface text-foreground hover:bg-accent",
                  inUse && "ring-1 ring-product/60",
                )}
              >
                {formatStrike(k)}
                {k === atm ? <span className="ml-1 text-micro uppercase">ATM</span> : null}
              </button>
            );
          })}
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button key={p.id} type="button" size="sm" variant="outline" className="h-7 px-2.5 text-body-sm" onClick={() => loadPreset(p.id)}>
              {p.label}
            </Button>
          ))}
          {legs.length > 0 ? (
            <>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-body-sm" onClick={repriceAll} title="Reprice legs at the current spot and IV">
                <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Reprice
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-body-sm" onClick={() => setLegs([])}>
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Clear
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {legs.length === 0 || !analysis ? (
        <div className="mt-4 grid place-items-center rounded-tile border border-dashed border-border bg-surface px-4 py-10 text-center">
          <p className="font-display text-lead font-bold text-foreground">No legs yet</p>
          <p className="mt-1 max-w-sm text-body text-muted-foreground">Pick Call or Put and Buy or Sell, then click a strike. Or load a preset such as a bull call spread.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
          <div className="min-w-0">
            <div className="h-64 w-full sm:h-80" role="img" aria-label={`Payoff chart. Breakevens ${analysis.bes.map((b) => formatNumberIN(b)).join(" and ") || "none"}.`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={analysis.data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset={0} stopColor={chartColors.bullish} stopOpacity={0.28} />
                      <stop offset={gradientOffset} stopColor={chartColors.bullish} stopOpacity={0.08} />
                      <stop offset={gradientOffset} stopColor={chartColors.bearish} stopOpacity={0.08} />
                      <stop offset={1} stopColor={chartColors.bearish} stopOpacity={0.28} />
                    </linearGradient>
                    <linearGradient id={strokeId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset={gradientOffset} stopColor={chartColors.bullish} />
                      <stop offset={gradientOffset} stopColor={chartColors.bearish} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="spot" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => formatNumberIN(v)} {...axisProps} />
                  <YAxis width={64} tickFormatter={(v: number) => formatINR(v, { decimals: 0 })} {...axisProps} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={tooltipLabelStyle}
                    itemStyle={tooltipItemStyle}
                    labelFormatter={(v) => `NIFTY ${formatNumberIN(Number(v))}`}
                    formatter={(v: number, name: string) => [formatINR(v, { decimals: 0 }), name === "expiry" ? "At expiry" : "Today (T+0)"]}
                  />
                  <ReferenceLine y={0} stroke={chartColors.axis} />
                  <ReferenceLine x={spot} stroke={chartColors.primary} strokeDasharray="4 4" label={{ value: "Spot", position: "top", fill: chartColors.muted, fontSize: 11 }} />
                  {analysis.bes.map((b) => (
                    <ReferenceLine key={b} x={b} stroke={chartColors.muted} strokeDasharray="2 3" />
                  ))}
                  <Area type="linear" dataKey="expiry" stroke={`url(#${strokeId})`} strokeWidth={2} fill={`url(#${fillId})`} isAnimationActive={false} />
                  <Line type="monotone" dataKey="today" stroke={chartColors.iv} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-body-sm text-muted-foreground">
              Solid: P&L at expiry · Dashed: P&L today (T+0) · Dotted lines: breakevens
            </p>
          </div>

          <div className="space-y-3">
            <ul className="space-y-1.5" aria-label="Legs">
              {legs.map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded-tile border border-border bg-surface px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => setLegs((cur) => cur.map((x) => (x.id === l.id ? { ...x, side: x.side === "BUY" ? "SELL" : "BUY" } : x)))}
                    className={cn("rounded-chip px-1.5 py-0.5 text-label uppercase focus-visible:shadow-ember focus-visible:outline-none", l.side === "BUY" ? "bg-wash-profit text-bullish" : "bg-wash-loss text-bearish")}
                    aria-label={`Switch ${formatStrike(l.strike)} ${l.type} to ${l.side === "BUY" ? "sell" : "buy"}`}
                  >
                    {l.side}
                  </button>
                  <span className="min-w-0 flex-1 truncate font-num text-body tabular-nums">
                    {formatStrike(l.strike)} {l.type} <span className="text-muted-foreground">@ {formatINR(l.premium)}</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="One lot fewer" disabled={l.lots <= 1} onClick={() => setLegs((cur) => cur.map((x) => (x.id === l.id ? { ...x, lots: Math.max(1, x.lots - 1) } : x)))}>
                      <Minus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <span className="w-6 text-center font-num text-body-sm tabular-nums" aria-label={`${l.lots} lots`}>
                      {l.lots}×
                    </span>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="One lot more" disabled={l.lots >= 20} onClick={() => setLegs((cur) => cur.map((x) => (x.id === l.id ? { ...x, lots: Math.min(20, x.lots + 1) } : x)))}>
                      <Plus className="h-3 w-3" aria-hidden="true" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remove ${formatStrike(l.strike)} ${l.type}`} onClick={() => setLegs((cur) => cur.filter((x) => x.id !== l.id))}>
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <SimStat label={analysis.net.type === "CREDIT" ? "Net credit" : "Net debit"} value={formatINR(Math.abs(analysis.net.net), { decimals: 0 })} />
              <SimStat label="Model POP" value={formatPct(analysis.pop * 100, { decimals: 1 })} tone="info" />
              <SimStat label="Max profit" value={analysis.mpl.unlimitedProfit ? "Unlimited" : formatINR(analysis.mpl.maxProfit, { decimals: 0 })} tone={pnlTone(analysis.mpl.unlimitedProfit ? 1 : analysis.mpl.maxProfit)} />
              <SimStat label="Max loss" value={analysis.mpl.unlimitedLoss ? "Unlimited" : formatINR(analysis.mpl.maxLoss, { decimals: 0 })} tone={analysis.mpl.unlimitedLoss || analysis.mpl.maxLoss < 0 ? "bearish" : undefined} />
            </div>
            <SimStat label="Breakevens at expiry" value={analysis.bes.length ? analysis.bes.map((b) => formatNumberIN(b)).join(" · ") : "None"} />
          </div>
        </div>
      )}
    </SimCard>
  );
}
