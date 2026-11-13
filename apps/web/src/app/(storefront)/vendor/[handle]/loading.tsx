import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { ProductGridSkeleton } from "@/component/product/ProductGridSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function VendorStoreLoading() {
  return (
    <CustomerLayout categories={[]}>
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-busy="true">
        <Skeleton className="mb-10 h-48 w-full rounded-3xl" />
        <div className="mb-8 space-y-3">
          <Skeleton className="h-8 w-72 rounded-xl" />
          <Skeleton className="h-5 w-96 max-w-full rounded-lg" />
        </div>
        <ProductGridSkeleton count={8} />
      </div>
    </CustomerLayout>
  );
}
