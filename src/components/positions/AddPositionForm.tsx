/** Add a tracked option position: ISO expiry picker, contract lot size, live LTP prefill, charge preview. */
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CONTRACT_SPECS, chargesForLegs, formatINR, formatNumberIN, getExpiries, getStrikeStep, normalizeSymbol } from "@/lib/options";
import { createPosition, getLotSize, type TrackedPosition } from "@/lib/positionStore";
import { ChainFeed } from "./ChainFeed";
import { ExpiryPicker } from "./ExpiryPicker";
import { feedSourceToQuote, useChainFeeds, feedKey } from "./helpers";
import { quoteFromChain } from "./analytics";
import { SourceBadge } from "./ui";

const SYMBOLS = Object.values(CONTRACT_SPECS)
  .sort((a, b) => (a.kind === b.kind ? a.symbol.localeCompare(b.symbol) : a.kind === "INDEX" ? -1 : 1))
  .map((s) => s.symbol);

export function AddPositionForm({ onAdd, onCancel }: { onAdd: (p: TrackedPosition) => void; onCancel: () => void }) {
  const uid = useId();
  const [symbolText, setSymbolText] = useState("NIFTY");
  const symbol = normalizeSymbol(symbolText);
  const [expiry, setExpiry] = useState(() => getExpiries("NIFTY", new Date(), 1)[0]?.date ?? "");
  const [type, setType] = useState<"CE" | "PE">("CE");
  const [action, setAction] = useState<"BUY" | "SELL">("SELL");
  const [strikeText, setStrikeText] = useState("");
  const [lotsText, setLotsText] = useState("1");
  const [lotSizeText, setLotSizeText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [tag, setTag] = useState("");
  const [feeds, report] = useChainFeeds();

  const contractLot = getLotSize(symbol, expiry || undefined);
  useEffect(() => {
    setLotSizeText(contractLot ? String(contractLot) : "");
  }, [contractLot]);
  useEffect(() => {
    const next = getExpiries(symbol, new Date(), 1)[0]?.date;
    if (next) setExpiry(next);
  }, [symbol]);

  const feed = feeds[feedKey(symbol, expiry)];
  const strike = Number(strikeText);
  const lots = Math.floor(Number(lotsText));
  const lotSize = Math.floor(Number(lotSizeText));
  const price = Number(priceText);
  const quote = feed && feed.expiryMatch && strike > 0 ? quoteFromChain(feed.chain, strike, type) : null;
  const step = getStrikeStep(symbol);
  const atm = feed && feed.spot > 0 ? Math.round(feed.spot / step) * step : NaN;

  const errors: string[] = [];
  if (!symbol) errors.push("Enter a symbol.");
  if (!expiry) errors.push("Choose an expiry.");
  if (!(strike > 0)) errors.push("Enter a strike.");
  if (!(lots > 0)) errors.push("Lots must be at least 1.");
  if (!(lotSize > 0)) errors.push("Enter the lot size.");
  if (!(priceText.trim() !== "" && price >= 0)) errors.push("Enter the entry price.");
  const valid = errors.length === 0;

  const preview = useMemo(() => {
    if (!valid) return null;
    const leg = { symbol, type, side: action, strike, expiry, lots, lotSize, premium: price } as const;
    return { qty: lots * lotSize, value: price * lots * lotSize, charges: chargesForLegs([leg]).total };
  }, [valid, symbol, type, action, strike, expiry, lots, lotSize, price]);

  const submit = () => {
    if (!valid) return;
    onAdd(
      createPosition({
        symbol,
        type,
        action,
        strike,
        expiry,
        lots,
        lotSize,
        entryPrice: price,
        currentPrice: quote && quote.ltp > 0 && feed?.source !== "sample" ? quote.ltp : price,
        tag: tag.trim() || undefined,
      }),
    );
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {symbol && expiry ? <ChainFeed symbol={symbol} expiry={expiry} onUpdate={report} /> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-sym`}>Symbol</Label>
          <Input id={`${uid}-sym`} list={`${uid}-syms`} value={symbolText} onChange={(e) => setSymbolText(e.target.value.toUpperCase())} autoComplete="off" />
          <datalist id={`${uid}-syms`}>
            {SYMBOLS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-exp`}>Expiry</Label>
          <ExpiryPicker id={`${uid}-exp`} symbol={symbol || "NIFTY"} value={expiry} onChange={setExpiry} />
        </div>
        <div className="grid gap-1.5">
          <span className="text-body font-medium" id={`${uid}-type`}>
            Type and side
          </span>
          <div className="flex gap-2">
            <ToggleGroup type="single" value={type} onValueChange={(v) => v && setType(v as "CE" | "PE")} aria-labelledby={`${uid}-type`} size="sm">
              <ToggleGroupItem value="CE">CE</ToggleGroupItem>
              <ToggleGroupItem value="PE">PE</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" value={action} onValueChange={(v) => v && setAction(v as "BUY" | "SELL")} aria-label="Side" size="sm">
              <ToggleGroupItem value="BUY" className="data-[state=on]:bg-wash-profit data-[state=on]:text-bullish">
                Buy
              </ToggleGroupItem>
              <ToggleGroupItem value="SELL" className="data-[state=on]:bg-wash-loss data-[state=on]:text-bearish">
                Sell
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-strike`}>Strike</Label>
          <Input id={`${uid}-strike`} type="number" inputMode="decimal" step={step} min={0} value={strikeText} onChange={(e) => setStrikeText(e.target.value)} placeholder={Number.isFinite(atm) ? `ATM ≈ ${atm}` : "Strike"} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-lots`}>Lots</Label>
          <Input id={`${uid}-lots`} type="number" inputMode="numeric" min={1} step={1} value={lotsText} onChange={(e) => setLotsText(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-lot`}>Lot size</Label>
          <Input id={`${uid}-lot`} type="number" inputMode="numeric" min={1} step={1} value={lotSizeText} onChange={(e) => setLotSizeText(e.target.value)} aria-describedby={contractLot ? undefined : `${uid}-lotwarn`} />
          {!contractLot && symbol ? (
            <p id={`${uid}-lotwarn`} className="flex items-center gap-1 text-body-sm text-warning">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Unknown symbol. Enter the lot size from the exchange circular.
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-price`}>Entry price (₹/unit)</Label>
          <Input id={`${uid}-price`} type="number" inputMode="decimal" min={0} step="0.05" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
          {quote && quote.ltp > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-body-sm text-muted-foreground">
              LTP {formatNumberIN(quote.ltp, 2)}
              <SourceBadge source={feedSourceToQuote(feed?.source ?? "none", !!feed?.isLive)} asOf={feed?.asOf} />
              <Button type="button" variant="link" className="text-body-sm" onClick={() => setPriceText(String(quote.ltp))}>
                Use
              </Button>
            </div>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-tag`}>Tag (optional)</Label>
          <Input id={`${uid}-tag`} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. Weekly strangle" maxLength={40} />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-tile border border-separator bg-surface/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-muted-foreground" aria-live="polite">
          {preview ? (
            <>
              Qty {formatNumberIN(preview.qty)} · {action === "BUY" ? "premium paid" : "premium received"} {formatINR(preview.value, { decimals: 0 })} · entry charges ≈ {formatINR(preview.charges)}
              {action === "SELL" ? " · margin is shown after adding" : ""}
            </>
          ) : (
            errors[0]
          )}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid}>
            <Plus aria-hidden="true" /> Add position
          </Button>
        </div>
      </div>
    </form>
  );
}
