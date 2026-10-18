import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BROKER_PRESETS, formatDateIST, formatINR, formatPct, formatStrike, getChargeRates, getLotSize, getStrikeStep, istDateString, type OptionType } from "@/lib/options";
import { cn } from "@/lib/utils";
import { isPos, resolveBroker, squareOffVsExpire, toNum } from "./calcLogic";
import { Callout, DateField, KV, NumField, Panel, Segmented, SelectField, SymbolField } from "./CalcUi";

export default function ExerciseSTTCalculator() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [type, setType] = useState<OptionType>("CE");
  const [strike, setStrike] = useState("25000");
  const [settle, setSettle] = useState("25120");
  const [premiumNow, setPremiumNow] = useState("118");
  const [entry, setEntry] = useState("60");
  const [lots, setLots] = useState("1");
  const [lotText, setLotText] = useState(String(getLotSize("NIFTY") ?? 65));
  const [brokerId, setBrokerId] = useState("zerodha");
  const [brokerageOnExercise, setBrokerageOnExercise] = useState(true);
  const [onDate, setOnDate] = useState(() => istDateString());

  const broker = resolveBroker(brokerId, { perOrder: 20 });
  const rates = getChargeRates(onDate);
  const qty = isPos(toNum(lots)) && isPos(toNum(lotText)) ? Math.round(toNum(lots)) * toNum(lotText) : NaN;
  const res = squareOffVsExpire({
    type,
    strike: toNum(strike),
    settlement: toNum(settle),
    premiumNow: toNum(premiumNow),
    entryPremium: toNum(entry),
    qty,
    broker,
    brokerageOnExercise,
    onDate,
  });

  const changeSymbol = (s: string) => {
    setSymbol(s);
    setLotText(String(getLotSize(s) ?? ""));
    const step = getStrikeStep(s);
    const k = toNum(strike);
    if (isPos(k)) setStrike(String(Math.round(k / step) * step));
  };

  const sameRate = Math.abs(rates.sttOptionSell - rates.sttOptionExercise) < 1e-12;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel
        title="Square off or let it expire?"
        description="For a long in-the-money option on expiry day: compare selling it before the close with letting the exchange settle it at intrinsic value."
        actions={<Badge variant="info">Rates from {formatDateIST(rates.effectiveFrom)}</Badge>}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
          <SymbolField value={symbol} onChange={changeSymbol} />
          <Segmented label="Option" value={type} onChange={setType} options={[{ value: "CE", label: "Call" }, { value: "PE", label: "Put" }]} />
          <NumField label="Strike" prefix="₹" value={strike} onChange={setStrike} invalid={!isPos(toNum(strike))} />
          <NumField label="Expected settlement" prefix="₹" value={settle} onChange={setSettle} invalid={!isPos(toNum(settle))} hint="Final settlement price of the underlying" />
          <NumField label="Bid you can sell at" prefix="₹" value={premiumNow} onChange={setPremiumNow} invalid={!(toNum(premiumNow) >= 0)} />
          <NumField label="Your entry premium" prefix="₹" value={entry} onChange={setEntry} hint="Optional, for net P&L" />
          <NumField label="Lots" value={lots} onChange={setLots} invalid={!isPos(toNum(lots))} />
          <NumField label="Lot size" value={lotText} onChange={setLotText} invalid={!isPos(toNum(lotText))} />
          <SelectField label="Broker" value={brokerId} onChange={setBrokerId} options={BROKER_PRESETS.filter((b) => b.id !== "custom").map((b) => ({ value: b.id, label: `${b.name} · ₹${b.perOrder}/order` }))} />
          <DateField label="Expiry date" value={onDate} onChange={(v) => setOnDate(v || istDateString())} hint="Picks the STT rate" />
          <div className="col-span-2 flex items-center gap-2 self-end pb-2">
            <Switch id="brk-ex" checked={brokerageOnExercise} onCheckedChange={setBrokerageOnExercise} />
            <Label htmlFor="brk-ex" className="text-body-sm">
              Broker charges brokerage on exercise
            </Label>
          </div>
        </div>

        {res.valid && !res.itm ? (
          <Callout tone="warning" className="mt-4">
            At {formatINR(toNum(settle))} this {formatStrike(toNum(strike))} {type} expires out of the money and worthless, so there is no exercise STT. Sell any remaining premium if you can.
          </Callout>
        ) : null}

        <Callout className="mt-4">
          STT on a sold option is {formatPct(rates.sttOptionSell * 100, { decimals: 3 })} of the premium. STT on an exercised option is {formatPct(rates.sttOptionExercise * 100, { decimals: 3 })} of the intrinsic value
          {sameRate
            ? ". The two rates are now equal, so the gap comes from the bid being below intrinsic, brokerage and the other square-off charges."
            : ". Because the exercise rate is charged on the full intrinsic value, letting a deep ITM option expire can cost more than selling it."}{" "}
          Exchange fees on settlement are not included. Verify current rates with your broker.
        </Callout>
      </Panel>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:self-start">
        <Panel title="Comparison">
          {!res.valid ? (
            <p className="text-body text-muted-foreground">Fill in strike, settlement, bid and quantity.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: "SQUARE_OFF", title: "Square off", net: res.squareOff.net, cost: res.squareOff.charges.total, pnl: res.squareOff.pnl },
                    { id: "EXPIRE", title: "Let it expire", net: res.expire.net, cost: res.expire.total, pnl: res.expire.pnl },
                  ] as const
                ).map((c) => {
                  const win = res.better === c.id;
                  return (
                    <div key={c.id} className={cn("rounded-md px-3 py-2", win ? "bg-wash-profit shadow-[inset_0_0_0_1px_hsl(var(--bullish)/0.35)]" : "bg-control-track")}>
                      <div className="flex items-center gap-1 text-label text-muted-foreground">
                        {win ? <CheckCircle2 className="h-3.5 w-3.5 text-bullish" aria-hidden="true" /> : null}
                        {c.title}
                      </div>
                      <div className="mt-0.5 font-num text-lead font-semibold tabular-nums">{formatINR(c.net, { decimals: 0 })}</div>
                      <div className="text-body-sm text-muted-foreground">Costs {formatINR(c.cost)}</div>
                      {isPos(toNum(entry)) ? <div className={cn("text-body-sm font-medium", c.pnl >= 0 ? "text-bullish" : "text-bearish")}>P&L {formatINR(c.pnl, { decimals: 0 })}</div> : null}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-body font-medium" role="status">
                {res.better === "EQUAL"
                  ? "Both routes leave you with the same amount."
                  : res.better === "SQUARE_OFF"
                    ? `Squaring off leaves you ${formatINR(res.advantage, { decimals: 0 })} better off.`
                    : `Letting it expire leaves you ${formatINR(-res.advantage, { decimals: 0 })} better off.`}
              </p>
              {res.itm ? (
                <p className="mt-1 text-body-sm text-muted-foreground">
                  Square off wins whenever you can sell at or above <span className="font-num font-semibold text-foreground">{formatINR(res.squareOffThreshold)}</span>.
                </p>
              ) : null}
              <div className="mt-4 divide-y divide-separator">
                <KV k="Intrinsic per unit" v={formatINR(res.intrinsicPerUnit)} />
                <KV k="Sale proceeds" v={formatINR(res.squareOff.proceeds, { decimals: 0 })} />
                <KV k="Square-off STT" v={formatINR(res.squareOff.charges.stt)} />
                <KV k="Other square-off charges" v={formatINR(res.squareOff.charges.total - res.squareOff.charges.stt)} />
                <KV k="Settlement value" v={formatINR(res.expire.proceeds, { decimals: 0 })} />
                <KV k="Exercise STT" v={formatINR(res.expire.stt)} />
                <KV k="Exercise brokerage + GST" v={formatINR(res.expire.brokerage + res.expire.gst)} />
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
