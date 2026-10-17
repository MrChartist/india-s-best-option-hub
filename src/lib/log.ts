/**
 * Tiny ring-buffer logger.
 *
 * Keeps the last N entries in memory so the error boundary can attach recent
 * context to a "Copy error" / "Report on GitHub" report, without shipping logs
 * anywhere. Warnings and errors are mirrored to the console; info and debug
 * only in development builds.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** Optional structured context (serialised lazily when formatted). */
  data?: unknown;
  /** Epoch milliseconds. */
  time: number;
}

export const LOG_CAPACITY = 200;

let buffer: LogEntry[] = [];
let mirrorToConsole = true;

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function push(level: LogLevel, message: string, data?: unknown): LogEntry {
  const entry: LogEntry = { level, message: String(message), time: Date.now() };
  if (data !== undefined) entry.data = data;
  buffer.push(entry);
  if (buffer.length > LOG_CAPACITY) buffer = buffer.slice(buffer.length - LOG_CAPACITY);

  if (mirrorToConsole && typeof console !== "undefined") {
    const args: unknown[] = data === undefined ? [message] : [message, data];
    if (level === "error") console.error(...args);
    else if (level === "warn") console.warn(...args);
    else if (isDev()) (level === "info" ? console.info : console.debug)(...args);
  }
  return entry;
}

export const log = {
  debug: (message: string, data?: unknown): LogEntry => push("debug", message, data),
  info: (message: string, data?: unknown): LogEntry => push("info", message, data),
  warn: (message: string, data?: unknown): LogEntry => push("warn", message, data),
  error: (message: string, data?: unknown): LogEntry => push("error", message, data),
};

/** The most recent entries, oldest first. */
export function getRecentLogs(limit: number = LOG_CAPACITY): LogEntry[] {
  return limit <= 0 ? [] : buffer.slice(-limit);
}

/** The most recent error entries, oldest first. */
export function getRecentErrors(limit = 20): LogEntry[] {
  if (limit <= 0) return [];
  return buffer.filter((e) => e.level === "error").slice(-limit);
}

export function clearLogs(): void {
  buffer = [];
}

/** Turn console mirroring on or off (tests switch it off to keep output clean). */
export function setConsoleMirroring(enabled: boolean): void {
  mirrorToConsole = enabled;
}

function safeStringify(value: unknown, maxLength = 500): string {
  let out: string;
  if (value instanceof Error) {
    out = `${value.name}: ${value.message}`;
  } else if (typeof value === "string") {
    out = value;
  } else {
    try {
      const seen = new WeakSet<object>();
      out =
        JSON.stringify(value, (_key, v: unknown) => {
          if (typeof v === "object" && v !== null) {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
          }
          return v;
        }) ?? String(value);
    } catch {
      out = String(value);
    }
  }
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

/** Plain-text lines for bug reports, e.g. "10:31:05 WARN  Proxy offline {"status":0}". */
export function formatLogs(entries: readonly LogEntry[] = getRecentLogs(30)): string {
  return entries
    .map((e) => {
      const t = new Date(e.time).toLocaleTimeString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" });
      const level = e.level.toUpperCase().padEnd(5);
      return `${t} ${level} ${e.message}${e.data === undefined ? "" : ` ${safeStringify(e.data)}`}`;
    })
    .join("\n");
}

// ── Error reports (used by ErrorBoundary) ────────────────────────────────

export const GITHUB_ISSUES_URL = "https://github.com/MrChartist/india-s-best-option-hub/issues/new";

/** Upper bound for a prefilled GitHub issue URL (browsers and GitHub cap around 8 KB). */
const MAX_ISSUE_URL_LENGTH = 7000;

/** Current path and query, or "unknown" outside a browser. */
export function currentPath(): string {
  try {
    return window.location.pathname + window.location.search;
  } catch {
    return "unknown";
  }
}

/**
 * Plain-text error report for the clipboard or a GitHub issue. Includes the
 * page, IST time, browser, stacks and the last few log lines; never storage
 * contents or credentials.
 */
export function buildErrorReport(error: Error, componentStack?: string | null): string {
  const time = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
  const lines = [
    `Error: ${error.name}: ${error.message}`,
    `Page: ${currentPath()}`,
    `Time: ${time} IST`,
    `Browser: ${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`,
    "",
    "Stack:",
    (error.stack ?? "(no stack)").split("\n").slice(0, 15).join("\n"),
  ];
  if (componentStack) {
    lines.push("", "Component stack:", componentStack.trim().split("\n").slice(0, 12).join("\n"));
  }
  const recent = formatLogs(getRecentLogs(15));
  if (recent) lines.push("", "Recent log:", recent);
  return lines.join("\n");
}

/** Prefilled "new issue" URL, trimmed to stay under browser URL limits. */
export function buildIssueUrl(error: Error, componentStack?: string | null): string {
  const title = `[Bug] ${error.message || error.name}`.slice(0, 120);
  const fence = "```";
  let report = buildErrorReport(error, componentStack);
  const make = (body: string) =>
    `${GITHUB_ISSUES_URL}?${new URLSearchParams({
      title,
      labels: "bug",
      body: `**What happened**\n\n<!-- What were you doing when this appeared? -->\n\n**Error report**\n\n${fence}text\n${body}\n${fence}\n`,
    }).toString()}`;
  let url = make(report);
  while (url.length > MAX_ISSUE_URL_LENGTH && report.length > 200) {
    report = `${report.slice(0, Math.floor(report.length * 0.75))}\n…(trimmed)`;
    url = make(report);
  }
  return url;
}
