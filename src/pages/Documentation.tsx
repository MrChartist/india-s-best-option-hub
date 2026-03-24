import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard, TableProperties, BarChart3, Calculator, Layers, TrendingUp,
  ScanSearch, Activity, Gauge, Users, Zap, Star, CandlestickChart, Atom,
  Crosshair, Briefcase, BookOpen, ChevronDown, ChevronRight, Target,
  Info, ArrowRight, Lightbulb,
} from "lucide-react";

interface FeatureDoc {
  id: string;
  title: string;
  icon: React.ElementType;
  path: string;
  category: "core" | "analysis" | "tools" | "data";
  difficulty: "beginner" | "intermediate" | "advanced";
  description: string;
  whatItDoes: string[];
  howToUse: string[];
  proTips: string[];
  keyTerms?: { term: string; definition: string }[];
}

const features: FeatureDoc[] = [
  {
    id: "dashboard",
    title: "Market Dashboard",
    icon: LayoutDashboard,
    path: "/",
    category: "core",
    difficulty: "beginner",
    description: "Your home base — a real-time overview of the Indian derivatives market with all critical metrics at a glance.",
    whatItDoes: [
      "Shows live prices of NIFTY, BANKNIFTY, FINNIFTY & MIDCPNIFTY with intraday sparklines",
      "Displays key metrics: PCR ratio, India VIX, Advance/Decline, FII/DII activity",
      "Expected Move widgets show the probable price range by expiry based on implied volatility",
      "IV Rank cards tell you if current volatility is historically high or low",
      "GIFT Nifty tracker shows pre-market direction before NSE opens",
      "Sector heatmap visualizes which sectors are gaining/losing",
      "Most Active F&O table with OI buildup/unwinding signals",
    ],
    howToUse: [
      "Check the ticker tape at the top for a quick pulse of all indices",
      "Use Quick Actions to jump to any tool — Option Chain, OI Analysis, Scanner, etc.",
      "Click any index card to go directly to its option chain",
      "Monitor the Expected Move widget to set straddle/strangle strikes",
      "Watch FII/DII numbers — institutional flow drives medium-term trends",
    ],
    proTips: [
      "PCR > 1.2 with rising Nifty = strong bullish confirmation",
      "VIX spike + market fall = potential bottom forming (look for short straddles)",
      "If GIFT Nifty shows a 100+ point gap, expect gap-up/down opening — plan accordingly",
    ],
    keyTerms: [
      { term: "PCR", definition: "Put-Call Ratio — ratio of put OI to call OI. Above 1 = more puts (bullish), below 0.7 = more calls (bearish)" },
      { term: "VIX", definition: "Volatility Index — measures market fear. Higher VIX = larger expected moves" },
      { term: "FII/DII", definition: "Foreign & Domestic Institutional Investors — their net buy/sell shows smart money flow" },
    ],
  },
  {
    id: "option-chain",
    title: "Option Chain",
    icon: TableProperties,
    path: "/option-chain",
    category: "core",
    difficulty: "beginner",
    description: "The full NSE option chain with real-time OI, volume, IV, and Greeks for any underlying and expiry.",
    whatItDoes: [
      "Displays complete call and put data for every strike price",
      "Highlights ATM (At The Money) strike automatically",
      "Shows Open Interest, Volume, IV, LTP, Change, and Greeks for each strike",
      "Flags unusual activity with 🔥 fire icons when volume > 3x average OI",
      "Color-codes ITM (In The Money) and OTM (Out of The Money) sections",
    ],
    howToUse: [
      "Select your underlying (NIFTY, BANKNIFTY, etc.) from the dropdown",
      "Choose the expiry date — weekly or monthly",
      "Look at the ATM strike (highlighted) for straddle/strangle pricing",
      "Check OI at different strikes to find support/resistance levels",
      "Watch for 🔥 fire icons — these indicate unusual activity worth investigating",
    ],
    proTips: [
      "High call OI at a strike = resistance, High put OI = support",
      "If both call & put OI are high at the same strike, expect a range-bound market",
      "Sudden OI buildup with price movement confirms the trend",
    ],
    keyTerms: [
      { term: "OI (Open Interest)", definition: "Total number of outstanding contracts. Rising OI = new positions, falling OI = positions closing" },
      { term: "IV (Implied Volatility)", definition: "Market's expectation of future volatility. Higher IV = more expensive options" },
      { term: "ATM", definition: "At The Money — the strike closest to the current spot price" },
    ],
  },
  {
    id: "oi-analysis",
    title: "OI Analysis",
    icon: BarChart3,
    path: "/oi-analysis",
    category: "analysis",
    difficulty: "intermediate",
    description: "Deep-dive into Open Interest patterns — call/put OI distribution, PCR trends, max pain, and OI buildup signals.",
    whatItDoes: [
      "Bar chart comparing Call OI vs Put OI at each strike",
      "PCR ratio chart showing trend over time",
      "Max Pain calculator — the strike where option sellers profit most",
      "Change in OI analysis revealing buildup and unwinding",
      "Top OI gainers/losers table for quick scanning",
    ],
    howToUse: [
      "Start with the OI bar chart — the tallest bars show key support/resistance",
      "Check Max Pain — price tends to gravitate here near expiry",
      "Monitor PCR trend — rising PCR = bullish, falling = bearish",
      "Look at Change in OI to see where new positions are being built today",
    ],
    proTips: [
      "Max Pain is most reliable in the last 2 days before expiry",
      "Divergence between PCR and price often signals a reversal",
      "A sudden spike in put OI at a lower strike can act as a strong support",
    ],
    keyTerms: [
      { term: "Max Pain", definition: "The strike price where maximum option buyers (both calls & puts) lose money. Price tends to settle here at expiry." },
    ],
  },
  {
    id: "gex",
    title: "Gamma Exposure (GEX)",
    icon: Atom,
    path: "/gex",
    category: "analysis",
    difficulty: "advanced",
    description: "Visualizes dealer gamma exposure to predict potential pin points and volatility zones.",
    whatItDoes: [
      "Shows net gamma exposure across all strikes",
      "Identifies positive gamma (price magnet) and negative gamma (volatility) zones",
      "Calculates GEX flip point where dealer hedging behavior changes",
      "Displays key levels: call wall, put wall, and zero gamma",
    ],
    howToUse: [
      "Green bars = positive gamma (price gets 'pinned' here)",
      "Red bars = negative gamma (expect bigger moves)",
      "The GEX flip point is critical — above it market is calm, below it gets volatile",
      "Use the call/put wall levels as intraday support and resistance",
    ],
    proTips: [
      "When spot is near the highest gamma strike, expect low volatility (good for selling options)",
      "When spot crosses below the GEX flip, expect fast moves — tighten stops",
      "Combine GEX with Max Pain for high-probability expiry predictions",
    ],
  },
  {
    id: "skew",
    title: "Skew Dashboard",
    icon: TrendingUp,
    path: "/skew",
    category: "analysis",
    difficulty: "advanced",
    description: "Analyzes put/call IV skew, term structure (contango vs backwardation), and skew percentile rankings.",
    whatItDoes: [
      "IV Smile chart showing how IV varies across strikes",
      "Put-Call skew measurement at each strike",
      "Term Structure showing IV across different expiries",
      "Contango/Backwardation detection for timing trades",
      "Skew Percentile rankings across multiple symbols with Z-scores",
    ],
    howToUse: [
      "Check the IV Smile — steep skew means puts are expensive relative to calls",
      "Term Structure in contango (front < back) = normal. Backwardation = fear/event ahead",
      "Use percentile rankings to find symbols where skew is unusually rich or cheap",
    ],
    proTips: [
      "Sell puts when put skew is at 90th percentile — they're relatively overpriced",
      "Backwardation often occurs before events (earnings, elections) — trade the event",
      "Compare skew across similar stocks to find relative value trades",
    ],
  },
  {
    id: "straddle",
    title: "Straddle Charts",
    icon: Activity,
    path: "/straddle",
    category: "tools",
    difficulty: "intermediate",
    description: "Real-time and historical ATM straddle price charts for NIFTY and BANKNIFTY.",
    whatItDoes: [
      "Charts the combined premium of ATM call + put over time",
      "Shows straddle decay curve approaching expiry",
      "Compares current straddle value vs expected move",
    ],
    howToUse: [
      "Monitor straddle prices during the day — they should decay (theta)",
      "If straddle increases despite time passing, expect a big move",
      "Compare current straddle with expected move to find overpriced/underpriced options",
    ],
    proTips: [
      "Sell straddles when VIX is above 20 and market is range-bound",
      "A straddle that doesn't decay by afternoon = trend day incoming",
    ],
  },
  {
    id: "volatility",
    title: "IV Surface & VRP",
    icon: Gauge,
    path: "/volatility",
    category: "analysis",
    difficulty: "advanced",
    description: "3D volatility surface, Volatility Risk Premium analysis (IV vs Realized Vol), and Greeks heatmap.",
    whatItDoes: [
      "3D IV surface showing IV across strikes and expiries simultaneously",
      "VRP chart comparing Implied Volatility vs Realized Volatility over 90 days",
      "Greeks Heatmap showing Delta/Gamma/Theta/Vega across all strikes",
    ],
    howToUse: [
      "VRP Analysis: When IV >> RV consistently, sell premium strategies work well",
      "Greeks Heatmap: Toggle between Greeks and Call/Put to find optimal strike selection",
      "Look for IV Surface anomalies — unusually high IV at specific strikes = event risk",
    ],
    proTips: [
      "IV > RV 70% of the time = structural seller's edge exists",
      "Gamma peaks at ATM and near expiry — manage risk carefully",
      "Theta is highest at ATM with 1-2 weeks to expiry — ideal for sellers",
    ],
  },
  {
    id: "scanner",
    title: "Options Scanner",
    icon: ScanSearch,
    path: "/scanner",
    category: "tools",
    difficulty: "intermediate",
    description: "Scans all F&O stocks to find unusual activity, high IV, and trading opportunities.",
    whatItDoes: [
      "Filters stocks by IV rank, volume spikes, OI buildup, and price change",
      "Highlights unusual options activity across the entire F&O universe",
      "Provides sortable, filterable tables with actionable signals",
    ],
    howToUse: [
      "Filter by IV Rank > 70 to find candidates for selling strategies",
      "Filter by volume spikes to catch unusual activity early",
      "Click any result to jump to its option chain for further analysis",
    ],
    proTips: [
      "Combine high IV rank + low volume = potential mean reversion trade",
      "Multiple unusual activity alerts on the same stock = something is brewing",
    ],
  },
  {
    id: "strategy",
    title: "Strategy Builder",
    icon: Layers,
    path: "/strategy",
    category: "tools",
    difficulty: "intermediate",
    description: "Build multi-leg option strategies with payoff diagrams, breakeven analysis, and Greeks summary.",
    whatItDoes: [
      "Preset strategies: Straddle, Strangle, Iron Condor, Butterfly, Spreads",
      "Custom multi-leg builder with up to 4 legs",
      "Interactive payoff diagram showing P&L at expiry",
      "Breakeven points, max profit, max loss calculations",
      "Combined Greeks for the entire position",
    ],
    howToUse: [
      "Start with a preset strategy or build custom legs",
      "Adjust strikes and lots to see the payoff change in real-time",
      "Check breakeven points relative to expected move",
      "Verify that max loss is within your risk tolerance",
    ],
    proTips: [
      "Always check max loss before entering — never risk more than 2% of capital",
      "Iron Condors work best in high VIX + range-bound markets",
      "Use the expected move widget on the dashboard to set your short strikes",
    ],
  },
  {
    id: "greeks",
    title: "Greeks Calculator",
    icon: Calculator,
    path: "/greeks",
    category: "tools",
    difficulty: "intermediate",
    description: "Black-Scholes model calculator for computing option Greeks with interactive sliders.",
    whatItDoes: [
      "Calculates Delta, Gamma, Theta, Vega, and Rho",
      "Interactive sliders for spot price, strike, IV, time to expiry",
      "Real-time updates as you change any input",
    ],
    howToUse: [
      "Input the current spot price, strike, IV, and days to expiry",
      "Adjust sliders to see how Greeks change — this is your 'what-if' analysis",
      "Delta tells you directional exposure, Theta your daily decay",
    ],
    proTips: [
      "Delta ≈ probability of finishing ITM (roughly)",
      "Theta accelerates exponentially in the last week — be aware",
      "Vega is highest for ATM long-dated options — useful for vol bets",
    ],
    keyTerms: [
      { term: "Delta", definition: "Rate of change of option price per ₹1 move in underlying. Also ≈ probability of finishing ITM." },
      { term: "Gamma", definition: "Rate of change of Delta. Highest at ATM, near expiry. Measures how fast your hedge changes." },
      { term: "Theta", definition: "Time decay — how much premium you lose per day, all else equal." },
      { term: "Vega", definition: "Sensitivity to IV changes. ₹ change in option price per 1% change in IV." },
    ],
  },
  {
    id: "fii-dii",
    title: "FII/DII Activity",
    icon: Users,
    path: "/fii-dii",
    category: "data",
    difficulty: "beginner",
    description: "Track Foreign and Domestic Institutional Investor flows in cash and F&O segments.",
    whatItDoes: [
      "Daily and historical FII/DII cash market data",
      "F&O segment flows (index + stock futures & options)",
      "Net buying/selling trends with charts",
    ],
    howToUse: [
      "Check daily net flow — consistent FII buying = bullish for medium term",
      "Watch for divergence — FII selling but DII buying = tug of war",
      "Monthly trends matter more than daily fluctuations",
    ],
    proTips: [
      "FII sells > ₹3000 Cr in a day = potential short-term bottom if DII absorbs",
      "End-of-month FII activity is often related to derivative rollovers, not conviction",
    ],
  },
  {
    id: "watchlist",
    title: "Watchlist",
    icon: Star,
    path: "/watchlist",
    category: "core",
    difficulty: "beginner",
    description: "Create and manage custom watchlists to track your favorite F&O stocks.",
    whatItDoes: [
      "Add/remove symbols to personal watchlists",
      "Quick view of prices, changes, and key data",
      "One-click access to option chain of any watchlist stock",
    ],
    howToUse: [
      "Add your actively traded symbols to the watchlist",
      "Monitor them in one view instead of switching between pages",
      "Click any symbol to drill down into its option chain",
    ],
    proTips: [
      "Keep separate watchlists for different strategies (e.g., momentum vs. theta plays)",
    ],
  },
  {
    id: "positions",
    title: "Position Tracker",
    icon: Briefcase,
    path: "/positions",
    category: "tools",
    difficulty: "intermediate",
    description: "Track your open option positions with real-time P&L, Greeks, and risk metrics.",
    whatItDoes: [
      "Log entry/exit prices for multi-leg positions",
      "Real-time unrealized P&L calculation",
      "Position-level Greeks aggregation",
    ],
    howToUse: [
      "Add your open positions with entry details",
      "Monitor combined P&L and Greeks in real-time",
      "Use the payoff chart to visualize your risk at expiry",
    ],
    proTips: [
      "Always set a stop-loss mentally — cut losers at 50% of premium paid",
      "Roll positions 3-5 days before expiry if theta is eating your profits",
    ],
  },
];

