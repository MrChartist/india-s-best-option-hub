import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell, BellRing, Plus, Trash2, Volume2, VolumeX, RotateCcw, Repeat, CircleDot, Activity,
  TrendingUp, Percent, Gauge, Scale, Waves, History, BellOff, Check,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  alertStore, countArmed, describeAlert, distanceToTrigger, formatMetricValue, metricKey, METRIC_META,
  OPERATOR_LABEL, useAlertMetrics, useAlertState, VIX_SYMBOL, toneFor,
  type AlertMetric, type AlertMode, type AlertOperator, type PriceAlert,
} from "@/lib/alerts";
import { notificationsSupported, playAlertSound, requestDesktopNotifications } from "@/hooks/useAlertEngine";
import { useFnOStocks } from "@/hooks/useMarketData";

const DEFAULT_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"];

const METRIC_ICON: Record<AlertMetric, typeof TrendingUp> = {
  price: TrendingUp,
  change_pct: Percent,
  vix: Gauge,
  pcr: Scale,
  atm_iv: Waves,
};

const TONE_CLASS = {
  bullish: "bg-bullish/15 text-bullish",
  bearish: "bg-bearish/15 text-bearish",
  warning: "bg-warning/15 text-warning",
  info: "bg-primary/15 text-primary",
} as const;

const QUICK_PCT = [-1, -0.5, 0.5, 1];

interface AlertSystemProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function AlertRow({ alert, current }: { alert: PriceAlert; current?: number }) {
  const Icon = METRIC_ICON[alert.metric];
  const tone = toneFor(alert);
  const dist = current !== undefined ? distanceToTrigger(alert, current) : null;
  const finished = !alert.active && alert.mode === "once" && alert.triggerCount > 0;

