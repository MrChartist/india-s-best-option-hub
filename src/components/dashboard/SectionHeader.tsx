import { InfoTooltip } from "./InfoTooltip";

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: string;
}

export function SectionHeader({ title, subtitle, icon, tooltip }: Props) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      {icon && <span className="text-primary">{icon}</span>}
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {subtitle && <p className="text-[10px] text-muted-foreground hidden sm:block">— {subtitle}</p>}
      <div className="flex-1 h-px bg-border ml-3" />
    </div>
  );
}
