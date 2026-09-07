import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LOT_PRESETS } from "../hooks/useTerminalConfig";
import type { TerminalConfig } from "../types";

interface Props {
  config: TerminalConfig;
  symbols: string[];
  expiries: { label: string; value: string }[];
  lotSize: number;
  onSymbol: (symbol: string) => void;
  onUpdate: <K extends keyof TerminalConfig>(key: K, value: TerminalConfig[K]) => void;
  onStepLots: (direction: 1 | -1) => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Label className="text-[10px] text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}

const TRIGGER = "h-8 text-xs";

/**
 * The instrument row: exchange, segment, symbol, expiry, strikes, lots, product.
 *
 * Strikes are shown as read-only values here because they are driven by the
 * steppers on the quote cards and by Shift+arrow — two editable copies of the
 * same number is how a user ends up trading a strike they did not intend.
 */
export function InstrumentBar({ config, symbols, expiries, lotSize, onSymbol, onUpdate, onStepLots }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
      <Field label="Exchange">
        <Select value={config.exchange} onValueChange={(v) => onUpdate("exchange", v as TerminalConfig["exchange"])}>
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="NSE">NSE</SelectItem>
            <SelectItem value="BSE">BSE</SelectItem>
            <SelectItem value="MCX">MCX</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Segment">
        <Select value={config.segment} onValueChange={(v) => onUpdate("segment", v as TerminalConfig["segment"])}>
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="OPTIONS">Options</SelectItem>
            <SelectItem value="FUTURES">Futures</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Symbol">
        <Select value={config.symbol} onValueChange={onSymbol}>
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            {symbols.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Expiry">
        <Select
          value={config.expiry || undefined}
          onValueChange={(v) => onUpdate("expiry", v)}
          disabled={expiries.length === 0}
        >
          <SelectTrigger className={TRIGGER}>
            <SelectValue placeholder={expiries.length ? "Select" : "Loading…"} />
          </SelectTrigger>
          <SelectContent>
            {expiries.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Call Strike">
        <div className="h-8 flex items-center px-2 rounded-md border border-input bg-background font-mono text-xs tabular-nums">
          {config.callStrike || "—"}
        </div>
      </Field>

      <Field label="Put Strike">
        <div className="h-8 flex items-center px-2 rounded-md border border-input bg-background font-mono text-xs tabular-nums">
          {config.putStrike || "—"}
        </div>
      </Field>

      <Field label={`Qty (1 lot = ${lotSize})`}>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => onStepLots(-1)} tabIndex={-1} aria-label="Fewer lots">
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            className="h-8 text-xs text-center font-mono tabular-nums"
            value={config.lots}
            inputMode="numeric"
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onUpdate("lots", Number.isFinite(n) && n > 0 ? n : 1);
            }}
          />
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => onStepLots(1)} tabIndex={-1} aria-label="More lots">
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex gap-1 mt-0.5">
          {LOT_PRESETS.map((n, i) => (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              onClick={() => onUpdate("lots", n)}
              className={`flex-1 text-[10px] py-0.5 rounded border transition-colors ${
                config.lots === n ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-accent"
              }`}
              title={`Press ${i + 1}`}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Product Type">
        <Select value={config.productType} onValueChange={(v) => onUpdate("productType", v as TerminalConfig["productType"])}>
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="INTRADAY">Intraday</SelectItem>
            <SelectItem value="MARGIN">Margin</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
