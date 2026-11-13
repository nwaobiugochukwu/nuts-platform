import { serverGetCategories, serverGetFeaturedVendors } from "@/api/server";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { HomeProductShelves } from "@/components/home/HomeProductShelves";

export default async function HomePage() {
  const [categories, featuredVendors] = await Promise.all([
    serverGetCategories(),
    serverGetFeaturedVendors(12),
  ]);

  return (
    <CustomerLayout categories={categories}>
      <HomeProductShelves
        initialCategories={categories}
        initialVendors={featuredVendors}
      />
    </CustomerLayout>
  );
}
