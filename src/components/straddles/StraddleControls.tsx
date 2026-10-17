/** Symbol, expiry and strike selection for the Straddles page (rolling ATM, a fixed strike, or a custom CE/PE pair). */
import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { SymbolSearch } from "@/components/option-chain/SymbolSearch";
import { formatDateIST, formatStrike } from "@/lib/options";
import { strikesAround, type StrikeSelection } from "@/lib/straddles";

export interface ExpiryChoice {
  date: string;
  dte: number;
  kind: string;
}

interface Props {
  symbol: string;
  onSymbol: (s: string) => void;
  expiries: ExpiryChoice[];
  expiry: string;
  onExpiry: (e: string) => void;
  selection: StrikeSelection;
  onSelection: (s: StrikeSelection) => void;
  strikes: number[];
  atm: number;
}

/** Strikes offered in the pickers: ±25 around ATM, plus any strike already chosen. */
function pickerStrikes(strikes: number[], atm: number, keep: number[]): number[] {
  const near = Number.isFinite(atm) ? strikesAround(strikes, atm, 25) : strikes.slice(0, 51);
  return [...new Set([...near, ...keep.filter((k) => Number.isFinite(k) && k > 0)])].sort((a, b) => a - b);
}

function StrikeSelect({ id, label, value, options, atm, onChange }: { id: string; label: string; value: number; options: number[]; atm: number; onChange: (k: number) => void }) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-label uppercase text-muted-foreground">{label}</Label>
      <Select value={Number.isFinite(value) ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))} disabled={options.length === 0}>
        <SelectTrigger id={id} className="h-9 w-full font-num tabular-nums sm:w-[140px]">
          <SelectValue placeholder={options.length === 0 ? "No strikes" : "Strike"} />
        </SelectTrigger>
        <SelectContent className="max-h-[320px]">
          {options.map((k) => (
            <SelectItem key={k} value={String(k)} className="font-num tabular-nums">
              {formatStrike(k)}
              {k === atm ? " · ATM" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function StraddleControls({ symbol, onSymbol, expiries, expiry, onExpiry, selection, onSelection, strikes, atm }: Props) {
  const sorted = useMemo(() => [...new Set(strikes)].sort((a, b) => a - b), [strikes]);
  const keepKey = selection.kind === "fixed" ? String(selection.strike) : selection.kind === "pair" ? `${selection.ce},${selection.pe}` : "";
  const options = useMemo(() => pickerStrikes(sorted, atm, keepKey ? keepKey.split(",").map(Number) : []), [sorted, atm, keepKey]);
  const atmIdx = sorted.indexOf(atm);
  const at = (offset: number) => (atmIdx >= 0 ? sorted[Math.min(sorted.length - 1, Math.max(0, atmIdx + offset))] : NaN);
  const hasAtm = Number.isFinite(atm) && atmIdx >= 0;

  const setMode = (kind: StrikeSelection["kind"]) => {
    if (kind === "atm") onSelection({ kind: "atm" });
    else if (kind === "fixed") onSelection({ kind: "fixed", strike: selection.kind === "pair" ? selection.ce : hasAtm ? atm : sorted[Math.floor(sorted.length / 2)] });
    else if (hasAtm) onSelection({ kind: "pair", ce: at(1), pe: at(-1) });
  };

  return (
    <section aria-label="Contract and strikes" className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 shadow-card lg:flex-row lg:flex-wrap lg:items-end">
      <div className="grid gap-1">
        <span id="straddle-symbol-label" className="text-label uppercase text-muted-foreground">Symbol</span>
        <div aria-labelledby="straddle-symbol-label">
          <SymbolSearch value={symbol} onSelect={onSymbol} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="straddle-expiry" className="text-label uppercase text-muted-foreground">Expiry</Label>
        <Select value={expiry || undefined} onValueChange={onExpiry} disabled={expiries.length === 0}>
          <SelectTrigger id="straddle-expiry" className="h-9 w-full sm:w-[230px]">
            <SelectValue placeholder="No expiry" />
          </SelectTrigger>
          <SelectContent>
            {expiries.map((e) => (
              <SelectItem key={e.date} value={e.date}>
                {formatDateIST(e.date)} · {e.kind} · {e.dte === 0 ? "today" : `${e.dte}d`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-w-0 gap-1">
        <span id="straddle-mode-label" className="text-label uppercase text-muted-foreground">Strikes</span>
        <div className="-mx-1 overflow-x-auto px-1">
          <ToggleGroup type="single" size="sm" value={selection.kind} onValueChange={(v) => v && setMode(v as StrikeSelection["kind"])} aria-labelledby="straddle-mode-label" className="justify-start">
            <ToggleGroupItem value="atm" className="whitespace-nowrap">ATM (rolling)</ToggleGroupItem>
            <ToggleGroupItem value="fixed" className="whitespace-nowrap" disabled={sorted.length === 0}>Fixed strike</ToggleGroupItem>
            <ToggleGroupItem value="pair" className="whitespace-nowrap" disabled={!hasAtm && selection.kind !== "pair"}>Custom CE/PE</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      {selection.kind === "fixed" ? (
        <StrikeSelect id="straddle-strike" label="Strike" value={selection.strike} options={options} atm={atm} onChange={(k) => onSelection({ kind: "fixed", strike: k })} />
      ) : null}
      {selection.kind === "pair" ? (
        <div className="flex flex-wrap items-end gap-2">
          <StrikeSelect id="straddle-ce" label="CE strike" value={selection.ce} options={options} atm={atm} onChange={(k) => onSelection({ kind: "pair", ce: k, pe: selection.pe })} />
          <StrikeSelect id="straddle-pe" label="PE strike" value={selection.pe} options={options} atm={atm} onChange={(k) => onSelection({ kind: "pair", ce: selection.ce, pe: k })} />
          {hasAtm ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Strangle presets">
              {[1, 2, 3].map((n) => (
                <Button key={n} type="button" size="sm" variant="outline" className="h-9" onClick={() => onSelection({ kind: "pair", ce: at(n), pe: at(-n) })} aria-label={`Strangle ${n} strike${n === 1 ? "" : "s"} either side of ATM`}>
                  ±{n}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
