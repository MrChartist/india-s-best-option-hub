import { BookOpen } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GexConvention } from "@/lib/gexData";

interface Props {
  convention: GexConvention;
  lotSize?: number;
  oiUnit?: "contracts" | "qty";
}

/** Plain-English guide to the GEX page: what the numbers mean and what is assumed. */
export function GexExplainer({ convention, lotSize, oiUnit = "contracts" }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lead">
          <BookOpen className="h-4 w-4 text-primary-ink" aria-hidden />
          How to read this page
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion type="single" collapsible defaultValue="convention" className="text-body">
          <AccordionItem value="gex">
            <AccordionTrigger className="text-body font-semibold">What gamma exposure (GEX) means</AccordionTrigger>
            <AccordionContent className="space-y-2 text-muted-foreground">
              <p>
                Whoever is short options must buy or sell futures to stay delta-hedged as the index moves. GEX estimates
                that hedge: the rupee value of futures that would change hands for a 1% move in the index.
              </p>
              <p>
                <span className="font-semibold text-bullish">Positive GEX</span> means hedgers sell rallies and buy
                dips, which tends to <em>damp</em> volatility and pin the index.{" "}
                <span className="font-semibold text-bearish">Negative GEX</span> means they chase the move, which tends
                to <em>amplify</em> it.
              </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="convention">
            <AccordionTrigger className="text-body font-semibold">
              Sign convention: why India defaults to the seller view
            </AccordionTrigger>
            <AccordionContent className="space-y-2 text-muted-foreground">
              <p>
                US tools assume market makers are long calls and short puts. In India, retail traders are heavy net{" "}
                <em>buyers</em> of weekly options, and proprietary desks and institutions are the main writers. So the
                default here is <span className="font-semibold text-foreground">net option-seller gamma</span>: writers
                are short both calls and puts.
              </p>
              <p>
                Under the seller view every strike adds short gamma, so the total is never positive and there is no
                flip. Read the profile as <em>where</em> short-gamma hedging is heaviest. The strikes with the most
                gamma act as magnets near expiry and as accelerators once they break.
              </p>
              <p>
                Switch to the dealer model to see the classic gamma flip. The flip from the dealer model is also shown
                in the levels card when the seller view is on, labelled as such.
              </p>
              <p className="text-label text-muted-foreground">
                Current: {convention === "sellerShortBoth" ? "Seller view (India)" : "Dealer model (US)"}
              </p>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="levels">
            <AccordionTrigger className="text-body font-semibold">
              Call wall, put wall, absolute gamma and flip
            </AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <span className="font-semibold text-foreground">Call wall</span>: strike with the largest call gamma
                  exposure. Often acts as resistance.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Put wall</span>: strike with the largest put gamma
                  exposure. Often acts as support.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Absolute gamma</span>: strike with the largest
                  combined gamma. The strongest pin, especially on expiry day.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Gamma flip</span>: the index level where total GEX
                  changes sign. Found by repricing every option over spot ±5% in 0.1% steps and interpolating the zero
                  crossing.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Max pain</span>: the expiry level where option buyers
                  collectively lose the most. Shown for comparison.
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="greeks">
            <AccordionTrigger className="text-body font-semibold">DEX, VEX and CEX</AccordionTrigger>
            <AccordionContent className="text-muted-foreground">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  <span className="font-semibold text-foreground">DEX</span> (delta exposure): the delta-notional held,
                  in ₹ crore.
                </li>
                <li>
                  <span className="font-semibold text-foreground">VEX</span> (vanna exposure): how much that delta
                  changes for a 1-point change in implied volatility. Compare it with the India VIX move.
                </li>
                <li>
                  <span className="font-semibold text-foreground">CEX</span> (charm exposure): how much that delta
                  drifts per calendar day as expiry nears. Large near weekly expiry.
                </li>
              </ul>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="assumptions">
            <AccordionTrigger className="text-body font-semibold">Units and assumptions</AccordionTrigger>
            <AccordionContent className="space-y-2 text-muted-foreground">
              <p>
                All values are in ₹ crore. GEX is per 1% move. Open interest is read as{" "}
                {oiUnit === "qty" ? "quantity (already multiplied by lot size)" : "contracts"}
                {lotSize ? ` and multiplied by the lot size (${lotSize})` : ""}
                {oiUnit === "qty" ? " so it is not counted twice" : ""}.
              </p>
              <p>
                Greeks come from Black-76 on the chain forward, with each strike's IV held fixed when spot moves (sticky
                strike). Where the feed has no IV, it is solved from option prices. The risk-free rate comes from your
                market settings.
              </p>
              <p>
                OI does not show who is long or short, so any sign convention is a model. Treat the levels as context,
                not signals.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
