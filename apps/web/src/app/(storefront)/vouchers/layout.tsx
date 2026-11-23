import { ProtectedLayout } from "@/components/domain/auth/ProtectedLayout";
import { CustomerLayout } from "@/components/layout/CustomerLayout";

export default function VouchersLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerLayout>
      <ProtectedLayout>{children}</ProtectedLayout>
    </CustomerLayout>
  );
}
