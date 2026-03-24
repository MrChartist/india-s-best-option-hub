import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { marketStats } from "@/lib/mockData";
import { TrendingUp, Users, Zap, Activity, BarChart3 } from "lucide-react";

export function KeyMetrics() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      <MetricCard
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        label="Nifty PCR"
        value={String(marketStats.niftyPCR)}
        valueColor={marketStats.niftyPCR > 1 ? "text-bullish" : "text-bearish"}
        sub={`BNF: ${marketStats.bankNiftyPCR}`}
      />
      <MetricCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label="India VIX"
        value={String(marketStats.indiaVix)}
        sub={`${marketStats.vixChange > 0 ? "+" : ""}${marketStats.vixChange.toFixed(2)}%`}
        subColor={marketStats.vixChange < 0 ? "text-bullish" : "text-bearish"}
      />
      <MetricCard
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Adv / Dec"
        value={`${marketStats.advanceDecline.advances} / ${marketStats.advanceDecline.declines}`}
        valueColor={marketStats.advanceDecline.advances > marketStats.advanceDecline.declines ? "text-bullish" : "text-bearish"}
        progress={(marketStats.advanceDecline.advances / (marketStats.advanceDecline.advances + marketStats.advanceDecline.declines)) * 100}
      />
      <MetricCard
        icon={<Users className="h-3.5 w-3.5" />}
        label="FII Net (₹Cr)"
        value={`${marketStats.fiiData.net >= 0 ? "+" : ""}${marketStats.fiiData.net.toFixed(0)}`}
        valueColor={marketStats.fiiData.net >= 0 ? "text-bullish" : "text-bearish"}
      />
      <MetricCard
        icon={<Users className="h-3.5 w-3.5" />}
        label="DII Net (₹Cr)"
        value={`${marketStats.diiData.net >= 0 ? "+" : ""}${marketStats.diiData.net.toFixed(0)}`}
        valueColor={marketStats.diiData.net >= 0 ? "text-bullish" : "text-bearish"}
      />
      <MetricCard
        icon={<Zap className="h-3.5 w-3.5" />}
        label="F&O Turnover"
        value={`₹${(marketStats.totalFnOTurnover / 1000).toFixed(1)}K Cr`}
      />
    </div>
  );
}

function MetricCard({ icon, label, value, valueColor, sub, subColor, progress }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
  subColor?: string;
  progress?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
          {icon}
          <p className="text-[10px] font-medium">{label}</p>
        </div>
        <p className={`text-base font-bold font-mono ${valueColor || "text-foreground"}`}>{value}</p>
        {progress !== undefined && <Progress value={progress} className="h-1 mt-1.5" />}
        {sub && <p className={`text-[10px] font-mono mt-0.5 ${subColor || "text-muted-foreground"}`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}
