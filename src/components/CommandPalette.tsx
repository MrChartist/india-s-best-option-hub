import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Keyboard, Search, Star, TrendingDown, TrendingUp } from "lucide-react";
import { MrChartistMark } from "@/components/brand/MrChartistLogo";
import { BRAND, withUtm } from "@/lib/brand/links";
import { useLiveIndices } from "@/hooks/useMarketData";
import { routesByGroup, type RouteDef } from "@/lib/routes";
import { routeIcon } from "@/lib/routeIcons";
import { STATIC_FNO_STOCKS } from "@/lib/screener/universe";
import { rankEntries, type PaletteEntry } from "./commandPaletteSearch";

const NAV_GROUPS = routesByGroup();
const FALLBACK_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];
const SHORTCUTS_ID = "action:shortcuts";
const ROUTE_BY_PATH = new Map<string, RouteDef>(NAV_GROUPS.flatMap((g) => g.routes.map((r) => [r.path, r] as const)));

const ROUTE_ENTRIES: PaletteEntry[] = NAV_GROUPS.flatMap(({ group, routes }) =>
  routes.map((r) => ({
    id: `route:${r.path}`,
    kind: "route" as const,
    label: r.navLabel,
    alt: r.title,
    keywords: r.keywords,
    path: r.path,
    group,
  })),
);
const STOCK_ENTRIES: PaletteEntry[] = STATIC_FNO_STOCKS.map((s) => ({
  id: `stock:${s}`,
  kind: "stock" as const,
  label: s,
  keywords: [],
  path: `/option-chain?symbol=${s}`,
  group: "F&O stock",
}));
const GITHUB_ID = "action:github-star";
const SITE_ID = "action:mrchartist-site";
const ACTION_ENTRIES: PaletteEntry[] = [
  { id: SHORTCUTS_ID, kind: "action", label: "Keyboard shortcuts", keywords: ["help", "keys", "hotkeys"], group: "Help" },
  {
    id: GITHUB_ID,
    kind: "action",
    label: "Star Option Hub on GitHub",
    keywords: ["github", "star", "source", "source code", "repo", "contribute"],
    href: withUtm(BRAND.repo, "command-palette"),
    group: "Mr. Chartist",
  },
  {
    id: SITE_ID,
    kind: "action",
    label: "Visit mrchartist.com",
    keywords: ["mr chartist", "website", "site", "products", "ecosystem"],
    href: withUtm(BRAND.site, "command-palette"),
    group: "Mr. Chartist",
  },
];

const DIALOG_CMD_CLASS =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the keyboard-shortcut overlay. */
  onShowShortcuts?: () => void;
}

