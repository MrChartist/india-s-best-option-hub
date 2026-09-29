import { useMemo } from "react";
import { toast } from "sonner";
import { Database, KeyRound, Lock, Plug, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BrokerCard } from "@/components/settings/BrokerCard";
import { ConnectionStatus } from "@/components/settings/ConnectionStatus";
import { DatabaseManager } from "@/components/DatabaseManager";
import { ChartDataDownloader } from "@/components/ChartDataDownloader";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocketReconnect } from "@/hooks/useWebSocket";
import { resetProxyStatus } from "@/hooks/useMarketData";
import {
  BROKERS,
  clearAllBrokerCredentials,
  getBrokerInfo,
  isComplete,
  removeBrokerCredentials,
  saveBrokerCredentials,
  setActiveBroker,
  useBrokerConfig,
  type BrokerCredentials,
} from "@/lib/brokerConfig";

export default function BrokerSettings() {
  const { saved, active } = useBrokerConfig();
  const queryClient = useQueryClient();
  const reconnectWS = useWebSocketReconnect();

  // Keys changed → drop cached data and reconnect the live feed so the new keys take effect immediately
  const applyKeys = () => {
    resetProxyStatus();
    reconnectWS();
    void queryClient.invalidateQueries();
  };

  const handleSave = (creds: BrokerCredentials) => {
    saveBrokerCredentials(creds);
    applyKeys();
  };

  const handleRemove = (brokerId: string) => {
    removeBrokerCredentials(brokerId);
    applyKeys();
    toast(`${getBrokerInfo(brokerId)?.name} keys removed`);
  };

  const handleSetActive = (brokerId: string) => {
    setActiveBroker(brokerId);
    applyKeys();
    toast.success(`${getBrokerInfo(brokerId)?.name} is now the active broker`);
  };

  const handleClearAll = () => {
    if (!window.confirm("Remove every saved broker key from this browser?")) return;
    clearAllBrokerCredentials();
    applyKeys();
    toast("All keys removed from this browser");
  };

  // Connected brokers first, then the rest in catalogue order
  const ordered = useMemo(() => {
    const isSet = (id: string) => {
      const info = getBrokerInfo(id)!;
      return isComplete(info, saved.find((s) => s.brokerId === id));
    };
    return [...BROKERS].sort((a, b) => Number(isSet(b.id)) - Number(isSet(a.id)));
  }, [saved]);

  return (
    <div className="space-y-4 pb-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Brokers &amp; Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">Bring your own keys. Everything runs locally and nothing is shared.</p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">Your keys stay on your machine</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Keys live in this browser only and travel just to your own local proxy, then straight to your broker. Nothing is stored on a server.
              Use read-only / data-only tokens where your broker offers them. For a permanent setup, put Dhan keys in a local <code className="rounded bg-foreground/10 px-1">.env</code> file instead.
            </p>
          </div>
          {saved.length > 0 && (
            <Button variant="outline" size="sm" className="shrink-0 text-bearish" onClick={handleClearAll}>
              <Trash2 className="h-3.5 w-3.5" /> Remove all keys
            </Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="brokers">
        <TabsList>
          <TabsTrigger value="brokers" className="gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Brokers</TabsTrigger>
          <TabsTrigger value="status" className="gap-1.5"><Plug className="h-3.5 w-3.5" /> Status</TabsTrigger>
          <TabsTrigger value="local" className="gap-1.5"><Database className="h-3.5 w-3.5" /> Local data</TabsTrigger>
        </TabsList>

        <TabsContent value="brokers" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {ordered.map((broker) => (
              <BrokerCard
                key={broker.id}
                broker={broker}
                saved={saved.find((s) => s.brokerId === broker.id)}
                isActive={active?.brokerId === broker.id}
                onSave={handleSave}
                onRemove={handleRemove}
                onSetActive={handleSetActive}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          <ConnectionStatus />
        </TabsContent>

        <TabsContent value="local" className="mt-4 space-y-4">
          <DatabaseManager />
          <ChartDataDownloader />
        </TabsContent>
      </Tabs>
    </div>
  );
}
