import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProductDetailLoading() {
  return (
    <CustomerLayout categories={[]}>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8" aria-busy="true">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full rounded-3xl" />
          <div className="space-y-6 py-4">
            <Skeleton className="h-9 w-3/4 rounded-xl" />
            <Skeleton className="h-6 w-1/3 rounded-lg" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
}
