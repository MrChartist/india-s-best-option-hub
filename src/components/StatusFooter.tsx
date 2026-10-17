import { useEffect, useState } from "react";
import { ArrowUpRight, Circle, Clock, Github } from "lucide-react";
import { useLiveIndices } from "@/hooks/useMarketData";
import { formatTimeIST } from "@/lib/options";
import { cn } from "@/lib/utils";

const GITHUB_URL = "https://github.com/MrChartist/india-s-best-option-hub";
const SITE_URL = "https://mrchartist.com";

interface SnapshotStats {
  count: number;
  symbols: string[];
  recording: boolean;
  lastTs: number | null;
}

type SnapshotModule = { getSnapshotStats?: () => Promise<SnapshotStats> };

// The snapshot store may not exist yet; a glob import resolves to {} instead of failing the build.
const snapshotLoaders = import.meta.glob<SnapshotModule>("/src/lib/snapshotStore.ts");

async function readSnapshotStats(): Promise<SnapshotStats | null> {
  try {
    const load = Object.values(snapshotLoaders)[0];
    if (!load) return null;
    const mod = await load();
    if (typeof mod.getSnapshotStats !== "function") return null;
    const stats = await mod.getSnapshotStats();
    if (!stats || typeof stats.count !== "number") return null;
    return stats;
  } catch {
    return null;
  }
}

/** Polls the local snapshot store every minute. Returns null when unavailable. */
function useSnapshotStats(): SnapshotStats | null {
  const [stats, setStats] = useState<SnapshotStats | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      readSnapshotStats().then((s) => {
        if (alive) setStats(s);
      });
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return stats;
}

/** Minute-resolution IST clock (60 s interval, aligned to the next minute boundary). */
function MinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const align = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(align);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return (
    <span className="flex items-center gap-1.5">
      <Clock className="h-3 w-3" aria-hidden="true" />
      <time dateTime={now.toISOString()} className="font-num tabular-nums">
        {formatTimeIST(now)}
      </time>
    </span>
  );
}

function RecordingStatus({ stats }: { stats: SnapshotStats | null }) {
  if (!stats) return null;
  const label = stats.recording
    ? `Recording · ${stats.count.toLocaleString("en-IN")} snapshots`
    : stats.count > 0
      ? `${stats.count.toLocaleString("en-IN")} snapshots saved`
      : "Not recording";
  const title = stats.lastTs ? `Last snapshot ${formatTimeIST(stats.lastTs)}` : "No snapshots stored on this device yet";
  return (
    <span className="hidden items-center gap-1.5 sm:flex" title={title}>
      <Circle
        className={cn("h-2 w-2", stats.recording ? "fill-bearish text-bearish" : "fill-muted-foreground/50 text-muted-foreground/50")}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

export const StatusFooter = () => {
  const { data: indicesResult } = useLiveIndices();
  const isConnected = indicesResult?.isLive || false;
  const stats = useSnapshotStats();

  return (
    <footer
      className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-card/60 px-3 py-1.5 text-micro font-medium normal-case tracking-normal text-muted-foreground sm:px-4"
      aria-label="Status and disclaimer"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isConnected ? "bg-bullish" : "bg-bearish")}
            aria-hidden="true"
          />
          <span>Feed {isConnected ? "live" : "offline"}</span>
        </span>
        <RecordingStatus stats={stats} />
        <span className="hidden lg:inline">Data for education and research. Not investment advice.</span>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden items-center gap-2 xl:flex">
          <kbd className="rounded-chip bg-muted px-1.5 py-0.5">Ctrl K</kbd> Search
          <kbd className="rounded-chip bg-muted px-1.5 py-0.5">R</kbd> Refresh
        </span>
        <MinuteClock />
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-0.5 rounded-sm transition-colors duration-fast hover:text-primary-ink sm:flex"
        >
          mrchartist.com
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 rounded-sm transition-colors duration-fast hover:text-primary-ink"
          aria-label="Source code on GitHub (opens in a new tab)"
        >
          <Github className="h-3 w-3" aria-hidden="true" />
          <span className="hidden md:inline">GitHub</span>
        </a>
      </div>

      <p className="w-full lg:hidden">Data for education and research. Not investment advice.</p>
    </footer>
  );
};
