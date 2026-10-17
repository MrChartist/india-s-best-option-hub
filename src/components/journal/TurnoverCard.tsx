/** ITR-ready F&O turnover for a financial year, with a CSV download. */
import { useId, useMemo, useState } from "react";
import { Download, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { financialYears, turnoverCsv, turnoverSummary, type RoundTrip } from "@/lib/journal";
import { formatINR } from "@/lib/options";
import { cn } from "@/lib/utils";
import { downloadText, signedClass, signedINR } from "@/components/positions/helpers";

export function TurnoverCard({ trips, sample }: { trips: RoundTrip[]; sample: boolean }) {
  const uid = useId();
  const years = useMemo(() => financialYears(trips), [trips]);
  const [picked, setPicked] = useState("");
  const fy = years.includes(picked) ? picked : years[0] ?? "";
  const s = useMemo(() => (fy ? turnoverSummary(trips, fy) : null), [trips, fy]);

  if (!s) return <p className="text-body-sm text-muted-foreground">No closed trades yet.</p>;

  const download = () => {
    const name = `fno-turnover-${fy.replace(/\s+/g, "-").toLowerCase()}${sample ? "-SAMPLE" : ""}.csv`;
    if (!downloadText(name, turnoverCsv(trips, fy, { sample }), "text/csv")) toast.error("Download failed");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-fy`}>Financial year</Label>
          <Select value={fy} onValueChange={setPicked}>
            <SelectTrigger id={`${uid}-fy`} className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={y}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={download}>
          <Download aria-hidden="true" /> Turnover CSV
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-body-sm">
        <div className="col-span-2 rounded-tile border border-border bg-surface/60 px-3 py-2">
          <dt className="flex items-center gap-1.5 text-label uppercase text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" aria-hidden="true" /> F&O turnover
          </dt>
          <dd className="font-num text-title tabular-nums">{formatINR(s.turnover, { decimals: 0 })}</dd>
          <dd className="text-micro text-muted-foreground">
            options {formatINR(s.optionsTurnover, { decimals: 0 })} · futures {formatINR(s.futuresTurnover, { decimals: 0 })} · {s.trades} round trip{s.trades === 1 ? "" : "s"}
          </dd>
        </div>
        <div className="rounded-tile border border-border px-3 py-2">
          <dt className="text-label uppercase text-muted-foreground">Gross P&L</dt>
          <dd className={cn("font-num font-semibold tabular-nums", signedClass(s.gross))}>{signedINR(s.gross)}</dd>
        </div>
        <div className="rounded-tile border border-border px-3 py-2">
          <dt className="text-label uppercase text-muted-foreground">Expenses (charges)</dt>
          <dd className="font-num font-semibold tabular-nums">{formatINR(s.charges, { decimals: 0 })}</dd>
        </div>
        <div className="col-span-2 rounded-tile border border-border px-3 py-2">
          <dt className="text-label uppercase text-muted-foreground">Net business income from F&O</dt>
          <dd className={cn("font-num text-lead font-semibold tabular-nums", signedClass(s.net))}>{signedINR(s.net)}</dd>
        </div>
      </dl>
      <p className="text-body-sm text-muted-foreground">
        Turnover = sum of absolute profit and loss on each trade (ICAI Guidance Note on Tax Audit, 2022). F&O is non-speculative business income, filed in ITR-3. A trade counts in the year it closes. Check with your chartered accountant before filing.
      </p>
    </div>
  );
}
