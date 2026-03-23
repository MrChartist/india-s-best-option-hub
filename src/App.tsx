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
import OptionsScanner from "./pages/OptionsScanner";
import PositionTracker from "./pages/PositionTracker";
import PriceCharts from "./pages/PriceCharts";
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
            <Route path="/scanner" element={<OptionsScanner />} />
            <Route path="/positions" element={<PositionTracker />} />
            <Route path="/charts" element={<PriceCharts />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
