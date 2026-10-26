"use client";

import { CustomerLayout } from "@/component/layout/CustomerLayout";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuthStore, normalizeRole } from "@/zustand/auth";
import { safeInternalPath } from "@/lib/safe-internal-path";
import {
  getPortalRoleFromPath,
  evaluateAuthPageRedirect,
} from "@/lib/portal-role";
import { Loader2, ArrowRightLeft } from "lucide-react";

interface PublicOnlyLayoutProps {
  children: ReactNode;
  showNavigation?: boolean;
}

export function PublicOnlyLayout({
  children,
  showNavigation = true,
}: PublicOnlyLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, user, role, logout } = useAuthStore();

  const targetPageRole = getPortalRoleFromPath(pathname);
  const activeRole = normalizeRole(role ?? user?.role);

  let redirectParam: string | null = null;
  if (typeof window !== "undefined") {
    redirectParam = new URLSearchParams(window.location.search).get("redirect");
  }

  const { shouldRedirect, targetPath, isCrossRoleAccess } =
    evaluateAuthPageRedirect(
      pathname,
      isAuthenticated,
      activeRole,
      redirectParam ? safeInternalPath(redirectParam, "/") : null,
    );

  useEffect(() => {
    if (shouldRedirect && targetPath) {
      router.replace(targetPath);
    }
  }, [shouldRedirect, targetPath, router]);

  // If already authenticated with the matching role, display a clean redirecting state
  if (shouldRedirect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-xs font-medium">Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  const roleNoticeBanner = isCrossRoleAccess ? (
    <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Signed in as <strong>{activeRole}</strong> ({user?.email}). Signing
            in below will switch your session to <strong>{targetPageRole}</strong>.
          </span>
        </div>
        <button
          type="button"
          onClick={() => void logout({ skipApi: true })}
          className="shrink-0 underline hover:opacity-80 font-medium"
        >
          Sign Out
        </button>
      </div>
    </div>
  ) : null;

  // Admin and Vendor auth pages should NOT render CustomerLayout with customer Navbar!
  if (targetPageRole !== "user" || !showNavigation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-3 py-6 sm:px-6 sm:py-12">
        <div className="w-full max-w-lg">
          {roleNoticeBanner}
          {children}
        </div>
      </div>
    );
  }

  return (
    <CustomerLayout>
      <div className="mx-auto w-full max-w-xl px-3 py-6 sm:px-6 sm:py-10">
        {roleNoticeBanner}
        {children}
      </div>
    </CustomerLayout>
  );
}
