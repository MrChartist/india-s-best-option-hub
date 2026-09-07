import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardSkeleton } from "@/components/LoadingSkeletons";

// Route-based code splitting for optimal initial load
const Index = lazy(() => import("./pages/Index"));
const OptionChain = lazy(() => import("./pages/OptionChain"));
const OIAnalysisLayout = lazy(() => import("./pages/oi-analysis/OIAnalysisLayout"));
const OIOverview = lazy(() => import("./pages/oi-analysis/OIOverview"));
const OITrendingOI = lazy(() => import("./pages/oi-analysis/OITrendingOI"));
const OIStrikeAnalysis = lazy(() => import("./pages/oi-analysis/OIStrikeAnalysis"));
const OIDeltaTracker = lazy(() => import("./pages/oi-analysis/OIDeltaTracker"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Scanner = lazy(() => import("./pages/Scanner"));
const StrategyBuilder = lazy(() => import("./pages/StrategyBuilder"));
const PositionTracker = lazy(() => import("./pages/PositionTracker"));
const Orders = lazy(() => import("./pages/Orders"));
const OneCliqTerminal = lazy(() => import("./features/one-cliq/OneCliqTerminal"));
const BrokerSettings = lazy(() => import("./pages/BrokerSettings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

function PageSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <ErrorBoundary fallbackMessage="This page encountered an error. Try refreshing.">
        {children}
      </ErrorBoundary>
    </Suspense>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<PageSuspense><Index /></PageSuspense>} />
            <Route path="/option-chain" element={<PageSuspense><OptionChain /></PageSuspense>} />
            <Route path="/oi-analysis" element={<PageSuspense><OIAnalysisLayout /></PageSuspense>}>
              <Route index element={<OIOverview />} />
              <Route path="trending-oi" element={<OITrendingOI />} />
              <Route path="strike-analysis" element={<OIStrikeAnalysis />} />
              <Route path="delta-tracker" element={<OIDeltaTracker />} />
            </Route>
            <Route path="/watchlist" element={<PageSuspense><Watchlist /></PageSuspense>} />
            <Route path="/scanner" element={<PageSuspense><Scanner /></PageSuspense>} />
            <Route path="/strategy-builder" element={<PageSuspense><StrategyBuilder /></PageSuspense>} />
            <Route path="/position-tracker" element={<PageSuspense><PositionTracker /></PageSuspense>} />
            <Route path="/orders" element={<PageSuspense><Orders /></PageSuspense>} />
            <Route path="/one-cliq" element={<PageSuspense><OneCliqTerminal /></PageSuspense>} />
            <Route path="/broker-settings" element={<PageSuspense><BrokerSettings /></PageSuspense>} />
            <Route path="*" element={<PageSuspense><NotFound /></PageSuspense>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

