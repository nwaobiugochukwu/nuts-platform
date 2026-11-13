import { serverGetCategories } from "@/api/server";
import { CartPageView } from "@/component/cart/CartPageView";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shopping Cart | NUTS-P Marketplace",
  description: "Review items from independent vendors before checkout.",
};

export default async function CartPage() {
  const categories = await serverGetCategories();

  return (
    <CartPageView
      categories={categories}
    />
  );
}
