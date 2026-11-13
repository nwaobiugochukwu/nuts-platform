import { ProtectedLayout } from "@/component/auth/ProtectedLayout";
import { CustomerLayout } from "@/component/layout/CustomerLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerLayout>
      <ProtectedLayout>{children}</ProtectedLayout>
    </CustomerLayout>
  );
}
