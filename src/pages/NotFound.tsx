import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";
import { MrChartistMark } from "@/components/brand/MrChartistLogo";
import { routeIcon } from "@/lib/routeIcons";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { log } from "@/lib/log";
import { findRoute, LEGACY_REDIRECTS, normalizePathname, ROUTES, suggestRoutes, type RouteDef } from "@/lib/routes";

const POPULAR_PATHS = ["/", "/option-chain", "/strategy-builder"];

/** One disclosure row of the suggestions group box (System Settings style). */
function RouteLink({ route, primary }: { route: RouteDef; primary?: boolean }) {
  const Icon = routeIcon(route.icon);
  return (
    <li>
      <Link
        to={route.path}
        className="group flex min-h-[44px] items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-control-track focus-visible:shadow-[inset_0_0_0_3px_hsl(var(--primary)/0.5)] focus-visible:outline-none"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-primary text-primary-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-headline text-foreground">{route.title}</span>
            {primary ? <span className="shrink-0 rounded-chip bg-wash-brand px-1.5 text-micro font-semibold text-primary-ink">Best match</span> : null}
          </span>
          {route.description && <span className="block truncate text-body-sm text-muted-foreground">{route.description}</span>}
        </span>
        <span className="hidden font-mono text-body-sm text-muted-foreground-subtle sm:inline">{route.path}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground-subtle" aria-hidden />
      </Link>
    </li>
  );
}

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  useDocumentTitle("Page not found");

  const path = normalizePathname(location.pathname);
  const suggestions = useMemo(() => suggestRoutes(location.pathname, { limit: 3 }), [location.pathname]);
  const fallback = useMemo(
    () => POPULAR_PATHS.map((p) => findRoute(p)).filter((r): r is RouteDef => Boolean(r)),
    [],
  );
  const best = suggestions[0];
  const hasLegacy = Boolean(LEGACY_REDIRECTS[path]);
  // history.length counts entries from other sites too. React Router's browser history stores its own
  // index in history.state.idx, which is 0 for the first in-app entry (direct load or external link).
  const canGoBack = typeof window !== "undefined" && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;

  useEffect(() => {
    log.info("404: no route for path", { path: location.pathname, suggestion: best?.path ?? null });
  }, [location.pathname, best]);

  const list = suggestions.length > 0 ? suggestions : fallback;

  return (
    // Rendered inside DashboardLayout's <main id="main">, so this is a plain block.
    <div className="flex min-h-[60svh] items-center justify-center px-1 py-8 text-foreground sm:py-12">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tile border border-separator bg-card text-foreground shadow-card">
            <MrChartistMark size={24} title="Mr. Chartist" />
          </span>
          <p className="text-body font-medium text-muted-foreground">Error 404 · Option Hub</p>
        </div>

        <h1 className="font-display text-display text-foreground">Page not found</h1>
        <p className="mt-2 text-body leading-relaxed text-muted-foreground">
          There is no page at{" "}
          <code className="break-all rounded-chip border border-separator bg-surface px-1.5 py-0.5 font-mono text-body-sm text-foreground">
            {location.pathname}
          </code>
          .{" "}
          {best
            ? hasLegacy
              ? `It has moved to ${best.title}.`
              : `Did you mean ${best.title}?`
            : "It may have been moved or the link may be wrong."}
        </p>

        <section aria-labelledby="nf-suggestions" className="mt-6">
          <h2 id="nf-suggestions" className="mb-1.5 px-3 text-label text-muted-foreground">
            {suggestions.length > 0 ? "Closest matches" : "Popular pages"}
          </h2>
          <ul className="divide-y divide-separator overflow-hidden rounded-tile border border-separator bg-card shadow-card">
            {list.map((r, i) => (
              <RouteLink key={r.path} route={r} primary={i === 0 && suggestions.length > 0} />
            ))}
          </ul>
        </section>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {canGoBack && (
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft aria-hidden /> Go back
            </Button>
          )}
          <Button asChild>
            <Link to="/">
              <Home aria-hidden /> Back to home
            </Link>
          </Button>
        </div>

        <p className="mt-8 text-body-sm text-muted-foreground">
          {ROUTES.filter((r) => !r.hidden).length} pages available. Press{" "}
          <kbd className="rounded-chip bg-control-track px-1 font-mono text-micro">g</kbd> then a letter to jump
          between pages once you are back in the terminal. Looking for another Mr. Chartist product? See{" "}
          <Link to="/ecosystem" className="font-semibold text-primary-ink underline-offset-4 hover:underline">
            More from Mr. Chartist
          </Link>
          .
        </p>
      </div>
    </div>
  );
};

export default NotFound;
