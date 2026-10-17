/** Entry-context chips: IV percentile, India VIX, days to expiry, IV at entry. */
import { Badge } from "@/components/ui/badge";
import type { EntryContext } from "@/lib/paperTrading";

export function ContextChips({ context }: { context?: EntryContext }) {
  if (!context) return <span className="text-muted-foreground">—</span>;
  const ivpTitle = context.ivpBasis === "vix" ? "IV percentile proxied by India VIX percentile (1 year)" : "IV percentile of this underlying (1 year)";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant="neutral" title={context.ivp !== null ? ivpTitle : "Not enough IV history"}>
        IVP {context.ivp !== null ? Math.round(context.ivp) : "—"}
        {context.ivpBasis === "vix" ? "*" : ""}
      </Badge>
      <Badge variant="neutral" title="India VIX at entry">VIX {context.vix !== null ? context.vix.toFixed(1) : "—"}</Badge>
      <Badge variant="neutral" title="Calendar days to expiry at entry">{context.dte}D</Badge>
      {context.iv !== null ? (
        <Badge variant="neutral" title="Contract IV at entry">
          IV {context.iv.toFixed(1)}
        </Badge>
      ) : null}
    </span>
  );
}
