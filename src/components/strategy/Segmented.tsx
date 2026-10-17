import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

/** Small segmented control (muted track, active segment on a card surface). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex items-center gap-0.5 rounded-tab bg-muted p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-chip px-2 py-1 text-[11px] font-semibold leading-none transition-colors duration-fast focus-visible:outline-none focus-visible:shadow-ember",
              // Strong active state: a filled, ringed pill that reads clearly on the muted track in both themes.
              active ? "bg-card text-foreground shadow-card ring-1 ring-border dark:bg-white/10 dark:ring-white/15" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
