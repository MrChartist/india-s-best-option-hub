import { ChartCandlestick, Github, Instagram, Linkedin, MessageCircle, Send, Youtube } from "lucide-react";
import type { SocialId } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

/** The X glyph (lucide's Twitter icon is the old bird). Path from Simple Icons, CC0. */
function XGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const ICONS = {
  youtube: Youtube,
  telegram: Send,
  whatsapp: MessageCircle,
  instagram: Instagram,
  linkedin: Linkedin,
  tradingview: ChartCandlestick,
  github: Github,
} as const;

/** Monochrome icon for a social profile; decorative (the link carries the name). */
export function SocialIcon({ id, className }: { id: SocialId; className?: string }) {
  if (id === "x") return <XGlyph className={cn("h-4 w-4 p-px", className)} />;
  const Icon = ICONS[id];
  return <Icon className={cn("h-4 w-4", className)} strokeWidth={1.75} aria-hidden="true" />;
}
