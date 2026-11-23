import { ProtectedLayout } from "@/components/auth/ProtectedLayout";

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
