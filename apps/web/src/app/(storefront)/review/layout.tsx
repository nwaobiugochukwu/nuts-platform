import { ProtectedLayout } from "@/components/domain/auth/ProtectedLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}