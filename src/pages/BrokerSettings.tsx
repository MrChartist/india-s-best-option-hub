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
import {
  Shield, ExternalLink, Trash2, CheckCircle2, Circle, Eye, EyeOff, Info, Key, Plug, AlertTriangle,
} from "lucide-react";

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
