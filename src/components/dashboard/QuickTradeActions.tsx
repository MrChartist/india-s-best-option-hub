import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TableProperties, BarChart3, Layers, ScanSearch, Activity, Atom, TrendingUp } from "lucide-react";

const actions = [
  { label: "Option Chain", icon: TableProperties, path: "/option-chain", desc: "NIFTY / BNIFTY chain", accent: "bg-primary/10 text-primary border-primary/20" },
  { label: "OI Analysis", icon: BarChart3, path: "/oi-analysis", desc: "Call/Put OI trends", accent: "bg-bullish/10 text-bullish border-bullish/20" },
  { label: "Strategy Builder", icon: Layers, path: "/strategy", desc: "Build & backtest", accent: "bg-accent text-accent-foreground border-border" },
  { label: "Scanner", icon: ScanSearch, path: "/scanner", desc: "Find opportunities", accent: "bg-warning/10 text-warning border-warning/20" },
  { label: "Straddle", icon: Activity, path: "/straddle", desc: "ATM straddle charts", accent: "bg-bearish/10 text-bearish border-bearish/20" },
  { label: "GEX", icon: Atom, path: "/gex", desc: "Gamma exposure", accent: "bg-primary/10 text-primary border-primary/20" },
  { label: "Skew", icon: TrendingUp, path: "/skew", desc: "IV skew dashboard", accent: "bg-bullish/10 text-bullish border-bullish/20" },
];

export function QuickTradeActions() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {actions.map((a) => (
        <Card
          key={a.path}
          className={`cursor-pointer border transition-all hover:scale-[1.02] hover:shadow-md ${a.accent}`}
          onClick={() => navigate(a.path)}
        >
          <CardContent className="p-3 flex flex-col items-center text-center gap-1.5">
            <a.icon className="h-5 w-5" />
            <p className="text-xs font-semibold leading-tight">{a.label}</p>
            <p className="text-[9px] text-muted-foreground leading-tight hidden sm:block">{a.desc}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
