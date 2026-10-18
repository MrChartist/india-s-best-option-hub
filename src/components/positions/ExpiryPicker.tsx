/** ISO expiry picker: upcoming SEBI-calendar expiries for the symbol, plus a custom date. */
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateIST, getExpiries, isValidIsoDate } from "@/lib/options";

const CUSTOM = "__custom__";

export function ExpiryPicker({
  symbol,
  value,
  onChange,
  id,
  className,
  count = 8,
}: {
  symbol: string;
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  className?: string;
  count?: number;
}) {
  const expiries = useMemo(() => getExpiries(symbol, new Date(), count), [symbol, count]);
  const listed = expiries.some((e) => e.date === value);
  const [custom, setCustom] = useState(!!value && !listed);
  const showCustom = custom || (!!value && !listed);

  return (
    <div className={className}>
      <Select
        value={showCustom ? CUSTOM : value || undefined}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(v);
        }}
      >
        <SelectTrigger id={id} aria-label="Expiry">
          <SelectValue placeholder="Choose expiry" />
        </SelectTrigger>
        <SelectContent>
          {expiries.map((e) => (
            <SelectItem key={e.date} value={e.date}>
              {formatDateIST(e.date)} · {e.type} · {e.dte === 0 ? "today" : `${e.dte}d`}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Other date…</SelectItem>
        </SelectContent>
      </Select>
      {showCustom ? (
        <Input
          type="date"
          aria-label="Custom expiry date"
          className="mt-1.5 h-9"
          value={isValidIsoDate(value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
      {expiries.length === 0 ? <p className="mt-1 text-body-sm text-warning">No calendar for {symbol}. Enter the date manually.</p> : null}
    </div>
  );
}
