import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { encodeLegsParam } from "@/components/strategy/strategyState";
import {
  black76Price,
  estimateMargin,
  formatDateIST,
  formatINR,
  formatStrike,
  forwardFromSpot,
  getLotSize,
  getMarketParams,
  getStrikeStep,
  netPremium,
  pctToDec,
  timeToExpiryYears,
  type Leg,
  type Side,
} from "@/lib/options";
import { isPos, toNum, upcomingExpiries, type Instrument } from "./calcLogic";
import { Callout, KV, NumField, Panel, SelectField, Stat, SymbolField } from "./CalcUi";
import { SpotBadge } from "./SpotBadge";
import { useSpotHint } from "./useSpotHint";

interface MRow {
  id: string;
  type: Instrument;
  side: Side;
  strike: string;
  lots: string;
  premium: string;
  iv: string;
}

let seq = 0;
const nid = () => `m${Date.now().toString(36)}${(seq += 1)}`;

const TYPES = [
  { value: "CE", label: "CE" },
  { value: "PE", label: "PE" },
  { value: "FUT", label: "FUT" },
] as const;
const SIDES = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
] as const;

type PresetId = "short-straddle" | "short-strangle" | "iron-condor" | "bull-put" | "bear-call" | "naked-put" | "short-fut";
const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "short-straddle", label: "Short straddle" },
  { id: "short-strangle", label: "Short strangle" },
  { id: "iron-condor", label: "Iron condor" },
  { id: "bull-put", label: "Bull put spread" },
  { id: "bear-call", label: "Bear call spread" },
  { id: "naked-put", label: "Naked put" },
  { id: "short-fut", label: "Short futures" },
];

function presetRows(id: PresetId, atm: number, step: number): MRow[] {
  const mk = (type: Instrument, side: Side, strike: number): MRow => ({ id: nid(), type, side, strike: type === "FUT" ? "" : String(strike), lots: "1", premium: "", iv: "" });
  const w = step * 4;
  switch (id) {
    case "short-straddle":
      return [mk("CE", "SELL", atm), mk("PE", "SELL", atm)];
    case "short-strangle":
      return [mk("CE", "SELL", atm + w), mk("PE", "SELL", atm - w)];
    case "iron-condor":
      return [mk("PE", "BUY", atm - 2 * w), mk("PE", "SELL", atm - w), mk("CE", "SELL", atm + w), mk("CE", "BUY", atm + 2 * w)];
    case "bull-put":
      return [mk("PE", "SELL", atm), mk("PE", "BUY", atm - w)];
    case "bear-call":
      return [mk("CE", "SELL", atm), mk("CE", "BUY", atm + w)];
    case "naked-put":
      return [mk("PE", "SELL", atm - w)];
    case "short-fut":
      return [mk("FUT", "SELL", 0)];
  }
}

const METHOD_LABEL = {
  "scenario-approx": "16-scenario SPAN approximation",
  "defined-risk": "Capped at defined max loss",
  "long-only": "Long options: premium only",
} as const;

