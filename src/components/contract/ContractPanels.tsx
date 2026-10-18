/** Contract page controls and side panels: contract switcher, trade actions, depth and contract facts. */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Layers, ListPlus, ScrollText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { encodeLegs } from "@/components/option-chain/basket";
import type { ExpiryDate } from "@/lib/mockData";
import type { OptionLegDataExt } from "@/lib/types/market";
import {
  dteLabel,
  formatDateIST,
  formatINR,
  formatNumberIN,
  formatPct,
  formatStrike,
  getMarketParams,
  getDividendYield,
  probITM,
  timeToExpiryYears,
  type Side,
} from "@/lib/options";
import { contractBasketLeg, contractPath, type ContractKey } from "@/lib/history/contractSeries";
import { cn } from "@/lib/utils";
import { HelpTip, Panel } from "./ContractUi";

export function ContractActions({ k, leg }: { k: ContractKey; leg: OptionLegDataExt | undefined }) {
  const [side, setSide] = useState<Side>("BUY");
  const legs = encodeLegs([contractBasketLeg(k, side, leg)]);
  return (
    <>
      <ToggleGroup type="single" value={side} onValueChange={(v) => v && setSide(v as Side)} aria-label="Leg direction">
        <ToggleGroupItem value="BUY" aria-label="Buy" className="data-[state=on]:text-bullish">
          Buy
        </ToggleGroupItem>
        <ToggleGroupItem value="SELL" aria-label="Sell" className="data-[state=on]:text-bearish">
          Sell
        </ToggleGroupItem>
      </ToggleGroup>
      <Button asChild variant="outline">
        <Link to={`/strategy-builder?legs=${legs}`}>
          <ListPlus aria-hidden="true" /> Add to builder
        </Link>
      </Button>
      <Button asChild>
        <Link to={`/paper-trading?legs=${legs}`}>
          <Wallet aria-hidden="true" /> Paper trade
        </Link>
      </Button>
    </>
  );
}

