import {
  serverGetCategories,
  serverGetPlatformPromos,
  serverGetFeaturedVendors,
  serverGetProductDiscovery,
} from "@/api/server";
import { CustomerLayout } from "@/components/layout/CustomerLayout";
import { HomeProductShelves } from "@/components/home/HomeProductShelves";

export default async function HomePage() {
  const [categories, promos, vendors, discovery] = await Promise.all([
    serverGetCategories(),
    serverGetPlatformPromos(),
    serverGetFeaturedVendors(8).catch(() => []),
    serverGetProductDiscovery().catch(() => ({ data: [] })),
  ]);

  return (
    <CustomerLayout categories={categories} initialPromos={promos}>
      <HomeProductShelves
        initialCategories={categories}
        initialVendors={vendors}
        initialProducts={discovery.data}
      />
    </CustomerLayout>
  );
}
