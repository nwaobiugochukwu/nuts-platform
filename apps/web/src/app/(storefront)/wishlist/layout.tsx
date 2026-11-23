import { ShopperOrGuestLayout } from "@/components/auth/ShopperOrGuestLayout";
import { type ReactNode } from "react";

export default function WishlistLayout({ children }: { children: ReactNode }) {
  return <ShopperOrGuestLayout>{children}</ShopperOrGuestLayout>;
}
