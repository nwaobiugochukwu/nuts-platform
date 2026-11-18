import { serverGetCategories } from "@/api/server";
import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { HomeProductShelves } from "@/components/home/HomeProductShelves";

export default async function HomePage() {
  const categories = await serverGetCategories();

  return (
    <CustomerLayout categories={categories}>
      <HomeProductShelves initialCategories={categories} />
    </CustomerLayout>
  );
}
