import { AdminLayout } from "@/component/layout/AdminLayout";
import { getServerSession } from "@/lib/server-auth.ts";
import { ClientAuthBoundary } from "@/components/domain/auth/ClientAuthBoundary";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (session.isAuthenticated && session.role === "admin") {
    return <AdminLayout>{children}</AdminLayout>;
  }

  return (
    <ClientAuthBoundary requiredRole="admin" loginPath="/auth/admin/login">
      <AdminLayout>{children}</AdminLayout>
    </ClientAuthBoundary>
  );
}
