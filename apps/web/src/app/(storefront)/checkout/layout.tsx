import { ProtectedLayout } from "@/components/auth/ProtectedLayout";

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
