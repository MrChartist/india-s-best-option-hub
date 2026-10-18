import { useMemo, useRef, useState } from "react";
import { BellRing, Download, FlaskConical, Lightbulb, Plus, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChannelsPanel } from "@/components/alerts/ChannelsPanel";
import { IdeasList } from "@/components/alerts/IdeasList";
import { RuleEditor } from "@/components/alerts/RuleEditor";
import { RULE_LIST, RuleRow } from "@/components/alerts/RuleRow";
import { TriggerLog } from "@/components/alerts/TriggerLog";
import { STAT_GROUP, Stat } from "@/components/positions/ui";
import { downloadText } from "@/components/alerts/alertConstants";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatTimeIST, istDateString } from "@/lib/options";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  RULE_CATEGORY,
  alertStore,
  describeRule,
  fireCountByRule,
  newRuleId,
  ruleCoverage,
  ruleCurrentValue,
  ruleTitle,
  type AlertRule,
  type RuleCategory,
} from "@/lib/alerts";

type CategoryFilter = "all" | RuleCategory;
type LogFilter = "all" | "real" | "test";
const MAX_IMPORT_BYTES = 512 * 1024;

/** File contents as text (Blob.text where available, FileReader otherwise). */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export default function Alerts() {
  useDocumentTitle("Alerts");
  const engine = useAlertEngine();
  const { rules, log, runtime, settings } = engine;
  const [tab, setTab] = useState(rules.length === 0 ? "ideas" : "rules");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AlertRule | "new" | null>(null);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const now = Date.now();
  const today = istDateString(new Date(now));

  const counts = useMemo(() => fireCountByRule(log), [log]);
  const firedToday = useMemo(
    () => log.filter((e) => !e.test && istDateString(new Date(e.ts)) === today).length,
    [log, today],
  );
  const active = rules.filter((r) => r.enabled).length;
  const channelsOn = (["toast", "desktop", "sound", "webhook"] as const).filter((k) =>
    k === "desktop"
      ? settings.desktop && engine.permission === "granted"
      : k === "webhook"
        ? settings.webhook && !!settings.webhookUrl
        : settings[k],
  ).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rules.filter(
      (r) =>
        (category === "all" || RULE_CATEGORY[r.type] === category) &&
        (!q || `${ruleTitle(r)} ${describeRule(r)} ${r.symbol}`.toLowerCase().includes(q)),
    );
  }, [rules, category, query]);
  const visibleLog = useMemo(
    () => (logFilter === "all" ? log : log.filter((e) => (logFilter === "test" ? e.test : !e.test))),
    [log, logFilter],
  );

  const feeds = runtime.feeds;
  const allSample = feeds.length > 0 && feeds.every((f) => f.mode === "sample");
  const anyLive = feeds.some((f) => f.mode === "live");
  const anyDelayed = feeds.some((f) => f.mode === "recorded");
  const source = !runtime.running ? (
    <Badge variant="neutral">Runner starting</Badge>
  ) : allSample ? (
    <Badge variant="warning">Sample data · alerts paused</Badge>
  ) : anyLive ? (
    <Badge variant="bullish">
      Live data{runtime.lastEvalAt ? ` · checked ${formatTimeIST(runtime.lastEvalAt, { seconds: true })}` : ""}
    </Badge>
  ) : anyDelayed ? (
    <Badge variant="info">Delayed data</Badge>
  ) : (
    <Badge variant="neutral">{feeds.length ? "Waiting for data" : "No chains needed yet"}</Badge>
  );

  const deleteRules = (ids: string[]) => {
    const removed = rules.filter((r) => ids.includes(r.id));
    if (removed.length === 0) return;
    engine.removeRules(ids);
    setSelected(new Set());
    toast.success(removed.length === 1 ? "Rule deleted" : `${removed.length} rules deleted`, {
      description: removed.length === 1 ? ruleTitle(removed[0]) : undefined,
      action: {
        label: "Undo",
        onClick: () => {
          const existing = new Set(alertStore.getState().rules.map((r) => r.id));
          for (const r of removed) if (!existing.has(r.id)) alertStore.addRule(r);
        },
      },
    });
  };

  const setEnabled = (ids: string[], enabled: boolean) => {
    for (const id of ids) engine.toggleRule(id, enabled);
    setSelected(new Set());
  };

  const onExport = () => {
    const ok = downloadText(`mr-chartist-alerts-${today}.json`, engine.exportJSON());
    if (ok) toast.success(`Exported ${rules.length} rule${rules.length === 1 ? "" : "s"}`);
    else toast.error("Could not export rules", { description: "Your browser blocked the download." });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error("That file is too large to be an alerts export");
      return;
    }
    let text: string;
    try {
      text = await readFileText(file);
    } catch {
      toast.error("Could not read that file");
      return;
    }
    const res = engine.importJSON(text);
    if (res.error) {
      toast.error("Import failed", { description: res.error });
      return;
    }
    if (res.rules.length === 0) {
      toast.error("No valid rules found", { description: res.errors?.[0] ?? undefined });
      return;
    }
    const migrated = (res.bySource?.chain ?? 0) + (res.bySource?.header ?? 0);
    const parts = [
      migrated ? `${migrated} migrated from older alert formats` : "",
      res.skipped ? `${res.skipped} skipped${res.errors?.[0] ? ` (${res.errors[0]})` : ""}` : "",
    ].filter(Boolean);
    toast.success(`Imported ${res.rules.length} rule${res.rules.length === 1 ? "" : "s"}`, {
      description: parts.join(" · ") || undefined,
    });
    setTab("rules");
  };

  const saveEdit = (r: AlertRule): string | null => {
    if (editing === "new") {
      alertStore.addRule({ ...r, id: newRuleId(), createdAt: Date.now() });
      toast.success("Rule added", { description: ruleTitle(r) });
      setEditing(null);
      setTab("rules");
      return null;
    }
    if (editing && typeof editing === "object") {
      const err = engine.updateRule(editing.id, { ...r, enabled: editing.enabled });
      if (err) return err;
      toast.success("Rule saved", { description: ruleTitle(r) });
      setEditing(null);
    }
    return null;
  };

  const selectedIds = [...selected].filter((id) => rules.some((r) => r.id === id));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        icon={BellRing}
        title="Alerts"
        description="Every alert in one place: price, IV, PCR, OI walls, max pain and gamma flip, option contracts, Premium Tide, the F&O ban list and your positions’ P&L and Greeks. Checked in this browser while the terminal is open."
        source={source}
        actions={
          <>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus aria-hidden="true" /> New rule
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" /> Import
            </Button>
            <Button size="sm" variant="outline" onClick={onExport} disabled={rules.length === 0}>
              <Download aria-hidden="true" /> Export
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => void onImport(e.target.files?.[0])}
            />
          </>
        }
      />

      <div className={cn(STAT_GROUP, "grid-cols-2 sm:grid-cols-4")}>
        <Stat
          label="Active rules"
          value={active}
          sub={rules.length > active ? `${rules.length - active} paused` : "None paused"}
        />
        <Stat label="Fired today" value={firedToday} sub="IST, test alerts excluded" />
        <Stat label="Channels on" value={`${channelsOn} of 4`} sub="In-app, browser, sound, webhook" />
        <Stat
          label="Feeds"
          value={feeds.length}
          sub={feeds.length ? feeds.map((f) => f.symbol).join(", ") : "Polled only when a rule needs them"}
        />
      </div>

      {allSample ? (
        <Alert className="border-warning/40">
          <AlertTitle>Sample data: no alert can fire</AlertTitle>
          <AlertDescription className="text-body-sm">
            The data proxy is offline, so the terminal shows clearly labelled sample chains. Sample data never triggers
            an alert. Your rules are saved and start checking as soon as live data returns. Use “Send a test alert” to
            check your channels now.
          </AlertDescription>
        </Alert>
      ) : null}
      {!engine.persisted && rules.length > 0 ? (
        <Alert className="border-warning/40">
          <AlertTitle>Rules are not being saved</AlertTitle>
          <AlertDescription className="text-body-sm">
            This browser is blocking site storage (private mode or full storage). Export your rules to keep them.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-4 sm:inline-flex sm:w-auto">
          <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="log">Log ({log.length})</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="ideas" className="gap-1">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Ideas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4 space-y-3">
          {rules.length === 0 ? (
            <div className="rounded-tile px-4 py-10 text-center">
              <BellRing className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="font-semibold">No alert rules yet</p>
              <p className="mx-auto mt-1 max-w-md text-body-sm text-muted-foreground">
                Create a rule, start from an idea, or import a file exported from this terminal (older chain and header
                alert files are migrated automatically).
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setEditing("new")}>
                  <Plus aria-hidden="true" /> New rule
                </Button>
                <Button size="sm" variant="outline" onClick={() => setTab("ideas")}>
                  <Lightbulb aria-hidden="true" /> Browse ideas
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search rules"
                    aria-label="Search rules"
                    className="h-9 pl-8"
                  />
                </div>
                <ToggleGroup
                  type="single"
                  value={category}
                  onValueChange={(v) => v && setCategory(v as CategoryFilter)}
                  className="flex-wrap justify-start"
                  aria-label="Filter by category"
                >
                  <ToggleGroupItem value="all" className="h-8 px-3 text-body-sm">
                    All
                  </ToggleGroupItem>
                  {(Object.keys(CATEGORY_LABEL) as RuleCategory[]).map((c) => (
                    <ToggleGroupItem key={c} value={c} className="h-8 px-3 text-body-sm">
                      {CATEGORY_LABEL[c]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {selectedIds.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-tile bg-control-track px-3 py-1.5"
                  role="region"
                  aria-label="Bulk actions"
                >
                  <span className="text-body-sm font-semibold">{selectedIds.length} selected</span>
                  <Button size="pill" variant="outline" onClick={() => setEnabled(selectedIds, false)}>
                    Pause
                  </Button>
                  <Button size="pill" variant="outline" onClick={() => setEnabled(selectedIds, true)}>
                    Resume
                  </Button>
                  <Button
                    size="pill"
                    variant="outline"
                    className="text-bearish"
                    onClick={() => deleteRules(selectedIds)}
                  >
                    Delete
                  </Button>
                  <Button size="pill" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">
                    Clear selection
                  </Button>
                </div>
              ) : null}

              {visible.length === 0 ? (
                <p className="rounded-tile px-4 py-6 text-center text-body-sm text-muted-foreground">
                  No rules match this filter.
                </p>
              ) : (
                <ul className={RULE_LIST} aria-label="Alert rules">
                  {visible.map((r) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      coverage={ruleCoverage(r, runtime, now, today)}
                      current={ruleCurrentValue(r, runtime)}
                      lastFired={engine.lastFired(r.id)}
                      fireCount={counts[r.id]}
                      selected={selected.has(r.id)}
                      onSelect={(on) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (on) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                      onToggle={() => engine.toggleRule(r.id)}
                      onEdit={() => setEditing(r)}
                      onDelete={() => deleteRules([r.id])}
                      onTest={() => engine.testFire(r)}
                      onSnooze={(min) => engine.snoozeRule(r.id, min === null ? undefined : Date.now() + min * 60_000)}
                    />
                  ))}
                </ul>
              )}
              <p className="text-micro normal-case tracking-normal text-muted-foreground">
                Rules run in this browser while the terminal is open (no server, nothing leaves your device except
                optional webhook posts). Option-contract rules on a non-nearest expiry are checked on the Option Chain
                page.
              </p>
            </>
          )}
        </TabsContent>

        <TabsContent value="log" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              value={logFilter}
              onValueChange={(v) => v && setLogFilter(v as LogFilter)}
              aria-label="Filter the log"
              className="justify-start"
            >
              <ToggleGroupItem value="all" className="h-8 px-3 text-body-sm">
                All
              </ToggleGroupItem>
              <ToggleGroupItem value="real" className="h-8 px-3 text-body-sm">
                Market alerts
              </ToggleGroupItem>
              <ToggleGroupItem value="test" className="h-8 px-3 text-body-sm">
                Tests
              </ToggleGroupItem>
            </ToggleGroup>
            <Button size="sm" variant="outline" onClick={() => engine.testFire()}>
              <FlaskConical aria-hidden="true" /> Test-fire
            </Button>
          </div>
          <TriggerLog log={visibleLog} detailed onClear={engine.clearLog} />
          <p className="text-micro normal-case tracking-normal text-muted-foreground">
            The last 200 alerts are kept on this device. Each entry stores the market snapshot the rule saw when it
            fired. Times are IST.
          </p>
        </TabsContent>

        <TabsContent value="channels" className="mt-4">
          <div className="max-w-2xl rounded-card border border-separator bg-card px-4 py-1">
            <ChannelsPanel engine={engine} />
          </div>
        </TabsContent>

        <TabsContent value="ideas" className="mt-4">
          <IdeasList engine={engine} columns={2} />
        </TabsContent>
      </Tabs>

      <p className="text-micro normal-case tracking-normal text-muted-foreground">
        Alerts are educational, not advice. Data for education and research. Not investment advice.
      </p>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing === "new" ? "New alert rule" : "Edit alert rule"}
            </DialogTitle>
            <DialogDescription className="text-body-sm">
              Checked against live data only. Editing a rule re-arms it from the next reading.
            </DialogDescription>
          </DialogHeader>
          {editing !== null ? (
            <RuleEditor
              key={editing === "new" ? "new" : editing.id}
              rule={editing === "new" ? undefined : editing}
              onSave={saveEdit}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
