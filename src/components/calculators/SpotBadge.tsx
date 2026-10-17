import { FlaskConical, Radio, Clock, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SpotHint } from "./useSpotHint";

/** Where a prefilled spot came from. Sample levels are always labelled. */
export function SpotBadge({ hint, touched }: { hint: SpotHint; touched: boolean }) {
  if (touched) {
    return (
      <Badge variant="neutral">
        <PenLine aria-hidden="true" /> Your input
      </Badge>
    );
  }
  if (hint.isLoading && hint.kind !== "live") return <Badge variant="neutral">Loading quote…</Badge>;
  if (hint.kind === "live")
    return (
      <Badge variant="bullish">
        <Radio aria-hidden="true" /> Live
      </Badge>
    );
  if (hint.kind === "delayed")
    return (
      <Badge variant="info">
        <Clock aria-hidden="true" /> Last saved
      </Badge>
    );
  if (hint.kind === "sample")
    return (
      <Badge variant="warning">
        <FlaskConical aria-hidden="true" /> Sample spot · edit
      </Badge>
    );
  return <Badge variant="neutral">Enter the price</Badge>;
}
