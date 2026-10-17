import { BookOpen } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Panel } from "./FlowUi";

const ITEMS: Array<{ q: string; a: string[] }> = [
  {
    q: "Why “interval flow” and not trades?",
    a: [
      "NSE does not publish trade-by-trade data for options to the public. US tools such as Unusual Whales read the consolidated tape (OPRA); there is no Indian equivalent.",
      "This page polls the option chain and compares each snapshot with the previous one. The rise in cumulative volume between two polls becomes one “print” for that contract. A print can hide many trades, in both directions.",
    ],
  },
  {
    q: "How is premium calculated?",
    a: ["Premium = contracts traded in the interval × LTP at the end of the interval × lot size. LTP is a stand-in for the average traded price, so large prints in fast markets can be off by the move inside the interval."],
  },
  {
    q: "How is the side (Ask / Bid / Mid) decided?",
    a: [
      "If the LTP is in the top quarter of the bid–ask spread (or at or above the ask) the print is tagged Ask: buyers were likely paying up. The bottom quarter (or at or below the bid) is Bid: sellers were hitting bids. Anything in between is Mid.",
      "When there is no usable quote, the tick test is used instead: an uptick from the previous LTP counts as Ask, a downtick as Bid. These rows carry an asterisk.",
    ],
  },
  {
    q: "Opening, closing and churn",
    a: [
      "If OI rose by at least 10% of the interval volume the print is tagged Opening (new positions). If OI fell by that much it is Closing. Otherwise it is Churn: volume traded without a matching change in OI, so the direction of positioning is unclear.",
      "OI on NSE is updated in batches during the day, so the tag is a hint, not a fact.",
    ],
  },
  {
    q: "Reading the Premium Tide",
    a: [
      "The call line adds premium bought at the ask and subtracts premium sold at the bid. The put line does the same for puts. Mid prints are left out.",
      "A rising call line with a falling put line means buyers are paying up for calls and puts are being sold: bullish premium. The dashed net line is calls minus puts. The orange line is spot on the right axis.",
      "Here calls are drawn green and puts red because buying calls is a bullish bet. This differs from OI charts elsewhere in the terminal, where call OI is red because it marks resistance.",
    ],
  },
  {
    q: "Unusual activity thresholds",
    a: [
      "Vol/OI ≥ 1.25: more contracts traded today than are open, a sign of fresh interest. Volume ≥ 3× its 5-day average at the same time of day, using snapshots recorded in this browser. Premium ≥ ₹10 lakh for index options or ₹2 lakh for stock options. You can change all of them.",
    ],
  },
  {
    q: "Where does the history come from?",
    a: [
      "Snapshots are kept in memory while the page is open and saved to IndexedDB in your browser when live data is available. Nothing is sent to a server. If you open the page mid-session, earlier intervals only appear if they were recorded before.",
    ],
  },
  {
    q: "Limits to keep in mind",
    a: [
      "A big Ask print can be a hedge, a roll or a market maker's inventory trade, not a directional bet. Flow is one input among many. Data for education and research; not investment advice.",
    ],
  },
];

/** How derived flow works, in plain language. */
export function FlowExplainer() {
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-1.5">
          <BookOpen className="h-4 w-4 text-primary-ink" aria-hidden="true" /> How derived flow works
        </span>
      }
      subtitle="What each number means and where it can mislead"
    >
      <Accordion type="multiple" defaultValue={["0"]} className="w-full">
        {ITEMS.map((it, i) => (
          <AccordionItem key={it.q} value={String(i)}>
            <AccordionTrigger className="text-left text-body font-semibold">{it.q}</AccordionTrigger>
            <AccordionContent className="space-y-2 text-body-sm text-muted-foreground">
              {it.a.map((p) => (
                <p key={p.slice(0, 24)}>{p}</p>
              ))}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Panel>
  );
}
