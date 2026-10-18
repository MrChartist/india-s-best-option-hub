import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DEFAULT_MARKET_PARAMS,
  dteLabel,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  formatSigned,
  forwardFromSpot,
  getDividendYield,
  getLotSize,
  getMarketParams,
  timeToExpiryYears,
} from "@/lib/options";
import { futuresBasis, isPos, toNum, upcomingExpiries } from "./calcLogic";
import { Callout, KV, NumField, Panel, SelectField, Stat, SymbolField } from "./CalcUi";
import { SpotBadge } from "./SpotBadge";
import { useSpotHint } from "./useSpotHint";

const r2 = (n: number) => String(Math.round(n * 100) / 100);

export default function FuturesBasisCalculator() {
  const [symbol, setSymbol] = useState("NIFTY");
  const hint = useSpotHint(symbol);
  const expiries = useMemo(() => upcomingExpiries(symbol, new Date(), 8).filter((e) => e.type === "monthly").slice(0, 3), [symbol]);
  const [expiry, setExpiry] = useState(() => expiries[0]?.date ?? "");
  const [spotText, setSpotText] = useState("");
  const [spotTouched, setSpotTouched] = useState(false);
  const [futText, setFutText] = useState("");
  const [futTouched, setFutTouched] = useState(false);
  const [rText, setRText] = useState(() => r2((getMarketParams().r || DEFAULT_MARKET_PARAMS.r) * 100));
  const [qText, setQText] = useState(() => r2(getDividendYield("NIFTY") * 100));

  useEffect(() => {
    if (!expiries.some((e) => e.date === expiry)) setExpiry(expiries[0]?.date ?? "");
  }, [expiries, expiry]);
  useEffect(() => {
    if (!spotTouched && Number.isFinite(hint.spot)) setSpotText(r2(hint.spot));
  }, [hint.spot, spotTouched]);

  const spot = toNum(spotText);
  const T = expiry ? timeToExpiryYears(expiry) : NaN;
  const r = toNum(rText) / 100;
  const q = Number.isFinite(toNum(qText)) ? toNum(qText) / 100 : 0;

  // until the user types a futures price, show the theoretical one (clearly labelled)
  useEffect(() => {
    if (!futTouched && isPos(spot) && isPos(T) && Number.isFinite(r)) setFutText(r2(forwardFromSpot(spot, T, r, q)));
  }, [spot, T, r, q, futTouched]);

  const fut = toNum(futText);
  const res = futuresBasis(spot, fut, T, r, q);
  const lot = getLotSize(symbol, expiry) ?? NaN;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="Futures basis and carry" description="Compare the futures price with spot: basis, annualised cost of carry, fair value and the dividend yield the market is pricing in.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
          <SymbolField
            value={symbol}
            onChange={(s) => {
              setSymbol(s);
              setSpotTouched(false);
              setFutTouched(false);
              setQText(r2(getDividendYield(s) * 100));
            }}
          />
          <SelectField label="Expiry" value={expiry} onChange={setExpiry} options={expiries.map((e) => ({ value: e.date, label: formatDateIST(e.date) }))} />
          <NumField label="Spot" prefix="₹" value={spotText} onChange={(v) => { setSpotText(v); setSpotTouched(true); }} invalid={!isPos(spot)} hint={<SpotBadge hint={hint} touched={spotTouched} />} />
          <NumField
            label="Futures price"
            prefix="₹"
            value={futText}
            onChange={(v) => { setFutText(v); setFutTouched(true); }}
            invalid={!isPos(fut)}
            hint={futTouched ? "Your input" : <Badge variant="warning">Derived fair value · type the quote</Badge>}
          />
          <NumField label="Interest rate" suffix="%" value={rText} onChange={setRText} invalid={!Number.isFinite(r)} hint="Annual, continuous" />
          <NumField label="Dividend yield" suffix="%" value={qText} onChange={setQText} hint="For the fair value" />
        </div>
        {expiry ? <p className="mt-3 text-body-sm text-muted-foreground">Time to expiry: {dteLabel(expiry)} ({formatNumberIN(T * 365, 2)} days, to 15:30 IST).</p> : null}
        <Callout className="mt-3">
          Fair futures = S × e<sup>(r − q)T</sup>. A futures price above fair value suggests rich carry (cash-and-carry arbitrage); below fair value suggests a discount (reverse arbitrage). Charges, margin funding and impact cost narrow these gaps in practice.
        </Callout>
      </Panel>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:self-start">
        <Panel title="Result" actions={res.valid ? <Badge variant={res.state === "PREMIUM" ? "bullish" : res.state === "DISCOUNT" ? "bearish" : "neutral"}>{res.state === "PREMIUM" ? "Premium" : res.state === "DISCOUNT" ? "Discount" : "Flat"}</Badge> : null}>
          {!res.valid ? (
            <p className="text-body text-muted-foreground">Enter spot, futures price, expiry and rate.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Basis" value={`${formatSigned(res.basis, 2)} pts`} emphasis tone="brand" sub={formatPct(res.basisPct, { decimals: 3, signed: true })} />
                <Stat label="Annualised carry" value={formatPct(res.annualisedPct, { decimals: 2, signed: true })} sub={`Continuous ${formatPct(res.continuousPct, { decimals: 2 })}`} />
                <Stat label="Implied dividend yield" value={formatPct(res.impliedDivYieldPct, { decimals: 2 })} sub="r − ln(F/S)/T" />
                <Stat label="vs fair value" value={`${formatSigned(res.mispricing, 2)} pts`} tone={Math.abs(res.mispricing) < 0.5 ? "default" : res.mispricing > 0 ? "warning" : "info"} sub={`Fair ${formatINR(res.fair)}`} />
              </div>
              <div className="mt-4 divide-y divide-separator">
                <KV k="Basis per lot" v={Number.isFinite(lot) ? formatINR(res.basis * lot, { decimals: 0 }) : "—"} />
                <KV k="Mispricing per lot" v={Number.isFinite(lot) ? formatINR(res.mispricing * lot, { decimals: 0 }) : "—"} />
                <KV k="Lot size" v={Number.isFinite(lot) ? formatNumberIN(lot) : "—"} />
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
