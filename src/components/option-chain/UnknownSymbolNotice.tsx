import { AlertTriangle } from "lucide-react";

/** Shown when a link names a symbol that has no F&O contracts and the page falls back to another one. */
export function UnknownSymbolNotice({ symbol, showing = "NIFTY" }: { symbol: string; showing?: string }) {
  return (
    <p className="flex items-center gap-2 rounded-tile bg-wash-warning px-3 py-2 text-body-sm text-warning" role="status">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
      &ldquo;{symbol}&rdquo; is not an F&amp;O underlying, so this page is showing {showing}.
    </p>
  );
}
