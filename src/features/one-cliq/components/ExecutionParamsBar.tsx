import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { marketProtectionPrice } from "../lib/fillModel";
import type { TerminalConfig, TriggerUnit } from "../types";

interface Props {
  config: TerminalConfig;
  /** Spot LTP, used to show what an SL in points actually means in rupees. */
  spot: number | null;
  onUpdate: <K extends keyof TerminalConfig>(key: K, value: TerminalConfig[K]) => void;
}

const TRIGGER = "h-8 text-xs";

const UNIT_LABEL: Record<TriggerUnit, string> = {
  SPOT_PTS: "Spot pts",
  PREMIUM: "Premium ₹",
  PCT: "%",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <Label className="text-[10px] text-muted-foreground font-normal">{label}</Label>
      {children}
      {hint && <span className="text-[10px] text-muted-foreground truncate">{hint}</span>}
    </div>
  );
}

/**
 * Order type, market protection, and the pre-armed SL / Target.
 *
 * The unit selector sits next to the value rather than being implied, because
 * "50" means three completely different risks depending on whether it is spot
 * points, rupees of premium, or a percentage. The hint line resolves it to a
 * concrete level so the trader sees the actual consequence before arming.
 */
export function ExecutionParamsBar({ config, spot, onUpdate }: Props) {
  const protectionHint = spot
    ? `Buy ≤ ₹${marketProtectionPrice(spot, "BUY", config.protectionPct).toFixed(2)}`
    : undefined;

  const levelHint = (value: number, unit: TriggerUnit, direction: -1 | 1): string | undefined => {
    if (unit !== "SPOT_PTS" || !spot) return undefined;
    return `≈ ${config.symbol} ${(spot + direction * value).toFixed(0)}`;
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
      <Field label="Order Type">
        <Select value={config.orderVariant} onValueChange={(v) => onUpdate("orderVariant", v as TerminalConfig["orderVariant"])}>
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="MARKET_PROTECT">Market Protection</SelectItem>
            <SelectItem value="MARKET">Market</SelectItem>
            <SelectItem value="LIMIT">Limit</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Market Protection %" hint={protectionHint}>
        <Select
          value={String(config.protectionPct)}
          onValueChange={(v) => onUpdate("protectionPct", Number(v))}
          disabled={config.orderVariant !== "MARKET_PROTECT"}
        >
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 5, 10, 15, 20].map((p) => (
              <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Predefined SL" hint={config.slEnabled ? levelHint(config.slValue, config.slUnit, -1) : undefined}>
        <div className="flex items-center gap-1">
          <Checkbox
            checked={config.slEnabled}
            onCheckedChange={(c) => onUpdate("slEnabled", c === true)}
            aria-label="Enable predefined stop loss"
          />
          <Input
            className="h-8 text-xs font-mono tabular-nums"
            value={config.slValue}
            inputMode="decimal"
            disabled={!config.slEnabled}
            onChange={(e) => onUpdate("slValue", Number(e.target.value) || 0)}
          />
        </div>
      </Field>

      <Field label="SL Unit">
        <Select
          value={config.slUnit}
          onValueChange={(v) => onUpdate("slUnit", v as TriggerUnit)}
          disabled={!config.slEnabled}
        >
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(UNIT_LABEL) as TriggerUnit[]).map((u) => (
              <SelectItem key={u} value={u}>{UNIT_LABEL[u]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Predefined Target" hint={config.targetEnabled ? levelHint(config.targetValue, config.targetUnit, 1) : undefined}>
        <div className="flex items-center gap-1">
          <Checkbox
            checked={config.targetEnabled}
            onCheckedChange={(c) => onUpdate("targetEnabled", c === true)}
            aria-label="Enable predefined target"
          />
          <Input
            className="h-8 text-xs font-mono tabular-nums"
            value={config.targetValue}
            inputMode="decimal"
            disabled={!config.targetEnabled}
            onChange={(e) => onUpdate("targetValue", Number(e.target.value) || 0)}
          />
        </div>
      </Field>

      <Field label="Target Unit">
        <Select
          value={config.targetUnit}
          onValueChange={(v) => onUpdate("targetUnit", v as TriggerUnit)}
          disabled={!config.targetEnabled}
        >
          <SelectTrigger className={TRIGGER}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(UNIT_LABEL) as TriggerUnit[]).map((u) => (
              <SelectItem key={u} value={u}>{UNIT_LABEL[u]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
