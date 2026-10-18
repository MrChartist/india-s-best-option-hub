import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { decodeShare, loadSavedStrategies } from "@/components/strategy/strategyState";
import { formatCompactIN, formatINR, formatNumberIN, formatPct, getLotSize, positionSize, type Leg } from "@/lib/options";
import { cn } from "@/lib/utils";
import { isPos, maxLossPerLotFromLegs, toNum } from "./calcLogic";
import { Callout, KV, NumField, Panel, Segmented, SelectField, Stat, SymbolField } from "./CalcUi";

type Mode = "manual" | "stop" | "strategy";

/** Strategy Builder keeps its working draft here (see StrategyBuilder.tsx). */
const DRAFT_KEY = "mc_strategy_draft_v1";

interface StrategyOption {
  id: string;
  label: string;
  symbol: string;
  legs: Leg[];
}

const lotSizeFor = (symbol: string, expiry: string) => getLotSize(symbol, expiry) ?? getLotSize(symbol) ?? 0;

function readStrategies(): StrategyOption[] {
  const out: StrategyOption[] = [];
  try {
    const draft = typeof window !== "undefined" ? window.localStorage.getItem(DRAFT_KEY) : null;
    const st = decodeShare(draft, lotSizeFor);
    if (st && st.legs.length) out.push({ id: "__draft", label: `Current builder draft · ${st.symbol}`, symbol: st.symbol, legs: st.legs });
  } catch {
    /* storage blocked: skip the draft */
  }
  for (const s of loadSavedStrategies()) {
    const st = decodeShare(s.share, lotSizeFor);
    if (st && st.legs.length) out.push({ id: s.id, label: `${s.name} · ${s.symbol}`, symbol: st.symbol, legs: st.legs });
  }
  return out;
}

const RISK_LADDER = [0.5, 1, 2, 3, 5];

