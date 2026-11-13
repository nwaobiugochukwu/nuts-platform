import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function VendorsLoading() {
  return (
    <CustomerLayout categories={[]}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-busy="true">
        <div className="mb-10 space-y-3 border-b border-border/50 pb-8">
          <Skeleton className="h-10 w-80 max-w-full rounded-xl" />
          <Skeleton className="h-5 w-[34rem] max-w-full rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-56 rounded-2xl border border-border/40" />
          ))}
        </div>
      </div>
    </CustomerLayout>
  );
}
