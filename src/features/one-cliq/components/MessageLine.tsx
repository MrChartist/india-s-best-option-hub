import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import type { TerminalMessage } from "../types";

interface Props {
  message: TerminalMessage | null;
  onClear: () => void;
}

const TONE_CLASS: Record<TerminalMessage["tone"], string> = {
  info: "text-muted-foreground",
  success: "text-bullish",
  warning: "text-warning",
  error: "text-bearish",
};

/**
 * The single-line status readout under the action bar, mirroring the reference
 * terminal's "Message: -".
 *
 * aria-live so a fill or a rejection is announced — with one-click execution the
 * user is watching the chart, not this line.
 */
export function MessageLine({ message, onClear }: Props) {
  return (
    <div className="flex items-center gap-2 min-h-[1.5rem] text-xs">
      <span className="text-muted-foreground shrink-0">Message:</span>
      <span
        className={`font-mono truncate ${message ? TONE_CLASS[message.tone] : "text-muted-foreground"}`}
        role="status"
        aria-live={message?.tone === "error" ? "assertive" : "polite"}
      >
        {message?.text || "—"}
      </span>
      {message && (
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={onClear} aria-label="Clear message">
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
