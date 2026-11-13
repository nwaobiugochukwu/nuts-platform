"use client";

import {
  BarChart3,
  Package,
  Settings,
  ShoppingBag,
  Tag,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { VendorHeader } from "./VendorHeader";
import { PanelShell, type PanelNavigationGroup } from "./PanelShell";

const NAV_GROUPS: PanelNavigationGroup[] = [
  {
    group: "Store management",
    items: [
      { href: "/vendor/analytic", label: "Analytics & Sales", icon: BarChart3 },
      { href: "/vendor/product", label: "Product Catalog", icon: Package },
      { href: "/vendor/order", label: "Customer Orders", icon: ShoppingBag },
      { href: "/vendor/wallet", label: "Wallet & Payouts", icon: Wallet },
      { href: "/vendor/discount", label: "Discount Coupons", icon: Tag },
      { href: "/vendor/setting", label: "Store Settings", icon: Settings },
    ],
  },
];

export function VendorLayout({ children }: { children: ReactNode }) {
  return (
    <PanelShell
      kind="Vendor"
      subtitle="Vendor Dashboard"
      homeHref="/vendor/analytic"
      navigationLabel="Store management"
      groups={NAV_GROUPS}
      header={(openNavigation, isNavigationOpen) => (
        <VendorHeader onMobileMenuClick={openNavigation} mobileMenuOpen={isNavigationOpen} />
      )}
    >
      {children}
    </PanelShell>
  );
}
