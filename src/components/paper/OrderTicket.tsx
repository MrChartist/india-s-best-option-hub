/** Order ticket with a mini chain: pick a strike, see bid/ask/mid, estimated fill, charges and margin. */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BROKER_PRESETS, calcCharges, estimateMargin, formatDateIST, getContractSpec, formatINR, formatNumberIN, formatPct, getBrokerPreset, getExpiries, getLotSize, getStrikeStep, istDateString, type OptionType, type Side } from "@/lib/options";
import { marketFillPrice, quoteMid, type GuardResult, type OrderInput, type OrderType, type Quote } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";
import { feedSourceToQuote, type FeedSnapshot } from "@/components/positions/helpers";
import { SourceBadge } from "@/components/positions/ui";

const PAPER_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "AXISBANK", "KOTAKBANK", "LT", "ITC", "BHARTIARTL", "BAJFINANCE", "MARUTI"];

export type TicketOrder = Omit<OrderInput, "context">;

const SKELETON_ROWS = ["s1", "s2", "s3", "s4", "s5", "s6"];

function quoteOf(feed: FeedSnapshot | undefined, strike: number, type: OptionType): Quote | null {
  if (!feed || !feed.expiryMatch) return null;
  const row = feed.chain.find((r) => r.strikePrice === strike);
  const leg = row ? (type === "CE" ? row.ce : row.pe) : undefined;
  if (!leg) return null;
  return { bid: leg.bidPrice || 0, ask: leg.askPrice || 0, ltp: leg.ltp || 0, source: feed.source };
}

