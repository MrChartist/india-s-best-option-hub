/** Cash ledger: deposits, premium flows, charges, settlements and STT on exercise, with running balance. */
import { useMemo } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateIST, formatINR, formatTimeIST, istDateString } from "@/lib/options";
import type { LedgerEntry, LedgerKind } from "@/lib/paperTrading";
import { cn } from "@/lib/utils";
import { downloadText, signedClass, signedINR } from "@/components/positions/helpers";
import { EmptyState } from "@/components/positions/ui";

const KIND: Record<LedgerKind, { label: string; variant: "default" | "neutral" | "bearish" | "info" | "warning" }> = {
  DEPOSIT: { label: "Capital", variant: "default" },
  PREMIUM: { label: "Premium", variant: "neutral" },
  CHARGES: { label: "Charges", variant: "bearish" },
  SETTLEMENT: { label: "Settlement", variant: "info" },
  EXERCISE_STT: { label: "STT exercise", variant: "warning" },
  RESET: { label: "Reset", variant: "neutral" },
  ARCHIVE: { label: "Archived", variant: "neutral" },
};

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function PaperLedger({ ledger }: { ledger: LedgerEntry[] }) {
  const rows = useMemo(() => [...ledger].sort((a, b) => b.ts - a.ts), [ledger]);
  const totals = useMemo(() => {
    const t = { charges: 0, stt: 0, premium: 0, settlement: 0 };
    const add = (kind: LedgerKind, amount: number) => {
      if (kind === "CHARGES") t.charges += -amount;
      if (kind === "EXERCISE_STT") t.stt += -amount;
      if (kind === "PREMIUM") t.premium += amount;
      if (kind === "SETTLEMENT") t.settlement += amount;
    };
    for (const e of ledger) {
      // Archive rows carry per-kind totals for the entries they replaced, so the totals still add up.
      if (e.kind === "ARCHIVE" && e.archived) for (const [k, v] of Object.entries(e.archived.byKind)) add(k as LedgerKind, v ?? 0);
      else add(e.kind, e.amount);
    }
    return t;
  }, [ledger]);

  const exportCsv = () => {
    const header = "date,time_ist,kind,description,amount,balance";
    const lines = [...ledger].sort((a, b) => a.ts - b.ts).map((e) => [e.date, formatTimeIST(e.ts), e.kind, e.description, e.amount.toFixed(2), e.balance.toFixed(2)].map(csvCell).join(","));
    if (!downloadText(`paper-ledger-${istDateString()}.csv`, [header, ...lines].join("\n"), "text/csv")) toast.error("Download failed");
  };

  if (!rows.length) return <EmptyState title="Ledger is empty">Every cash movement will be recorded here.</EmptyState>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Charges paid</dt>
            <dd className="font-num tabular-nums text-bearish">{formatINR(totals.charges)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">STT on exercise</dt>
            <dd className="font-num tabular-nums text-bearish">{formatINR(totals.stt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Net premium</dt>
            <dd className={cn("font-num tabular-nums", signedClass(totals.premium))}>{signedINR(totals.premium)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground">Settlements</dt>
            <dd className={cn("font-num tabular-nums", signedClass(totals.settlement))}>{signedINR(totals.settlement)}</dd>
          </div>
        </dl>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download aria-hidden="true" /> CSV
        </Button>
      </div>
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 500).map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap text-body-sm text-muted-foreground">
                {formatDateIST(e.date)} · {formatTimeIST(e.ts)}
              </TableCell>
              <TableCell>
                <Badge variant={KIND[e.kind].variant}>{KIND[e.kind].label}</Badge>
              </TableCell>
              <TableCell className="text-body-sm">
                {e.description}
                {e.archived ? (
                  <span className="block text-micro text-muted-foreground">
                    {formatDateIST(e.archived.from)} to {formatDateIST(e.archived.to)} · net of premium, charges and settlements
                  </span>
                ) : null}
              </TableCell>
              <TableCell className={cn("text-right tabular-nums", signedClass(e.amount))}>{signedINR(e.amount, 2)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatINR(e.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {ledger.some((e) => e.kind === "ARCHIVE") ? (
        <p className="px-4 pb-1 text-body-sm text-muted-foreground">Entries older than 90 days are folded into one archived row per month to keep this browser's storage small. Trades and the P&L calendar keep full detail.</p>
      ) : null}
      {rows.length > 500 ? <p className="px-4 pb-3 text-body-sm text-muted-foreground">Showing the latest 500 of {rows.length} entries. Export CSV for the full ledger.</p> : null}
    </div>
  );
}
