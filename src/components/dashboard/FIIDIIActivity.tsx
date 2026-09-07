import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Landmark, Building2, Loader2 } from "lucide-react";
import { useFIIDII } from "@/hooks/useMarketData";

function ActivityCard({ label, icon, netValue, buyValue, sellValue }: { label: string; icon: React.ReactNode; netValue: number; buyValue: number; sellValue: number }) {
  const isNetBuy = netValue >= 0;
  return (
    <Card className="hover:shadow-card-hover transition-all duration-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{icon} {label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-center">
          <p className={`text-3xl font-semibold font-mono ${isNetBuy ? "text-bullish" : "text-bearish"}`}>
            {isNetBuy ? "+" : ""}₹{netValue.toFixed(0)} Cr
          </p>
          <p className={`text-xs font-semibold uppercase tracking-wider mt-1 ${isNetBuy ? "text-bullish" : "text-bearish"}`}>
            Net {isNetBuy ? "Buyers" : "Sellers"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2 rounded bg-accent/30 text-center">
            <p className="text-muted-foreground">Buy</p>
            <p className="font-mono font-semibold">₹{buyValue.toFixed(0)} Cr</p>
          </div>
          <div className="p-2 rounded bg-accent/30 text-center">
            <p className="text-muted-foreground">Sell</p>
            <p className="font-mono font-semibold">₹{sellValue.toFixed(0)} Cr</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Real NSE FII/DII cash-market activity — proxy's /api/nse-proxy?endpoint=fii-dii,
// already fully implemented (fetchFIIDII in marketApi.ts) but previously unused anywhere.
export function FIIDIIActivity() {
  const { data, isLoading } = useFIIDII();

  const fii = data?.find((d) => d.category.toUpperCase().includes("FII") || d.category.toUpperCase().includes("FPI"));
  const dii = data?.find((d) => d.category.toUpperCase().includes("DII"));

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading FII/DII activity...</p>
        </CardContent>
      </Card>
    );
  }

  if (!fii && !dii) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          FII/DII activity unavailable — published after market close each trading day.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {fii && <ActivityCard label={`FII/FPI · ${fii.date}`} icon={<Landmark className="h-5 w-5 text-primary" />} netValue={fii.netValue} buyValue={fii.buyValue} sellValue={fii.sellValue} />}
      {dii && <ActivityCard label={`DII · ${dii.date}`} icon={<Building2 className="h-5 w-5 text-primary" />} netValue={dii.netValue} buyValue={dii.buyValue} sellValue={dii.sellValue} />}
    </div>
  );
}
