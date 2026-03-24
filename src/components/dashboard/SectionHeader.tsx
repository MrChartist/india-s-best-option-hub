interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, icon }: Props) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      {icon && <span className="text-primary">{icon}</span>}
      <div>
        <h2 className="text-sm font-semibold text-foreground tracking-tight">{title}</h2>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex-1 h-px bg-border ml-3" />
    </div>
  );
}
