import { Card, CardContent, CardHeader } from "@/component/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="h-full border border-border/40 bg-card/60 shadow-none overflow-hidden rounded-2xl">
          <CardHeader className="p-0">
            <Skeleton className="aspect-square w-full rounded-none" />
          </CardHeader>
          <CardContent className="p-4 space-y-2.5">
            <Skeleton className="h-3 w-1/3 rounded-full" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
            <Skeleton className="h-5 w-1/2 rounded-md pt-1" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
