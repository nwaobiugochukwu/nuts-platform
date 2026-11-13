import { serverGetCategories,serverGetVendors } from "@/api/server";
import { VendorsPageView } from "@/component/domain/vendor/VendorsPageView";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover Vendors | NUTS-P Marketplace",
  description: "Shop directly from verified independent vendors and local merchants.",
};

export default async function VendorsPage() {
  const [categories, vendors] = await Promise.all([
    serverGetCategories(),
    serverGetVendors({ limit: 30 }),
  ]);

  return (
    <VendorsPageView
      initialCategories={categories}
      initialVendors={vendors}
    />
  );
}
