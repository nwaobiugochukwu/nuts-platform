import { type ReactNode } from "react";

/**
 * Layout wrapper for storefront customer pages.
 * Navigation and authorization are handled at the route/middleware level.
 */
export function ShopperOrGuestLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
