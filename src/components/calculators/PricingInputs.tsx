import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MARKET_PARAMS, dteLabel, formatNumberIN, getDividendYield, getMarketParams, getStrikeStep, istDateString, timeToExpiryYears } from "@/lib/options";
import { isPos, toNum, upcomingExpiries } from "./calcLogic";
import { DateField, NumField, Segmented, SymbolField } from "./CalcUi";
import { SpotBadge } from "./SpotBadge";
import { useSpotHint } from "./useSpotHint";

export type Model = "BS" | "B76";
export type ExpiryMode = "date" | "days";

export interface PricingState {
  symbol: string;
  model: Model;
  underlying: number;
  strike: number;
  T: number;
  r: number;
  q: number;
  expiryLabel: string;
  /** Strike step for the underlying, for ladder tables. */
  step: number;
}

function round2(n: number) {
  return String(Math.round(n * 100) / 100);
}

/** Shared inputs for the price and IV calculators. Owns its own state and reports parsed values. */
export function usePricingInputs() {
  const [symbol, setSymbol] = useState("NIFTY");
  const [model, setModel] = useState<Model>("BS");
  const hint = useSpotHint(symbol);
  const [underlyingText, setUnderlyingText] = useState("");
  const [touched, setTouched] = useState(false);
  const [strikeText, setStrikeText] = useState("");
  const [strikeTouched, setStrikeTouched] = useState(false);
  const [expiryMode, setExpiryMode] = useState<ExpiryMode>("date");
  const nextExpiry = useMemo(() => upcomingExpiries(symbol, new Date(), 1)[0]?.date ?? "", [symbol]);
  const [expiryDate, setExpiryDate] = useState(nextExpiry);
  const [daysText, setDaysText] = useState("7");
  const [rText, setRText] = useState(() => round2((getMarketParams().r || DEFAULT_MARKET_PARAMS.r) * 100));
  const [qText, setQText] = useState(() => round2(getDividendYield("NIFTY") * 100));

  useEffect(() => {
    if (!touched && Number.isFinite(hint.spot)) setUnderlyingText(round2(hint.spot));
  }, [hint.spot, touched]);
  const step = getStrikeStep(symbol);
  useEffect(() => {
    const s = toNum(underlyingText);
    if (!strikeTouched && isPos(s)) setStrikeText(String(Math.round(s / step) * step));
  }, [underlyingText, strikeTouched, step]);

  const changeSymbol = (s: string) => {
    setSymbol(s);
    setTouched(false);
    setStrikeTouched(false);
    setQText(round2(getDividendYield(s) * 100));
    const e = upcomingExpiries(s, new Date(), 1)[0]?.date;
    if (e) setExpiryDate(e);
  };

  const T = expiryMode === "date" ? (expiryDate ? timeToExpiryYears(expiryDate) : NaN) : isPos(toNum(daysText)) ? toNum(daysText) / 365 : NaN;
  const state: PricingState = {
    symbol,
    model,
    underlying: toNum(underlyingText),
    strike: toNum(strikeText),
    T,
    r: toNum(rText) / 100,
    q: model === "BS" ? (Number.isFinite(toNum(qText)) ? toNum(qText) / 100 : 0) : 0,
    expiryLabel: expiryMode === "date" ? (expiryDate ? dteLabel(expiryDate) : "—") : `${formatNumberIN(toNum(daysText), 2)} calendar days`,
    step,
  };

  const fields = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SymbolField value={symbol} onChange={changeSymbol} />
        <Segmented
          label="Model"
          value={model}
          onChange={setModel}
          options={[
            { value: "BS", label: "Spot · Black-Scholes" },
            { value: "B76", label: "Futures · Black-76" },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField
          label={model === "BS" ? "Spot (S)" : "Futures (F)"}
          prefix="₹"
          value={underlyingText}
          onChange={(v) => { setUnderlyingText(v); setTouched(true); }}
          invalid={!isPos(state.underlying)}
          hint={model === "BS" || touched ? <SpotBadge hint={hint} touched={touched} /> : "Spot prefilled. Type the futures price."}
        />
        <NumField label="Strike (K)" prefix="₹" value={strikeText} onChange={(v) => { setStrikeText(v); setStrikeTouched(true); }} invalid={!isPos(state.strike)} hint={`Step ${formatNumberIN(step, 2)}`} />
      </div>
      <Segmented className="max-w-xs" label="Time to expiry" value={expiryMode} onChange={setExpiryMode} options={[{ value: "date", label: "Expiry date" }, { value: "days", label: "Days" }]} />
      <div className="grid grid-cols-2 gap-3">
        {expiryMode === "date" ? (
          <DateField label="Expiry" value={expiryDate} min={istDateString()} onChange={setExpiryDate} hint={expiryDate ? `${state.expiryLabel} · to 15:30 IST` : "Pick a date"} />
        ) : (
          <NumField label="Days to expiry" value={daysText} onChange={setDaysText} invalid={!isPos(toNum(daysText))} hint="Calendar days, ACT/365" />
        )}
        <NumField label="Interest rate (r)" suffix="%" value={rText} onChange={setRText} invalid={!Number.isFinite(state.r)} hint="Annual, continuous" />
        {model === "BS" ? <NumField label="Dividend yield (q)" suffix="%" value={qText} onChange={setQText} hint="Index yield estimate" /> : null}
      </div>
    </div>
  );

  const valid = isPos(state.underlying) && isPos(state.strike) && Number.isFinite(state.T) && state.T >= 0 && Number.isFinite(state.r);
  return { state, fields, valid };
}
