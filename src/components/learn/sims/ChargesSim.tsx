import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
import { BROKER_PRESETS, formatINR, formatNumberIN, formatPct, getChargeRates, getLotSize, type ChargesBreakdown } from "@/lib/options";
import { cn } from "@/lib/utils";
import { compareSquareOffVsExercise, pnlTone, roundTripSummary } from "./simLogic";
import { SimCard, SimSegmented, SimSlider, SimStat } from "./SimUi";

type Mode = "roundTrip" | "exercise";
type RateDate = "2025-10-01" | "2026-04-01";

const MODE_OPTIONS = [
  { value: "roundTrip", label: "Round-trip charges" },
  { value: "exercise", label: "Exercise vs square-off" },
] as const;
const RATE_OPTIONS = [
  { value: "2025-10-01", label: "Before 1 Apr 2026" },
  { value: "2026-04-01", label: "From 1 Apr 2026" },
] as const;

const ROWS: Array<{ key: keyof Omit<ChargesBreakdown, "total">; label: string }> = [
  { key: "brokerage", label: "Brokerage" },
  { key: "stt", label: "STT" },
  { key: "exchange", label: "Exchange charges" },
  { key: "gst", label: "GST" },
  { key: "stamp", label: "Stamp duty" },
  { key: "sebi", label: "SEBI fee" },
];

const BROKER = BROKER_PRESETS.find((b) => b.id === "zerodha") ?? BROKER_PRESETS[0];

function Breakdown({ charges }: { charges: ChargesBreakdown }) {
  const total = charges.total || 1;
  return (
    <table className="w-full text-body">
      <caption className="sr-only">Charges breakdown</caption>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.key} className="border-b border-separator last:border-0">
            <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">
              {r.label}
            </th>
            <td className="w-1/3 py-1.5" aria-hidden="true">
              <div className="h-1.5 overflow-hidden rounded-capsule bg-muted">
                <div className={cn("h-full rounded-capsule", r.key === "stt" ? "bg-primary" : "bg-product")} style={{ width: `${Math.min(100, (charges[r.key] / total) * 100)}%` }} />
              </div>
            </td>
            <td className="py-1.5 pl-2 text-right font-num tabular-nums">{formatINR(charges[r.key])}</td>
          </tr>
        ))}
        <tr>
          <th scope="row" className="pt-2 text-left font-semibold">
            Total
          </th>
          <td />
          <td className="pt-2 text-right font-num font-semibold tabular-nums">{formatINR(charges.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Every rupee between gross and net, and the expiry-day exercise STT comparison. */
export default function ChargesSim() {
  const lot = getLotSize("NIFTY") ?? 65;
  const [mode, setMode] = useState<Mode>("roundTrip");
  const [rateDate, setRateDate] = useState<RateDate>("2026-04-01");
  const [entry, setEntry] = useState(100);
  const [exit, setExit] = useState(115);
  const [lots, setLots] = useState(2);
  const [intrinsicVal, setIntrinsicVal] = useState(80);
  const [timeValue, setTimeValue] = useState(1);

  const qty = lots * lot;
  const rates = getChargeRates(rateDate);
  const rt = useMemo(() => roundTripSummary({ entry, exit, qty, onDate: rateDate, broker: BROKER }), [entry, exit, qty, rateDate]);
  const cmp = useMemo(
    () => compareSquareOffVsExercise({ exitPrice: intrinsicVal + timeValue, intrinsic: intrinsicVal, qty, onDate: rateDate, broker: BROKER }),
    [intrinsicVal, timeValue, qty, rateDate],
  );

  return (
    <SimCard
      title="Charges and the STT trap"
      icon={<Receipt className="h-4 w-4" />}
      footnote={`Rates from the terminal's dated table (verify against the latest Budget and exchange circulars): STT on option sell ${formatPct(rates.sttOptionSell * 100, { decimals: 3 })}, on exercise ${formatPct(rates.sttOptionExercise * 100, { decimals: 3 })}. Brokerage ₹${BROKER.perOrder} per order.`}
    >
      <div className="flex flex-wrap items-end gap-4">
        <SimSegmented label="Mode" value={mode} options={MODE_OPTIONS} onChange={setMode} />
        <SimSegmented label="Rates as on" value={rateDate} options={RATE_OPTIONS} onChange={setRateDate} />
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,280px)_1fr]">
        <div className="space-y-5">
          <SimSlider label="Lots (NIFTY)" value={lots} min={1} max={20} step={1} onChange={setLots} format={(v) => `${v} × ${lot} = ${formatNumberIN(v * lot)} qty`} />
          {mode === "roundTrip" ? (
            <>
              <SimSlider label="Buy premium" value={entry} min={1} max={400} step={0.5} onChange={setEntry} format={(v) => formatINR(v)} />
              <SimSlider label="Sell premium" value={exit} min={0.5} max={500} step={0.5} onChange={setExit} format={(v) => formatINR(v)} />
            </>
          ) : (
            <>
              <SimSlider label="Intrinsic value at close" value={intrinsicVal} min={1} max={400} step={1} onChange={setIntrinsicVal} format={(v) => formatINR(v, { decimals: 0 })} hint="Settlement price minus strike for a long ITM call." />
              <SimSlider label="Bid above intrinsic before 15:30" value={timeValue} min={0} max={10} step={0.25} onChange={setTimeValue} format={(v) => formatINR(v)} />
            </>
          )}
        </div>
        {mode === "roundTrip" ? (
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SimStat label="Gross P&L" value={formatINR(rt.gross, { decimals: 0 })} tone={pnlTone(rt.gross)} />
              <SimStat label="Charges" value={formatINR(rt.charges.total)} tone="warning" />
              <SimStat label="Net P&L" value={formatINR(rt.net, { decimals: 0 })} tone={pnlTone(rt.net)} />
              <SimStat label="Charges / gross" value={Number.isFinite(rt.chargesPctOfGross) ? formatPct(rt.chargesPctOfGross, { decimals: 1 }) : "—"} sub={rt.gross <= 0 ? "no gross profit" : undefined} />
            </div>
            <Breakdown charges={rt.charges} />
            <p className="text-body text-muted-foreground">
              Charges are paid on every trade, winning or losing. A trader doing 10 such round trips a day pays about {formatINR(rt.charges.total * 10 * 250, { decimals: 0 })} a year in costs before making a single rupee.
            </p>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <SimStat label="Sell before 15:30" value={formatINR(cmp.squareOff.total)} sub={`STT ${formatINR(cmp.squareOff.stt)} + fees`} />
              <SimStat label="Let it exercise" value={formatINR(cmp.exerciseStt)} sub="STT on intrinsic value" />
              <SimStat
                label={cmp.difference > 0 ? "Exercise costs more by" : "Squaring off costs more by"}
                value={formatINR(Math.abs(cmp.difference))}
                tone={cmp.difference > 0 ? "bearish" : "info"}
              />
            </div>
            <p className="text-body text-muted-foreground">
              Squaring off also earns the {formatINR(timeValue)} per unit above intrinsic ({formatINR(timeValue * qty, { decimals: 0 })} in total). Switch the rate date to compare the old 0.125% exercise rate with the 2026 table. For stock options, exercise means physical delivery, which is a much bigger risk than the tax.
            </p>
          </div>
        )}
      </div>
    </SimCard>
  );
}
