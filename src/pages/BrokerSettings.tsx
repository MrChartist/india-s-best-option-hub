import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  BROKERS,
  getSavedBrokers,
  saveBrokerCredentials,
  removeBrokerCredentials,
  setActiveBroker,
  getActiveBroker,
  type BrokerInfo,
  type BrokerCredentials,
} from "@/lib/brokerConfig";
import { testDhanConnection } from "@/lib/marketApi";
import { useProxyHealth } from "@/hooks/useMarketData";
import { useWebSocketStatus } from "@/hooks/useWebSocket";
import {
  Shield, ExternalLink, Trash2, CheckCircle2, Circle, Eye, EyeOff, Info, Key, Plug, AlertTriangle,
  Server, Zap, Globe, BarChart3, Loader2, CheckCircle, XCircle, Wifi,
} from "lucide-react";
import { DatabaseManager } from "@/components/DatabaseManager";

function BrokerCard({
  broker,
  saved,
  isActive,
  onSave,
  onRemove,
  onSetActive,
}: {
  broker: BrokerInfo;
  saved?: BrokerCredentials;
  isActive: boolean;
  onSave: (brokerId: string, values: Record<string, string>) => void;
  onRemove: (brokerId: string) => void;
  onSetActive: (brokerId: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(saved?.values || {});
  const [showFields, setShowFields] = useState<Record<string, boolean>>({});
  const [isEditing, setIsEditing] = useState(!saved);

  const handleSave = () => {
    const missing = broker.fields.filter((f) => f.required && !values[f.key]?.trim());
    if (missing.length > 0) {
      toast.error(`Please fill: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    onSave(broker.id, values);
    setIsEditing(false);
  };

  return (
    <Card className={`transition-all duration-200 ${isActive ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{broker.logo}</span>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                {broker.name}
                {saved && (
                  <Badge variant={isActive ? "default" : "secondary"} className="text-2xs">
                    {isActive ? "Active" : "Connected"}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{broker.description}</CardDescription>
            </div>
          </div>
          <a href={broker.docsUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {broker.features.map((f) => (
            <Badge key={f} variant="outline" className="text-2xs font-normal">
              {f}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {isEditing ? (
          <>
            {broker.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-destructive">*</span>}
                </Label>
                <div className="relative">
                  <Input
                    type={field.type === "password" && !showFields[field.key] ? "password" : "text"}
                    placeholder={field.placeholder}
                    value={values[field.key] || ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="text-sm pr-9"
                  />
                  {field.type === "password" && (
                    <button
                      type="button"
                      onClick={() => setShowFields({ ...showFields, [field.key]: !showFields[field.key] })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showFields[field.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-2xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3 shrink-0" />
                    {field.helpText}
                  </p>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button size="sm" onClick={handleSave} className="flex-1">
                <Key className="h-3.5 w-3.5 mr-1.5" />
                Save Keys
              </Button>
              {saved && (
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>{broker.fields.filter((f) => f.required).length} keys configured</span>
              <span className="text-2xs">• Added {new Date(saved!.addedAt).toLocaleDateString("en-IN")}</span>
            </div>
            <div className="flex gap-2">
              {!isActive && (
                <Button size="sm" variant="outline" onClick={() => onSetActive(broker.id)} className="flex-1">
                  <Circle className="h-3.5 w-3.5 mr-1.5" />
                  Set Active
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onRemove(broker.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionStatusPanel() {
  const { data: health } = useProxyHealth();
  const wsConnected = useWebSocketStatus();
  const [dhanStatus, setDhanStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [dhanMessage, setDhanMessage] = useState("");

  const handleTestDhan = async () => {
    setDhanStatus("testing");
    try {
      const result = await testDhanConnection();
      if (result.status === "success") {
        setDhanStatus("success");
        setDhanMessage("Connected successfully");
        toast.success("Dhan API connection verified!");
      } else {
        setDhanStatus("error");
        setDhanMessage(result.message || "Connection failed");
        toast.error("Dhan connection failed: " + result.message);
      }
    } catch (e: any) {
      setDhanStatus("error");
      setDhanMessage(e.message || "Network error");
      toast.error("Connection test failed");
    }
  };

  const sources = [
    {
      name: "Dhan API (Primary)",
      icon: <Wifi className="h-4 w-4" />,
      status: dhanStatus === "success" ? "online" : dhanStatus === "error" ? "offline" : health?.sources?.dhan ? "online" : "unknown",
      detail: dhanStatus === "success"
        ? "Primary source · Option Chain, Greeks, WebSocket"
        : health?.sources?.dhan
        ? "Credentials loaded from .env · Option Chain, Expiry, WebSocket"
        : dhanMessage || "Click Test to verify — provides Option Chain, Greeks, Live Ticks",
      color: dhanStatus === "success" || health?.sources?.dhan ? "text-emerald-500" : dhanStatus === "error" ? "text-red-500" : "text-zinc-500",
    },
    {
      name: "Dhan WebSocket",
      icon: <Zap className="h-4 w-4" />,
      status: wsConnected ? "online" : "offline",
      detail: wsConnected
        ? `Live ticks · ${health?.websocket?.cachedTicks || 0} cached, ${health?.websocket?.instrumentsSubscribed || 0} instruments`
        : "Requires Dhan credentials · Real-time index + VIX ticks",
      color: wsConnected ? "text-emerald-500" : "text-zinc-500",
    },
    {
      name: "NSE India (Fallback)",
      icon: <Globe className="h-4 w-4" />,
      status: health?.reachable ? "online" : "offline",
      detail: "Fallback · Indices, Sectors, A/D, Option Chain if Dhan fails",
      color: health?.reachable ? "text-emerald-500" : "text-red-500",
    },
    {
      name: "TradingView Scanner",
      icon: <BarChart3 className="h-4 w-4" />,
      status: "online",
      detail: "No auth needed · 100+ F&O stocks LTP, Volume, Sectors",
      color: "text-emerald-500",
    },
    {
      name: "Proxy Server",
      icon: <Server className="h-4 w-4" />,
      status: health?.reachable ? "online" : "offline",
      detail: health?.reachable ? `Uptime: ${Math.floor((health.uptime || 0) / 60)}min · Routes all API traffic` : "Not reachable — run: npm run dev",
      color: health?.reachable ? "text-emerald-500" : "text-red-500",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          Connection Status
          <Badge variant="outline" className="text-2xs ml-auto">
            {sources.filter(s => s.status === "online").length}/{sources.length} Online
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">Real-time status of all data sources</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {sources.map((src) => (
          <div key={src.name} className="flex items-center gap-3 p-2 rounded-md bg-accent/20">
            <div className={src.color}>{src.icon}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{src.name}</span>
                <div className={`h-1.5 w-1.5 rounded-full ${
                  src.status === "online" ? "bg-emerald-500" :
                  src.status === "offline" ? "bg-red-500" : "bg-zinc-500"
                }`} />
              </div>
              <p className="text-[10px] text-muted-foreground truncate">{src.detail}</p>
            </div>
            {src.name.startsWith("Dhan API") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleTestDhan}
                disabled={dhanStatus === "testing"}
              >
                {dhanStatus === "testing" ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Testing</>
                ) : dhanStatus === "success" ? (
                  <><CheckCircle className="h-3 w-3 text-emerald-500" /> Connected</>
                ) : dhanStatus === "error" ? (
                  <><XCircle className="h-3 w-3 text-red-500" /> Retry</>
                ) : (
                  <>Test</>
                )}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function BrokerSettings() {
  const [savedBrokers, setSavedBrokers] = useState(getSavedBrokers());
  const activeBroker = getActiveBroker();

  const handleSave = (brokerId: string, values: Record<string, string>) => {
    const creds: BrokerCredentials = {
      brokerId,
      values,
      addedAt: new Date().toISOString(),
      isActive: savedBrokers.length === 0, // first broker is auto-active
    };
    saveBrokerCredentials(creds);
    setSavedBrokers(getSavedBrokers());
    toast.success(`${BROKERS.find((b) => b.id === brokerId)?.name} keys saved securely`);
  };

  const handleRemove = (brokerId: string) => {
    removeBrokerCredentials(brokerId);
    setSavedBrokers(getSavedBrokers());
    toast.info("Broker keys removed");
  };

  const handleSetActive = (brokerId: string) => {
    setActiveBroker(brokerId);
    setSavedBrokers(getSavedBrokers());
    toast.success(`${BROKERS.find((b) => b.id === brokerId)?.name} is now active`);
  };

  const connectedIds = savedBrokers.map((b) => b.brokerId);
  const availableBrokers = BROKERS.filter((b) => !connectedIds.includes(b.id));
  const connectedBrokers = BROKERS.filter((b) => connectedIds.includes(b.id));

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Plug className="h-6 w-6 text-primary" />
          Broker API Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your broker accounts for live market data and trading. Keys are stored locally in your browser.
        </p>
      </div>

      {/* Security Notice */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">Security Notice</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              API keys are stored in your browser's localStorage and are <strong>never sent to our servers</strong>.
              They are passed directly to your broker's API through a secure proxy. For maximum security, use
              read-only API tokens when available.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connection Status Panel */}
      <ConnectionStatusPanel />

      {/* Database Manager */}
      <DatabaseManager />

      <Tabs defaultValue={connectedBrokers.length > 0 ? "connected" : "available"}>
        <TabsList>
          <TabsTrigger value="connected" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" />
            Connected ({connectedBrokers.length})
          </TabsTrigger>
          <TabsTrigger value="available" className="gap-1.5">
            <Plug className="h-3.5 w-3.5" />
            Available ({availableBrokers.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connected" className="mt-4">
          {connectedBrokers.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Key className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No brokers connected yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Switch to "Available" tab to add your first broker</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {connectedBrokers.map((broker) => (
                <BrokerCard
                  key={broker.id}
                  broker={broker}
                  saved={savedBrokers.find((s) => s.brokerId === broker.id)}
                  isActive={activeBroker?.brokerId === broker.id}
                  onSave={handleSave}
                  onRemove={handleRemove}
                  onSetActive={handleSetActive}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="available" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {availableBrokers.map((broker) => (
              <BrokerCard
                key={broker.id}
                broker={broker}
                isActive={false}
                onSave={handleSave}
                onRemove={handleRemove}
                onSetActive={handleSetActive}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* How It Works */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { step: "1", title: "Get API Keys", desc: "Sign up for API access on your broker's developer portal" },
              { step: "2", title: "Enter Credentials", desc: "Paste your Client ID, API Key, and Access Token above" },
              { step: "3", title: "Live Data Flows", desc: "Option chain, LTP, Greeks, and OI update in real-time" },
            ].map((s) => (
              <div key={s.step} className="flex gap-3">
                <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                  {s.step}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
