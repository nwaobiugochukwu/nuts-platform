"use client";

import { NotificationBell } from "@/component/notification/NotificationBell";
import { Button } from "@/component/ui/button";
import { useAuthStore } from "@/zustand/auth";
import { logoutWithFeedback } from "@/lib/logout";
import {
  ChevronDown,
  ExternalLink,
  LogIn,
  LogOut,
  Menu,
  Store,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { vendorAccountService } from "@/api";
import { useQuery } from "@tanstack/react-query";

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/vendor": { title: "Merchant Hub", subtitle: "Live store revenue, sales performance, and operations" },
  "/vendor/analytic": { title: "Store analytics", subtitle: "Sales, engagement, and follower performance" },
  "/vendor/product": { title: "Product Catalog", subtitle: "Inventory listings, pricing, and stock controls" },
  "/vendor/order": { title: "Order Fulfillment", subtitle: "Customer purchases, shipments, and status tracking" },
  "/vendor/wallet": { title: "Store Wallet", subtitle: "Available earnings, pending payouts, and settlements" },
  "/vendor/discount": { title: "Discount Coupons", subtitle: "Custom promotion codes, limits, and campaigns" },
  "/vendor/setting": { title: "Store Settings", subtitle: "Brand identity, profile preferences, and theme appearance" },
};

interface VendorHeaderProps {
  onMobileMenuClick?: () => void;
  mobileMenuOpen?: boolean;
}

export function VendorHeader({ onMobileMenuClick, mobileMenuOpen = false }: VendorHeaderProps) {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, isInitialized, logout } = useAuthStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Ensure vendor store details are resolved even if auth store has partial session
  const { data: vendorProfile } = useQuery({
    queryKey: ["vendor-header-profile"],
    queryFn: async () => {
      const res = await vendorAccountService.me();
      return res.data;
    },
    enabled: isAuthenticated && !user?.storeSlug,
    staleTime: 1000 * 60 * 10,
  });

  const pageInfo = PAGE_TITLES[pathname] ?? {
    title: "Vendor Store",
    subtitle: "Manage your storefront and catalog",
  };

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const displayName = firstName
    ? `${firstName} ${lastName}`.trim()
    : user?.email?.split("@")[0] || "Vendor";
  const shortName = firstName || user?.email?.split("@")[0] || "Vendor";
  const initials = firstName
    ? `${firstName[0]}${lastName ? lastName[0] : ""}`.toUpperCase()
    : user?.email?.[0]?.toUpperCase() || "V";

  const effectiveStoreName =
    user?.storeName || vendorProfile?.storeName || "";
  const effectiveStoreSlug =
    user?.storeSlug || vendorProfile?.storeSlug || "";
  const storeHref = effectiveStoreSlug ? `/vendor/${effectiveStoreSlug}` : "/vendor";

  return (
    <header className="sticky top-0 z-30 flex h-auto min-h-18 w-full items-center justify-between gap-2 border-b border-border/80 bg-background/80 px-3 py-2 backdrop-blur-xl sm:h-18 sm:px-8">
      {/* Left: Mobile hamburger + Dynamic Title */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none sm:gap-3">
        {onMobileMenuClick && (
          <button
            type="button"
            onClick={onMobileMenuClick}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-card text-foreground hover:bg-secondary lg:hidden transition-colors"
            aria-label="Open mobile navigation"
            aria-controls="panel-navigation"
            aria-expanded={mobileMenuOpen}
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <div className="min-w-0 flex-1 sm:flex-none">
          <h1 className="min-w-0 truncate text-sm font-bold tracking-tight text-foreground sm:text-lg">
            {pageInfo.title}
          </h1>
          <p className="hidden text-xs text-muted-foreground sm:block mt-0.5">
            {pageInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Right: Storefront Action + Profile */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <Link href={storeHref} target="_blank" rel="noopener noreferrer">
          <Button
            variant="outline"
            size="sm"
            className="hidden sm:flex items-center gap-1.5 text-xs font-medium rounded-xl border-border/80 hover:bg-secondary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Storefront
          </Button>
        </Link>

        {isAuthenticated && <NotificationBell />}

        {/* Profile Dropdown */}
        {isLoading && !user ? (
          <div className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/40 py-1 pl-1.5 pr-3 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ) : !isAuthenticated && isInitialized ? (
          <Link href="/auth/vendor/login">
            <Button size="sm" variant="default" className="rounded-xl gap-1.5 text-xs font-medium">
              <LogIn className="h-3.5 w-3.5" />
              Sign In
            </Button>
          </Link>
        ) : (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2.5 rounded-2xl border border-border/80 bg-card p-1 pr-3 shadow-2xs transition-all hover:bg-secondary/60 hover:border-foreground/20 focus:outline-none"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-900 to-neutral-700 text-white text-xs font-semibold shrink-0 shadow-xs">
                {initials}
              </div>
              <div className="hidden sm:flex flex-col text-left leading-none">
                <span className="text-sm font-semibold text-foreground max-w-[120px] truncate">
                  {shortName}
                </span>
              </div>
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                  dropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {dropdownOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-68 rounded-2xl border border-border/80 bg-popover p-2 text-popover-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 z-50 backdrop-blur-xl"
              >
                {/* User Info */}
                <div className="flex items-center gap-3 border-b border-border/60 px-3 py-3 mb-1">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-semibold">
                    {initials}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {displayName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate font-mono">
                      {user?.email}
                    </p>
                    <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold uppercase bg-primary/10 text-primary truncate max-w-[190px]">
                      <Store className="h-3 w-3 shrink-0" />
                      <span className="truncate">{effectiveStoreName || "Vendor"}</span>
                    </span>
                  </div>
                </div>

                {/* Sign Out */}
                <div className="border-t border-border/60 mt-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDropdownOpen(false);
                      void logoutWithFeedback(logout, { redirectTo: "/auth/vendor/login" });
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