export default function MarginCalculator() {
  const [symbol, setSymbol] = useState("NIFTY");
  const expiries = useMemo(() => upcomingExpiries(symbol, new Date(), 6), [symbol]);
  const [expiry, setExpiry] = useState(() => expiries[0]?.date ?? "");
  const hint = useSpotHint(symbol);
  const [spotText, setSpotText] = useState("");
  const [spotTouched, setSpotTouched] = useState(false);
  const [ivText, setIvText] = useState("14");
  const [rows, setRows] = useState<MRow[]>(() => presetRows("iron-condor", 25000, 50));
  /** True until the user edits the legs: the default iron condor follows the quoted spot. */
  const [autoRows, setAutoRows] = useState(true);

  // keep the expiry valid for the chosen underlying
  useEffect(() => {
    if (!expiries.some((e) => e.date === expiry)) setExpiry(expiries[0]?.date ?? "");
  }, [expiries, expiry]);

  // prefill spot from the quote (until the user types their own)
  useEffect(() => {
    if (!spotTouched && Number.isFinite(hint.spot)) setSpotText(String(Math.round(hint.spot * 100) / 100));
  }, [hint.spot, spotTouched]);

  const spot = toNum(spotText);
  const step = getStrikeStep(symbol);
  const lotSize = getLotSize(symbol, expiry) ?? NaN;
  const sigma = pctToDec(toNum(ivText));
  const { r } = getMarketParams();
  const T = expiry ? timeToExpiryYears(expiry) : NaN;

  // keep the default iron condor centred on the quoted spot until the user edits the legs
  const autoAtm = autoRows && !spotTouched && isPos(spot) ? Math.round(spot / step) * step : NaN;
  useEffect(() => {
    if (isPos(autoAtm)) setRows(presetRows("iron-condor", autoAtm, step));
  }, [autoAtm, step]);

  const modelPremium = (row: MRow): number => {
    if (!isPos(spot) || !(T >= 0)) return NaN;
    const F = forwardFromSpot(spot, T, r, 0);
    if (row.type === "FUT") return Math.round(F * 20) / 20;
    const K = toNum(row.strike);
    const vol = isPos(toNum(row.iv)) ? pctToDec(toNum(row.iv)) : sigma;
    if (!isPos(K) || !isPos(vol)) return NaN;
    return Math.round(black76Price({ F, K, T, r, sigma: vol, type: row.type }) * 20) / 20;
  };

  const legs: Leg[] = rows
    .map((row): Leg | null => {
      const strike = row.type === "FUT" ? 0 : toNum(row.strike);
      const lots = toNum(row.lots);
      const typed = toNum(row.premium);
      const premium = row.premium.trim() === "" ? modelPremium(row) : typed;
      if ((row.type !== "FUT" && !isPos(strike)) || !isPos(lots) || !(premium >= 0) || !isPos(lotSize) || !expiry) return null;
      const ivp = toNum(row.iv);
      return {
        id: row.id,
        symbol,
        type: row.type,
        side: row.side,
        strike,
        expiry,
        lots: Math.round(lots),
        lotSize,
        premium,
        iv: isPos(ivp) ? pctToDec(ivp) : isPos(sigma) ? sigma : undefined,
      };
    })
    .filter((l): l is Leg => l !== null);

  const est = isPos(spot) && legs.length ? estimateMargin(legs, { spot, sigma: isPos(sigma) ? sigma : undefined }) : null;
  const prem = netPremium(legs);
  const usesModel = rows.some((row) => row.premium.trim() === "");
  const builderHref = legs.length ? `/strategy-builder?legs=${encodeLegsParam(legs)}` : "";

  const applyPreset = (id: PresetId) => {
    const atm = isPos(spot) ? Math.round(spot / step) * step : 0;
    if (!atm && id !== "short-fut") return;
    setAutoRows(false);
    setRows(presetRows(id, atm, step));
  };
  const update = (id: string, patch: Partial<MRow>) => {
    setAutoRows(false);
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Panel
          title="Margin estimate"
          description="SPAN-style estimate for a multi-leg position, with the hedge benefit compared with margining every leg on its own."
          actions={<Badge variant="warning">Estimate; actual SPAN may differ</Badge>}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
            <SymbolField value={symbol} onChange={(s) => {
                setSymbol(s);
                setSpotText("");
                setSpotTouched(false);
                setAutoRows(true);
                setRows([]);
              }} />
            <SelectField
              label="Expiry"
              value={expiry}
              onChange={setExpiry}
              options={expiries.map((e) => ({ value: e.date, label: `${formatDateIST(e.date)}${e.type === "monthly" ? " · M" : ""}` }))}
            />
            <NumField
              label="Spot"
              prefix="₹"
              value={spotText}
              onChange={(v) => { setSpotText(v); setSpotTouched(true); }}
              invalid={!isPos(spot)}
              hint={<SpotBadge hint={hint} touched={spotTouched} />}
            />
            <NumField label="Default IV" suffix="%" value={ivText} onChange={setIvText} invalid={!isPos(sigma)} hint="Used where a leg has no IV" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Load a preset">
            <span className="mr-1 text-label text-muted-foreground">Presets</span>
            {PRESETS.map((p) => (
              <Button key={p.id} variant="outline" size="pill" onClick={() => applyPreset(p.id)} disabled={!isPos(spot)}>
                {p.label}
              </Button>
            ))}
          </div>

          <ul className="mt-4 divide-y divide-separator overflow-hidden rounded-md border border-separator empty:hidden" aria-label="Legs">
            {rows.map((row, i) => {
              const mp = modelPremium(row);
              return (
                <li key={row.id} className="grid grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
                  <SelectField compact label="Type" value={row.type} onChange={(v) => update(row.id, { type: v })} options={TYPES} />
                  <SelectField compact label="Side" value={row.side} onChange={(v) => update(row.id, { side: v })} options={SIDES} />
                  {row.type === "FUT" ? (
                    <div className="min-w-0 space-y-1">
                      <span className="block text-label text-muted-foreground">Strike</span>
                      <div className="flex h-7 items-center rounded-sm bg-control-track px-2 text-body text-muted-foreground [@media(pointer:coarse)]:h-9">n/a</div>
                    </div>
                  ) : (
                    <NumField label="Strike" value={row.strike} onChange={(v) => update(row.id, { strike: v })} invalid={!isPos(toNum(row.strike))} step={String(step)} />
                  )}
                  <NumField label="Lots" value={row.lots} onChange={(v) => update(row.id, { lots: v })} invalid={!isPos(toNum(row.lots))} />
                  <NumField label={row.type === "FUT" ? "Price" : "Premium"} prefix="₹" value={row.premium} placeholder={Number.isFinite(mp) ? `${mp} model` : "price"} onChange={(v) => update(row.id, { premium: v })} />
                  <NumField label="IV" suffix="%" value={row.iv} placeholder={ivText || "—"} onChange={(v) => update(row.id, { iv: v })} />
                  <Button variant="ghost" size="icon" className="col-span-2 w-full sm:col-span-1 sm:w-7" onClick={() => {
                      setAutoRows(false);
                      setRows((rs) => rs.filter((x) => x.id !== row.id));
                    }} aria-label={`Remove leg ${i + 1}`}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
          {rows.length === 0 ? <p className="mt-2 text-body text-muted-foreground">No legs. Add one or load a preset.</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => {
                setAutoRows(false);
                setRows((rs) => [...rs, { id: nid(), type: "CE", side: "SELL", strike: isPos(spot) ? String(Math.round(spot / step) * step) : "", lots: "1", premium: "", iv: "" }]);
              }}>
              <Plus /> Add leg
            </Button>
            {builderHref ? (
              <Button asChild variant="ghost" size="sm">
                <Link to={builderHref}>
                  Open in Strategy Builder <ArrowUpRight />
                </Link>
              </Button>
            ) : null}
          </div>
          {usesModel ? (
            <Callout className="mt-3">
              Blank premiums use a Black-76 model price at the leg IV (shown in grey). Type the traded premium for a more accurate premium-received figure.
            </Callout>
          ) : null}
        </Panel>
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-3 xl:self-start">
        <Panel title="Margin required" actions={est?.definedRisk ? <Badge variant="bullish"><ShieldCheck /> Defined risk</Badge> : null}>
          {!est || legs.length === 0 ? (
            <p className="text-body text-muted-foreground">{isPos(spot) ? "Add at least one complete leg." : "Enter a spot price to estimate margin."}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Total margin" value={formatINR(est.total, { decimals: 0 })} emphasis tone="brand" className="col-span-2" sub={METHOD_LABEL[est.method]} />
                <Stat label="Hedge benefit" value={formatINR(est.hedgeBenefit, { decimals: 0 })} tone={est.hedgeBenefit > 0 ? "bullish" : "default"} sub={`Naked ${formatINR(est.nakedTotal, { decimals: 0 })}`} />
                <Stat label={prem.type === "CREDIT" ? "Premium received" : "Premium paid"} value={formatINR(Math.abs(prem.net), { decimals: 0 })} tone={prem.type === "CREDIT" ? "bullish" : "default"} />
              </div>
              <div className="mt-3 divide-y divide-separator">
                <KV k="SPAN (approx.)" v={formatINR(est.span, { decimals: 0 })} />
                <KV k="Exposure margin" v={formatINR(est.exposure, { decimals: 0 })} />
                <KV k="Expiry-day ELM" v={formatINR(est.elmExpiryDay, { decimals: 0 })} />
                <KV k="Premium received (short legs)" v={formatINR(est.premiumReceived, { decimals: 0 })} />
                <KV k="Total" v={formatINR(est.total, { decimals: 0 })} strong />
              </div>
              <p className="mt-3 text-body-sm text-muted-foreground">
                Lot size {Number.isFinite(lotSize) ? lotSize : "—"} · {legs.length} leg{legs.length === 1 ? "" : "s"} · spot {formatStrike(spot)}. Compare with your broker's margin calculator before placing the trade.
              </p>
            </>
          )}
        </Panel>
        <Callout tone="warning">
          Estimate; actual SPAN may differ. The exchange publishes SPAN risk arrays several times a day; this tool approximates them with 16 price and volatility scenarios, 2% index / 3.5% stock exposure and an extra 2% ELM on short index options on expiry day.
        </Callout>
      </div>
    </div>
  );
}
