import { ProtectedLayout } from "@/component/auth/ProtectedLayout";

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
