import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TableProperties, BarChart3, Star, Settings } from "lucide-react";

const actions = [
  { label: "Option Chain", icon: TableProperties, path: "/option-chain", desc: "NIFTY / BNIFTY chain", accent: "bg-primary/10 text-primary border-primary/20" },
  { label: "OI Analysis", icon: BarChart3, path: "/oi-analysis", desc: "Call/Put OI trends", accent: "bg-bullish/10 text-bullish border-bullish/20" },
  { label: "Watchlist", icon: Star, path: "/watchlist", desc: "Track your scripts", accent: "bg-warning/10 text-warning border-warning/20" },
  { label: "Broker API", icon: Settings, path: "/broker-settings", desc: "Connect your broker", accent: "bg-accent text-accent-foreground border-border" },
];

export function QuickTradeActions() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {actions.map((a) => (
        <Card
          key={a.path}
          className={`cursor-pointer border transition-all duration-300 hover:scale-[1.02] hover:shadow-card-hover ${a.accent}`}
          onClick={() => navigate(a.path)}
        >
          <CardContent className="p-4 flex flex-col items-center text-center gap-2">
            <a.icon className="h-6 w-6 drop-shadow-md" />
            <p className="text-base font-bold leading-tight drop-shadow-sm">{a.label}</p>
            <p className="text-xs text-muted-foreground leading-tight hidden sm:block font-medium">{a.desc}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
