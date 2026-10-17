import { Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import DashboardLayout from "@/components/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { LEGACY_REDIRECTS, ROUTES } from "@/lib/routes";

// Route-based code splitting: one lazy chunk per page, built from the route registry
// (src/lib/routes.ts) so App, the sidebar and the command palette stay in sync.
const PAGES: { path: string; Component: LazyExoticComponent<ComponentType> }[] = ROUTES.map((r) => ({
  path: r.path,
  Component: lazyWithRetry(r.lazy),
}));

const NotFound = lazyWithRetry(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000, gcTime: 600_000 } },
});

/** Redirect an old path to its new home, keeping ?query and #hash (e.g. /chain?symbol=TCS). */
function LegacyRedirect({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}

/**
 * Route-level loading state: a neutral header bar plus one content block. It does not imitate any
 * particular page (each page renders its own specific skeleton once its chunk has loaded).
 */
function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 animate-in fade-in duration-300" role="status" aria-busy="true" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-[60vh] w-full rounded-lg" />
    </div>
  );
}

function PageSuspense({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary
      fallbackMessage="This page encountered an error. Try refreshing."
      resetKeys={[location.pathname]}
    >
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<DashboardLayout />}>
            {PAGES.map(({ path, Component }) => (
              <Route
                key={path}
                path={path}
                element={
                  <PageSuspense>
                    <Component />
                  </PageSuspense>
                }
              />
            ))}
            {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
              <Route key={from} path={from} element={<LegacyRedirect to={to} />} />
            ))}
            <Route
              path="*"
              element={
                <PageSuspense>
                  <NotFound />
                </PageSuspense>
              }
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
