import { useEffect, useState, useSyncExternalStore } from "react";
import { CloudOff, Database, FlaskConical, RefreshCw, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROXY_BASE, probeProxy, useProxyStatus } from "@/lib/api/proxyClient";
import { bannerState, type BannerKind } from "@/lib/marketData/banner";
import { cn } from "@/lib/utils";

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

const readOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** navigator.onLine as React state. */
function useDeviceOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, () => true);
}

/** Wall clock that only ticks while `active` (drives the "next check in" countdown). */
function useTicker(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

const TONE: Record<BannerKind, string> = {
  sample: "border-warning/30 bg-wash-warning",
  demo: "border-warning/30 bg-wash-warning",
  cached: "border-info/30 bg-wash-info",
};

const ICON: Record<BannerKind, typeof Database> = {
  sample: Database,
  demo: FlaskConical,
  cached: CloudOff,
};

function StartProxyHelp() {
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const retry = async () => {
    setChecking(true);
    setFailed(false);
    const ok = await probeProxy({ force: true });
    setChecking(false);
    setFailed(!ok);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-capsule px-2 font-semibold text-primary-ink underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-ember"
        >
          <Terminal className="h-3 w-3" aria-hidden="true" />
          Start proxy
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3.5 text-xs">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Get live NSE data</p>
          <p className="leading-relaxed text-muted-foreground">
            Charts and tables are showing sample data because the local proxy at{" "}
            <code className="break-all rounded bg-muted px-1">{PROXY_BASE}</code> is not answering. Start it in a terminal
            from the project folder:
          </p>
        </div>
        <pre className="overflow-x-auto rounded-chip border border-border bg-muted px-2.5 py-2 font-mono text-xs text-foreground">
          npm run proxy
        </pre>
        <p className="leading-relaxed text-muted-foreground">
          Or run <code className="rounded bg-muted px-1">npm run dev</code> to start Vite and the proxy together. Add
          Dhan API keys in Broker settings for real-time ticks.
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={retry} disabled={checking}>
            <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} aria-hidden="true" />
            {checking ? "Checking…" : "Check again now"}
          </Button>
          <span role="status" aria-live="polite" className="text-muted-foreground">
            {failed ? "Still offline." : ""}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Global data-provenance bar (32 px) under the top bar. Driven by the proxy reachability gate and
 * navigator.onLine, so individual pages do not need their own "sample data" banners.
 */
export function SampleBanner() {
  const gate = useProxyStatus();
  const online = useDeviceOnline();
  const now = useTicker(gate.status === "offline" && gate.nextRetryAt !== null && online);
  const state = bannerState(gate, online, now);
  if (!state) return null;
  const Icon = ICON[state.kind];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-0 z-20 flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b px-2.5 text-xs text-foreground sm:px-3",
        TONE[state.kind],
      )}
      data-testid="sample-banner"
      data-kind={state.kind}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", state.kind === "cached" ? "text-info" : "text-warning")} aria-hidden="true" />
      <Badge variant={state.kind === "cached" ? "info" : "default"}>{state.badge}</Badge>
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <span className="min-w-0 truncate font-medium">{state.message}</span>
      {state.showStartProxy && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <StartProxyHelp />
        </>
      )}
      {state.detail && (
        <span className="ml-auto hidden shrink-0 font-num tabular-nums text-muted-foreground sm:inline">{state.detail}</span>
      )}
    </div>
  );
}
