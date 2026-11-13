import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ProductGridSkeleton } from "@/component/product/ProductGridSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <CustomerLayout categories={[]}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-busy="true">
        <Skeleton className="mb-3 h-9 w-72 rounded-xl" />
        <Skeleton className="mb-8 h-5 w-96 max-w-full rounded-lg" />
        <Skeleton className="mb-8 h-11 w-full rounded-xl" />
        <ProductGridSkeleton count={8} />
      </div>
    </CustomerLayout>
  );
}
