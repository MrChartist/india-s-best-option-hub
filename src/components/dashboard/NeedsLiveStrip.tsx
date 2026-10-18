/**
 * One compact strip that names everything the dashboard still cannot show without live data, with
 * a "Start proxy" helper. Rendered below the populated sections so the page never leads with gaps.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { CloudOff, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PROXY_BASE, probeProxy } from "@/lib/api/proxyClient";
import { cn } from "@/lib/utils";
import type { LiveGap } from "./liveGaps";

export function StartProxyButton({ onRecovered }: { onRecovered?: () => void }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<"" | "ok" | "failed">("");
  const check = async () => {
    setChecking(true);
    setResult("");
    const ok = await probeProxy({ force: true }).catch(() => false);
    setChecking(false);
    setResult(ok ? "ok" : "failed");
    if (ok) onRecovered?.();
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="shrink-0">
          <Terminal className="!size-3.5" aria-hidden="true" />
          Start proxy
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3.5 text-body-sm">
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Get live NSE data</p>
          <p className="leading-relaxed text-muted-foreground">
            The local proxy at <code className="break-all rounded-chip bg-muted px-1">{PROXY_BASE}</code> is not answering. Start it in a terminal from the project folder:
          </p>
        </div>
        <pre className="overflow-x-auto rounded-sm bg-control-track px-2.5 py-2 font-mono text-body-sm text-foreground">npm run proxy</pre>
        <p className="leading-relaxed text-muted-foreground">
          Or run <code className="rounded-chip bg-muted px-1">npm run dev</code> to start the app and the proxy together. Add Dhan API keys in{" "}
          <Link to="/broker-settings" className="font-medium text-primary-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            Broker settings
          </Link>{" "}
          for real-time ticks.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void check()} disabled={checking}>
            <RefreshCw className={cn("!size-3.5", checking && "motion-safe:animate-spin")} aria-hidden="true" />
            {checking ? "Checking…" : "Check again now"}
          </Button>
          <span role="status" aria-live="polite" className={result === "ok" ? "text-bullish" : "text-muted-foreground"}>
            {result === "ok" ? "Connected. Loading live data…" : result === "failed" ? "Still offline." : ""}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NeedsLiveStrip({ gaps, onRecovered }: { gaps: readonly LiveGap[]; onRecovered?: () => void }) {
  if (gaps.length === 0) return null;
  return (
    <aside
      aria-label="Needs live data"
      className="flex flex-col gap-2 rounded-tile border border-dashed border-separator-strong bg-card px-3 py-2 text-body-sm sm:flex-row sm:items-center"
    >
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
        <CloudOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <span className="font-semibold text-foreground">Needs live data:</span>
        {gaps.map((g, i) => (
          <span key={g.key} className="inline-flex items-center gap-1.5">
            {g.to ? (
              <Link to={g.to} className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:shadow-focus focus-visible:outline-none">
                {g.label}
              </Link>
            ) : (
              <span>{g.label}</span>
            )}
            {i < gaps.length - 1 ? <span aria-hidden="true">·</span> : null}
          </span>
        ))}
      </p>
      <StartProxyButton onRecovered={onRecovered} />
    </aside>
  );
}
