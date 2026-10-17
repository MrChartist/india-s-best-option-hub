import { cn } from "@/lib/utils";

/** LB long build-up, SB short build-up, SC short covering, LU long unwinding. */
export type BuildupKind = "LB" | "SB" | "SC" | "LU";

export interface BuildupMeta {
  code: BuildupKind;
  label: string;
  /** Price and OI direction plus the plain-English reading. */
  hint: string;
  className: string;
}

/**
 * One palette for OI build-up everywhere: LB green, SB red, SC blue, LU amber.
 * Washes are tinted backgrounds whose ink passes AA in both themes.
 */
export const BUILDUP_META: Record<BuildupKind, BuildupMeta> = {
  LB: { code: "LB", label: "Long build-up", hint: "Price ↑ OI ↑: fresh longs", className: "bg-wash-profit text-bullish border-bullish/25" },
  SB: { code: "SB", label: "Short build-up", hint: "Price ↓ OI ↑: fresh shorts", className: "bg-wash-loss text-bearish border-bearish/25" },
  SC: { code: "SC", label: "Short covering", hint: "Price ↑ OI ↓: shorts exiting", className: "bg-wash-info text-info border-info/25" },
  LU: { code: "LU", label: "Long unwinding", hint: "Price ↓ OI ↓: longs exiting", className: "bg-wash-warning text-warning border-warning/30" },
};

export interface BuildupBadgeProps {
  kind: BuildupKind;
  /** compact: two-letter code with a tooltip; full (default): the full label. */
  variant?: "compact" | "full";
  className?: string;
}

export function BuildupBadge({ kind, variant = "full", className }: BuildupBadgeProps) {
  const meta = BUILDUP_META[kind];
  const compact = variant === "compact";
  return (
    <span
      title={compact ? `${meta.label}. ${meta.hint}` : meta.hint}
      className={cn(
        "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-chip border px-1.5 text-[11px] font-semibold leading-none",
        compact && "min-w-[1.75rem] justify-center tracking-[0.04em]",
        meta.className,
        className,
      )}
    >
      {compact ? (
        <>
          <span aria-hidden="true">{meta.code}</span>
          <span className="sr-only">{`${meta.label}: ${meta.hint}`}</span>
        </>
      ) : (
        meta.label
      )}
    </span>
  );
}

export default BuildupBadge;