export default function PositionSizeCalculator() {
  const [capital, setCapital] = useState("500000");
  const [riskPct, setRiskPct] = useState("2");
  const [mode, setMode] = useState<Mode>("manual");
  const [symbol, setSymbol] = useState("NIFTY");
  const [lotText, setLotText] = useState(String(getLotSize("NIFTY") ?? 65));
  const [maxLossText, setMaxLossText] = useState("3000");
  const [entryText, setEntryText] = useState("150");
  const [stopText, setStopText] = useState("100");
  const strategies = useMemo(readStrategies, []);
  const [strategyId, setStrategyId] = useState(() => strategies[0]?.id ?? "");

  const cap = toNum(capital);
  const risk = toNum(riskPct);
  const lot = toNum(lotText);
  const chosen = strategies.find((s) => s.id === strategyId);
  const legsRisk = chosen ? maxLossPerLotFromLegs(chosen.legs) : null;
  const strategyLot = chosen?.legs.find((l) => l.lotSize > 0)?.lotSize ?? NaN;

  let perLot = NaN;
  let perLotNote = "";
  if (mode === "manual") {
    perLot = toNum(maxLossText);
  } else if (mode === "stop") {
    const e = toNum(entryText);
    const s = toNum(stopText);
    perLot = isPos(lot) && Number.isFinite(e) && Number.isFinite(s) ? Math.abs(e - s) * lot : NaN;
    perLotNote = Number.isFinite(perLot) ? `${formatNumberIN(Math.abs(e - s), 2)} pts × ${formatNumberIN(lot)} units` : "";
  } else if (legsRisk) {
    perLot = legsRisk.perLot;
    perLotNote = legsRisk.unlimited
      ? "This strategy has unlimited loss at expiry"
      : `Max loss ${formatINR(legsRisk.totalMaxLoss, { decimals: 0 })} for ${legsRisk.baseLots} lot${legsRisk.baseLots === 1 ? "" : "s"}`;
  }

  const lotSizeUsed = mode === "strategy" ? strategyLot : lot;
  const unlimited = mode === "strategy" && !!legsRisk?.unlimited;
  const res = !unlimited ? positionSize({ capital: cap, riskPct: risk, maxLossPerLot: perLot, lotSize: lotSizeUsed }) : { lots: 0, riskAmount: (cap * risk) / 100, capitalAtRisk: 0 };
  // Risk is a share of capital: above 100% the worst case would exceed the whole account.
  const riskOk = isPos(risk) && risk <= 100;
  const inputsOk = isPos(cap) && riskOk && isPos(perLot) && Number.isFinite(perLot);
  const oneLotTooBig = inputsOk && res.lots === 0 && perLot > res.riskAmount;
  const highRisk = riskOk && risk > 5;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="Position size" description="Size a trade so that its worst-case loss stays within a fixed share of your capital.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumField label="Trading capital" prefix="₹" value={capital} onChange={setCapital} invalid={!isPos(cap)} hint={isPos(cap) ? formatCompactIN(cap, { symbol: true }) : "Enter your capital"} />
          <NumField label="Risk per trade" suffix="%" value={riskPct} onChange={setRiskPct} invalid={!riskOk} hint={isPos(risk) && risk > 100 ? "Risk cannot be more than 100% of capital" : isPos(cap) && riskOk ? `${formatINR((cap * risk) / 100, { decimals: 0 })} at risk` : "Most traders use 0.5 to 2%"} />
        </div>
        {highRisk ? (
          <Callout tone="warning" className="mt-3">
            Risking more than 5% per trade means a short losing streak can cut your capital sharply.
          </Callout>
        ) : null}

        <Segmented
          className="mt-4 max-w-md"
          label="Max loss per lot from"
          value={mode}
          onChange={setMode}
          options={[
            { value: "manual", label: "Manual" },
            { value: "stop", label: "Stop-loss" },
            { value: "strategy", label: "Saved strategy" },
          ]}
        />

        <div className="mt-4">
          {mode === "manual" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <NumField label="Max loss per lot" prefix="₹" value={maxLossText} onChange={setMaxLossText} invalid={!isPos(toNum(maxLossText))} hint="Worst-case rupee loss for one lot" />
              <SymbolField value={symbol} onChange={(s) => { setSymbol(s); setLotText(String(getLotSize(s) ?? "")); }} />
              <NumField label="Lot size" value={lotText} onChange={setLotText} hint="For the quantity shown" />
            </div>
          ) : null}
          {mode === "stop" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
              <SymbolField value={symbol} onChange={(s) => { setSymbol(s); setLotText(String(getLotSize(s) ?? "")); }} />
              <NumField label="Lot size" value={lotText} onChange={setLotText} invalid={!isPos(lot)} />
              <NumField label="Entry price" prefix="₹" value={entryText} onChange={setEntryText} />
              <NumField label="Stop-loss price" prefix="₹" value={stopText} onChange={setStopText} />
              {perLotNote ? <p className="col-span-2 text-body-sm text-muted-foreground sm:col-span-4">Loss per lot: {formatINR(perLot)} ({perLotNote}). Slippage and charges come on top.</p> : null}
            </div>
          ) : null}
          {mode === "strategy" ? (
            strategies.length === 0 ? (
              <Callout>
                No saved strategies found in this browser. Build and save one in the Strategy Builder, or use the manual mode.
              </Callout>
            ) : (
              <div className="space-y-2">
                <SelectField label="Strategy" value={strategyId} onChange={setStrategyId} options={strategies.map((s) => ({ value: s.id, label: s.label }))} />
                {perLotNote ? (
                  <p className={cn("text-body-sm", unlimited ? "text-bearish" : "text-muted-foreground")}>
                    {perLotNote}. {unlimited ? "Add a protective leg to size it by risk." : `Per lot: ${formatINR(perLot, { decimals: 0 })} at expiry (before charges).`}
                  </p>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </Panel>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:self-start">
        <Panel title="Result">
          {!inputsOk && !unlimited ? (
            <p className="text-body text-muted-foreground">Enter capital, risk % and the loss per lot.</p>
          ) : unlimited ? (
            <Callout tone="loss">Unlimited-loss strategies cannot be sized by a fixed risk budget.</Callout>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Lots" value={formatNumberIN(res.lots)} emphasis tone={res.lots > 0 ? "brand" : "bearish"} sub={isPos(lotSizeUsed) ? `${formatNumberIN(res.lots * lotSizeUsed)} units` : undefined} />
                <Stat label="Capital at risk" value={formatINR(res.capitalAtRisk, { decimals: 0 })} sub={isPos(cap) ? formatPct((res.capitalAtRisk / cap) * 100, { decimals: 2 }) + " of capital" : undefined} />
              </div>
              <div className="mt-3 divide-y divide-separator">
                <KV k="Risk budget" v={formatINR(res.riskAmount, { decimals: 0 })} />
                <KV k="Loss per lot" v={formatINR(perLot, { decimals: 0 })} />
                <KV k="Unused budget" v={formatINR(res.riskAmount - res.capitalAtRisk, { decimals: 0 })} />
              </div>
              {oneLotTooBig ? (
                <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-wash-loss px-3 py-2 text-body-sm text-bearish">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <p>
                    One lot risks {formatINR(perLot, { decimals: 0 })}, which is {formatPct((perLot / cap) * 100, { decimals: 2 })} of capital and more than your {formatPct(risk, { decimals: 1 })} budget. Skip the trade, tighten the stop or use a hedged structure.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </Panel>
        {inputsOk && !unlimited ? (
          <Panel title="Risk ladder" description="Lots at other risk levels for the same loss per lot.">
            <table className="w-full text-body">
              <thead className="[&_th]:shadow-[inset_0_calc(-1*var(--hairline))_0_hsl(var(--separator-strong))]">
                <tr className="text-left">
                  <th scope="col">Risk</th>
                  <th scope="col" className="text-right">Budget</th>
                  <th scope="col" className="text-right">Lots</th>
                </tr>
              </thead>
              <tbody className="zebra-rows">
                {RISK_LADDER.map((p) => {
                  const r = positionSize({ capital: cap, riskPct: p, maxLossPerLot: perLot, lotSize: lotSizeUsed });
                  return (
                    <tr key={p} className={cn(Math.abs(p - risk) < 1e-9 && "font-semibold text-primary-ink")}>
                      <td>{formatPct(p, { decimals: 1 })}</td>
                      <td className="text-right">{formatINR(r.riskAmount, { decimals: 0 })}</td>
                      <td className="text-right">{r.lots}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Badge variant="neutral" className="mt-3">Before charges and slippage</Badge>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
