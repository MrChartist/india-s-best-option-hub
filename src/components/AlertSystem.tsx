import { useState, useCallback, useEffect, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Bell, Plus, Trash2, AlertTriangle, TrendingUp, BarChart3, Volume2, VolumeX, CheckCircle } from "lucide-react";
import { useAlertEngine, playAlertSound, type AlertCondition, type AlertTone } from "@/hooks/useAlertEngine";
import { useAllIndices, useLiveIndices } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
import { getAlerts, saveAlerts } from "@/lib/alertStore";
import { toast } from "sonner";

const typeIcons = {
  price: <TrendingUp className="h-3 w-3" />,
  oi_spike: <BarChart3 className="h-3 w-3" />,
  iv_spike: <AlertTriangle className="h-3 w-3" />,
  pcr: <BarChart3 className="h-3 w-3" />,
  vix: <AlertTriangle className="h-3 w-3" />,
};

const typeLabels: Record<string, string> = {
  price: "Price",
  oi_spike: "OI Spike",
  iv_spike: "IV Spike",
  pcr: "PCR",
  vix: "VIX",
};

interface AlertSystemProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlertSystem({ open, onOpenChange }: AlertSystemProps) {
  const [alerts, setAlerts] = useState<AlertCondition[]>(() => getAlerts());

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Persist to localStorage — alerts previously vanished on every reload since
  // this only ever lived in useState.
  useEffect(() => { saveAlerts(alerts); }, [alerts]);

  // Live data from hooks
  const { data: allIndicesData } = useAllIndices();
  const { data: indicesResult } = useLiveIndices();
  const { vix: wsVix } = useWebSocketVix();
  const liveVix = wsVix?.value ?? allIndicesData?.vix?.value ?? 0;

  // Per-symbol live spot, so a BANKNIFTY alert checks BANKNIFTY's own price —
  // this used to read a field (`indices`) useAllIndices() never returns, so
  // every "price" alert was permanently comparing against 0 and could never fire.
  const spotBySymbol = useMemo(() => {
    const map: Record<string, number> = {};
    for (const idx of indicesResult?.data ?? []) map[idx.symbol] = idx.ltp;
    return map;
  }, [indicesResult]);

  // Alert data from live market stats
  // VIX serves as IV proxy; PCR derived from VIX level heuristic when chain is unavailable
  const derivedPCR = liveVix > 0 ? (liveVix > 18 ? 0.7 : liveVix > 14 ? 1.0 : 1.3) : 0;
  const alertData = {
    spotBySymbol,
    vix: liveVix,
    pcr: derivedPCR,
    atmIV: liveVix, // VIX ≈ ATM IV for NIFTY
    maxOIChange: 0,
  };

  const handleTriggered = useCallback((alert: AlertCondition) => {
    // Persist the triggered flag locally — useAlertEngine only computes it internally
    // to decide when to fire this callback, it never writes it back to our state, so
    // without this the "TRIGGERED" badge in the list below could never actually render.
    setAlerts(prev => prev.map(a => (a.id === alert.id ? { ...a, triggered: true, triggeredAt: Date.now() } : a)));
    toast.warning(
      `🔔 ${alert.symbol} ${typeLabels[alert.type]} ${alert.condition} ${alert.value}`,
      { duration: 8000, description: `Alert triggered at ${new Date().toLocaleTimeString("en-IN")}` }
    );
  }, []);

  useAlertEngine(alerts, alertData, handleTriggered, soundEnabled);

  const addAlert = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const rawValueInput = fd.get("value");
    const rawValue = Number(rawValueInput);
    const newAlert: AlertCondition = {
      id: Date.now().toString(),
      symbol: fd.get("symbol") as string || "NIFTY",
      type: fd.get("type") as AlertCondition["type"] || "price",
      condition: fd.get("condition") as "above" | "below" || "above",
      // `|| 24500` would silently discard an intentionally entered 0 — only fall
      // back when the field is genuinely empty/missing or non-numeric.
      value: rawValueInput !== null && rawValueInput !== "" && Number.isFinite(rawValue) ? rawValue : 24500,
      active: true,
      triggered: false,
      tone: (fd.get("type") === "price" ? "bullish" : fd.get("type") === "vix" ? "warning" : "info") as AlertTone,
    };
    setAlerts([...alerts, newAlert]);
    setShowAdd(false);
  };

  const toggleAlert = (id: string) => {
    setAlerts(alerts.map(a => a.id === id ? { ...a, active: !a.active, triggered: false } : a));
  };

  const removeAlert = (id: string) => setAlerts(alerts.filter(a => a.id !== id));

  const testSound = () => {
    playAlertSound("info", 0.3);
    toast.info("🔊 Sound test played");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[340px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> Alerts
              <Badge variant="outline">{alerts.filter(a => a.active).length} active</Badge>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={testSound}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Test 🔊
              </button>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                {soundEnabled ? <Volume2 className="h-4 w-4 text-bullish" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {/* Alert List */}
          {alerts.map(alert => (
            <div
              key={alert.id}
              className={`flex items-center gap-2 p-2.5 rounded-md border transition-colors ${
                alert.triggered ? "bg-warning/10 border-warning/30" :
                alert.active ? "bg-card border-border" :
                "bg-muted/30 border-border/50 opacity-60"
              }`}
            >
              <div className="shrink-0">
                {alert.triggered ? (
                  <CheckCircle className="h-4 w-4 text-warning animate-pulse" />
                ) : (
                  typeIcons[alert.type]
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{alert.symbol}</span>
                  <Badge variant="outline" className="text-xs h-4 px-1">{typeLabels[alert.type]}</Badge>
                  {alert.triggered && <Badge className="text-xs h-4 px-1 bg-warning text-warning-foreground">TRIGGERED</Badge>}
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {alert.condition} {alert.value}
                </p>
              </div>
              <Switch
                checked={alert.active}
                onCheckedChange={() => toggleAlert(alert.id)}
                className="scale-75"
              />
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeAlert(alert.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {/* Add Alert */}
          {showAdd ? (
            <form onSubmit={addAlert} className="p-3 rounded-md border bg-accent/30 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Symbol</Label>
                  <Select name="symbol" defaultValue="NIFTY">
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select name="type" defaultValue="price">
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(typeLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Condition</Label>
                  <Select name="condition" defaultValue="above">
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Above</SelectItem>
                      <SelectItem value="below">Below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Value</Label>
                  <Input name="value" type="number" defaultValue={24500} className="h-7 text-xs font-mono" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-7 text-xs flex-1">Add Alert</Button>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} className="w-full h-8 text-xs gap-1">
              <Plus className="h-3 w-3" /> Add Alert
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
