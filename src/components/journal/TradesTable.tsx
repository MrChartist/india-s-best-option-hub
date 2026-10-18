/** Round-trip log with tags and notes. */
import { useEffect, useMemo, useState } from "react";
import { NotebookPen, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { contractName, parseTags, type Annotation, type RoundTrip } from "@/lib/journal";
import { formatDateIST, formatINR, formatNumberIN, formatTimeIST } from "@/lib/options";
import { cn } from "@/lib/utils";
import { signedClass, signedINR } from "@/components/positions/helpers";
import { EmptyState, STICKY_CELL } from "@/components/positions/ui";

type Filter = "all" | "win" | "loss";
const PAGE = 100;

function NoteDialog({ trip, note, onSave, onOpenChange }: { trip: RoundTrip | null; note: Annotation | undefined; onSave: (a: Annotation) => void; onOpenChange: (o: boolean) => void }) {
  const [tags, setTags] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    if (trip) {
      setTags((note?.tags ?? []).join(", "));
      setText(note?.note ?? "");
    }
  }, [trip, note]);
  return (
    <Dialog open={!!trip} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tags and notes</DialogTitle>
          <DialogDescription>
            {trip ? (
              <>
                {contractName(trip)} · {trip.strategy} · {signedINR(trip.net)} net
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ tags: parseTags(tags), note: text.trim().slice(0, 2000) });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="journal-tags">Tags (comma separated)</Label>
            <Input id="journal-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="plan followed, breakout, revenge trade" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="journal-note">Note</Label>
            <Textarea id="journal-note" value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Why you took it, how you managed it, what you would do differently." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TradesTable({ trips, notes, onAnnotate }: { trips: RoundTrip[]; notes: Record<string, Annotation>; onAnnotate: (id: string, a: Annotation) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<RoundTrip | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...trips]
      .filter((t) => (filter === "win" ? t.net > 0 : filter === "loss" ? t.net <= 0 : true))
      .filter((t) => {
        if (!needle) return true;
        const tags = notes[t.id]?.tags.join(" ") ?? "";
        return `${contractName(t)} ${t.strategy} ${tags} ${notes[t.id]?.note ?? ""}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.exitTs ?? 0) - (a.exitTs ?? 0) || (b.exitDate < a.exitDate ? -1 : 1));
  }, [trips, q, filter, notes]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contract, strategy, tag or note" className="pl-8" aria-label="Search trades" />
        </div>
        <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} aria-label="Show" size="sm">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="win">Winners</ToggleGroupItem>
          <ToggleGroupItem value="loss">Losers</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {!rows.length ? (
        <div className="px-4 pb-4">
          <EmptyState title="No trades match">Clear the search or change the filter.</EmptyState>
        </div>
      ) : (
        <Table className="min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-surface">Contract</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Exit</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Entry / exit</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, limit).map((t) => {
              const n = notes[t.id];
              return (
                <TableRow key={t.id}>
                  <TableCell className={cn(STICKY_CELL, "font-semibold")}>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      {t.underlying} {t.type === "FUT" ? "FUT" : formatNumberIN(t.strike)}
                      {t.type !== "FUT" ? <Badge variant={t.type === "CE" ? "bearish" : "bullish"}>{t.type}</Badge> : null}
                      <Badge variant={t.direction === "LONG" ? "bullish" : "bearish"}>{t.direction === "LONG" ? "Long" : "Short"}</Badge>
                    </div>
                    <div className="text-micro font-normal text-muted-foreground">
                      exp {formatDateIST(t.expiry)} · {t.dte} DTE
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-body-sm">{t.strategy}</TableCell>
                  <TableCell className="whitespace-nowrap text-body-sm">
                    {formatDateIST(t.entryDate)}
                    {t.entryTs !== null ? <span className="block text-micro text-muted-foreground">{formatTimeIST(t.entryTs)}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-body-sm">
                    {formatDateIST(t.exitDate)}
                    {t.assumedExpiry ? (
                      <Badge variant="info" className="ml-1" title="No closing trade in the tradebook: assumed to expire worthless. Add the exit trade if it settled in the money.">
                        Expired*
                      </Badge>
                    ) : t.settled ? (
                      <Badge variant="info" className="ml-1">
                        Settled
                      </Badge>
                    ) : t.exitTs !== null ? (
                      <span className="block text-micro text-muted-foreground">{formatTimeIST(t.exitTs)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumberIN(t.qty)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {formatNumberIN(t.entryPrice, 2)} → {formatNumberIN(t.exitPrice, 2)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", signedClass(t.gross))}>{signedINR(t.gross)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatINR(t.charges, { decimals: 0 })}</TableCell>
                  <TableCell className={cn("text-right font-semibold tabular-nums", signedClass(t.net))}>{signedINR(t.net)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className="flex min-h-[28px] max-w-[220px] flex-wrap items-center gap-1 rounded-chip px-1 text-left hover:bg-accent focus-visible:shadow-focus focus-visible:outline-none"
                      aria-label={`Tags and notes for ${contractName(t)} closed ${formatDateIST(t.exitDate)}`}
                      title={n?.note || "Add tags and a note"}
                    >
                      {n?.tags.length ? n.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>) : <span className="text-micro text-muted-foreground">Add</span>}
                      {n?.note ? <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has a note" /> : null}
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {rows.length > limit ? (
        <div className="flex justify-center px-4 pb-3">
          <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}
          </Button>
        </div>
      ) : null}
      <NoteDialog
        trip={editing}
        note={editing ? notes[editing.id] : undefined}
        onOpenChange={(o) => !o && setEditing(null)}
        onSave={(a) => {
          if (editing) onAnnotate(editing.id, a);
          setEditing(null);
        }}
      />
    </div>
  );
}
