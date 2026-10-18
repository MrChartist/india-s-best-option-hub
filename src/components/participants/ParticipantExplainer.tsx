import { BookOpen } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const ITEMS: Array<{ id: string; q: string; a: React.ReactNode }> = [
  {
    id: "who",
    q: "Who are FII, DII, Pro and Client?",
    a: (
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong>FII / FPI</strong>: foreign portfolio investors registered with SEBI, such as global funds and banks.
        </li>
        <li>
          <strong>DII</strong>: domestic institutions such as mutual funds, insurers and banks. In F&amp;O they mostly hedge, so they are usually short stock futures.
        </li>
        <li>
          <strong>Pro</strong>: brokers trading their own money (proprietary desks), including many market makers and arbitrageurs.
        </li>
        <li>
          <strong>Client</strong>: everyone else, which means retail traders, HNIs, corporates and trusts trading through a broker.
        </li>
      </ul>
    ),
  },
  {
    id: "source",
    q: "Where does this data come from, and when?",
    a: (
      <p>
        NSE Clearing publishes two files after every trading day: participant-wise open interest and participant-wise volume. They usually appear between 18:00 and 20:00 IST. Before that, today&apos;s file is not yet out and the page shows the previous session. Numbers are in contracts, not rupees, and cover all
        index and stock F&amp;O, not just NIFTY.
      </p>
    ),
  },
  {
    id: "longpct",
    q: "What is FII long % in index futures?",
    a: (
      <>
        <p>Long % = FII index futures long contracts ÷ (long + short) × 100. It is the most watched single number in this file.</p>
        <p className="mt-2">
          Readings below about 10% or above 90% are rare extremes. Historically, very low readings showed FIIs crowded on the short side, which has often been followed by short covering. Treat it as context, not a timing signal: FIIs also use futures to hedge their large cash-market holdings.
        </p>
      </>
    ),
  },
  {
    id: "mirror",
    q: "Why do Clients and FIIs look like mirror images?",
    a: (
      <p>
        Every futures or options contract has a buyer and a seller, so across the four groups total longs always equal total shorts. Pro and DII positions in index futures are fairly small and steady, so when FIIs add shorts, Clients usually end up holding the matching longs. The correlation tiles measure how
        tight that mirror has been.
      </p>
    ),
  },
  {
    id: "options",
    q: "How should I read calls and puts here?",
    a: (
      <>
        <p>Long calls and short puts gain when the index rises. Short calls and long puts gain when it falls. Following the Indian convention, calls are drawn in the bearish colour (call writing marks resistance) and puts in the bullish colour (put writing marks support).</p>
        <p className="mt-2">This file has no strikes or expiries. A far out-of-the-money call and an at-the-money call count the same, so the net figures show a tilt, not true delta exposure.</p>
      </>
    ),
  },
  {
    id: "cash",
    q: "How are cash-market FII / DII flows different?",
    a: (
      <p>
        Cash flows are the rupee value of shares bought and sold in the cash market (₹ crore, provisional). They show money moving in or out of Indian equities. F&amp;O positioning shows bets and hedges. The two can disagree: FIIs may sell shares and buy index futures at the same time.
      </p>
    ),
  },
  {
    id: "caution",
    q: "Can I trade on this?",
    a: (
      <p>
        Use it to understand who holds which side, not as a buy or sell signal. The data is a day old by the time it is published, is aggregated across all expiries and strikes, and mixes hedges with directional trades. SEBI&apos;s study found that about 9 in 10 individual F&amp;O traders lost money.
      </p>
    ),
  },
];

export function ParticipantExplainer() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <BookOpen className="h-4 w-4" aria-hidden="true" />
        <p className="text-label">Learn</p>
      </div>
      <Accordion type="multiple" className="w-full">
        {ITEMS.map((it) => (
          <AccordionItem key={it.id} value={it.id}>
            <AccordionTrigger className="text-left text-lead">{it.q}</AccordionTrigger>
            <AccordionContent className="text-body leading-relaxed text-muted-foreground">{it.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
