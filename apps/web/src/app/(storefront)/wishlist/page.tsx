import { serverGetCategories } from "@/api/server";
import { WishlistPageView } from "@/component/wishlist/WishlistPageView";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saved Wishlist | NUTS-P Marketplace",
  description: "Curated items saved to your private collection.",
};

export default async function WishlistPage() {
  const categories = await serverGetCategories();

  return (
    <WishlistPageView
      categories={categories}
    />
  );
}
