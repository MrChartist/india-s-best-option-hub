import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Bell, Plus, Trash2, AlertTriangle, TrendingUp, BarChart3 } from "lucide-react";

export interface Alert {
  id: string;
  symbol: string;
  type: "price" | "oi_spike" | "iv_spike" | "pcr";
  condition: "above" | "below";
  value: number;
  active: boolean;
}

const typeIcons = {
  price: <TrendingUp className="h-3 w-3" />,
  oi_spike: <BarChart3 className="h-3 w-3" />,
  iv_spike: <AlertTriangle className="h-3 w-3" />,
  pcr: <BarChart3 className="h-3 w-3" />,
};

const typeLabels = {
  price: "Price",
  oi_spike: "OI Spike",
  iv_spike: "IV Spike",
  pcr: "PCR",
};

interface AlertSystemProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlertSystem({ open, onOpenChange }: AlertSystemProps) {
  const [alerts, setAlerts] = useState<Alert[]>([
    { id: "1", symbol: "NIFTY", type: "price", condition: "above", value: 24500, active: true },
    { id: "2", symbol: "BANKNIFTY", type: "oi_spike", condition: "above", value: 500000, active: true },
    { id: "3", symbol: "NIFTY", type: "iv_spike", condition: "above", value: 18, active: false },
  ]);

  const [newAlert, setNewAlert] = useState<Partial<Alert>>({
    symbol: "NIFTY",
    type: "price",
    condition: "above",
    value: 24500,
  });

  const addAlert = () => {
    if (!newAlert.symbol || !newAlert.value) return;
    setAlerts([...alerts, {
      ...newAlert as Alert,
      id: Date.now().toString(),
      active: true,
    }]);
  };

  const removeAlert = (id: string) => setAlerts(alerts.filter(a => a.id !== id));
  const toggleAlert = (id: string) => setAlerts(alerts.map(a => a.id === id ? { ...a, active: !a.active } : a));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[380px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Bell className="h-4 w-4" /> Price & OI Alerts
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Add new alert */}
          <div className="p-3 rounded-lg border bg-accent/30 space-y-2">
            <p className="text-xs font-medium">New Alert</p>
            <div className="grid grid-cols-2 gap-2">
              <Select value={newAlert.symbol} onValueChange={v => setNewAlert({ ...newAlert, symbol: v })}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NIFTY", "BANKNIFTY", "FINNIFTY"].map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={newAlert.type} onValueChange={v => setNewAlert({ ...newAlert, type: v as Alert["type"] })}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="price">Price</SelectItem>
                  <SelectItem value="oi_spike">OI Spike</SelectItem>
                  <SelectItem value="iv_spike">IV Spike</SelectItem>
                  <SelectItem value="pcr">PCR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={newAlert.condition} onValueChange={v => setNewAlert({ ...newAlert, condition: v as "above" | "below" })}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Above</SelectItem>
                  <SelectItem value="below">Below</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={newAlert.value}
                onChange={e => setNewAlert({ ...newAlert, value: Number(e.target.value) })}
                className="h-7 text-[10px] font-mono"
              />
            </div>
            <Button size="sm" className="w-full h-7 text-xs" onClick={addAlert}>
              <Plus className="h-3 w-3 mr-1" /> Add Alert
            </Button>
          </div>

          {/* Active alerts */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Active Alerts ({alerts.filter(a => a.active).length})</p>
            {alerts.map(alert => (
              <div
                key={alert.id}
                className={`flex items-center justify-between p-2.5 rounded-lg border ${alert.active ? "bg-card" : "bg-muted/50 opacity-60"}`}
              >
                <div className="flex items-center gap-2">
                  {typeIcons[alert.type]}
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{alert.symbol}</span>
                      <Badge variant="outline" className="text-[8px] h-3.5 px-1">{typeLabels[alert.type]}</Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {alert.condition === "above" ? "≥" : "≤"} {alert.value.toLocaleString("en-IN")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => toggleAlert(alert.id)}>
                    <Bell className={`h-3 w-3 ${alert.active ? "text-primary" : "text-muted-foreground"}`} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeAlert(alert.id)}>
                    <Trash2 className="h-3 w-3 text-bearish" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
