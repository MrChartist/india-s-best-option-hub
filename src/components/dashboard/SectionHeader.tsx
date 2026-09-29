import { InfoTooltip } from "./InfoTooltip";

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: string;
}

export function SectionHeader({ title, subtitle, icon, tooltip }: Props) {
  return (
    <div className="flex items-center gap-2.5 pb-1 pt-6">
      {icon && (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/12 text-primary" style={{ backgroundColor: "hsl(var(--primary) / 0.12)" }}>
          {icon}
        </span>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-lg font-semibold leading-tight text-foreground">{title}</h2>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      {subtitle && <p className="hidden truncate text-sm text-muted-foreground sm:block">{subtitle}</p>}
    </div>
  );
}
