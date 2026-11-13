"use client";

import {
ChevronDown,
Heart,
LayoutDashboard,
LogOut,
Package,
Search,
Settings,
Shield,
ShoppingCart,
Store,
User as UserIcon,
Wallet,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { usePathname } from "next/navigation";
import { useEffect,useRef,useState } from "react";

import { NotificationBell } from "@/component/notification/NotificationBell";
import { CategoryNavMenu } from "@/component/category/CategoryNavMenu";
import type { CategoryResponseDto } from "@/api/dto/category";
import { useCart } from "@/hooks/use-cart";
import { useHydrated } from "@/hooks/use-hydrated";
import { useWishlist } from "@/hooks/use-wishlist";
import { usePublicCategories } from "@/hooks/use-public-categories";
import { useAuthStore } from "@/zustand/auth";
import { logoutWithFeedback } from "@/lib/logout";

import { SearchDrawer } from "@/components/search/SearchDrawer";

export function Navbar({
  categories = [],
  showCategoryNavigation = true,
}: {
  categories?: CategoryResponseDto[];
  showCategoryNavigation?: boolean;
}) {
  const pathname = usePathname();
  const { user, isAuthenticated, role, logout } = useAuthStore();
  const isMounted = useHydrated();
  const [accountOpen, setAccountOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isLoggedIn = isAuthenticated && (!!user || !!role);
  const capabilities = useAuthStore((state) => state.capabilities);
  const canPurchase = capabilities ? capabilities.canPurchase : !isLoggedIn;
  const canSell = capabilities?.canSell ?? false;
  const canAdminister = capabilities?.canAdminister ?? false;

  const { count: cartCount } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { data: cachedCategories } = usePublicCategories(
    categories,
    showCategoryNavigation,
  );
  const categoryItems = cachedCategories ?? categories ?? [];

  const isLinkActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const [searchDrawerOpen, setSearchDrawerOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchDrawerOpen((prev) => !prev);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const firstName = user?.firstName ?? "";
  const lastName = user?.lastName ?? "";
  const displayName = firstName ? `${firstName} ${lastName}`.trim() : user?.email?.split("@")[0] || "Account";
  const shortName = firstName || user?.email?.split("@")[0] || "";
  const initials = firstName
    ? `${firstName[0]}${lastName ? lastName[0] : ""}`.toUpperCase()
    : user?.email?.[0]?.toUpperCase() || "U";

  const roleLabel = canAdminister ? "Administrator" : canSell ? "Vendor" : "Member";
  const DashboardIcon = canAdminister ? Shield : LayoutDashboard;

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 sm:gap-4 px-3 sm:px-6 lg:px-8">
        {/* Brand Logo and primary navigation */}
        <div className="flex items-center gap-2.5 sm:gap-5 min-w-0">
          {showCategoryNavigation && <CategoryNavMenu categories={categoryItems} />}

          <Link href="/" className="flex shrink-0 items-center gap-1 group">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground transition-transform group-hover:scale-105">
              NUTS<span className="inline-block h-1.5 w-1.5 rounded-full bg-primary ml-0.5"></span>
            </span>
          </Link>

          <nav className="hidden xl:flex items-center gap-6 ml-3">
            <Link
              href="/"
              className={`text-sm font-medium transition-colors ${
                pathname === "/" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Home
            </Link>
            <Link
              href="/discover"
              className={`text-sm font-medium transition-colors ${
                pathname === "/discover" ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Discover
            </Link>
            <Link
              href="/vendor"
              className={`text-sm font-medium transition-colors ${
                pathname.startsWith("/vendor") ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Vendors
            </Link>
          </nav>
        </div>

        {/* Center: Search Trigger (Desktop / Tablet) */}
        <div className="hidden md:block flex-1 max-w-md mx-3 lg:mx-6">
          <button
            type="button"
            onClick={() => setSearchDrawerOpen(true)}
            className="flex w-full items-center justify-between rounded-full border border-border/80 bg-secondary/60 px-4 py-2 text-sm text-muted-foreground transition-all hover:border-black dark:hover:border-white hover:bg-card hover:text-foreground cursor-pointer group shadow-2xs"
            aria-label="Open search drawer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="truncate">Search NUTS</span>
            </div>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Mobile Search Toggle Button */}
          <button
            type="button"
            onClick={() => setSearchDrawerOpen(true)}
            className="md:hidden flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground cursor-pointer"
            aria-label="Open search drawer"
          >
            <Search className="h-5 w-5" />
          </button>

          {/* Wishlist and Cart - Only show for customer sessions */}
          {canPurchase && (
            <>
              <Link
                href="/wishlist"
                className={`relative hidden h-9 w-9 items-center justify-center rounded-full transition-all xl:flex ${
                  isLinkActive("/wishlist")
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
                aria-label="Wishlist"
              >
                <Heart className="h-5 w-5" />
                {isMounted && wishlistCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-xs">
                    {wishlistCount}
                  </span>
                )}
              </Link>

              <Link
                href="/cart"
                className={`relative hidden h-9 w-9 items-center justify-center rounded-full transition-all xl:flex ${
                  isLinkActive("/cart")
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
                aria-label="Shopping Cart"
              >
                <ShoppingCart className="h-5 w-5" />
                {isMounted && cartCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground shadow-xs">
                    {cartCount}
                  </span>
                )}
              </Link>
            </>
          )}

          {isMounted && isLoggedIn && (
            <div className="hidden xl:block">
              <NotificationBell />
            </div>
          )}


          {!isMounted ? (
            <div className="flex items-center gap-2 opacity-0 pointer-events-none" aria-hidden="true">
              <span className="text-xs sm:text-sm font-medium px-2 py-1.5 opacity-0">Sign In</span>
            </div>
          ) : !isLoggedIn ? (
            <div className="flex items-center gap-1.5 sm:gap-2.5 animate-in fade-in-0 duration-150">
              <Link
                href="/auth/login"
                className="text-xs sm:text-sm font-medium text-foreground hover:text-muted-foreground transition-colors px-2 py-1.5"
              >
                Sign In
              </Link>
              <Link
                href="/auth/register"
                className="hidden sm:inline-flex rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 sm:px-4 py-1.5 text-xs sm:text-sm font-medium transition-all shadow-xs"
              >
                Sign Up
              </Link>
            </div>
          ) : (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setAccountOpen((prev) => !prev)}
                className="flex items-center gap-1.5 sm:gap-2 rounded-full border border-border bg-secondary/80 py-1 pl-1 pr-2 sm:pl-1.5 sm:pr-3 transition-all hover:bg-secondary"
                aria-haspopup="true"
                aria-expanded={accountOpen}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold tracking-tight shrink-0 select-none">
                  {initials}
                </div>
                {shortName && (
                  <span className="hidden sm:block text-xs sm:text-sm font-medium text-foreground max-w-[80px] md:max-w-[100px] truncate">
                    {shortName}
                  </span>
                )}
                <ChevronDown
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
                    accountOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {accountOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-border bg-popover p-2 text-popover-foreground shadow-xl z-50">
                  <div className="flex items-center gap-3 border-b border-border px-3 py-3 mb-1">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                      {initials}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <p className="text-sm font-semibold text-foreground truncate leading-snug">
                        {displayName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate leading-snug">
                        {user?.email}
                      </p>
                      <span className="mt-0.5 inline-flex items-center w-fit rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
                        {roleLabel}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    {canSell ? (
                      <>
                        <Link
                          href="/vendor/analytic"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <DashboardIcon className="h-4 w-4 text-foreground" />
                          Vendor Dashboard
                        </Link>
                        <Link
                          href="/vendor/product"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Package className="h-4 w-4 text-muted-foreground" />
                          My Products
                        </Link>
                        <Link
                          href="/vendor/order"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                          Store Orders
                        </Link>
                        <Link
                          href="/vendor/wallet"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          Vendor Wallet
                        </Link>
                        <Link
                          href="/vendor/setting"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          Store Settings
                        </Link>
                        {user?.storeSlug && (
                          <Link
                            href={`/vendor/${user.storeSlug}`}
                            onClick={() => setAccountOpen(false)}
                            className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                          >
                            <Store className="h-4 w-4 text-muted-foreground" />
                            My Storefront
                          </Link>
                        )}
                      </>
                    ) : canAdminister ? (
                      <>
                        <Link
                          href="/admin"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <DashboardIcon className="h-4 w-4 text-foreground" />
                          Admin Dashboard
                        </Link>
                        <Link
                          href="/admin/product"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Package className="h-4 w-4 text-muted-foreground" />
                          Manage Products
                        </Link>
                        <Link
                          href="/admin/order"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                          Manage Orders
                        </Link>
                        <Link
                          href="/admin/user"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <UserIcon className="h-4 w-4 text-muted-foreground" />
                          Manage Users
                        </Link>
                        <Link
                          href="/admin/vendor"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Store className="h-4 w-4 text-muted-foreground" />
                          Manage Vendors
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link
                          href="/account"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <UserIcon className="h-4 w-4 text-muted-foreground" />
                          My Account
                        </Link>
                        <Link
                          href="/order"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Package className="h-4 w-4 text-muted-foreground" />
                          My Orders
                        </Link>
                        <Link
                          href="/wallet"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Wallet className="h-4 w-4 text-muted-foreground" />
                          My Wallet
                        </Link>
                        <Link
                          href="/account/setting"
                          onClick={() => setAccountOpen(false)}
                          className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary transition-colors"
                        >
                          <Settings className="h-4 w-4 text-muted-foreground" />
                          Settings & Preferences
                        </Link>
                      </>
                    )}
                  </div>

                  <div className="border-t border-border my-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAccountOpen(false);
                        const redirectPath = canAdminister
                          ? "/auth/admin/login"
                          : canSell
                            ? "/auth/vendor/login"
                            : "/auth/login";
                        void logoutWithFeedback(logout, { redirectTo: redirectPath });
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
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
      </div>

      {/* Global Search Popout Drawer with Recommended For You & Quick Suggestions */}
      <SearchDrawer
        isOpen={searchDrawerOpen}
        onClose={() => setSearchDrawerOpen(false)}
      />
    </header>
  );
}
