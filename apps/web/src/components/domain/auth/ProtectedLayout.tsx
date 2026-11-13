import { type ReactNode } from "react";
import { getServerSession } from "@/lib/server-auth.ts";
import { ClientAuthBoundary } from "./ClientAuthBoundary";

export async function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();

  if (session.isAuthenticated && session.role === "user") {
    return <>{children}</>;
  }

  return (
    <ClientAuthBoundary requiredRole="user" loginPath="/auth/login">
      {children}
    </ClientAuthBoundary>
  );
}
