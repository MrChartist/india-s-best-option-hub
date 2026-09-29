export function MarketHeader({ marketStatus }: { marketStatus: string }) {
  const now = new Date();
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Market Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        NSE · <span className="text-foreground">{marketStatus}</span>
      </p>
    </div>
  );
}
