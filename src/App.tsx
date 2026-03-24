import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import Index from "./pages/Index";
import OptionChain from "./pages/OptionChain";
import OIAnalysis from "./pages/OIAnalysis";
import GreeksCalculator from "./pages/GreeksCalculator";
import StrategyBuilder from "./pages/StrategyBuilder";
import StrategyFinder from "./pages/StrategyFinder";
import OptionsScanner from "./pages/OptionsScanner";
import PositionTracker from "./pages/PositionTracker";
import PriceCharts from "./pages/PriceCharts";
import StraddleCharts from "./pages/StraddleCharts";
import VolatilitySurface from "./pages/VolatilitySurface";
import FIIDIIActivity from "./pages/FIIDIIActivity";
import OISpurts from "./pages/OISpurts";
import GammaExposure from "./pages/GammaExposure";
import SkewDashboard from "./pages/SkewDashboard";
import Watchlist from "./pages/Watchlist";
import Documentation from "./pages/Documentation";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/option-chain" element={<OptionChain />} />
            <Route path="/oi-analysis" element={<OIAnalysis />} />
            <Route path="/greeks" element={<GreeksCalculator />} />
            <Route path="/strategy" element={<StrategyBuilder />} />
            <Route path="/strategy-finder" element={<StrategyFinder />} />
            <Route path="/scanner" element={<OptionsScanner />} />
            <Route path="/positions" element={<PositionTracker />} />
            <Route path="/charts" element={<PriceCharts />} />
            <Route path="/straddle" element={<StraddleCharts />} />
            <Route path="/volatility" element={<VolatilitySurface />} />
            <Route path="/fii-dii" element={<FIIDIIActivity />} />
            <Route path="/oi-spurts" element={<OISpurts />} />
            <Route path="/gex" element={<GammaExposure />} />
            <Route path="/skew" element={<SkewDashboard />} />
            <Route path="/watchlist" element={<Watchlist />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
