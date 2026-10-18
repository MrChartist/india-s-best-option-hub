/**
 * The quick alerts sheet (lazy-loaded the first time the bell is opened). Full management lives on
 * the Alerts page (/alerts).
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bell, BellRing, Lightbulb, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { formatTimeIST } from "@/lib/options";
import { alertStore, fireCountByRule, newRuleId, ruleCoverage, type AlertRule } from "@/lib/alerts";
import { IdeasList } from "./IdeasList";
import { RuleEditor } from "./RuleEditor";
import { RULE_LIST, RuleRow } from "./RuleRow";
import { TriggerLog } from "./TriggerLog";

const MODE_LABEL = {
  live: "live",
  recorded: "delayed",
  sample: "sample · not checked",
  waiting: "connecting",
} as const;
const ALERTS_PATH = "/alerts";

export interface AlertSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AlertSheet({ open, onOpenChange }: AlertSheetProps) {
  const engine = useAlertEngine();
  const [adding, setAdding] = useState(false);
  const active = engine.rules.filter((r) => r.enabled).length;
  const counts = useMemo(() => fireCountByRule(engine.log), [engine.log]);
  const now = Date.now();

  const onAdd = (r: AlertRule) => {
    alertStore.addRule({ ...r, id: newRuleId(), createdAt: Date.now() });
    setAdding(false);
    toast.success("Rule added", { description: "It is checked while the terminal is open." });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px]">
        <SheetHeader className="space-y-1 border-b border-separator px-4 py-4 text-left">
          <SheetTitle className="flex items-center gap-2 font-display">
            <Bell className="h-4 w-4" aria-hidden="true" /> Alerts
            <Badge variant={active > 0 ? "default" : "neutral"}>{active} active</Badge>
          </SheetTitle>
          <SheetDescription className="text-body-sm">
            Rules are checked against live chain data every few seconds while the terminal is open. Sample data never
            triggers an alert.
          </SheetDescription>
          <Button asChild variant="link" className="justify-start text-body-sm">
            <Link to={ALERTS_PATH} onClick={() => onOpenChange(false)}>
              Manage all alerts <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </SheetHeader>

        <div className="space-y-3 border-b border-separator px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id="alert-sound"
                checked={engine.settings.sound}
                onCheckedChange={(c) => engine.setSettings({ sound: c })}
              />
              <Label htmlFor="alert-sound" className="text-body-sm">
                Sound
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="alert-desktop"
                checked={engine.settings.desktop && engine.permission === "granted"}
                disabled={engine.permission === "unsupported" || engine.permission === "denied"}
                onCheckedChange={async (c) => {
                  const p = await engine.enableDesktop(c);
                  if (c && p === "denied")
                    toast.error("Notifications are blocked", {
                      description: "Allow them for this site in your browser settings.",
                    });
                }}
              />
              <Label htmlFor="alert-desktop" className="text-body-sm">
                Browser notifications
              </Label>
            </div>
          </div>
          {engine.status.length > 0 || engine.hasBanRule ? (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Data feeds">
              <span className="text-micro text-muted-foreground">Watching</span>
              {engine.status.map((s) => (
                <Badge
                  key={s.symbol}
                  variant={s.mode === "live" ? "bullish" : s.mode === "sample" ? "warning" : "neutral"}
                  title={s.asOf ? `As of ${formatTimeIST(s.asOf, { seconds: true })}` : undefined}
                >
                  {s.symbol} · {MODE_LABEL[s.mode]}
                </Badge>
              ))}
              {engine.hasBanRule ? (
                <Badge variant={engine.banListAvailable ? "info" : "neutral"}>
                  Ban list · {engine.banListAvailable ? engine.banListDate || "loaded" : "unavailable"}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        <Tabs defaultValue={engine.rules.length === 0 ? "ideas" : "rules"} className="flex-1 px-4 py-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rules">Rules ({engine.rules.length})</TabsTrigger>
            <TabsTrigger value="ideas" className="gap-1">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Ideas
            </TabsTrigger>
            <TabsTrigger value="log">Log ({engine.log.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="rules" className="mt-3 space-y-3">
            {engine.rules.length === 0 && !adding ? (
              <div className="rounded-tile px-4 py-6 text-center text-body-sm text-muted-foreground">
                <BellRing className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
                No rules yet. Add one, or start from the Ideas tab.
              </div>
            ) : null}
            <ul className={RULE_LIST}>
              {engine.rules.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  compact
                  coverage={ruleCoverage(r, engine.runtime, now)}
                  lastFired={engine.lastFired(r.id)}
                  fireCount={counts[r.id]}
                  onToggle={() => engine.toggleRule(r.id)}
                  onDelete={() => engine.removeRule(r.id)}
                />
              ))}
            </ul>
            {adding ? (
              <div className="rounded-tile border border-separator bg-surface p-3">
                <RuleEditor compact onSave={onAdd} onCancel={() => setAdding(false)} />
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full gap-1">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New rule
              </Button>
            )}
          </TabsContent>
          <TabsContent value="ideas" className="mt-3">
            <IdeasList engine={engine} />
          </TabsContent>
          <TabsContent value="log" className="mt-3">
            <TriggerLog log={engine.log} limit={30} onClear={engine.clearLog} />
          </TabsContent>
        </Tabs>

        <p className="border-t border-separator px-4 py-3 text-micro normal-case tracking-normal text-muted-foreground">
          Alerts are educational, not advice. Data for education and research. Not investment advice.
        </p>
      </SheetContent>
    </Sheet>
  );
}
