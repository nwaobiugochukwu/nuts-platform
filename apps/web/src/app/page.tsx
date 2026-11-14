import { serverGetCategories, serverGetFeaturedVendors, serverGetTrendingProducts } from "@/api/server";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { HomeProductShelves } from "@/components/home/HomeProductShelves";

export default async function HomePage() {
  // Fetch all server-side data in parallel so there is zero waterfall.
  // `serverGetTrendingProducts` provides an SSR-rendered initial product set
  // for "A good place to start" — visible on first paint before any client
  // query resolves, eliminating the staggered-load UX issue.
  const [categories, featuredVendors, initialProducts] = await Promise.all([
    serverGetCategories(),
    serverGetFeaturedVendors(12),
    serverGetTrendingProducts({ limit: 12 }),
  ]);

  return (
    <CustomerLayout categories={categories}>
      <HomeProductShelves
        initialCategories={categories}
        initialVendors={featuredVendors}
        initialProducts={initialProducts}
      />
    </CustomerLayout>
  );
}
