import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";
import { useDensityClasses } from "./density";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  tooltip?: string;
  /** Right-aligned controls (status chip, links). */
  actions?: ReactNode;
  id?: string;
}

export function SectionHeader({ title, subtitle, icon, tooltip, actions, id }: Props) {
  const d = useDensityClasses();
  return (
    <div className={cn("flex items-center gap-2.5", d.section)}>
      {icon && <span className="text-primary-ink" aria-hidden="true">{icon}</span>}
      <div className="flex min-w-0 items-center gap-1">
        <h2 id={id} className="font-display text-[17px] font-bold leading-tight text-foreground">{title}</h2>
        {tooltip && <InfoTooltip text={tooltip} label={`About ${title}`} />}
      </div>
      {subtitle && <p className="hidden min-w-0 truncate text-body-sm text-muted-foreground sm:block">{subtitle}</p>}
      <div className="ml-1 h-px min-w-4 flex-1 bg-border" aria-hidden="true" />
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
