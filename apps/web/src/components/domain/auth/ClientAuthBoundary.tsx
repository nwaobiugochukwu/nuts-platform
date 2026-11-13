"use client";

import { useAuthStore, type AuthRole } from "@/zustand/auth";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface ClientAuthBoundaryProps {
  requiredRole?: AuthRole;
  loginPath?: string;
  children: ReactNode;
}

export function ClientAuthBoundary({
  requiredRole,
  loginPath = "/auth/login",
  children,
}: ClientAuthBoundaryProps) {
  const router = useRouter();
  const { isAuthenticated, status, role } = useAuthStore();

  const isRoleAuthorized = !requiredRole || role === requiredRole;

  useEffect(() => {
    if (
      status === "unauthenticated" ||
      (status === "authenticated" && !isRoleAuthorized)
    ) {
      router.replace(loginPath);
    }
  }, [status, isRoleAuthorized, loginPath, router]);

  if (status === "unknown" || status === "hydrating") {
    return (
      <div className="flex min-h-[50vh] w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary opacity-60" />
      </div>
    );
  }

  if (isAuthenticated && isRoleAuthorized) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary opacity-60" />
    </div>
  );
}