  return (
    <div
      className={cn(
        "glass-control flex items-center gap-3 rounded-2xl p-3 transition-opacity",
        !alert.active && "opacity-60",
      )}
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[tone])}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug">{describeAlert(alert)}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {current !== undefined ? (
            <span className="num font-mono text-foreground/80">Now {formatMetricValue(alert.metric, current)}</span>
          ) : (
            <span>Waiting for live data</span>
          )}
          {dist !== null && alert.active && (
            <span className={cn("num font-mono", dist <= 0 ? "text-bullish" : "text-muted-foreground")}>
              {dist <= 0 ? "level met" : `${dist.toFixed(2)}% away`}
            </span>
          )}
          {alert.mode === "repeat" && (
            <span className="inline-flex items-center gap-0.5"><Repeat className="h-3 w-3" />repeat</span>
          )}
          {alert.triggerCount > 0 && (
            <span className="text-warning">
              fired {alert.triggerCount}× · {alert.lastTriggeredAt ? timeAgo(alert.lastTriggeredAt) : ""}
            </span>
          )}
        </div>
        {alert.note && <p className="mt-1 truncate text-xs italic text-muted-foreground">{alert.note}</p>}
      </div>

      {finished ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Re-arm alert"
          onClick={() => alertStore.rearm(alert.id)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      ) : (
        <Switch
          checked={alert.active}
          onCheckedChange={(v) => alertStore.update(alert.id, { active: v })}
          aria-label={alert.active ? "Pause alert" : "Resume alert"}
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-bearish"
        aria-label="Delete alert"
        onClick={() => alertStore.remove(alert.id)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AddAlertForm({ onDone }: { onDone: () => void }) {
  const metrics = useAlertMetrics();
  const { data: fno } = useFnOStocks();
  const symbols = useMemo(
    () => [...DEFAULT_SYMBOLS, ...(fno?.allStocks?.map((s) => s.symbol) ?? [])],
    [fno],
  );

  const [symbol, setSymbol] = useState("NIFTY");
  const [metric, setMetric] = useState<AlertMetric>("price");
  const [operator, setOperator] = useState<AlertOperator>("crosses_above");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<AlertMode>("once");
  const [note, setNote] = useState("");

  const meta = METRIC_META[metric];
  const effectiveSymbol = metric === "vix" ? VIX_SYMBOL : symbol.trim().toUpperCase();
  const current = metrics[metricKey(effectiveSymbol, metric)];

  const applyPct = (pct: number) => {
    if (current === undefined) return;
    const target = metric === "change_pct" ? pct : current * (1 + pct / 100);
    setValue(target.toFixed(meta.decimals));
    setOperator(pct > 0 ? "crosses_above" : "crosses_below");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(value);
    if (!value.trim() || !Number.isFinite(num)) {
      toast.error("Enter a valid trigger value");
      return;
    }
    if (meta.needsSymbol && !effectiveSymbol) {
      toast.error("Enter a symbol");
      return;
    }
    alertStore.add({
      symbol: effectiveSymbol,
      metric,
      operator,
      value: num,
      mode,
      sound: true,
      note: note.trim() || undefined,
    });
    toast.success("Alert armed", { description: describeAlert({ symbol: effectiveSymbol, metric, operator, value: num }) });
    onDone();
  };

  return (
    <form onSubmit={submit} className="glass-control space-y-3 rounded-2xl p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Alert on</Label>
          <Select value={metric} onValueChange={(v) => setMetric(v as AlertMetric)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(METRIC_META) as AlertMetric[]).map((m) => (
                <SelectItem key={m} value={m}>{METRIC_META[m].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alert-symbol" className="text-xs text-muted-foreground">Symbol</Label>
          <Input
            id="alert-symbol"
            list="alert-symbols"
            value={metric === "vix" ? "INDIA VIX" : symbol}
            disabled={metric === "vix"}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="h-9 font-mono uppercase"
            autoComplete="off"
          />
          <datalist id="alert-symbols">
            {symbols.map((s) => <option key={s} value={s} />)}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Condition</Label>
          <Select value={operator} onValueChange={(v) => setOperator(v as AlertOperator)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(OPERATOR_LABEL) as AlertOperator[]).map((o) => (
                <SelectItem key={o} value={o}>{OPERATOR_LABEL[o]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alert-value" className="text-xs text-muted-foreground">
            Value{meta.unit && ` (${meta.unit})`}
          </Label>
          <Input
            id="alert-value"
            type="number"
            step="any"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={current !== undefined ? current.toFixed(meta.decimals) : "0.00"}
            className="h-9 font-mono num"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">
          {current !== undefined ? (
            <>Now <span className="num font-mono text-foreground">{formatMetricValue(metric, current)}</span></>
          ) : (
            "No live reading yet"
          )}
        </span>
        {current !== undefined &&
          QUICK_PCT.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPct(p)}
              className={cn(
                "num rounded-full px-2.5 py-1 font-mono text-xs font-medium transition-colors",
                p > 0 ? "bg-bullish/15 text-bullish hover:bg-bullish/25" : "bg-bearish/15 text-bearish hover:bg-bearish/25",
              )}
            >
              {p > 0 ? "+" : ""}{p}%
            </button>
          ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Frequency</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as AlertMode)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="once">Only once</SelectItem>
              <SelectItem value="repeat">Every time (1 min gap)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="alert-note" className="text-xs text-muted-foreground">Note (optional)</Label>
          <Input id="alert-note" value={note} onChange={(e) => setNote(e.target.value)} className="h-9" maxLength={80} placeholder="e.g. trim short straddle" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="submit" className="flex-1"><Check className="h-4 w-4" /> Arm alert</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export function AlertSystem({ open, onOpenChange }: AlertSystemProps) {
  const { alerts, history, prefs } = useAlertState();
  const metrics = useAlertMetrics();
  const [showAdd, setShowAdd] = useState(false);
  const armed = countArmed(alerts);

  const toggleDesktop = async () => {
    if (prefs.browserNotify) {
      alertStore.setPrefs({ browserNotify: false });
      return;
    }
    if (!notificationsSupported()) {
      toast.error("This browser does not support desktop notifications");
      return;
    }
    const ok = await requestDesktopNotifications();
    alertStore.setPrefs({ browserNotify: ok });
    if (!ok) toast.error("Notifications are blocked — allow them in your browser's site settings");
  };

  const toggleSound = () => {
    const next = !prefs.sound;
    alertStore.setPrefs({ sound: next });
    if (next) playAlertSound("info");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="space-y-3 p-5 pb-3 pr-14">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <BellRing className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="leading-tight">Alerts</SheetTitle>
              <SheetDescription className="text-xs">
                {armed} armed · runs while this tab is open
              </SheetDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={toggleSound}>
              {prefs.sound ? <Volume2 className="h-3.5 w-3.5 text-bullish" /> : <VolumeX className="h-3.5 w-3.5" />}
              Sound {prefs.sound ? "on" : "off"}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={toggleDesktop}>
              {prefs.browserNotify ? <Bell className="h-3.5 w-3.5 text-bullish" /> : <BellOff className="h-3.5 w-3.5" />}
              Desktop {prefs.browserNotify ? "on" : "off"}
            </Button>
          </div>
        </SheetHeader>

        <Tabs defaultValue="active" className="flex min-h-0 flex-1 flex-col px-5 pb-5">
          <TabsList className="w-full">
            <TabsTrigger value="active" className="flex-1 gap-1.5"><CircleDot className="h-3.5 w-3.5" />Alerts ({alerts.length})</TabsTrigger>
            <TabsTrigger value="history" className="flex-1 gap-1.5"><History className="h-3.5 w-3.5" />History ({history.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-3 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            {showAdd ? (
              <AddAlertForm onDone={() => setShowAdd(false)} />
            ) : (
              <Button className="w-full" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4" /> New alert
              </Button>
            )}

            {alerts.length === 0 && !showAdd && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Activity className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No alerts yet</p>
                <p className="max-w-[16rem] text-xs text-muted-foreground/80">
                  Get pinged when NIFTY crosses a level, VIX spikes, or PCR flips — so you don't have to watch the screen.
                </p>
              </div>
            )}

            {alerts.map((a) => (
              <AlertRow key={a.id} alert={a} current={metrics[metricKey(a.symbol, a.metric)]} />
            ))}
          </TabsContent>

          <TabsContent value="history" className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Triggered alerts will show up here</p>
            ) : (
              <>
                {history.map((h) => (
                  <div key={h.id} className="glass-control flex items-start gap-3 rounded-2xl p-3">
                    <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[toneFor(h)])}>
                      <BellRing className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight">{describeAlert(h)}</p>
                      <p className="num mt-1 font-mono text-xs text-muted-foreground">
                        Hit at {formatMetricValue(h.metric, h.actual)} ·{" "}
                        {new Date(h.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                      {h.note && <p className="mt-1 text-xs italic text-muted-foreground">{h.note}</p>}
                    </div>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => alertStore.clearHistory()}>
                  <Trash2 className="h-3.5 w-3.5" /> Clear history
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
