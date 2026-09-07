import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { TableProperties, BarChart3, Star, Settings } from "lucide-react";

const actions = [
  {
    label: "Option Chain",
    icon: TableProperties,
    path: "/option-chain",
    desc: "NIFTY / BNIFTY chain",
  },
  {
    label: "OI Analysis",
    icon: BarChart3,
    path: "/oi-analysis",
    desc: "Call/Put OI trends",
  },
  {
    label: "Watchlist",
    icon: Star,
    path: "/watchlist",
    desc: "Track your scripts",
  },
  {
    label: "Broker API",
    icon: Settings,
    path: "/broker-settings",
    desc: "Connect your broker",
  },
];

export function QuickTradeActions() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map((a) => (
        <Card
          key={a.path}
          className="group min-h-[106px] cursor-pointer transition-all duration-200 hover:border-primary/20 hover:shadow-card-hover"
          onClick={() => navigate(a.path)}
        >
          <CardContent className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <div className="rounded-lg border border-border/70 bg-muted/30 p-2 text-primary transition-colors duration-200 group-hover:border-primary/25">
              <a.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold leading-tight">{a.label}</p>
              <p className="mt-1 hidden text-xs font-semibold uppercase leading-tight tracking-wider text-muted-foreground sm:block">
                {a.desc}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
