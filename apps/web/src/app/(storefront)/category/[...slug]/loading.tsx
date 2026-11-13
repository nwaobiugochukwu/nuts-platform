import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ProductGridSkeleton } from "@/component/product/ProductGridSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function CategoryLoading() {
  return (
    <CustomerLayout categories={[]}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-busy="true">
        <Skeleton className="mb-6 h-4 w-36 rounded-md" />
        <Skeleton className="mb-3 h-9 w-64 rounded-xl" />
        <Skeleton className="mb-8 h-5 w-96 max-w-full rounded-lg" />
        <div className="mb-8 flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-28 shrink-0 rounded-full" />
          ))}
        </div>
        <ProductGridSkeleton count={8} />
      </div>
    </CustomerLayout>
  );
}
