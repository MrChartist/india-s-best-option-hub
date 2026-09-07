import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-48 bg-primary/10" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full bg-primary/10" />
        </div>
      </div>

      {/* Ticker */}
      <div className="flex gap-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-10 w-48 rounded-md" />
        ))}
      </div>

      {/* Index Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="border-border/50 bg-card/30">
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between">
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-28 bg-primary/5" />
                </div>
                <Skeleton className="h-6 w-16 rounded" />
              </div>
              <Skeleton className="h-12 w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-14" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <Card key={i} className="border-border/50 bg-card/30">
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-3 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-1 p-3">
      <div className="flex gap-4 pb-3 border-b border-border/50">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={`h-3 ${i === 0 ? "w-24 bg-primary/10" : "w-16"}`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-2.5">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-4 ${c === 0 ? "w-24 font-bold" : "w-16"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border/50 bg-card/30" style={{ height }}>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent -translate-x-[100%] animate-[shimmer_2s_infinite]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center opacity-50">
        <div className="h-8 w-8 mb-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase">Loading Chart...</p>
      </div>
    </div>
  );
}
