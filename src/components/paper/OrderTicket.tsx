/** Order ticket with a mini chain: pick a strike, see bid/ask/mid, estimated fill, charges and margin. */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { calcCharges, estimateMargin, formatDateIST, formatINR, formatNumberIN, formatPct, getExpiries, getLotSize, getStrikeStep, istDateString, type OptionType, type Side } from "@/lib/options";
import { marketFillPrice, quoteMid, type OrderInput, type OrderType, type Quote } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";
import { feedSourceToQuote, type FeedSnapshot } from "@/components/positions/helpers";
import { SourceBadge } from "@/components/positions/ui";

const PAPER_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN", "AXISBANK", "KOTAKBANK", "LT", "ITC", "BHARTIARTL", "TATAMOTORS", "BAJFINANCE", "MARUTI"];

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
  onPlace,
}: {
  symbol: string;
  onSymbol: (s: string) => void;
  expiry: string;
  onExpiry: (e: string) => void;
  feed: FeedSnapshot | undefined;
  slippagePct: number;
  allowSampleFills: boolean;
  onPlace: (input: Omit<OrderInput, "context">, quote: Quote | null) => boolean;
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

  const estimate = (side: Side) => {
    const px = orderType === "LIMIT" ? (limit > 0 ? limit : NaN) : marketFillPrice(quote, side, slippagePct);
    if (!(px > 0) || !(lots > 0) || !(lotSize > 0)) return null;
    const qty = lots * lotSize;
    const ch = calcCharges([{ type, side, price: px, qty }], { onDate: istDateString() });
    const margin = side === "SELL" && spot > 0 ? estimateMargin([{ symbol, type, side, strike: activeStrike, expiry, lots, lotSize, premium: px }], { spot }).total : px * qty;
    return { px, qty, value: px * qty, charges: ch.total, margin };
  };
  const estBuy = estimate("BUY");
  const estSell = estimate("SELL");

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
    const ok = onPlace(
      { symbol, expiry, strike: activeStrike, type, side, lots, lotSize, orderType, limitPrice: orderType === "LIMIT" ? limit : undefined, sl, target, origin: "ticket" },
      quote,
    );
    if (ok) {
      setSlText("");
      setTgText("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-sym`}>Underlying</Label>
          <Select value={symbol} onValueChange={onSymbol}>
            <SelectTrigger id={`${uid}-sym`} className="h-9">
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
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-exp`}>Expiry</Label>
          <Select value={expiry} onValueChange={onExpiry}>
            <SelectTrigger id={`${uid}-exp`} className="h-9">
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
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading chain">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
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
                        aria-label={`Select ${r.strikePrice} CE, LTP ${r.ce.ltp}`}
                        className={cn("w-full rounded px-1.5 py-1 text-right hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none", sel("CE") && "bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {r.ce.ltp > 0 ? formatNumberIN(r.ce.ltp, 2) : "—"}
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
                        aria-label={`Select ${r.strikePrice} PE, LTP ${r.pe.ltp}`}
                        className={cn("w-full rounded px-1.5 py-1 text-left hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none", sel("PE") && "bg-primary text-primary-foreground hover:bg-primary")}
                      >
                        {r.pe.ltp > 0 ? formatNumberIN(r.pe.ltp, 2) : "—"}
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

      <div className="grid grid-cols-2 gap-2">
        {(["BUY", "SELL"] as const).map((side) => {
          const est = side === "BUY" ? estBuy : estSell;
          return (
            <div key={side} className="space-y-1.5">
              <Button variant={side === "BUY" ? "buy" : "sell"} className="w-full" disabled={!!err} onClick={() => submit(side)}>
                {side === "BUY" ? "Buy" : "Sell"} {orderType === "LIMIT" ? "limit" : "at market"}
              </Button>
              <p className="text-center text-body-sm text-muted-foreground" aria-live="polite">
                {est ? (
                  <>
                    ≈ {formatNumberIN(est.px, 2)} · {side === "BUY" ? "pay" : "get"} {formatINR(est.value, { decimals: 0 })}
                    <br />
                    charges {formatINR(est.charges, { decimals: 0 })} · {side === "SELL" ? "margin" : "cost"} {formatINR(est.margin, { decimals: 0 })}
                  </>
                ) : (
                  "—"
                )}
              </p>
            </div>
          );
        })}
      </div>
      {err ? <p className="text-center text-body-sm text-muted-foreground">{err}</p> : null}
      <p className="text-body-sm text-muted-foreground">
        Market fills at mid {slippagePct > 0 ? `± ${slippagePct}% slippage` : "(no slippage)"}, rounded to ₹0.05 against you.
      </p>
    </div>
  );
}
