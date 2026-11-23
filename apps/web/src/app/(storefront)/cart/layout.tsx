import { ShopperOrGuestLayout } from "@/components/domain/auth/ShopperOrGuestLayout";
import { type ReactNode } from "react";

export default function CartLayout({ children }: { children: ReactNode }) {
  return <ShopperOrGuestLayout>{children}</ShopperOrGuestLayout>;
}
