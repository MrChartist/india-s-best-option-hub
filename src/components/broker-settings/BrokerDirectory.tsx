import { useMemo, useState } from "react";
import { LayoutGrid, Search, Table2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BrokerAuthKind, BrokerCredentials, BrokerInfo } from "@/lib/brokerConfig";
import { AUTH_COPY, EMPTY_FILTER, MATRIX_COLUMNS, filterBrokers, type BrokerFilter, type MatrixKey } from "@/lib/brokerDirectory";
import { BrokerCapabilityMatrix } from "./BrokerCapabilityMatrix";
import { BrokerKeysCard } from "./BrokerKeysCard";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type View = "matrix" | "cards";

/**
 * Every broker in one place: search and filter, a capability matrix (chain / quotes / live feed /
 * portfolio / orders, from the adapters) and the keys card for each broker. Works down to 375 px:
 * the filters stack, and the matrix scrolls inside its own frame with the broker column pinned.
 */
export function BrokerDirectory({
  brokers,
  saved,
  activeId,
  locked,
}: {
  brokers: BrokerInfo[];
  saved: BrokerCredentials[];
  activeId?: string;
  locked: boolean;
}) {
  const [filter, setFilter] = useState<BrokerFilter>(EMPTY_FILTER);
  const [view, setView] = useState<View>(() => (saved.some((s) => s.brokerId !== "dhan") ? "cards" : "matrix"));
  const savedIds = useMemo(() => new Set(saved.map((s) => s.brokerId)), [saved]);
  const shown = useMemo(() => filterBrokers(brokers, filter, savedIds), [brokers, filter, savedIds]);
  const filtered = filter.query !== "" || filter.auth !== "all" || filter.capability !== "all" || filter.savedOnly;
  const set = (patch: Partial<BrokerFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const openCard = (id: string) => {
    setView("cards");
    // Wait for the cards to render, then move focus to the chosen broker.
    window.setTimeout(() => {
      const el = document.getElementById(`broker-card-${id}`);
      if (typeof el?.scrollIntoView === "function") el.scrollIntoView({ block: "start", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    }, 0);
  };

  return (
    <section aria-labelledby="broker-directory-title" className="space-y-3">
      <div className="space-y-1">
        <h2 id="broker-directory-title" className="text-lead text-foreground">
          All brokers ({brokers.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          Option chains, quotes and your portfolio from your own broker, through the local proxy. Set one active to use it for chains; the
          live feed and 1Cliq orders stay on Dhan. Every broker except Dhan is in beta: built from the official API docs and tested against
          recorded samples, not yet verified with a live account.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]" role="search" aria-label="Filter brokers">
        <div className="space-y-1">
          <Label htmlFor="broker-search" className="text-xs">
            Search
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="broker-search"
              type="search"
              placeholder="Name, feature or capability, e.g. depth"
              value={filter.query}
              onChange={(e) => set({ query: e.target.value })}
              className="pl-8 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="broker-auth" className="text-xs">
            Sign-in method
          </Label>
          <select id="broker-auth" className={SELECT_CLASS} value={filter.auth} onChange={(e) => set({ auth: e.target.value as BrokerAuthKind | "all" })}>
            <option value="all">Any</option>
            {(Object.keys(AUTH_COPY) as BrokerAuthKind[]).map((k) => (
              <option key={k} value={k}>
                {AUTH_COPY[k].label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="broker-cap" className="text-xs">
            Must offer
          </Label>
          <select id="broker-cap" className={SELECT_CLASS} value={filter.capability} onChange={(e) => set({ capability: e.target.value as MatrixKey | "all" })}>
            <option value="all">Anything</option>
            {MATRIX_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--primary))]"
              checked={filter.savedOnly}
              onChange={(e) => set({ savedOnly: e.target.checked })}
            />
            Saved only
          </label>
          {filtered && (
            <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setFilter(EMPTY_FILTER)}>
              <X className="h-3.5 w-3.5" aria-hidden /> Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite" role="status">
          Showing {shown.length} of {brokers.length} brokers
        </p>
        <div className="flex gap-1" role="group" aria-label="View">
          <Button type="button" size="sm" variant={view === "matrix" ? "default" : "outline"} className="gap-1.5" aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>
            <Table2 className="h-3.5 w-3.5" aria-hidden /> Capability matrix
          </Button>
          <Button type="button" size="sm" variant={view === "cards" ? "default" : "outline"} className="gap-1.5" aria-pressed={view === "cards"} onClick={() => setView("cards")}>
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> Connect
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No broker matches these filters.
        </p>
      ) : view === "matrix" ? (
        <BrokerCapabilityMatrix brokers={shown} onSelect={openCard} />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.some((b) => b.id === "dhan") && (
            <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground md:col-span-2 xl:col-span-3">
              Dhan&apos;s keys are in the Dhan card at the top of this page.
            </p>
          )}
          {shown.filter((b) => b.id !== "dhan").map((b) => (
            <div key={b.id} id={`broker-card-${b.id}`} tabIndex={-1} className="min-w-0 scroll-mt-20 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <BrokerKeysCard broker={b} saved={saved.find((s) => s.brokerId === b.id)} isActive={activeId === b.id} disabled={locked} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
