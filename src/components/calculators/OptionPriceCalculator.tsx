import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  formatGreek,
  formatINR,
  formatNumberIN,
  formatPct,
  formatStrike,
  getLotSize,
  pctToDec,
  probITM,
  type Greeks,
} from "@/lib/options";
import { cn } from "@/lib/utils";
import { isPos, priceOption, toNum } from "./calcLogic";
import { NumField, Panel, Stat } from "./CalcUi";
import { usePricingInputs } from "./PricingInputs";

const GREEK_ROWS: Array<{ key: keyof Greeks; label: string; help: string; perLot: boolean }> = [
  { key: "delta", label: "Delta", help: "Price change per ₹1 move in the underlying", perLot: true },
  { key: "gamma", label: "Gamma", help: "Delta change per ₹1 move", perLot: true },
  { key: "theta", label: "Theta (calendar day)", help: "Price decay per calendar day", perLot: true },
  { key: "thetaTrading", label: "Theta (trading day)", help: "Decay per trading day (×365/252)", perLot: true },
  { key: "vega", label: "Vega", help: "Price change per 1 vol point", perLot: true },
  { key: "rho", label: "Rho", help: "Price change per 1% change in rates", perLot: true },
  { key: "vanna", label: "Vanna", help: "Delta change per 1 vol point", perLot: false },
  { key: "charm", label: "Charm", help: "Delta change per calendar day", perLot: false },
  { key: "vomma", label: "Vomma", help: "Vega change per 1 vol point", perLot: false },
];

export default function OptionPriceCalculator() {
  const { state, fields, valid } = usePricingInputs();
  const [ivText, setIvText] = useState("14");
  const [perLot, setPerLot] = useState(false);
  const sigma = pctToDec(toNum(ivText));
  const ok = valid && isPos(sigma);
  const lot = getLotSize(state.symbol) ?? 1;
  const mult = perLot ? lot : 1;

  const ce = ok ? priceOption(state, sigma, "CE") : null;
  const pe = ok ? priceOption(state, sigma, "PE") : null;
  const parityLhs = ce && pe ? ce.price - pe.price : NaN;
  const parityRhs = ce ? Math.exp(-state.r * state.T) * (ce.forward - state.strike) : NaN;
  const ladder = ok ? [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((k) => state.strike + k * state.step).filter((k) => k > 0) : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
      <Panel title="Inputs" description="Fair value and Greeks for European index and stock options.">
        {fields}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <NumField label="Implied volatility" suffix="%" value={ivText} onChange={setIvText} invalid={!isPos(sigma)} hint="Annualised" />
        </div>
      </Panel>

      <div className="min-w-0 space-y-4">
        <Panel
          title="Fair value"
          description={ok ? `${state.model === "BS" ? "Black-Scholes-Merton" : "Black-76"} · T = ${formatNumberIN(state.T * 365, 2)} days · ${state.expiryLabel}` : undefined}
          actions={
            <div className="flex items-center gap-2">
              <Switch id="per-lot" checked={perLot} onCheckedChange={setPerLot} aria-label="Show values per lot" />
              <Label htmlFor="per-lot" className="text-body-sm">
                Per lot ({formatNumberIN(lot)})
              </Label>
            </div>
          }
        >
          {!ce || !pe ? (
            <p className="text-body text-muted-foreground">Enter the underlying price, strike, expiry, rate and IV.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { t: "CE" as const, v: ce },
                  { t: "PE" as const, v: pe },
                ].map(({ t, v }) => (
                  <div key={t} className="rounded-tile border border-border bg-surface p-3">
                    <div className="flex items-center justify-between">
                      <Badge variant={t === "CE" ? "bearish" : "bullish"}>
                        {formatStrike(state.strike)} {t}
                      </Badge>
                      <span className="text-body-sm text-muted-foreground">P(ITM) {formatPct(probITM({ F: v.forward, K: state.strike, T: state.T, sigma, type: t }) * 100, { decimals: 1 })}</span>
                    </div>
                    <div className="mt-2 font-num text-num-hero font-bold tabular-nums">{formatINR(v.price * mult)}</div>
                    <div className="mt-1 flex gap-4 text-body-sm text-muted-foreground">
                      <span>Intrinsic {formatINR(v.intrinsic * mult)}</span>
                      <span>Time value {formatINR((v.price - v.intrinsic) * mult)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[480px] text-body">
                  <caption className="sr-only">Greeks for call and put</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-label uppercase text-muted-foreground">
                      <th className="py-2 font-semibold">Greek</th>
                      <th className="py-2 text-right font-semibold">Call</th>
                      <th className="py-2 text-right font-semibold">Put</th>
                      <th className="hidden py-2 pl-4 font-semibold md:table-cell">Meaning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {GREEK_ROWS.map((row) => {
                      const m = row.perLot ? mult : 1;
                      return (
                        <tr key={row.key}>
                          <th scope="row" className="py-1.5 text-left font-medium">
                            {row.label}
                            {!row.perLot && perLot ? <span className="ml-1 text-micro text-muted-foreground">(per unit)</span> : null}
                          </th>
                          <td className={cn("py-1.5 text-right tabular-nums", ce.g[row.key] < 0 && "text-bearish")}>{m === 1 ? formatGreek(row.key, ce.g[row.key]) : formatNumberIN(ce.g[row.key] * m, 2)}</td>
                          <td className={cn("py-1.5 text-right tabular-nums", pe.g[row.key] < 0 && "text-bearish")}>{m === 1 ? formatGreek(row.key, pe.g[row.key]) : formatNumberIN(pe.g[row.key] * m, 2)}</td>
                          <td className="hidden py-1.5 pl-4 text-body-sm text-muted-foreground md:table-cell">{row.help}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Forward" value={formatINR(ce.forward)} sub={state.model === "BS" ? "S·e^((r−q)T)" : "Futures input"} />
                <Stat label="C − P" value={formatINR(parityLhs)} />
                <Stat label="Parity check" value={formatINR(parityRhs)} sub="e^(−rT)(F − K)" tone={Math.abs(parityLhs - parityRhs) < 0.01 ? "bullish" : "warning"} />
              </div>
            </>
          )}
        </Panel>

        {ok && ladder.length ? (
          <Panel title="Strike ladder" description="Same IV for every strike (no skew), so treat wing prices as a rough guide.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-body">
                <thead>
                  <tr className="border-b border-border text-label uppercase text-muted-foreground">
                    <th className="py-2 text-right font-semibold">CE Δ</th>
                    <th className="py-2 text-right font-semibold">CE</th>
                    <th className="py-2 text-center font-semibold">Strike</th>
                    <th className="py-2 text-left font-semibold">PE</th>
                    <th className="py-2 text-left font-semibold">PE Δ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ladder.map((k) => {
                    const c = priceOption(state, sigma, "CE", k);
                    const p = priceOption(state, sigma, "PE", k);
                    const atm = k === state.strike;
                    return (
                      <tr key={k} className={cn(atm && "bg-wash-brand/55")}>
                        <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatGreek("delta", c.g.delta)}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatINR(c.price * mult)}</td>
                        <td className="py-1.5 text-center font-semibold tabular-nums">{formatStrike(k)}</td>
                        <td className="py-1.5 text-left tabular-nums">{formatINR(p.price * mult)}</td>
                        <td className="py-1.5 text-left tabular-nums text-muted-foreground">{formatGreek("delta", p.g.delta)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
