import { Github } from "lucide-react";

const REPO_URL = "https://github.com/MrChartist/india-s-best-option-hub";

const HINTS: { keys: string; label: string }[] = [
  { keys: "⌘K", label: "Search" },
  { keys: "A", label: "Alerts" },
  { keys: "R", label: "Refresh" },
  { keys: "1–7", label: "Pages" },
];

/** Shortcut cheat-sheet + version. Connection status lives in the toolbar and Brokers & Data — not repeated here. */
export const StatusFooter = () => (
  <footer className="glass-panel flex h-9 shrink-0 items-center justify-between gap-3 rounded-2xl px-4 text-[11px] text-muted-foreground">
    <span className="font-medium">@MrChartist · open source · MIT</span>

    <div className="hidden items-center gap-4 md:flex">
      {HINTS.map((h) => (
        <span key={h.keys} className="flex items-center gap-1.5">
          <kbd className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">{h.keys}</kbd>
          {h.label}
        </span>
      ))}
    </div>

    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 font-medium transition-colors hover:text-primary"
    >
      <Github className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Star on GitHub</span>
    </a>
  </footer>
);