/** CE/PE toggle, strike stepper and expiry picker. Every change navigates to the new contract URL. */
export function ContractSwitcher({ k, strikes, expiries, spot }: { k: ContractKey; strikes: number[]; expiries: ExpiryDate[]; spot: number }) {
  const navigate = useNavigate();
  const go = (patch: Partial<ContractKey>) => {
    const n = { ...k, ...patch };
    navigate(contractPath(n.symbol, n.expiry, n.strike, n.type));
  };
  const list = useMemo(() => (strikes.includes(k.strike) ? strikes : [...strikes, k.strike].sort((a, b) => a - b)), [strikes, k.strike]);
  const i = list.indexOf(k.strike);
  const atm = spot > 0 && strikes.length ? strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]) : NaN;
  const expiryOptions = expiries.some((e) => e.value === k.expiry) ? expiries : [{ label: formatDateIST(k.expiry), value: k.expiry, daysToExpiry: 0 }, ...expiries];

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Switch contract">
      <ToggleGroup type="single" value={k.type} onValueChange={(v) => v && v !== k.type && go({ type: v as "CE" | "PE" })} aria-label="Option type">
        <ToggleGroupItem value="CE" aria-label="Call (CE)">CE</ToggleGroupItem>
        <ToggleGroupItem value="PE" aria-label="Put (PE)">PE</ToggleGroupItem>
      </ToggleGroup>
      {/* Strike stepper: previous / pop-up / next share one bezel. */}
      <div className="flex h-7 items-center rounded-pill bg-control shadow-control [@media(pointer:coarse)]:h-9">
        <Button size="icon" variant="ghost" className="rounded-r-none" disabled={i <= 0} onClick={() => go({ strike: list[i - 1] })} aria-label="Lower strike">
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Select value={String(k.strike)} onValueChange={(v) => go({ strike: Number(v) })}>
          <SelectTrigger className="w-[148px] rounded-none border-x border-separator bg-transparent font-num tabular-nums shadow-none" aria-label="Strike">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {list.map((s) => (
              <SelectItem key={s} value={String(s)} className="font-num tabular-nums">
                {formatStrike(s)}
                {s === atm ? " · ATM" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" className="rounded-l-none" disabled={i < 0 || i >= list.length - 1} onClick={() => go({ strike: list[i + 1] })} aria-label="Higher strike">
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <Select value={k.expiry} onValueChange={(v) => go({ expiry: v })}>
        <SelectTrigger className="w-[140px]" aria-label="Expiry">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {expiryOptions.map((e) => (
            <SelectItem key={e.value} value={e.value}>
              {formatDateIST(e.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button asChild variant="ghost">
        <Link to={`/option-chain?symbol=${encodeURIComponent(k.symbol)}&expiry=${k.expiry}`}>
          <Layers aria-hidden="true" /> Option chain
        </Link>
      </Button>
    </div>
  );
}

/** Top of the order book from the live chain (bid/ask with quantities when the feed sends them). */
export function DepthPanel({ leg, lotSize, sample }: { leg: OptionLegDataExt | undefined; lotSize: number; sample: boolean }) {
  const bid = leg?.bidPrice ?? 0;
  const ask = leg?.askPrice ?? 0;
  const twoSided = bid > 0 && ask > 0 && ask >= bid;
  const mid = twoSided ? (bid + ask) / 2 : NaN;
  const spread = twoSided ? ask - bid : NaN;
  const bq = leg?.bidQty;
  const aq = leg?.askQty;
  const hasQty = typeof bq === "number" || typeof aq === "number";
  const maxQty = Math.max(bq ?? 0, aq ?? 0, 1);
  const lots = (q: number | undefined) => (typeof q === "number" && lotSize > 0 ? `${formatNumberIN(q / lotSize, q % lotSize === 0 ? 0 : 1)} lots` : "");

  return (
    <Panel
      title={
        <>
          <ScrollText className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Market depth
        </>
      }
      subtitle={sample ? "Best bid and offer from the sample chain (not market data)" : "Best bid and offer from the option chain"}
    >
      {!leg || (!twoSided && !(leg.ltp > 0)) ? (
        <p className="text-body-sm text-muted-foreground">No quote for this contract in the current chain.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-tile bg-wash-profit/50 px-3 py-2.5">
              <p className="text-label text-muted-foreground">Bid</p>
              <p className="font-num text-title tabular-nums text-bullish">{bid > 0 ? formatINR(bid) : "—"}</p>
              <p className="font-num text-body-sm tabular-nums text-muted-foreground">{typeof bq === "number" ? `${formatNumberIN(bq)} qty ${lots(bq) ? `· ${lots(bq)}` : ""}` : "Quantity not sent"}</p>
            </div>
            <div className="rounded-tile bg-wash-loss/50 px-3 py-2.5 text-right">
              <p className="text-label text-muted-foreground">Ask</p>
              <p className="font-num text-title tabular-nums text-bearish">{ask > 0 ? formatINR(ask) : "—"}</p>
              <p className="font-num text-body-sm tabular-nums text-muted-foreground">{typeof aq === "number" ? `${formatNumberIN(aq)} qty ${lots(aq) ? `· ${lots(aq)}` : ""}` : "Quantity not sent"}</p>
            </div>
          </div>
          {hasQty ? (
            <div className="flex h-1.5 overflow-hidden rounded-full bg-control-track" aria-hidden="true">
              <div className="ml-auto h-full bg-bullish/70" style={{ width: `${((bq ?? 0) / maxQty) * 50}%` }} />
              <div className="h-full bg-bearish/70" style={{ width: `${((aq ?? 0) / maxQty) * 50}%` }} />
            </div>
          ) : null}
          <dl className="grid grid-cols-3 gap-2 text-body-sm">
            <div>
              <dt className="text-muted-foreground">Mid</dt>
              <dd className="font-num tabular-nums">{formatINR(mid)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Spread</dt>
              <dd className="font-num tabular-nums">{formatINR(spread)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1 text-muted-foreground">
                Spread % <HelpTip text="Spread as a share of the mid price. Under 1% is tight for index options; wide spreads cost you on entry and exit." label="About spread percent" />
              </dt>
              <dd className={cn("font-num tabular-nums", twoSided && spread / mid > 0.03 ? "text-warning" : "")}>{twoSided ? formatPct((spread / mid) * 100, { decimals: 2 }) : "—"}</dd>
            </div>
          </dl>
          <p className="text-body-sm text-muted-foreground">Only the best level is available from the chain feed; full five-level depth needs a broker market-depth subscription.</p>
        </div>
      )}
    </Panel>
  );
}

/** Contract facts: lot, premium per lot, breakeven, probability ITM and decay per lot. */
export function FactsPanel({ k, leg, spot, lotSize, thetaPerUnit }: { k: ContractKey; leg: OptionLegDataExt | undefined; spot: number; lotSize: number; thetaPerUnit: number }) {
  const premium = leg?.ltp ?? NaN;
  const now = new Date();
  const T = timeToExpiryYears(k.expiry, now);
  const r = getMarketParams().r;
  const q = getDividendYield(k.symbol);
  const sigma = leg && leg.iv > 0 ? leg.iv / 100 : NaN;
  const F = spot > 0 && T > 0 ? spot * Math.exp((r - q) * T) : NaN;
  const pItm = F > 0 && sigma > 0 ? probITM({ F, K: k.strike, T, sigma, type: k.type }) : NaN;
  const breakeven = premium > 0 ? (k.type === "CE" ? k.strike + premium : k.strike - premium) : NaN;
  const toBreakeven = breakeven > 0 && spot > 0 ? ((breakeven - spot) / spot) * 100 : NaN;
  const rows: Array<{ label: string; value: string; help?: string }> = [
    { label: "Expiry", value: `${formatDateIST(k.expiry)} · ${dteLabel(k.expiry, now)}` },
    { label: "Lot size", value: lotSize > 0 ? `${formatNumberIN(lotSize)} units` : "—" },
    { label: "Premium per lot", value: premium > 0 && lotSize > 0 ? formatINR(premium * lotSize, { decimals: 0 }) : "—", help: "LTP × lot size. The most a buyer can lose on one lot, before charges." },
    { label: "Breakeven at expiry", value: breakeven > 0 ? `${formatNumberIN(breakeven, 2)}${Number.isFinite(toBreakeven) ? ` (${formatPct(toBreakeven, { decimals: 2, signed: true })} from spot)` : ""}` : "—" },
    { label: "Chance of expiring ITM", value: Number.isFinite(pItm) ? formatPct(pItm * 100, { decimals: 1 }) : "—", help: "Risk-neutral probability from the current IV (lognormal on the forward). It is a model reading, not a forecast." },
    { label: "Theta per lot", value: Number.isFinite(thetaPerUnit) && lotSize > 0 ? `${formatINR(thetaPerUnit * lotSize, { decimals: 0 })} / day` : "—", help: "Model time decay per calendar day for one lot at today's IV and spot." },
  ];
  return (
    <Panel
      title={
        <>
          <ScrollText className="h-4 w-4 text-primary-ink" aria-hidden="true" /> Contract facts
        </>
      }
      subtitle="Per lot figures use the exchange lot size for this expiry"
    >
      <dl className="-my-1 divide-y divide-separator text-body">
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-8 items-center justify-between gap-3 py-1">
            <dt className="flex items-center gap-1 text-muted-foreground">
              {row.label}
              {row.help ? <HelpTip text={row.help} label={`About ${row.label}`} /> : null}
            </dt>
            <dd className="text-right font-num tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