export function CommandPalette({ open, onOpenChange, onShowShortcuts }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { data: indicesResult } = useLiveIndices();
  const indices = useMemo(() => indicesResult?.data ?? [], [indicesResult]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const indexEntries: PaletteEntry[] =
      indices.length > 0
        ? indices.map((idx) => ({
            id: `index:${idx.symbol}`,
            kind: "index" as const,
            label: idx.symbol,
            alt: idx.name,
            keywords: ["index"],
            path: `/option-chain?symbol=${idx.symbol}`,
            group: "Index",
          }))
        : FALLBACK_INDICES.map((sym) => ({
            id: `index:${sym}`,
            kind: "index" as const,
            label: sym,
            keywords: ["index"],
            path: `/option-chain?symbol=${sym}`,
            group: "Index",
          }));
    return [...ROUTE_ENTRIES, ...indexEntries, ...STOCK_ENTRIES, ...ACTION_ENTRIES];
  }, [indices]);

  const ranked = useMemo(() => (query.trim() ? rankEntries(entries, query) : []), [entries, query]);

  // Keep the best match highlighted whenever the ranking changes, so Enter opens it.
  useEffect(() => {
    setSelected(ranked[0]?.entry.id ?? "");
  }, [ranked]);

  const go = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  const runEntry = (entry: PaletteEntry) => {
    if (entry.id === SHORTCUTS_ID) {
      onOpenChange(false);
      onShowShortcuts?.();
    } else if (entry.href) {
      window.open(entry.href, "_blank", "noopener,noreferrer");
      onOpenChange(false);
    } else if (entry.path) {
      go(entry.path);
    }
  };

  const renderEntry = (entry: PaletteEntry) => {
    if (entry.kind === "route") {
      const r = ROUTE_BY_PATH.get(entry.path ?? "");
      const Icon = routeIcon(r?.icon ?? "");
      return (
        <>
          <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{entry.label}</span>
          {r?.badge && <span className="ml-2 text-[10px] font-semibold uppercase text-primary-ink">{r.badge}</span>}
          <span className="ml-auto pl-2 text-[11px] text-muted-foreground">{entry.group}</span>
        </>
      );
    }
    if (entry.kind === "index") {
      const idx = indices.find((i) => `index:${i.symbol}` === entry.id);
      return (
        <>
          {idx ? (
            idx.change >= 0 ? (
              <TrendingUp className="mr-2 h-4 w-4 text-bullish" aria-hidden="true" />
            ) : (
              <TrendingDown className="mr-2 h-4 w-4 text-bearish" aria-hidden="true" />
            )
          ) : (
            <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          <span>{entry.alt ?? entry.label}</span>
          <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
            {idx ? <span className="font-mono">{idx.ltp.toLocaleString("en-IN")}</span> : "Index · option chain"}
          </span>
        </>
      );
    }
    if (entry.kind === "stock") {
      return (
        <>
          <Search className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{entry.label}</span>
          <span className="ml-auto pl-2 text-[11px] text-muted-foreground">F&amp;O stock · option chain</span>
        </>
      );
    }
    if (entry.href) {
      return (
        <>
          {entry.id === GITHUB_ID ? (
            <Star className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <MrChartistMark size={16} decorative className="mr-2" />
          )}
          <span>{entry.label}</span>
          <span className="ml-auto flex items-center gap-1 pl-2 text-[11px] text-muted-foreground">
            New tab <ExternalLink className="!h-3 !w-3" aria-hidden="true" />
          </span>
        </>
      );
    }
    return (
      <>
        <Keyboard className="mr-2 h-4 w-4" aria-hidden="true" />
        {entry.label}
        <CommandShortcut>?</CommandShortcut>
      </>
    );
  };

  const byGroup = (pred: (e: PaletteEntry) => boolean) => entries.filter(pred);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-panel p-0 shadow-float">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search pages, symbols and actions</DialogDescription>
        <Command shouldFilter={false} value={selected} onValueChange={setSelected} className={DIALOG_CMD_CLASS}>
          <CommandInput placeholder="Search pages, symbols, actions..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {query.trim() ? (
              ranked.length > 0 && (
                <CommandGroup heading="Best matches">
                  {ranked.map(({ entry }) => (
                    <CommandItem key={entry.id} value={entry.id} onSelect={() => runEntry(entry)}>
                      {renderEntry(entry)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            ) : (
              <>
                {NAV_GROUPS.map(({ group, routes }) => (
                  <CommandGroup key={group} heading={group}>
                    {routes.map((r) => {
                      const Icon = routeIcon(r.icon);
                      return (
                        <CommandItem key={r.path} value={`route:${r.path}`} onSelect={() => go(r.path)}>
                          <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                          <span>{r.navLabel}</span>
                          {r.badge && <span className="ml-2 text-[10px] font-semibold uppercase text-primary-ink">{r.badge}</span>}
                          {r.shortcut && <CommandShortcut>{r.shortcut.toUpperCase()}</CommandShortcut>}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}

                <CommandSeparator />
                <CommandGroup heading="Indices">
                  {byGroup((e) => e.kind === "index").map((e) => (
                    <CommandItem key={e.id} value={e.id} onSelect={() => runEntry(e)}>
                      {renderEntry(e)}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup heading="F&O Stocks · open option chain">
                  {STOCK_ENTRIES.map((e) => (
                    <CommandItem key={e.id} value={e.id} onSelect={() => runEntry(e)}>
                      <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                      {e.label}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup heading="Mr. Chartist">
                  {ACTION_ENTRIES.filter((e) => e.group === "Mr. Chartist").map((e) => (
                    <CommandItem key={e.id} value={e.id} onSelect={() => runEntry(e)}>
                      {renderEntry(e)}
                    </CommandItem>
                  ))}
                </CommandGroup>

                <CommandSeparator />
                <CommandGroup heading="Help">
                  {ACTION_ENTRIES.filter((e) => e.group === "Help").map((e) => (
                    <CommandItem key={e.id} value={e.id} onSelect={() => runEntry(e)}>
                      {renderEntry(e)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
