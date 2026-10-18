import { memo } from "react";
import { ExternalLink, NotebookPen, ShoppingBasket, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PayoffTone } from "@/lib/optimizer";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatINR, formatPct } from "@/lib/options";
import type { RankedCandidate } from "@/lib/optimizer";
import { cn } from "@/lib/utils";
import { HintChip } from "./ResultCard";
import { ELM_HINT, FUNDS_HINT, VIEW_HINT_DIRECTIONAL, VIEW_HINT_NEUTRAL, money, sizeLabel, tagFor, type PayoffView, type ResultActions } from "./resultHelpers";

export interface ResultsTableProps extends ResultActions {
  results: RankedCandidate[];
  view: PayoffView;
  neutralView?: boolean;
}

const TONE_TEXT: Record<PayoffTone, string> = {
  bullish: "text-bullish",
  bearish: "text-bearish",
  neutral: "text-foreground",
  volatile: "text-info",
};

function ResultsTableImpl({ results, view, onOpen, onAddToBasket, onPaperTrade, neutralView = false }: ResultsTableProps) {
  return (
    <div className="overflow-hidden rounded-tile border border-separator bg-card shadow-card">
      <Table aria-label="Ranked strategies table" className="min-w-[720px] text-body-sm [&_td]:px-2 [&_th]:px-2">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-10 text-right">
              #
            </TableHead>
            <TableHead scope="col">Strategy and payoff</TableHead>
            <TableHead scope="col" className="text-right">
              Return · profit
            </TableHead>
            <TableHead scope="col" className="text-right">
              Chance
            </TableHead>
            <TableHead scope="col" className="text-right">
              Max loss
            </TableHead>
            <TableHead scope="col" className="text-right">
              <span title={FUNDS_HINT}>Funds (est.)</span>
            </TableHead>
            <TableHead scope="col" className="text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((c, i) => {
            const tag = tagFor(c, view);
            const primary = i === 0;
            return (
              <TableRow key={c.id} className={cn(primary && "bg-control-track [&>td:first-child]:shadow-[inset_2px_0_0_hsl(var(--primary))]")}>
                <TableCell className="text-right align-top font-semibold text-muted-foreground">{c.rank}</TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="font-display text-headline text-foreground">{c.label}</span>
                    <span className="text-body-sm text-muted-foreground">· {sizeLabel(c)}</span>
                    {!c.definedRisk && <Badge variant="warning">Undefined risk</Badge>}
                    {c.matchesView && <HintChip label="Matches your view" hint={neutralView ? VIEW_HINT_NEUTRAL : VIEW_HINT_DIRECTIONAL} variant="default" icon={<Target aria-hidden="true" />} />}
                  </div>
                  <div className={cn("mt-0.5 font-sans text-body-sm font-semibold", TONE_TEXT[tag.tone])}>{tag.text}</div>
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  <div className={cn("font-semibold", c.roi >= 0 ? "text-bullish" : "text-bearish")}>{formatPct(c.roi * 100, { decimals: 1, signed: true })}</div>
                  <div className="text-body-sm text-muted-foreground" title="Net profit at target after charges">
                    {formatINR(c.netProfit, { decimals: 0 })}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top font-semibold tabular-nums text-info">{formatPct(c.pop * 100, { decimals: 1 })}</TableCell>
                <TableCell className="text-right align-top tabular-nums text-bearish">{money(c.maxLoss, c.unlimitedLoss)}</TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  <div>{formatINR(c.fundsRequired, { decimals: 0 })}</div>
                  {c.elm > 0 && (
                    <div className="mt-0.5 flex justify-end">
                      <HintChip label="incl. expiry-day ELM" hint={`${ELM_HINT} ELM here: ${formatINR(c.elm, { decimals: 0 })}.`} variant="warning" />
                    </div>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex justify-end gap-1">
                    <Button size="pill" variant={primary ? "default" : "outline"} onClick={() => onOpen(c)} aria-label={`Open ${c.label} in Builder`} title="Open in Builder">
                      <ExternalLink aria-hidden="true" />
                      <span className="hidden 2xl:inline">Builder</span>
                    </Button>
                    <Button size="pill" variant="outline" onClick={() => onPaperTrade(c)} aria-label={`Paper trade ${c.label}`} title="Paper trade">
                      <NotebookPen aria-hidden="true" />
                      <span className="hidden 2xl:inline">Paper</span>
                    </Button>
                    <Button size="pill" variant="ghost" onClick={() => onAddToBasket(c)} aria-label={`Add ${c.label} to basket`} title="Add to basket">
                      <ShoppingBasket aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export const ResultsTable = memo(ResultsTableImpl);
