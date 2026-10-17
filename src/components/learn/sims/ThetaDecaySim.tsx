import { useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { axisProps, chartColors, gridProps, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "@/lib/chartTheme";
import { formatINR, formatNumberIN, formatPct, getLotSize, getStrikeStep, nowIST } from "@/lib/options";
import { useSimSpot } from "../simSpot";
import { clockLabel, decayByDays, expiryDayCurve, MARKET_CLOSE_MIN, MARKET_OPEN_MIN } from "./simLogic";
import { SimCard, SimSegmented, SimSlider, SimStat } from "./SimUi";

type View = "day" | "days";
type Moneyness = "0" | "1" | "2";

const VIEW_OPTIONS = [
  { value: "day", label: "Expiry day" },
  { value: "days", label: "Last 30 days" },
] as const;
const MONEY_OPTIONS = [
  { value: "0", label: "ATM" },
  { value: "1", label: "1 strike OTM" },
  { value: "2", label: "2 strikes OTM" },
] as const;

/** Watch an ATM NIFTY call lose its time value through expiry day (09:15 → 15:30 IST). */
export default function ThetaDecaySim() {
  const { spot } = useSimSpot();
  const step = getStrikeStep("NIFTY");
  const lot = getLotSize("NIFTY") ?? 65;
  const atm = Math.round(spot / step) * step;
  const [view, setView] = useState<View>("day");
  const [money, setMoney] = useState<Moneyness>("0");
  const [ivPct, setIvPct] = useState(14);
  const [minute, setMinute] = useState(11 * 60);

  const strike = atm + Number(money) * step;
  const sigma = ivPct / 100;

  const dayCurve = useMemo(() => expiryDayCurve({ spot: atm, strike, sigma, type: "CE", stepMin: 5 }), [atm, strike, sigma]);
  const daysCurve = useMemo(() => decayByDays({ spot: atm, strike, sigma, type: "CE", maxDays: 30 }), [atm, strike, sigma]);

  const at = dayCurve.reduce((best, p) => (Math.abs(p.minute - minute) < Math.abs(best.minute - minute) ? p : best), dayCurve[0]);
  const open = dayCurve[0];
  const later = dayCurve.find((p) => p.minute >= Math.min(MARKET_CLOSE_MIN, at.minute + 30)) ?? dayCurve[dayCurve.length - 1];
  const lastHourStart = dayCurve.find((p) => p.minute >= MARKET_CLOSE_MIN - 60) ?? open;
  const lastHourShare = open.timeValue > 0 ? ((lastHourStart.timeValue - 0) / open.timeValue) * 100 : 0;

  const ist = nowIST();
  const nowMin = ist.hh * 60 + ist.mm;
  const inSession = nowMin >= MARKET_OPEN_MIN && nowMin <= MARKET_CLOSE_MIN;

  return (
    <SimCard
      title="Theta decay on expiry day"
      icon={<Clock3 className="h-4 w-4" />}
      footnote={`Spot held at ${formatNumberIN(atm)} and IV fixed so only time changes. Real expiry-day IV and spot move constantly.`}
    >
      <div className="flex flex-wrap items-end gap-4">
        <SimSegmented label="View" value={view} options={VIEW_OPTIONS} onChange={setView} />
        <SimSegmented label="Strike" value={money} options={MONEY_OPTIONS} onChange={setMoney} />
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="space-y-5">
          {view === "day" ? (
            <div className="space-y-2">
              <SimSlider label="Clock (IST)" value={minute} min={MARKET_OPEN_MIN} max={MARKET_CLOSE_MIN} step={5} onChange={setMinute} format={clockLabel} />
              {inSession ? (
                <Button type="button" variant="outline" size="sm" className="h-7 text-body-sm" onClick={() => setMinute(nowMin - (nowMin % 5))}>
                  Jump to now ({clockLabel(nowMin)} IST)
                </Button>
              ) : null}
            </div>
          ) : null}
          <SimSlider label="Implied volatility" value={ivPct} min={6} max={40} step={0.5} onChange={setIvPct} format={(v) => formatPct(v, { decimals: 1 })} />
          {view === "day" ? (
            <div className="grid grid-cols-2 gap-2">
              <SimStat label={`${formatNumberIN(strike)} CE at ${at.label}`} value={formatINR(at.value)} sub={`${formatINR(at.value * lot, { decimals: 0 })} per lot`} />
              <SimStat label="Lost since 09:15" value={formatINR(at.value - open.value)} tone="bearish" sub={formatPct(open.value > 0 ? ((at.value - open.value) / open.value) * 100 : 0, { decimals: 0, signed: true })} />
              <SimStat label="Next 30 minutes" value={formatINR(later.value - at.value)} tone="bearish" sub="if nothing else moves" />
              <SimStat label="Burnt in last hour" value={formatPct(lastHourShare, { decimals: 0 })} sub="of the opening time value" tone="warning" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <SimStat label="30 days out" value={formatINR(daysCurve[0]?.value ?? NaN)} />
              <SimStat label="7 days out" value={formatINR(daysCurve.find((d) => d.days === 7)?.value ?? NaN)} />
              <SimStat label="1 day out" value={formatINR(daysCurve.find((d) => d.days === 1)?.value ?? NaN)} />
              <SimStat label="Half the value left at" value={`${daysCurve.find((d) => d.value <= (daysCurve[0]?.value ?? 0) / 2)?.days ?? 0} days`} sub="for an ATM option" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="h-60 w-full sm:h-72" role="img" aria-label={view === "day" ? `Option value from 09:15 to 15:30. At ${at.label} it is ${formatINR(at.value)}.` : "Option value as days to expiry fall from 30 to 0."}>
            <ResponsiveContainer width="100%" height="100%">
              {view === "day" ? (
                <AreaChart data={dayCurve} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} onClick={(s) => {
                  const v = Number((s as { activeLabel?: string | number } | null)?.activeLabel);
                  if (Number.isFinite(v)) setMinute(v);
                }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="minute" type="number" domain={[MARKET_OPEN_MIN, MARKET_CLOSE_MIN]} ticks={[555, 600, 660, 720, 780, 840, 900, 930]} tickFormatter={clockLabel} {...axisProps} />
                  <YAxis width={52} tickFormatter={(v: number) => `₹${formatNumberIN(v)}`} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => `${clockLabel(Number(v))} IST`} formatter={(v: number) => [formatINR(v), "Premium"]} />
                  <Area type="monotone" dataKey="value" stroke={chartColors.primary} strokeWidth={2} fill={chartColors.primary} fillOpacity={0.12} isAnimationActive={false} />
                  <ReferenceLine x={at.minute} stroke={chartColors.muted} strokeDasharray="4 4" />
                  <ReferenceDot x={at.minute} y={at.value} r={5} fill={chartColors.primary} stroke={chartColors.card} strokeWidth={2} />
                </AreaChart>
              ) : (
                <AreaChart data={daysCurve} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="days" type="number" reversed domain={[0, 30]} tickFormatter={(v: number) => `${v}d`} {...axisProps} />
                  <YAxis width={52} tickFormatter={(v: number) => `₹${formatNumberIN(v)}`} {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} labelFormatter={(v) => `${v} days to expiry`} formatter={(v: number) => [formatINR(v), "Premium"]} />
                  <Area type="monotone" dataKey="value" stroke={chartColors.iv} strokeWidth={2} fill={chartColors.iv} fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-body text-muted-foreground">
            Time value shrinks with the square root of time left, so each hour costs more than the one before. On expiry day the ATM option keeps a meaningful premium until lunch, then collapses towards its intrinsic value by 15:30.
          </p>
        </div>
      </div>
    </SimCard>
  );
}
