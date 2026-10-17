/** Hand the chosen CE/PE pair to the Strategy Builder or the shared basket, long or short. */
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, Hammer, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addLegs, readBasket, writeBasket } from "@/components/option-chain/basket";
import { formatINR, formatStrike, type Side } from "@/lib/options";
import { pairBuilderUrl, pairLegs, type PairQuote } from "@/lib/straddles";

interface Props {
  symbol: string;
  expiry: string;
  ce: PairQuote;
  pe: PairQuote;
  lotSize: number;
  sample: boolean;
}

export function OpenInBuilder({ symbol, expiry, ce, pe, lotSize, sample }: Props) {
  const navigate = useNavigate();
  const ready = pairLegs({ symbol, expiry, ce, pe, side: "SELL" }).length === 2;
  const name = ce.strike === pe.strike ? `${formatStrike(ce.strike)} straddle` : `${formatStrike(ce.strike)} CE + ${formatStrike(pe.strike)} PE`;
  const premium = ce.premium + pe.premium;

  const open = (side: Side) => {
    const url = pairBuilderUrl({ symbol, expiry, ce, pe, side });
    if (url) navigate(url);
  };
  const basket = (side: Side) => {
    const legs = pairLegs({ symbol, expiry, ce, pe, side });
    if (legs.length !== 2) return;
    writeBasket(addLegs(readBasket(), legs));
    toast.success(`Added ${side === "SELL" ? "short" : "long"} ${symbol} ${name} to the basket`, {
      description: `2 legs · ${formatINR(premium)} per unit${lotSize > 0 ? ` · ${formatINR(premium * lotSize, { decimals: 0 })} per lot` : ""}${sample ? " · sample prices" : ""}`,
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={!ready} aria-label={ready ? `Open in builder: the ${name} in the Strategy Builder or basket` : "Open in builder (no prices for this pair yet)"}>
          <Hammer aria-hidden="true" /> Open in builder <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-body-sm font-normal text-muted-foreground">
          {symbol} {name} · {formatINR(premium)}
          {sample ? " · sample prices" : ""}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => open("SELL")}>
          <Hammer aria-hidden="true" /> Sell in Strategy Builder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open("BUY")}>
          <Hammer aria-hidden="true" /> Buy in Strategy Builder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => basket("SELL")}>
          <ShoppingBasket aria-hidden="true" /> Add short pair to basket
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => basket("BUY")}>
          <ShoppingBasket aria-hidden="true" /> Add long pair to basket
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
