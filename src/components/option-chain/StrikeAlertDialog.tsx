import { useEffect, useMemo, useState } from "react";
import { BellRing, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDateIST, formatStrike, type OptionType } from "@/lib/options";
import {
  ALERT_FIELD_LABEL,
  ALERT_FIELD_OPS,
  OP_SYMBOL,
  alertCurrentValue,
  describeAlert,
  newAlertId,
  type AlertField,
  type AlertOp,
  type StrikeAlert,
} from "./alerts";
import type { RowView } from "./chainModel";

export interface StrikeAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  expiry: string;
  strike: number | null;
  defaultType: OptionType;
  rows: RowView[];
  alerts: StrikeAlert[];
  onSave: (a: StrikeAlert) => void;
  onDelete: (id: string) => void;
}

export function StrikeAlertDialog({ open, onOpenChange, symbol, expiry, strike, defaultType, rows, alerts, onSave, onDelete }: StrikeAlertDialogProps) {
  const [type, setType] = useState<OptionType>(defaultType);
  const [field, setField] = useState<AlertField>("premium");
  const [op, setOp] = useState<AlertOp>("gte");
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      setType(defaultType);
      setField("premium");
      setOp("gte");
      setValue("");
    }
  }, [open, defaultType, strike]);

  const draft: StrikeAlert | null = strike !== null ? { id: "draft", symbol, expiry, strike, type, field, op, value: Number(value) } : null;
  const current = draft ? alertCurrentValue(draft, rows) : NaN;
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && (field === "oiChange" || parsed > 0);
  const forStrike = useMemo(() => alerts.filter((a) => a.symbol === symbol && a.expiry === expiry && a.strike === strike), [alerts, symbol, expiry, strike]);
  const otherCount = alerts.filter((a) => a.symbol === symbol).length - forStrike.length;

  const save = () => {
    if (!valid || strike === null) return;
    onSave({ id: newAlertId(), symbol, expiry, strike, type, field, op, value: parsed });
    setValue("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <BellRing className="h-5 w-5 text-primary-ink" />
            Alert on {symbol} {strike !== null ? formatStrike(strike) : ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {expiry ? formatDateIST(expiry) : ""} expiry. Checked on every refresh while this page is open; you get a toast and a browser notification if allowed.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">Option</Label>
            <ToggleGroup type="single" value={type} onValueChange={(v) => v && setType(v as OptionType)} className="justify-start">
              <ToggleGroupItem value="CE" className="h-8 px-4 text-xs">CE (call)</ToggleGroupItem>
              <ToggleGroupItem value="PE" className="h-8 px-4 text-xs">PE (put)</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="alert-field" className="text-xs">When</Label>
              <Select
                value={field}
                onValueChange={(v) => {
                  const f = v as AlertField;
                  setField(f);
                  if (!ALERT_FIELD_OPS[f].includes(op)) setOp(ALERT_FIELD_OPS[f][0]);
                }}
              >
                <SelectTrigger id="alert-field" className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ALERT_FIELD_LABEL) as AlertField[]).map((f) => (
                    <SelectItem key={f} value={f} className="text-xs">{ALERT_FIELD_LABEL[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="sr-only">Condition</Label>
              <ToggleGroup type="single" value={op} onValueChange={(v) => v && setOp(v as AlertOp)}>
                {ALERT_FIELD_OPS[field].map((o) => (
                  <ToggleGroupItem key={o} value={o} className="h-9 w-9 text-sm" aria-label={o === "gte" ? "at or above" : "at or below"}>
                    {OP_SYMBOL[o]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alert-value" className="text-xs">Value</Label>
              <Input id="alert-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={field === "iv" ? "e.g. 18" : field === "premium" ? "e.g. 120" : "e.g. 500000"} className="h-9 text-xs" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Now: {Number.isFinite(current) ? (field === "iv" ? `${current.toFixed(2)}%` : field === "premium" ? `₹${current.toFixed(2)}` : current.toLocaleString("en-IN")) : "no data"}
          </p>
          <DialogFooter>
            <Button type="submit" disabled={!valid}>Save alert</Button>
          </DialogFooter>
        </form>

        {forStrike.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-label uppercase text-muted-foreground">Alerts on this strike</p>
            <ul className="space-y-1">
              {forStrike.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-chip bg-muted/60 px-2 py-1 text-xs">
                  <span className="truncate">{describeAlert(a)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(a.id)} aria-label={`Delete alert ${describeAlert(a)}`}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {otherCount > 0 && <p className="text-[11px] text-muted-foreground">{otherCount} more {otherCount === 1 ? "alert" : "alerts"} on other {symbol} strikes or expiries.</p>}
      </DialogContent>
    </Dialog>
  );
}
