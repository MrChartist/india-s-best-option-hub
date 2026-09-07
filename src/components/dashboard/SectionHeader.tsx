import { InfoTooltip } from "./InfoTooltip";

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: string;
}

export function SectionHeader({ title, subtitle, icon, tooltip }: Props) {
  return (
    <div className="flex items-center gap-2 pt-5 pb-2">
      {icon && <span className="text-primary">{icon}</span>}
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-lg font-semibold leading-tight tracking-tight text-foreground">{title}</h2>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {subtitle && (
        <p className="hidden truncate text-xs font-medium leading-none text-muted-foreground/80 sm:block">
          {subtitle}
        </p>
      )}
      <div className="ml-2 h-px flex-1 bg-gradient-to-r from-border/80 via-border/35 to-transparent" />
    </div>
  );
}
