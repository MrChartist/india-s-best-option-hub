/** Tradebook import: broker picker (or auto-detect), file drop, how-to per broker, and parse issues. */
import { useId, useRef, useState, type DragEvent } from "react";
import { FileUp, Info, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BROKERS, SOURCE_LABEL, parseTradebook, type BrokerId, type ParseResult } from "@/lib/journal";
import { cn } from "@/lib/utils";

export interface ImportOutcome {
  result: ParseResult & { broker: BrokerId | null };
  fileName: string;
}

export function ImportPanel({ imported, onImport, onClear }: { imported: number; onImport: (o: ImportOutcome) => void; onClear: () => void }) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [broker, setBroker] = useState<BrokerId | "auto">("auto");
  const [drag, setDrag] = useState(false);
  const [last, setLast] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const read = (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      setLast({ fileName: file.name, result: { source: "zerodha", fills: [], issues: [{ line: 0, message: "The file is larger than 15 MB. Export one financial year at a time." }], rows: 0, broker: null } });
      return;
    }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseTradebook(String(reader.result ?? ""), broker);
      const outcome = { result, fileName: file.name };
      setLast(outcome);
      setBusy(false);
      if (result.fills.length) onImport(outcome);
    };
    reader.onerror = () => {
      setBusy(false);
      setLast({ fileName: file.name, result: { source: "zerodha", fills: [], issues: [{ line: 0, message: "The file could not be read." }], rows: 0, broker: null } });
    };
    reader.readAsText(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) read(f);
  };

  const howTo = broker === "auto" ? null : BROKERS.find((b) => b.id === broker)?.howTo;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="grid content-start gap-1.5">
          <Label htmlFor={`${uid}-broker`}>Broker</Label>
          <Select value={broker} onValueChange={(v) => setBroker(v as BrokerId | "auto")}>
            <SelectTrigger id={`${uid}-broker`} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Detect automatically</SelectItem>
              {BROKERS.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn("flex flex-col items-center justify-center gap-2 rounded-tile border border-dashed px-4 py-5 text-center transition-colors duration-fast", drag ? "border-primary bg-wash-brand" : "border-border bg-surface/40")}
        >
          <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-body-sm text-muted-foreground">Drop a tradebook CSV here, or</p>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Reading…" : "Choose CSV file"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            aria-label="Choose a tradebook CSV"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) read(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-body-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {howTo ?? "Zerodha, Dhan, Upstox and Angel One F&O tradebooks are recognised from their column headers."} The file is read in this browser only; nothing is uploaded.
      </p>
      {last ? (
        <div role="status" className={cn("rounded-tile border px-3 py-2 text-body-sm", last.result.fills.length ? "border-bullish/30 bg-wash-profit" : "border-bearish/30 bg-wash-loss")}>
          <p className="font-semibold text-foreground">
            {last.result.fills.length
              ? `Read ${last.result.fills.length} F&O fill${last.result.fills.length === 1 ? "" : "s"} from ${last.fileName}${last.result.broker ? ` (${SOURCE_LABEL[last.result.broker]})` : ""}.`
              : `Nothing imported from ${last.fileName}.`}
          </p>
          {last.result.issues.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-muted-foreground">
                {last.result.issues.length} row{last.result.issues.length === 1 ? "" : "s"} skipped
              </summary>
              <ul className="mt-1 max-h-40 list-disc overflow-auto pl-5 text-muted-foreground">
                {last.result.issues.slice(0, 50).map((i) => (
                  <li key={`${i.line}-${i.message}`}>{i.line ? `Line ${i.line}: ` : ""}{i.message}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      {imported > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-body-sm">
          <span className="text-muted-foreground">{imported} imported fills stored in this browser.</span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-bearish">
                <Trash2 aria-hidden="true" /> Clear imports
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear imported trades?</AlertDialogTitle>
                <AlertDialogDescription>This removes {imported} imported fills from this browser. Tags and notes on those trades are removed too.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onClear}>Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </div>
  );
}
