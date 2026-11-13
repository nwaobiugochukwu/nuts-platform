import { Skeleton } from "@/components/ui/skeleton";

export function TrendingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>

      <div className="flex gap-4 sm:gap-6 overflow-hidden pb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="w-[230px] sm:w-[270px] shrink-0 space-y-3 rounded-2xl border border-border/40 p-3 bg-card/60"
          >
            <Skeleton className="aspect-[4/5] w-full rounded-xl" />
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="h-3 w-1/2 rounded-md" />
            <Skeleton className="h-5 w-1/3 rounded-md pt-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
