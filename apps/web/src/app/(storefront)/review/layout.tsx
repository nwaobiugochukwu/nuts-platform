import { ProtectedLayout } from "@/components/auth/ProtectedLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}