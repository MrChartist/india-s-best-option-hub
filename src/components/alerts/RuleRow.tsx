import { AlarmClock, FlaskConical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { formatTimeIST } from "@/lib/options";
import { RULE_TYPE_LABEL, describeRule, ruleTitle, type AlertRule, type RuleCoverage } from "@/lib/alerts";
import { cn } from "@/lib/utils";
import { TYPE_ICON } from "./alertConstants";
import { CoverageBadge } from "./alertUi";

export interface RuleRowProps {
  rule: AlertRule;
  coverage: RuleCoverage;
  current?: { label: string; value: string } | null;
  lastFired?: number;
  fireCount?: number;
  onToggle: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  onTest?: () => void;
  onSnooze?: (minutes: number | null) => void;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
  compact?: boolean;
}

/** Container classes for a list of RuleRows: one macOS group box with hairline dividers. */
export const RULE_LIST = "divide-y divide-separator overflow-hidden rounded-tile border border-separator bg-card shadow-card";

export function RuleRow({
  rule,
  coverage,
  current,
  lastFired,
  fireCount,
  onToggle,
  onDelete,
  onEdit,
  onTest,
  onSnooze,
  selected,
  onSelect,
  compact = false,
}: RuleRowProps) {
  const title = ruleTitle(rule);
  const desc = describeRule(rule);
  const snoozed = !!rule.snoozeUntil && rule.snoozeUntil > Date.now();
  return (
    <li
      className={cn(
        // A row of a grouped list (see RULE_LIST): the container draws the box and the hairlines.
        "flex items-start gap-2.5 px-3 py-2.5",
        !rule.enabled && "bg-control-track",
      )}
    >
      {onSelect ? (
        <Checkbox
          checked={!!selected}
          onCheckedChange={(c) => onSelect(c === true)}
          aria-label={`Select rule: ${title}`}
          className="mt-1"
        />
      ) : null}
      <span className={cn("mt-0.5 shrink-0", rule.enabled ? "text-primary-ink" : "text-muted-foreground")}>
        {TYPE_ICON[rule.type]}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "break-words text-body font-semibold leading-snug",
            !rule.enabled && "text-muted-foreground",
          )}
        >
          {title}
        </p>
        {rule.label ? <p className="break-words text-body-sm text-muted-foreground">{desc}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground">
          <span>{RULE_TYPE_LABEL[rule.type]}</span>
          <span aria-hidden="true">·</span>
          <span>{rule.cooldownMin > 0 ? `cooldown ${rule.cooldownMin} min` : "re-arms on reset"}</span>
          {lastFired ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                fired {formatTimeIST(lastFired)}
                {fireCount && fireCount > 1 ? ` (${fireCount}×)` : ""}
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <CoverageBadge coverage={coverage} />
          {current && !compact ? (
            <span className="text-body-sm tabular-nums text-muted-foreground">
              {current.label}: <span className="text-foreground">{current.value}</span>
            </span>
          ) : null}
        </div>
      </div>
      <Switch
        checked={rule.enabled}
        onCheckedChange={onToggle}
        aria-label={`${rule.enabled ? "Pause" : "Resume"} rule: ${title}`}
        className="mt-0.5"
      />
      {compact || !onEdit ? (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDelete}
          aria-label={`Delete rule: ${desc}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Actions for rule: ${title}`}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil aria-hidden="true" /> Edit
            </DropdownMenuItem>
            {onTest ? (
              <DropdownMenuItem onSelect={onTest}>
                <FlaskConical aria-hidden="true" /> Test-fire
              </DropdownMenuItem>
            ) : null}
            {onSnooze ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Snooze</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onSnooze(30)}>
                  <AlarmClock aria-hidden="true" /> 30 minutes
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSnooze(120)}>
                  <AlarmClock aria-hidden="true" /> 2 hours
                </DropdownMenuItem>
                {snoozed ? <DropdownMenuItem onSelect={() => onSnooze(null)}>End snooze</DropdownMenuItem> : null}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-bearish focus:text-bearish">
              <Trash2 aria-hidden="true" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
