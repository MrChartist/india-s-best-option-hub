import { Link } from "react-router-dom";
import { Layers, MoreHorizontal, Sparkles, TableProperties, WandSparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { symbolLinks } from "@/lib/screener/display";
import type { SuggestionMeta } from "@/lib/screener/suggest";

export interface RowActionsProps {
  symbol: string;
  suggestion: SuggestionMeta | null;
  onSuggest: () => void;
}

/** Per-row action menu: option chain, Strategy Builder, Optimizer and the suggested structure. */
export function RowActions({ symbol, suggestion, onSuggest }: RowActionsProps) {
  const links = symbolLinks(symbol);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${symbol}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-chip text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-label uppercase text-muted-foreground">{symbol}</DropdownMenuLabel>
        <DropdownMenuItem asChild className="gap-2">
          <Link to={links.chain}>
            <TableProperties className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Option chain
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <Link to={links.builder}>
            <Layers className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Strategy Builder
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2">
          <Link to={links.optimizer}>
            <WandSparkles className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Optimizer
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSuggest} disabled={!suggestion} className="items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
          <span className="flex min-w-0 flex-col">
            <span>Suggested structure</span>
            <span className="text-micro normal-case text-muted-foreground">
              {suggestion ? suggestion.title : "No clear signal in this row yet"}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
