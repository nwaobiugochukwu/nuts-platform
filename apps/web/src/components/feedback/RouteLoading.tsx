import { Skeleton } from "@/components/ui/skeleton";

/** Lightweight placeholder for panel/section route `loading.tsx` files. */
export function RouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="space-y-6 py-2"
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <Skeleton className="h-8 w-56 rounded-xl" />
      <Skeleton className="h-4 w-80 max-w-full rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}
