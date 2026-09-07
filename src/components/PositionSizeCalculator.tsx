import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calculator, AlertTriangle } from "lucide-react";

const STORAGE_KEY = "optionsdesk_risk_settings";

interface RiskSettings {
  capital: number;
  riskPercent: number;
}

function loadSettings(): RiskSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed.capital) && Number.isFinite(parsed.riskPercent)) return parsed;
    }
  } catch { /* ignore */ }
  return { capital: 500000, riskPercent: 2 };
}

interface Props {
  maxLoss: number;
  maxLossUnlimited: boolean;
}

// Answers the question every trader should ask BEFORE placing a trade: "does
// this position's worst case fit my risk budget?" Deliberately does not
// auto-suggest a lot count — legs in a multi-leg strategy can carry different
// lot multipliers, so "risk per lot" isn't a single well-defined number here.
export function PositionSizeCalculator({ maxLoss, maxLossUnlimited }: Props) {
  const [settings, setSettings] = useState<RiskSettings>(() => loadSettings());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const maxAcceptableLoss = (settings.capital * settings.riskPercent) / 100;
  const withinBudget = !maxLossUnlimited && maxLoss <= maxAcceptableLoss;
  const lossPercentOfCapital = settings.capital > 0 ? (maxLoss / settings.capital) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" /> Position Size Check
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Trading Capital (₹)</Label>
            <Input
              type="number"
              value={settings.capital || ""}
              onChange={(e) => setSettings((s) => ({ ...s, capital: Number(e.target.value) || 0 }))}
              className="h-8 text-xs font-mono mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Risk per Trade (%)</Label>
            <Input
              type="number"
              step="0.5"
              value={settings.riskPercent || ""}
              onChange={(e) => setSettings((s) => ({ ...s, riskPercent: Number(e.target.value) || 0 }))}
              className="h-8 text-xs font-mono mt-1"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="p-2.5 rounded-md bg-accent/30 text-center">
            <p className="text-xs text-muted-foreground">Max Acceptable Loss</p>
            <p className="text-sm font-semibold font-mono">₹{maxAcceptableLoss.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          </div>
          <div className="p-2.5 rounded-md bg-accent/30 text-center">
            <p className="text-xs text-muted-foreground">This Strategy's Max Loss</p>
            <p className="text-sm font-semibold font-mono">
              {maxLossUnlimited ? "Unlimited" : `₹${maxLoss.toLocaleString("en-IN")}`}
            </p>
          </div>
        </div>

        {maxLossUnlimited ? (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-bearish/10 border border-bearish/20 text-bearish text-xs">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Unlimited-loss strategy — position sizing by max-loss doesn't apply. Size this by margin and worst-case scenario instead.
          </div>
        ) : (
          <div className={`flex items-center justify-between p-2.5 rounded-md border text-xs ${withinBudget ? "bg-bullish/10 border-bullish/20 text-bullish" : "bg-bearish/10 border-bearish/20 text-bearish"}`}>
            <span>{withinBudget ? "Within your risk budget" : "Exceeds your risk budget"}</span>
            <Badge variant="outline" className={withinBudget ? "border-bullish/40 text-bullish" : "border-bearish/40 text-bearish"}>
              {lossPercentOfCapital.toFixed(2)}% of capital
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
