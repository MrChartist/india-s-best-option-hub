import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BellRing, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export function StrikeAlertDialog({
  open,
  onOpenChange,
  symbol,
  expiry,
  strike,
  defaultType,
  rows,
  alerts,
  onSave,
  onDelete,
}: StrikeAlertDialogProps) {
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

  const draft: StrikeAlert | null =
    strike !== null ? { id: "draft", symbol, expiry, strike, type, field, op, value: Number(value) } : null;
  const current = draft ? alertCurrentValue(draft, rows) : NaN;
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && (field === "oiChange" || parsed > 0);
  const forStrike = useMemo(
    () => alerts.filter((a) => a.symbol === symbol && a.expiry === expiry && a.strike === strike),
    [alerts, symbol, expiry, strike],
  );
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
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary-ink" aria-hidden="true" />
            Alert on {symbol} {strike !== null ? formatStrike(strike) : ""}
          </DialogTitle>
          <DialogDescription className="text-body-sm">
            {expiry ? formatDateIST(expiry) : ""} expiry. Checked on every refresh while this page is open
            (nearest-expiry alerts also in the background); you get a toast and a browser notification if allowed.
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
            <Label className="text-body-sm text-muted-foreground">Option</Label>
            <ToggleGroup
              type="single"
              value={type}
              onValueChange={(v) => v && setType(v as OptionType)}
              className="justify-start"
            >
              <ToggleGroupItem value="CE" className="px-4">
                CE (call)
              </ToggleGroupItem>
              <ToggleGroupItem value="PE" className="px-4">
                PE (put)
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="alert-field" className="text-body-sm text-muted-foreground">
                When
              </Label>
              <Select
                value={field}
                onValueChange={(v) => {
                  const f = v as AlertField;
                  setField(f);
                  if (!ALERT_FIELD_OPS[f].includes(op)) setOp(ALERT_FIELD_OPS[f][0]);
                }}
              >
                <SelectTrigger id="alert-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ALERT_FIELD_LABEL) as AlertField[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {ALERT_FIELD_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="sr-only">Condition</Label>
              <ToggleGroup type="single" value={op} onValueChange={(v) => v && setOp(v as AlertOp)}>
                {ALERT_FIELD_OPS[field].map((o) => (
                  <ToggleGroupItem
                    key={o}
                    value={o}
                    className="w-8"
                    aria-label={o === "gte" ? "at or above" : "at or below"}
                  >
                    {OP_SYMBOL[o]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alert-value" className="text-body-sm text-muted-foreground">
                Value
              </Label>
              <Input
                id="alert-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={field === "iv" ? "e.g. 18" : field === "premium" ? "e.g. 120" : "e.g. 500000"}
                className="tabular-nums"
              />
            </div>
          </div>
          <p className="text-body-sm tabular-nums text-muted-foreground">
            Now:{" "}
            {Number.isFinite(current)
              ? field === "iv"
                ? `${current.toFixed(2)}%`
                : field === "premium"
                  ? `₹${current.toFixed(2)}`
                  : current.toLocaleString("en-IN")
              : "no data"}
          </p>
          <DialogFooter>
            <Button type="submit" disabled={!valid}>
              Save alert
            </Button>
          </DialogFooter>
        </form>

        {forStrike.length > 0 && (
          <div className="hairline-t space-y-1.5 pt-3">
            <p className="text-label text-muted-foreground">Alerts on this strike</p>
            <ul className="divide-y divide-separator overflow-hidden rounded-tile bg-surface shadow-[0_0_0_var(--hairline)_hsl(var(--separator))]">
              {forStrike.map((a) => (
                <li
                  key={a.id}
                  className="flex min-h-8 items-center justify-between gap-2 py-0.5 pl-3 pr-1 text-body"
                >
                  <span className="truncate">{describeAlert(a)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-bearish"
                    onClick={() => onDelete(a.id)}
                    aria-label={`Delete alert ${describeAlert(a)}`}
                  >
                    <Trash2 className="!size-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="hairline-t flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className="text-body-sm text-muted-foreground">
            {otherCount > 0
              ? `${otherCount} more ${otherCount === 1 ? "alert" : "alerts"} on other ${symbol} strikes or expiries.`
              : "Pause, edit, log and route alerts in the Alerts Centre."}
          </p>
          <Button asChild variant="link" size="sm" className="h-auto">
            <Link to="/alerts" onClick={() => onOpenChange(false)}>
              Manage all alerts <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
