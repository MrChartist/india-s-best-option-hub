import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Home, SearchX } from "lucide-react";
import { routeIcon } from "@/lib/routeIcons";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { log } from "@/lib/log";
import { findRoute, LEGACY_REDIRECTS, normalizePathname, ROUTES, suggestRoutes, type RouteDef } from "@/lib/routes";

const POPULAR_PATHS = ["/", "/option-chain", "/strategy-builder"];

function RouteLink({ route, primary }: { route: RouteDef; primary?: boolean }) {
  const Icon = routeIcon(route.icon);
  return (
    <li>
      <Link
        to={route.path}
        className={
          "group flex items-center gap-3 rounded-tile border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
          (primary
            ? "border-primary/40 bg-wash-brand/50 hover:bg-wash-brand"
            : "border-border bg-card hover:border-primary/40 hover:bg-surface")
        }
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-primary-ink">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{route.title}</span>
          {route.description && <span className="block truncate text-xs text-muted-foreground">{route.description}</span>}
        </span>
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{route.path}</span>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
          aria-hidden
        />
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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile border border-border bg-card shadow-card">
            <SearchX className="h-5 w-5 text-primary-ink" aria-hidden />
          </span>
          <p className="font-num text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Error 404</p>
        </div>

        <h1 className="font-display text-display text-foreground">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          There is no page at{" "}
          <code className="break-all rounded-chip border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-foreground">
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
          <h2 id="nf-suggestions" className="mb-2 text-label uppercase text-muted-foreground">
            {suggestions.length > 0 ? "Closest matches" : "Popular pages"}
          </h2>
          <ul className="space-y-2">
            {list.map((r, i) => (
              <RouteLink key={r.path} route={r} primary={i === 0 && suggestions.length > 0} />
            ))}
          </ul>
        </section>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {canGoBack && (
            <Button type="button" variant="outline" className="gap-2" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Go back
            </Button>
          )}
          <Button asChild className="gap-2">
            <Link to="/">
              <Home className="h-4 w-4" aria-hidden /> Back to home
            </Link>
          </Button>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          {ROUTES.filter((r) => !r.hidden).length} pages available. Press{" "}
          <kbd className="rounded-chip border border-border bg-surface px-1 font-mono text-[11px]">g</kbd> then a letter to jump
          between pages once you are back in the terminal.
        </p>
      </div>
    </div>
  );
};

export default NotFound;
