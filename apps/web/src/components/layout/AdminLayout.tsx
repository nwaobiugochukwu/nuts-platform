"use client";

import {
  BarChart3,
  Layers,
  Megaphone,
  Package,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Tag,
  UserCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { AdminHeader } from "./AdminHeader";
import { PanelShell, type PanelNavigationGroup } from "./PanelShell";

const NAV_GROUPS: PanelNavigationGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/admin/analytic", label: "Analytics & KPI", icon: BarChart3 },
      { href: "/admin/setting", label: "System & Cache", icon: Settings },
    ],
  },
  {
    group: "Governance",
    items: [
      { href: "/admin/staff", label: "Staff Governance", icon: ShieldCheck },
      { href: "/admin/platform", label: "Platform Controls", icon: Sliders },
      { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
    ],
  },
  {
    group: "Commerce",
    items: [
      { href: "/admin/product", label: "Products", icon: Package },
      { href: "/admin/category", label: "Categories", icon: Layers },
      { href: "/admin/order", label: "Orders", icon: ShoppingCart },
      { href: "/admin/discount", label: "Discounts", icon: Tag },
    ],
  },
  {
    group: "Membership",
    items: [
      { href: "/admin/vendor", label: "Vendors & Stores", icon: UserCheck },
      { href: "/admin/user", label: "User Directory", icon: Users },
    ],
  },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PanelShell
      kind="Admin"
      subtitle="Enterprise Command"
      homeHref="/admin/analytic"
      navigationLabel="Admin sections"
      groups={NAV_GROUPS}
      header={(openNavigation, isNavigationOpen) => (
        <AdminHeader onMobileMenuClick={openNavigation} mobileMenuOpen={isNavigationOpen} />
      )}
    >
      {children}
    </PanelShell>
  );
}
