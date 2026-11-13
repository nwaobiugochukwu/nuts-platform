import { ProtectedLayout } from "@/component/auth/ProtectedLayout";

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
