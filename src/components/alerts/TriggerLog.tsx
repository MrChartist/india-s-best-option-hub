import { useMemo, useState } from "react";
import { ChevronDown, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDateIST, formatINR, formatNumberIN, formatTimeIST } from "@/lib/options";
import { fmtRs, type AlertSnapshot, type ChannelKey, type DeliveryOutcome, type TriggerLogEntry } from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { ToneDot } from "./alertUi";

const CHANNEL_SHORT: Record<ChannelKey, string> = {
  toast: "In-app",
  desktop: "Browser",
  sound: "Sound",
  webhook: "Webhook",
};
const OUTCOME_VARIANT: Record<DeliveryOutcome, "bullish" | "neutral" | "bearish" | "warning"> = {
  sent: "bullish",
  skipped: "neutral",
  failed: "bearish",
  blocked: "warning",
};
const OUTCOME_WORD: Record<DeliveryOutcome, string> = {
  sent: "sent",
  skipped: "off",
  failed: "failed",
  blocked: "blocked",
};

function snapshotRows(s: AlertSnapshot): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (s.valueLabel && Number.isFinite(s.value)) {
    const v = s.value as number;
    const money = /₹/.test(s.valueLabel);
    rows.push([
      s.valueLabel.replace(" ₹", ""),
      money
        ? Math.abs(v) >= 1e5
          ? `${v < 0 ? "−" : ""}${fmtRs(Math.abs(v))}`
          : formatINR(v, { decimals: 0 })
        : formatNumberIN(v, Math.abs(v) < 100 ? 2 : 0),
    ]);
  }
  if (Number.isFinite(s.spot)) rows.push(["Spot", formatNumberIN(s.spot as number, 2)]);
  if (Number.isFinite(s.pcr)) rows.push(["PCR (OI)", (s.pcr as number).toFixed(2)]);
  if (Number.isFinite(s.atmIv)) rows.push(["ATM IV", `${(s.atmIv as number).toFixed(2)}%`]);
  if (Number.isFinite(s.ivp)) rows.push(["IV percentile", String(Math.round(s.ivp as number))]);
  if (Number.isFinite(s.maxPain)) rows.push(["Max pain", formatNumberIN(s.maxPain as number)]);
  if (Number.isFinite(s.gammaFlip)) rows.push(["Gamma flip", formatNumberIN(s.gammaFlip as number)]);
  if (Number.isFinite(s.tideNet))
    rows.push(["Net tide", `${(s.tideNet as number) < 0 ? "−" : ""}${fmtRs(Math.abs(s.tideNet as number))}`]);
  if (Number.isFinite(s.pnl) && s.valueLabel !== "P&L ₹")
    rows.push(["P&L", formatINR(s.pnl as number, { decimals: 0 })]);
  if (Number.isFinite(s.netDelta)) rows.push(["Net delta", formatNumberIN(s.netDelta as number, 1)]);
  if (s.expiry) rows.push(["Expiry", formatDateIST(s.expiry)]);
  if (Number.isFinite(s.dataTs) && (s.dataTs as number) > 0)
    rows.push(["Data as of", formatTimeIST(s.dataTs as number, { seconds: true })]);
  return rows;
}

function LogItem({ e, detailed }: { e: TriggerLogEntry; detailed: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = e.snapshot ? snapshotRows(e.snapshot) : [];
  const delivery = (Object.keys(CHANNEL_SHORT) as ChannelKey[]).filter(
    (k) => e.delivery?.[k] && e.delivery[k] !== "skipped",
  );
  return (
    <li className="rounded-tile border border-separator bg-card p-2.5">
      <div className="flex gap-2">
        <ToneDot tone={e.tone} className="mt-1.5" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 break-words text-body-sm font-semibold">{e.title}</p>
            {e.test ? (
              <Badge variant="info">
                <FlaskConical aria-hidden="true" /> Test
              </Badge>
            ) : null}
          </div>
          <p className="break-words text-body-sm text-muted-foreground">{e.message}</p>
          <p className="mt-0.5 text-micro text-muted-foreground">
            <time dateTime={new Date(e.ts).toISOString()}>
              {formatDateIST(e.ts)} · {formatTimeIST(e.ts, { seconds: true })}
            </time>
            {e.shownElsewhere ? ` · shown on ${e.shownElsewhere}` : ""}
          </p>
          {detailed ? (
            <>
              {e.rule && e.rule !== e.title ? <p className="mt-1 break-words text-body-sm">Rule: {e.rule}</p> : null}
              <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Delivery">
                {delivery.length === 0 ? <Badge variant="neutral">Logged only</Badge> : null}
                {delivery.map((k) => (
                  <Badge key={k} variant={OUTCOME_VARIANT[e.delivery[k] as DeliveryOutcome]}>
                    {CHANNEL_SHORT[k]} {OUTCOME_WORD[e.delivery[k] as DeliveryOutcome]}
                  </Badge>
                ))}
              </div>
              {rows.length > 0 ? (
                <Collapsible open={open} onOpenChange={setOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="pill" className="-ml-2 mt-1">
                      <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />{" "}
                      {open ? "Hide" : "Show"} market snapshot
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 rounded-chip bg-muted/50 p-2 text-body-sm sm:grid-cols-3">
                      {rows.map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-micro text-muted-foreground">{k}</dt>
                          <dd className="truncate tabular-nums">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export interface TriggerLogProps {
  log: TriggerLogEntry[];
  onClear?: () => void;
  detailed?: boolean;
  limit?: number;
  /** Filter to one rule. */
  ruleId?: string;
}

export function TriggerLog({ log, onClear, detailed = false, limit, ruleId }: TriggerLogProps) {
  const [confirm, setConfirm] = useState(false);
  const items = useMemo(() => {
    const l = ruleId ? log.filter((e) => e.ruleId === ruleId) : log;
    return limit ? l.slice(0, limit) : l;
  }, [log, limit, ruleId]);

  if (items.length === 0) {
    return (
      <p className="rounded-tile px-4 py-6 text-center text-body-sm text-muted-foreground">
        No alerts have fired yet. Use “Test” to check your channels.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ol className="space-y-2" aria-live="polite" aria-label="Trigger log, newest first">
        {items.map((e) => (
          <LogItem key={e.id} e={e} detailed={detailed} />
        ))}
      </ol>
      {onClear ? (
        confirm ? (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="pill"
              className="text-bearish"
              onClick={() => {
                onClear();
                setConfirm(false);
              }}
            >
              Clear the log
            </Button>
            <Button variant="ghost" size="pill" onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="pill" onClick={() => setConfirm(true)}>
            Clear log
          </Button>
        )
      ) : null}
    </div>
  );
}
