import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, Zap, TrendingUp, ArrowRight } from "lucide-react";

export function WelcomeBanner() {
  const navigate = useNavigate();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-card to-card overflow-hidden">
      <CardContent className="py-4 px-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {greeting}, Trader!
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Your F&O command center — track indices, analyze OI, scan for opportunities, and build strategies. All in one place.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="gap-1.5 text-xs h-8"
              onClick={() => navigate("/option-chain")}
            >
              <Zap className="h-3.5 w-3.5" />
              Start Trading
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
