import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Zap, TrendingUp, ArrowRight, BarChart2 } from "lucide-react";

export function WelcomeBanner() {
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <Card className="relative overflow-hidden border-primary/25 bg-[linear-gradient(115deg,hsl(var(--primary)/0.12)_0%,hsl(var(--card))_36%,hsl(var(--card))_100%)] shadow-glow-sm">
      <div className="absolute inset-y-0 right-0 hidden w-1/3 border-l border-primary/10 bg-[linear-gradient(135deg,transparent_0%,hsl(var(--primary)/0.08)_100%)] sm:block" />
      <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 text-primary/10 pointer-events-none lg:block">
        <BarChart2 size={150} strokeWidth={1.4} />
      </div>

      <CardContent className="relative z-10 px-5 py-5 sm:px-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[22px] font-bold leading-tight text-foreground sm:text-2xl">
              <TrendingUp className="h-6 w-6 text-primary" />
              {greeting}, Trader
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground whitespace-pre-line">
              {`'''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''

              find erros andlets solve this`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Button
              size="default"
              className="gap-2 font-semibold shadow-glow-sm transition-all hover:shadow-glow"
              onClick={() => navigate("/option-chain")}
            >
              <Zap className="h-4 w-4" />
              Start Trading
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
