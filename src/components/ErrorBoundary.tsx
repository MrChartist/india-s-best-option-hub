import React from "react";
import { AlertTriangle, Check, ChevronRight, Copy, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildErrorReport, buildIssueUrl, currentPath, log } from "@/lib/log";
import { isChunkLoadError, reloadOnceForChunkError } from "@/lib/lazyWithRetry";

type ResetKeys = ReadonlyArray<unknown>;

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Headline shown in the fallback. */
  fallbackMessage?: string;
  /** When any value changes (e.g. the route pathname), a crashed boundary resets itself. */
  resetKeys?: ResetKeys;
  /** Called after the boundary resets (retry button or resetKeys change). */
  onReset?: () => void;
  /** Called once per caught error. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Fully custom fallback; receives the error and a reset callback. */
  fallback?: (props: { error: Error; reset: () => void }) => React.ReactNode;
  className?: string;
}

interface State {
  error: Error | null;
  componentStack: string | null;
  reloading: boolean;
}

function keysChanged(a: ResetKeys = [], b: ResetKeys = []): boolean {
  return a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyErrorButton({ getText, compact }: { getText: () => string; compact?: boolean }) {
  const [state, setState] = React.useState<"idle" | "copied" | "failed">("idle");
  React.useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const label = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy error";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("gap-1.5", compact && "h-7 px-2 text-xs")}
      onClick={async () => setState((await copyText(getText())) ? "copied" : "failed")}
    >
      {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span aria-live="polite">{label}</span>
    </Button>
  );
}

function ErrorDetails({ error, componentStack }: { error: Error; componentStack: string | null }) {
  return (
    <details className="group mx-auto w-full max-w-xl rounded-md border border-border bg-surface/60 text-left">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden />
        Technical details
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-2.5">
        <p className="break-words font-mono text-xs leading-relaxed text-bearish">
          {error.name}: {error.message}
        </p>
        {(error.stack || componentStack) && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
            {(error.stack ?? "").split("\n").slice(1, 10).join("\n")}
            {componentStack ? `\n\nComponent stack:${componentStack.split("\n").slice(0, 8).join("\n")}` : ""}
          </pre>
        )}
      </div>
    </details>
  );
}

export interface WidgetErrorBoundaryProps extends ErrorBoundaryProps {
  /** Widget name for the message, e.g. "OI heatmap". */
  label?: string;
}

interface InternalProps extends WidgetErrorBoundaryProps {
  /** "page" (default) shows the full recovery card; "widget" a compact inline one. */
  variant?: "page" | "widget";
}

/**
 * Error boundary with recovery, a details disclosure, "Copy error" and
 * "Report on GitHub". Chunk-load errors trigger one automatic reload, and a
 * change in `resetKeys` (for example the route pathname) clears the error.
 */
export class ErrorBoundary extends React.Component<InternalProps, State> {
  state: State = { error: null, componentStack: null, reloading: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.error(`UI crash: ${error.message}`, { name: error.name, path: currentPath() });
    this.setState({ componentStack: info.componentStack ?? null });
    this.props.onError?.(error, info);
    // A stale chunk after a deploy: reload once to fetch the new build.
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      this.setState({ reloading: true });
    }
  }

  componentDidUpdate(prevProps: InternalProps): void {
    if (this.state.error && keysChanged(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null, reloading: false });
    this.props.onReset?.();
  };

  reportText = (): string => (this.state.error ? buildErrorReport(this.state.error, this.state.componentStack) : "");

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return this.props.variant === "widget" ? this.renderWidget(error) : this.renderPage(error);
  }

  private renderPage(error: Error): React.ReactNode {
    const { componentStack, reloading } = this.state;

    const chunk = isChunkLoadError(error);
    const headline = reloading
      ? "Loading the latest version…"
      : chunk
        ? "This page could not be loaded."
        : this.props.fallbackMessage || "Something went wrong on this page.";
    const detail = reloading
      ? "A new version of the terminal was released. Reloading now."
      : chunk
        ? "The app was probably updated while this tab was open, or your connection dropped. Reload to get the latest version."
        : "The rest of the terminal still works. Try again, or reload the page. If it keeps happening, please report it.";

    return (
      <div
        role="alert"
        className={cn(
          "mx-auto my-6 w-full max-w-2xl rounded-card border border-bearish/25 bg-card px-4 py-8 text-center shadow-card sm:px-8",
          this.props.className,
        )}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-tile border border-bearish/25 bg-wash-loss">
          {reloading ? (
            <RefreshCw className="h-6 w-6 animate-spin text-bearish" aria-hidden />
          ) : (
            <AlertTriangle className="h-6 w-6 text-bearish" aria-hidden />
          )}
        </div>
        <h2 className="font-display text-lg font-bold tracking-tight text-foreground">{headline}</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{detail}</p>

        {!reloading && (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {!chunk && (
                <Button type="button" size="sm" className="gap-1.5" onClick={this.reset}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={chunk ? "default" : "outline"}
                className="gap-1.5"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reload page
              </Button>
              <CopyErrorButton getText={this.reportText} />
              <Button asChild type="button" size="sm" variant="ghost" className="gap-1.5">
                <a href={buildIssueUrl(error, componentStack)} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Report on GitHub
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
            </div>
            <div className="mt-5">
              <ErrorDetails error={error} componentStack={componentStack} />
            </div>
          </>
        )}
      </div>
    );
  }
  private renderWidget(error: Error): React.ReactNode {
    const { reloading } = this.state;

    const what = this.props.label ? `${this.props.label} failed to load.` : "This widget failed to load.";
    return (
      <div
        role="alert"
        className={cn(
          "flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-bearish/30 bg-wash-loss/40 p-4 text-center",
          this.props.className,
        )}
      >
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-bearish" aria-hidden />
          {reloading ? "Loading the latest version…" : this.props.fallbackMessage || what}
        </p>
        {!reloading && (
          <>
            <p className="max-w-xs truncate text-xs text-muted-foreground" title={error.message}>
              {error.message}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={this.reset}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
              </Button>
              <CopyErrorButton getText={this.reportText} compact />
            </div>
          </>
        )}
      </div>
    );
  }
}

/**
 * Compact boundary for a single card or chart, so one broken widget does not
 * take the page down. Shows a one-line message with Retry and Copy error.
 */
export function WidgetErrorBoundary(props: WidgetErrorBoundaryProps) {
  return <ErrorBoundary {...props} variant="widget" />;
}