export function OrderTicket({
  symbol,
  onSymbol,
  expiry,
  onExpiry,
  feed,
  slippagePct,
  allowSampleFills,
  brokerId,
  capital,
  maxRiskPct,
  beginnerMode,
  guard,
  wouldBeNaked,
  onPlace,
}: {
  symbol: string;
  onSymbol: (s: string) => void;
  expiry: string;
  onExpiry: (e: string) => void;
  feed: FeedSnapshot | undefined;
  slippagePct: number;
  allowSampleFills: boolean;
  brokerId: string;
  /** Capital the max-loss percentage is measured against (equity). */
  capital: number;
  maxRiskPct: number;
  beginnerMode: boolean;
  /** Guardrail check for an order at an expected fill price with the declared max loss. */
  guard: (input: TicketOrder, price: number, maxLoss: number | null) => GuardResult;
  /** True when selling this contract would open or add to a naked short. */
  wouldBeNaked: (input: TicketOrder) => boolean;
  onPlace: (input: TicketOrder, quote: Quote | null, maxLoss: number | null) => boolean;
}) {
  const uid = useId();
  const expiries = useMemo(() => getExpiries(symbol, new Date(), 8), [symbol]);
  const [strike, setStrike] = useState<number>(NaN);
  const [type, setType] = useState<OptionType>("CE");
  const [lotsText, setLotsText] = useState("1");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [limitText, setLimitText] = useState("");
  const [slText, setSlText] = useState("");
  const [tgText, setTgText] = useState("");
  const [maxLossText, setMaxLossText] = useState("");

  const chain = useMemo(() => (feed?.expiryMatch ? [...feed.chain].sort((a, b) => a.strikePrice - b.strikePrice) : []), [feed]);
  const spot = feed?.spot ?? NaN;
  const step = getStrikeStep(symbol);
  const atm = useMemo(() => {
    if (!chain.length || !(spot > 0)) return NaN;
    return chain.reduce((best, r) => (Math.abs(r.strikePrice - spot) < Math.abs(best - spot) ? r.strikePrice : best), chain[0].strikePrice);
  }, [chain, spot]);

  // Reset strike to ATM when the chain changes contract.
  useEffect(() => {
    setStrike(NaN);
  }, [symbol, expiry]);
  const activeStrike = Number.isFinite(strike) && chain.some((r) => r.strikePrice === strike) ? strike : atm;

  const strikesView = useMemo(() => {
    const i = chain.findIndex((r) => r.strikePrice === atm);
    if (i < 0) return chain.slice(0, 15);
    return chain.slice(Math.max(0, i - 7), i + 8);
  }, [chain, atm]);

  const lotSize = getLotSize(symbol, expiry || undefined) ?? 0;
  const lots = Math.floor(Number(lotsText));
  const quote = Number.isFinite(activeStrike) ? quoteOf(feed, activeStrike, type) : null;
  const mid = quoteMid(quote);
  const limit = Number(limitText);
  const sl = slText.trim() ? Number(slText) : undefined;
  const target = tgText.trim() ? Number(tgText) : undefined;
  const isSample = feed?.source === "sample";
  const blockedSample = isSample && !allowSampleFills;

  const broker = getBrokerPreset(brokerId) ?? BROKER_PRESETS[0];
  const maxLoss = maxLossText.trim() ? Number(maxLossText) : null;
  const maxLossValid = maxLoss !== null && Number.isFinite(maxLoss) && maxLoss > 0 ? maxLoss : null;
  const maxLossPct = maxLossValid !== null && capital > 0 ? (maxLossValid / capital) * 100 : NaN;

  const orderFor = (side: Side): TicketOrder => ({ symbol, expiry, strike: activeStrike, type, side, lots, lotSize, orderType, limitPrice: orderType === "LIMIT" ? limit : undefined, sl, target, origin: "ticket" });

  const estimate = (side: Side) => {
    const px = orderType === "LIMIT" ? (limit > 0 ? limit : NaN) : marketFillPrice(quote, side, slippagePct);
    if (!(px > 0) || !(lots > 0) || !(lotSize > 0) || !Number.isFinite(activeStrike)) return null;
    const qty = lots * lotSize;
    const ch = calcCharges([{ type, side, price: px, qty, exchange: getContractSpec(symbol)?.exchange ?? "NSE" }], { broker, onDate: istDateString() });
    const m = side === "SELL" && spot > 0 ? estimateMargin([{ symbol, type, side, strike: activeStrike, expiry, lots, lotSize, premium: px }], { spot }) : null;
    return { px, qty, value: px * qty, charges: ch.total, margin: m?.fundsRequired ?? NaN, elm: m?.elmExpiryDay ?? 0, guard: guard(orderFor(side), px, maxLossValid) };
  };
  const estBuy = estimate("BUY");
  const estSell = estimate("SELL");
  const sellHidden = beginnerMode && Number.isFinite(activeStrike) && lots > 0 && wouldBeNaked(orderFor("SELL"));
  const suggested = estBuy && !estBuy.guard.risk.unlimited ? Math.ceil(estBuy.guard.risk.loss) : null;

  const err = !lotSize
    ? "Lot size unknown for this symbol."
    : !(lots > 0)
      ? "Enter lots."
      : !Number.isFinite(activeStrike)
        ? "Pick a strike."
        : orderType === "LIMIT" && !(limit > 0)
          ? "Enter a limit price."
          : orderType === "MARKET" && !quote
            ? "No quote for this strike."
            : orderType === "MARKET" && blockedSample
              ? "Only sample quotes. Turn on sample fills in settings."
              : (sl !== undefined && !(sl > 0)) || (target !== undefined && !(target > 0))
                ? "SL and target must be premium prices above zero."
                : null;

  const submit = (side: Side) => {
    if (err) return;
    const ok = onPlace(orderFor(side), quote, maxLossValid);
    if (ok) {
      setSlText("");
      setTgText("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${uid}-sym`}>Underlying</Label>
          <Select value={symbol} onValueChange={onSymbol}>
            <SelectTrigger id={`${uid}-sym`} className="h-9 w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAPER_SYMBOLS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${uid}-exp`}>Expiry</Label>
          <Select value={expiry} onValueChange={onExpiry}>
            <SelectTrigger id={`${uid}-exp`} className="h-9 w-full min-w-0" title={expiry ? formatDateIST(expiry) : undefined}>
              <SelectValue placeholder="Expiry" />
            </SelectTrigger>
            <SelectContent>
              {expiries.map((e) => (
                <SelectItem key={e.date} value={e.date}>
                  {formatDateIST(e.date)} · {e.type} · {e.dte === 0 ? "today" : `${e.dte}d`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-body-sm">
        <span className="text-muted-foreground">
          Spot <span className="font-num font-semibold text-foreground tabular-nums">{spot > 0 ? formatNumberIN(spot, 2) : "—"}</span> · lot {lotSize || "—"} · step {step}
        </span>
        {feed && !feed.loading ? <SourceBadge source={feedSourceToQuote(feed.source, feed.isLive)} asOf={feed.asOf} /> : null}
      </div>

      {feed?.loading || !feed ? (
        <div className="space-y-1.5" role="status" aria-busy="true" aria-label="Loading chain">
          {SKELETON_ROWS.map((k) => (
            <Skeleton key={k} className="h-7 w-full" />
          ))}
        </div>
      ) : !strikesView.length ? (
        <p className="rounded-tile border border-dashed border-border px-3 py-4 text-center text-body-sm text-muted-foreground">{feed.expiryMatch ? "No strikes in this chain." : "The chain for this expiry is not available yet."}</p>
      ) : (
        <div className="max-h-[300px] overflow-auto rounded-tile border border-border">
          <table className="w-full font-num text-body-sm tabular-nums">
            <caption className="sr-only">Mini option chain. Choose a CE or PE price to select that contract.</caption>
            <thead className="sticky top-0 bg-surface">
              <tr className="text-label uppercase text-muted-foreground">
                <th scope="col" className="px-2 py-1.5 text-right">CE LTP</th>
                <th scope="col" className="px-2 py-1.5 text-center">Strike</th>
                <th scope="col" className="px-2 py-1.5 text-left">PE LTP</th>
              </tr>
            </thead>
            <tbody>
              {strikesView.map((r) => {
                const isAtm = r.strikePrice === atm;
                const sel = (t: OptionType) => r.strikePrice === activeStrike && type === t;
                return (
                  <tr key={r.strikePrice} className={cn("border-t border-border/60", isAtm && "bg-wash-brand/55")}>
                    <td className={cn("px-1 py-0.5 text-right", r.strikePrice < spot && "bg-muted/60")}>
                      <button
                        type="button"
                        onClick={() => {
                          setStrike(r.strikePrice);
                          setType("CE");
                        }}
                        aria-pressed={sel("CE")}
                        aria-label={`${r.ce.ltp > 0 ? formatNumberIN(r.ce.ltp, 2) : "No LTP"}: select ${r.strikePrice} CE`}
                        className={cn("w-full rounded px-1.5 py-1 text-right hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none", sel("CE") && "bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {r.ce.ltp > 0 ? formatNumberIN(r.ce.ltp, 2) : <span aria-hidden="true">—</span>}
                      </button>
                    </td>
                    <td className={cn("px-2 py-0.5 text-center font-semibold", isAtm && "text-primary-ink")}>{formatNumberIN(r.strikePrice)}</td>
                    <td className={cn("px-1 py-0.5 text-left", r.strikePrice > spot && "bg-muted/60")}>
                      <button
                        type="button"
                        onClick={() => {
                          setStrike(r.strikePrice);
                          setType("PE");
                        }}
                        aria-pressed={sel("PE")}
                        aria-label={`${r.pe.ltp > 0 ? formatNumberIN(r.pe.ltp, 2) : "No LTP"}: select ${r.strikePrice} PE`}
                        className={cn("w-full rounded px-1.5 py-1 text-left hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none", sel("PE") && "bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {r.pe.ltp > 0 ? formatNumberIN(r.pe.ltp, 2) : <span aria-hidden="true">—</span>}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-tile border border-border bg-surface/60 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-lead font-bold">
            {symbol} {Number.isFinite(activeStrike) ? formatNumberIN(activeStrike) : "—"} {type}
          </p>
          <ToggleGroup type="single" value={type} onValueChange={(v) => v && setType(v as OptionType)} aria-label="Option type" size="sm" variant="outline">
            <ToggleGroupItem value="CE">CE</ToggleGroupItem>
            <ToggleGroupItem value="PE">PE</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <dl className="mt-2 grid grid-cols-4 gap-2 text-body-sm">
          {[
            ["Bid", quote?.bid],
            ["Ask", quote?.ask],
            ["LTP", quote?.ltp],
            ["Mid", mid],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="text-label uppercase text-muted-foreground">{k as string}</dt>
              <dd className="font-num tabular-nums">{typeof v === "number" && v > 0 ? formatNumberIN(v, 2) : "—"}</dd>
            </div>
          ))}
        </dl>
        {(() => {
          const row = chain.find((r) => r.strikePrice === activeStrike);
          const iv = row ? (type === "CE" ? row.ce.iv : row.pe.iv) : 0;
          return iv > 0 ? <p className="mt-1 text-body-sm text-muted-foreground">IV {formatPct(iv, { decimals: 1 })}</p> : null;
        })()}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-lots`}>Lots</Label>
          <Input id={`${uid}-lots`} type="number" inputMode="numeric" min={1} step={1} value={lotsText} onChange={(e) => setLotsText(e.target.value)} className="h-9" />
        </div>
        <div className="grid gap-1.5">
          <span id={`${uid}-ot`} className="text-sm font-medium">
            Order type
          </span>
          <ToggleGroup type="single" value={orderType} onValueChange={(v) => v && setOrderType(v as OrderType)} aria-labelledby={`${uid}-ot`} size="sm" variant="outline" className="justify-start">
            <ToggleGroupItem value="MARKET">Market</ToggleGroupItem>
            <ToggleGroupItem value="LIMIT">Limit</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {orderType === "LIMIT" ? (
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor={`${uid}-limit`}>Limit price (₹)</Label>
            <Input id={`${uid}-limit`} type="number" inputMode="decimal" min={0.05} step="0.05" value={limitText} onChange={(e) => setLimitText(e.target.value)} placeholder={mid > 0 ? `Mid ${mid.toFixed(2)}` : undefined} className="h-9" />
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-sl`}>Stop-loss (₹, optional)</Label>
          <Input id={`${uid}-sl`} type="number" inputMode="decimal" min={0.05} step="0.05" value={slText} onChange={(e) => setSlText(e.target.value)} className="h-9" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-tg`}>Target (₹, optional)</Label>
          <Input id={`${uid}-tg`} type="number" inputMode="decimal" min={0.05} step="0.05" value={tgText} onChange={(e) => setTgText(e.target.value)} className="h-9" />
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">SL and target are premium levels for this contract, checked on every quote update. For a short, the stop sits above the entry.</p>

      {isSample ? (
        <p className="flex items-start gap-1.5 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-body-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {allowSampleFills ? "No live chain. Fills use generated sample quotes and are labelled as such." : "No live chain and sample fills are off, so market orders cannot fill."}
        </p>
      ) : null}

      <div className="space-y-1.5 rounded-tile border border-border p-3">
        <Label htmlFor={`${uid}-maxloss`} className="flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-primary-ink" aria-hidden="true" />
          Max loss on this trade (₹) <span className="text-bearish" aria-hidden="true">*</span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={`${uid}-maxloss`}
            type="number"
            inputMode="numeric"
            min={1}
            step={100}
            required
            aria-required="true"
            aria-describedby={`${uid}-maxloss-help`}
            value={maxLossText}
            onChange={(e) => setMaxLossText(e.target.value)}
            placeholder={suggested ? `e.g. ${suggested}` : "Required"}
            className="h-9"
          />
          {suggested && !maxLossText ? (
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={() => setMaxLossText(String(suggested))}>
              Use {formatINR(suggested, { decimals: 0 })}
            </Button>
          ) : null}
        </div>
        <p id={`${uid}-maxloss-help`} className="text-body-sm text-muted-foreground">
          {maxLossValid !== null ? (
            <>
              <span className={cn("font-num font-semibold tabular-nums", maxLossPct > maxRiskPct ? "text-bearish" : "text-foreground")}>{formatPct(maxLossPct, { decimals: 2 })}</span> of capital · your limit is {maxRiskPct}% ({formatINR((capital * maxRiskPct) / 100, { decimals: 0 })})
            </>
          ) : (
            <>Required before placing. Your limit is {maxRiskPct}% of capital ({formatINR((capital * maxRiskPct) / 100, { decimals: 0 })}). Buys risk the premium unless you set a stop; sells need a stop.</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["BUY", "SELL"] as const).map((side) => {
          const est = side === "BUY" ? estBuy : estSell;
          const hidden = side === "SELL" && sellHidden;
          const blocked = !!est && !est.guard.ok;
          return (
            <div key={side} className="min-w-0 space-y-1.5">
              {hidden ? (
                <div className="flex h-10 items-center justify-center gap-1.5 rounded-pill border border-dashed border-border px-2 text-center text-body-sm text-muted-foreground" role="note">
                  <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Naked sell hidden
                </div>
              ) : (
                <Button
                  className={cn("h-10 w-full font-semibold", side === "BUY" ? "bg-bullish text-bullish-foreground hover:bg-bullish/90" : "bg-bearish text-bearish-foreground hover:bg-bearish/90")}
                  disabled={!!err || blocked}
                  onClick={() => submit(side)}
                >
                  {side === "BUY" ? "Buy" : "Sell"} {orderType === "LIMIT" ? "limit" : "at market"}
                </Button>
              )}
              <div className="text-center text-body-sm text-muted-foreground" aria-live="polite">
                {hidden ? (
                  "Beginner mode: selling needs a long of the same type to hedge it."
                ) : est ? (
                  side === "BUY" ? (
                    <>
                      ≈ {formatNumberIN(est.px, 2)} × {formatNumberIN(est.qty)}
                      <br />
                      total <span className="font-num font-semibold tabular-nums text-foreground">{formatINR(est.value + est.charges, { decimals: 0 })}</span>
                      <span className="block text-micro">
                        premium {formatINR(est.value, { decimals: 0 })} + charges {formatINR(est.charges, { decimals: 0 })}
                      </span>
                    </>
                  ) : (
                    <>
                      ≈ {formatNumberIN(est.px, 2)} · get {formatINR(est.value, { decimals: 0 })}
                      <br />
                      margin <span className="font-num font-semibold tabular-nums text-foreground">{Number.isFinite(est.margin) ? formatINR(est.margin, { decimals: 0 }) : "—"}</span> · charges {formatINR(est.charges, { decimals: 0 })}
                      {est.elm > 0 ? (
                        <span className="mt-1 flex justify-center">
                          <Badge variant="warning" title={`Includes the 2% extreme-loss margin charged on expiry day (${formatINR(est.elm, { decimals: 0 })}).`}>
                            incl. expiry-day ELM
                          </Badge>
                        </span>
                      ) : null}
                    </>
                  )
                ) : (
                  "—"
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(() => {
        const buyR = estBuy?.guard.blockers ?? [];
        const sellR = !sellHidden ? estSell?.guard.blockers ?? [] : [];
        const reasons = [...new Set([...buyR, ...sellR])].map((r) => (buyR.includes(r) && sellR.includes(r) ? r : buyR.includes(r) ? `Buy: ${r}` : `Sell: ${r}`));
        if (err || !reasons.length) {
          return !err && estBuy?.guard.ok ? (
            <p className="flex items-center justify-center gap-1.5 text-body-sm text-bullish">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Guardrails passed for a buy{estSell?.guard.ok && !sellHidden ? " and a sell" : ""}.
            </p>
          ) : null;
        }
        return (
          <ul className="space-y-1 rounded-tile border border-warning/30 bg-wash-warning/60 px-3 py-2 text-body-sm text-foreground" aria-label="Guardrail checks">
            {reasons.map((r) => (
              <li key={r} className="flex items-start gap-1.5">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        );
      })()}
      {err ? <p className="text-center text-body-sm text-muted-foreground">{err}</p> : null}
      <p className="text-body-sm text-muted-foreground">
        Market fills at mid {slippagePct > 0 ? `± ${slippagePct}% slippage` : "(no slippage)"}, rounded to ₹0.05 against you.
      </p>
    </div>
  );
}
