"use client";

import { orderService,referralService,userService,walletService,vendorFollowingService } from "@/api";
import { Button } from "@/component/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/component/ui/card";
import { useWishlist } from "@/hooks/use-wishlist";
import { queryKey } from "@/lib/query-key";
import { formatDate,formatPrice } from "@/lib/util";
import { useQuery } from "@tanstack/react-query";
import {
ArrowRight,
Check,
Copy,
Gift,
Heart,
Mail,
MapPin,
Package,
Phone,
Settings,
Share2,
User,
Wallet,
Store,
} from "lucide-react";
import Link from "@/components/navigation/AppLink";
import { useState } from "react";
import { toast } from "sonner";

export default function AccountPage() {
  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: queryKey.user.profile,
    queryFn: async () => (await userService.me()).data,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  const { data: walletData } = useQuery({
    queryKey: ["wallet"],
    queryFn: async () => (await walletService.getUserWallet()).data,
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  const { data: ordersData } = useQuery({
    queryKey: queryKey.order.list({ page: 1, limit: 1 }),
    queryFn: async () => await orderService.list({ page: 1, limit: 1 }),
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 15,
  });

  const { data: referralStats } = useQuery({
    queryKey: ["account", user?.id, "referral-stats"],
    queryFn: async () => (await referralService.getStats()).data,
    enabled: Boolean(user?.id),
    staleTime: 1000 * 60 * 5,
  });

  const { data: followingCount } = useQuery({
    queryKey: ["vendor-follows", user?.id ?? null, "count"],
    queryFn: async () => (await vendorFollowingService.count()).data,
    enabled: Boolean(user?.id),
    staleTime: 1000 * 60,
  });

  const { items: wishlistItems } = useWishlist();
  const [copied, setCopied] = useState(false);

  if (userLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="h-64 animate-pulse rounded-3xl bg-neutral-100 dark:bg-neutral-900" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <p className="text-muted-foreground">Unable to load account profile.</p>
        <Button asChild className="mt-4 rounded-full">
          <Link href="/auth/login">Sign In</Link>
        </Button>
      </div>
    );
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Member";
  const initials =
    [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join("").toUpperCase() ||
    (user.email?.[0]?.toUpperCase() ?? "M");

  const totalOrders = ordersData?.meta?.totalItems ?? ordersData?.data?.length ?? 0;
  const walletBalance = walletData?.balance ?? 0;
  const wishlistCount = wishlistItems.length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 space-y-10">
      {/* Profile Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-800 p-8 sm:p-10 text-white shadow-xl">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-2xl bg-white text-neutral-950 font-bold text-xl sm:text-2xl shadow-lg">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="break-words text-2xl sm:text-3xl font-bold tracking-tight">{fullName}</h1>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-400">
                <span className="break-all">{user.email}</span>
                {user.phoneNumber && (
                  <>
                    <span>·</span>
                    <span className="break-all">{user.phoneNumber}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              asChild
              className="rounded-full bg-white text-neutral-950 hover:bg-neutral-100 text-sm font-medium px-6 shadow-sm"
            >
              <Link href="/account/setting" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span>Account Settings</span>
              </Link>
            </Button>
          </div>
        </div>

        {/* Ambient background glow */}
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {/* Wallet Stat */}
        <Link href="/wallet" className="group block">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  NUTS Wallet
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                  {formatPrice(walletBalance)}
                </p>
                <p className="mt-1 text-xs text-neutral-500 flex items-center gap-1">
                  <span>View balance & ledger</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-foreground">
                <Wallet className="h-6 w-6 stroke-[1.5]" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Orders Stat */}
        <Link href="/order" className="group block">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Total Orders
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                  {totalOrders}
                </p>
                <p className="mt-1 text-xs text-neutral-500 flex items-center gap-1">
                  <span>Track delivery status</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-foreground">
                <Package className="h-6 w-6 stroke-[1.5]" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Wishlist Stat */}
        <Link href="/wishlist" className="group block">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Saved Wishlist
                </p>
                <p className="mt-2 text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                  {wishlistCount}
                </p>
                <p className="mt-1 text-xs text-neutral-500 flex items-center gap-1">
                  <span>View your private items</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-foreground">
                <Heart className="h-6 w-6 stroke-[1.5]" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/account/following" className="group block">
          <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Following Stores</p>
                <p className="mt-2 text-2xl font-bold text-foreground group-hover:text-primary transition-colors">
                  {followingCount?.count ?? 0}
                </p>
                <p className="mt-1 text-xs text-neutral-500 flex items-center gap-1">
                  <span>Manage the stores you follow</span>
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-foreground">
                <Store className="h-6 w-6 stroke-[1.5]" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Account Details Overview */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Personal Details Card */}
        <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-neutral-500" />
                <span>Personal Profile</span>
              </CardTitle>
              <Link
                href="/account/setting"
                className="text-xs font-medium text-neutral-500 hover:text-foreground transition-colors"
              >
                Edit
              </Link>
            </div>
            <CardDescription className="text-sm">
              Primary identification credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3 text-sm">
              <span className="text-muted-foreground">Full Name</span>
              <span className="font-semibold text-foreground">{fullName}</span>
            </div>
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3 text-sm">
              <span className="text-muted-foreground">Email Address</span>
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-neutral-400" />
                {user.email}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3 text-sm">
              <span className="text-muted-foreground">Phone Number</span>
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-neutral-400" />
                {user.phoneNumber ?? "Not configured"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm pt-1">
              <span className="text-muted-foreground">Member Since</span>
              <span className="font-medium text-foreground">
                {user.createdAt ? formatDate(new Date(user.createdAt).toISOString()) : "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Shipping Information Card */}
        <Card className="rounded-2xl border-neutral-200/80 dark:border-neutral-800">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-neutral-500" />
                <span>Default Shipping Address</span>
              </CardTitle>
            </div>
            <CardDescription className="text-sm">
              Configured during checkout for rapid order dispatch
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {user.shippingInformation ? (
              <div className="space-y-4 text-sm">
                <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
                  <span className="text-muted-foreground">Recipient Name</span>
                  <span className="font-semibold text-foreground">
                    {user.shippingInformation.fullName}
                  </span>
                </div>
                <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800/80 pb-3">
                  <span className="text-muted-foreground">Contact Phone</span>
                  <span className="font-semibold text-foreground">
                    {user.shippingInformation.phone}
                  </span>
                </div>
                <div className="flex items-start justify-between text-sm pt-1">
                  <span className="text-muted-foreground">Delivery Address</span>
                  <address className="not-italic text-right font-medium text-foreground leading-relaxed max-w-[220px]">
                    {user.shippingInformation.street}, {user.shippingInformation.city},{" "}
                    {user.shippingInformation.state}, {user.shippingInformation.country}
                  </address>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground space-y-3">
                <p>No default shipping address saved yet.</p>
                <p className="text-xs text-neutral-400">
                  Your delivery address will be saved securely automatically when you place your first order.
                </p>
                <Button asChild size="sm" variant="outline" className="rounded-full text-sm font-medium">
                  <Link href="/product">Explore Catalog</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Referral Program Card */}
      <Card className="rounded-3xl border-neutral-200/80 dark:border-neutral-800 overflow-hidden">
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-6 sm:p-8 border-b border-amber-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md">
              <Gift className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-foreground">Your Personal Referral Link</h3>
              <p className="text-xs text-muted-foreground">
                Invite fellow shoppers to NUTS. When they register and order, you earn credits straight into your wallet.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-full text-xs self-start sm:self-auto">
            <Link href="/account/setting">Manage in Settings</Link>
          </Button>
        </div>

        <CardContent className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="space-y-4">
            <div>
              <span className="text-xs font-semibold text-muted-foreground block mb-1">Your Referral Code</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-4 py-3 font-mono font-bold text-xl tracking-widest text-foreground select-all">
                  {referralStats?.code ?? "Referral code unavailable"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const code = referralStats?.code;
                    if (!code) {
                      toast.error("Your referral code is not available yet");
                      return;
                    }
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                      toast.success("Referral code copied!");
                    }
                  }}
                  className="rounded-2xl h-12 px-4 text-sm font-medium shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-1 text-emerald-500" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" />
                      <span>Copy</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div>
              <label
                htmlFor="direct-registration-url"
                className="text-xs font-semibold text-muted-foreground block mb-1"
              >
                Direct Registration URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="direct-registration-url"
                  name="registrationUrl"
                  aria-label="Direct Registration URL"
                  type="text"
                  readOnly
                  value={
                    typeof window !== "undefined" && referralStats?.code
                      ? `${window.location.origin}/auth/register?ref=${encodeURIComponent(referralStats.code)}`
                      : ""
                  }
                  className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-muted-foreground truncate"
                />
                <Button
                  type="button"
                  onClick={() => {
                    const link = referralStats?.code ?
                      typeof window !== "undefined"
                        ? `${window.location.origin}/auth/register?ref=${encodeURIComponent(referralStats.code)}`
                        : ""
                      : "";
                    if (!link) {
                      toast.error("Your referral code is not available yet");
                      return;
                    }
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(link);
                      toast.success("Referral invite link copied!");
                    }
                  }}
                  className="rounded-xl h-9 px-4 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 shrink-0"
                >
                  <Share2 className="h-3.5 w-3.5 mr-1" />
                  <span>Share Link</span>
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-900/60 p-5 space-y-2.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Program Rewards:</p>
            <p>• New shoppers get a discount on their order by entering your code at signup.</p>
            <p>• You automatically earn cashback credits credited to your NUTS Wallet.</p>
            <p>• Wallet balances never expire and can be redeemed on any store checkout.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