const categoryLabels: Record<string, { label: string; color: string }> = {
  core: { label: "Core", color: "bg-primary/15 text-primary border-primary/30" },
  analysis: { label: "Analysis", color: "bg-bullish/15 text-bullish border-bullish/30" },
  tools: { label: "Tools", color: "bg-warning/15 text-warning border-warning/30" },
  data: { label: "Data", color: "bg-secondary text-secondary-foreground border-border" },
};

const difficultyLabels: Record<string, { label: string; color: string }> = {
  beginner: { label: "Beginner", color: "bg-bullish/10 text-bullish" },
  intermediate: { label: "Intermediate", color: "bg-warning/10 text-warning" },
  advanced: { label: "Advanced", color: "bg-bearish/10 text-bearish" },
};

export default function Documentation() {
  const [expandedId, setExpandedId] = useState<string | null>("dashboard");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const filtered = filterCategory === "all"
    ? features
    : features.filter((f) => f.category === filterCategory);

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Feature Documentation
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Everything you need to know about OptionsDesk — from basics to pro-level techniques
          </p>
        </div>
      </div>

      {/* Quick Start */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-card">
        <CardContent className="py-4 px-5">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Lightbulb className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold mb-1">Quick Start Guide</h3>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Start on the <strong>Dashboard</strong> — check market pulse, VIX, and PCR ratio</li>
                <li>Open the <strong>Option Chain</strong> — find your underlying, choose expiry, spot ATM strike</li>
                <li>Check <strong>OI Analysis</strong> — identify support/resistance via OI clusters and Max Pain</li>
                <li>Use the <strong>Strategy Builder</strong> — select a strategy, set strikes, verify max loss</li>
                <li>Monitor with <strong>Straddle Charts</strong> and <strong>GEX</strong> — watch for breakouts or pin-action</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {["all", "core", "analysis", "tools", "data"].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
              filterCategory === cat
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:border-primary/30"
            }`}
          >
            {cat === "all" ? "All Features" : categoryLabels[cat]?.label || cat}
            <span className="ml-1 opacity-60">
              ({cat === "all" ? features.length : features.filter((f) => f.category === cat).length})
            </span>
          </button>
        ))}
      </div>

      {/* Feature Cards */}
      <div className="space-y-2">
        {filtered.map((feature) => {
          const isExpanded = expandedId === feature.id;
          const catStyle = categoryLabels[feature.category];
          const diffStyle = difficultyLabels[feature.difficulty];

          return (
            <Card
              key={feature.id}
              className={`transition-all ${isExpanded ? "border-primary/30 shadow-sm" : "hover:border-primary/20"}`}
            >
              <button
                className="w-full text-left"
                onClick={() => setExpandedId(isExpanded ? null : feature.id)}
              >
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <feature.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-sm">{feature.title}</CardTitle>
                        <Badge variant="outline" className={`text-[9px] h-4 ${catStyle.color}`}>{catStyle.label}</Badge>
                        <Badge variant="outline" className={`text-[9px] h-4 ${diffStyle.color}`}>{diffStyle.label}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{feature.description}</p>
                    </div>
                    <div className="shrink-0 text-muted-foreground">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {isExpanded && (
                <CardContent className="px-4 pb-4 pt-0">
                  <Separator className="mb-3" />
                  <div className="grid md:grid-cols-2 gap-4">
                    {/* What It Does */}
                    <div>
                      <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-2">
                        <Info className="h-3 w-3 text-primary" /> What It Does
                      </h4>
                      <ul className="space-y-1">
                        {feature.whatItDoes.map((item, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                            <span className="text-primary mt-0.5">•</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* How to Use */}
                    <div>
                      <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5 mb-2">
                        <ArrowRight className="h-3 w-3 text-bullish" /> How to Use
                      </h4>
                      <ol className="space-y-1">
                        {feature.howToUse.map((item, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                            <span className="text-bullish font-mono text-[10px] mt-0.5">{i + 1}.</span>
                            {item}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>

                  {/* Pro Tips */}
                  <div className="mt-3 p-2.5 rounded-lg bg-warning/5 border border-warning/15">
                    <h4 className="text-xs font-semibold text-warning flex items-center gap-1.5 mb-1.5">
                      <Lightbulb className="h-3 w-3" /> Pro Tips
                    </h4>
                    <ul className="space-y-1">
                      {feature.proTips.map((tip, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-warning">💡</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Key Terms */}
                  {feature.keyTerms && feature.keyTerms.length > 0 && (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold text-foreground mb-2">Key Terms</h4>
                      <div className="grid sm:grid-cols-2 gap-2">
                        {feature.keyTerms.map((kt) => (
                          <div key={kt.term} className="p-2 rounded-md bg-accent/50 border border-border">
                            <span className="text-[11px] font-semibold text-foreground">{kt.term}</span>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{kt.definition}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Navigate Link */}
                  <div className="mt-3 flex items-center gap-2">
                    <a
                      href={feature.path}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      Open {feature.title} <ArrowRight className="h-3 w-3" />
                    </a>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
