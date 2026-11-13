import { VendorLayout } from "@/component/layout/VendorLayout";
import { getServerSession } from "@/lib/server-auth.ts";
import { ClientAuthBoundary } from "@/components/domain/auth/ClientAuthBoundary";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (session.isAuthenticated && session.role === "vendor") {
    return <VendorLayout>{children}</VendorLayout>;
  }

  return (
    <ClientAuthBoundary requiredRole="vendor" loginPath="/auth/vendor/login">
      <VendorLayout>{children}</VendorLayout>
    </ClientAuthBoundary>
  );
}
