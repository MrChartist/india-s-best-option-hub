import { useState, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Bell, Plus, Trash2, AlertTriangle, TrendingUp, BarChart3, Volume2, VolumeX, CheckCircle } from "lucide-react";
import { useAlertEngine, playAlertSound, type AlertCondition, type AlertTone } from "@/hooks/useAlertEngine";
import { useAllIndices } from "@/hooks/useMarketData";
import { useWebSocketVix } from "@/hooks/useWebSocket";
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
  const [alerts, setAlerts] = useState<AlertCondition[]>([
    { id: "1", symbol: "NIFTY", type: "price", condition: "above", value: 24500, active: true, triggered: false, tone: "bullish" },
    { id: "2", symbol: "NIFTY", type: "price", condition: "below", value: 24000, active: true, triggered: false, tone: "bearish" },
    { id: "3", symbol: "NIFTY", type: "vix", condition: "above", value: 18, active: true, triggered: false, tone: "warning" },
    { id: "4", symbol: "NIFTY", type: "pcr", condition: "above", value: 1.3, active: false, triggered: false, tone: "info" },
  ]);

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Live data from hooks
  const { data: allIndicesData } = useAllIndices();
  const { vix: wsVix } = useWebSocketVix();
  const liveVix = wsVix?.value ?? allIndicesData?.vix?.value ?? 0;

  // Alert data from live market stats
  const alertData = {
    spotPrice: 24250,
    vix: liveVix,
    pcr: 0.95,
    atmIV: 14.5,
    maxOIChange: 500000,
  };

  const handleTriggered = useCallback((alert: AlertCondition) => {
    toast.warning(
      `🔔 ${alert.symbol} ${typeLabels[alert.type]} ${alert.condition} ${alert.value}`,
      { duration: 8000, description: `Alert triggered at ${new Date().toLocaleTimeString("en-IN")}` }
    );
  }, []);

  useAlertEngine(alerts, alertData, handleTriggered, soundEnabled);

  const addAlert = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const newAlert: AlertCondition = {
      id: Date.now().toString(),
      symbol: fd.get("symbol") as string || "NIFTY",
      type: fd.get("type") as AlertCondition["type"] || "price",
      condition: fd.get("condition") as "above" | "below" || "above",
      value: Number(fd.get("value")) || 24500,
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
              <Badge variant="outline" className="text-[9px]">{alerts.filter(a => a.active).length} active</Badge>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={testSound}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
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
                  <Badge variant="outline" className="text-[8px] h-3.5 px-1">{typeLabels[alert.type]}</Badge>
                  {alert.triggered && <Badge className="text-[8px] h-3.5 px-1 bg-warning text-warning-foreground">TRIGGERED</Badge>}
                </div>
                <p className="text-[10px] text-muted-foreground font-mono">
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
                  <Label className="text-[9px]">Symbol</Label>
                  <Select name="symbol" defaultValue="NIFTY">
                    <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[9px]">Type</Label>
                  <Select name="type" defaultValue="price">
                    <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
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
                  <Label className="text-[9px]">Condition</Label>
                  <Select name="condition" defaultValue="above">
                    <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above">Above</SelectItem>
                      <SelectItem value="below">Below</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[9px]">Value</Label>
                  <Input name="value" type="number" defaultValue={24500} className="h-7 text-[10px] font-mono" />
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
