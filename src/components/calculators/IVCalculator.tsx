import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { decToPct, formatGreek, formatINR, formatNumberIN, formatPct, formatStrike, impliedVol, impliedVol76, type OptionType } from "@/lib/options";
import { isNonNeg, priceOption, toNum } from "./calcLogic";
import { Callout, KV, NumField, Panel, Segmented, Stat } from "./CalcUi";
import { usePricingInputs } from "./PricingInputs";

export default function IVCalculator() {
  const { state, fields, valid } = usePricingInputs();
  const [type, setType] = useState<OptionType>("CE");
  const [priceText, setPriceText] = useState("150");
  const price = toNum(priceText);
  const ready = valid && isNonNeg(price) && state.T > 0;

  const iv = !ready
    ? NaN
    : state.model === "B76"
      ? impliedVol76(price, { F: state.underlying, K: state.strike, T: state.T, r: state.r, type })
      : impliedVol(price, { S: state.underlying, K: state.strike, T: state.T, r: state.r, q: state.q, type });
  const solved = Number.isFinite(iv);
  const check = solved ? priceOption(state, iv, type) : null;
  const intrinsicNow = valid ? priceOption(state, 0.0001, type).intrinsic : NaN;
  const floor = valid ? priceOption(state, 0.001, type).price : NaN;
  const bumps = solved ? [-2, -1, 1, 2].map((d) => ({ d, p: priceOption(state, Math.max(iv + d / 100, 0.001), type).price })) : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
      <Panel title="Inputs" description="Solve the volatility that makes the model price equal to the market premium.">
        {fields}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Segmented label="Option" value={type} onChange={setType} options={[{ value: "CE", label: "Call" }, { value: "PE", label: "Put" }]} />
          <NumField label="Market premium" prefix="₹" value={priceText} onChange={setPriceText} invalid={!isNonNeg(price)} hint="Use the mid price when the spread is wide" />
        </div>
      </Panel>

      <div className="min-w-0 space-y-4">
        <Panel title="Implied volatility" actions={ready ? <Badge variant="outline">{formatStrike(state.strike)} {type}</Badge> : null}>
          {!valid ? (
            <p className="text-body text-muted-foreground">Enter the underlying price, strike, expiry and rate.</p>
          ) : !(state.T > 0) ? (
            <Callout tone="warning">This contract has expired, so there is no time value to solve for.</Callout>
          ) : !solved ? (
            <Callout tone="loss">
              No volatility reproduces {formatINR(price)}.{" "}
              {price < floor ? `The premium is below the no-arbitrage floor of ${formatINR(floor)} (intrinsic ${formatINR(intrinsicNow)}, discounted).` : "The premium is above what any volatility up to 500% can produce."} Check the inputs, especially the underlying price and model.
            </Callout>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Implied vol" value={formatPct(decToPct(iv), { decimals: 2 })} emphasis tone="brand" className="col-span-2 sm:col-span-1" />
                <Stat label="Model price" value={formatINR(check?.price ?? NaN)} sub="At the solved IV" />
                <Stat label="Time value" value={formatINR(price - intrinsicNow)} sub={`Intrinsic ${formatINR(intrinsicNow)}`} />
              </div>
              <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
                <div className="divide-y divide-border">
                  <KV k="Delta" v={formatGreek("delta", check?.g.delta ?? NaN)} />
                  <KV k="Gamma" v={formatGreek("gamma", check?.g.gamma ?? NaN)} />
                  <KV k="Theta / day" v={formatGreek("theta", check?.g.theta ?? NaN)} />
                  <KV k="Vega / vol pt" v={formatGreek("vega", check?.g.vega ?? NaN)} />
                </div>
                <div className="divide-y divide-border">
                  {bumps.map((b) => (
                    <KV key={b.d} k={`Price at IV ${b.d > 0 ? "+" : "−"}${Math.abs(b.d)} pt (${formatNumberIN(decToPct(iv) + b.d, 2)}%)`} v={formatINR(b.p)} />
                  ))}
                </div>
              </div>
              <p className="mt-3 text-body-sm text-muted-foreground">
                {state.model === "B76" ? "Black-76 on the futures price" : "Black-Scholes-Merton on spot with dividend yield"} · {state.expiryLabel}. NSE quotes IV on spot; Black-76 on the futures or parity forward usually gives a cleaner smile.
              </p>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
