"use client";

import type { ReactNode } from "react";

export function RoleGuardLayout({
  children,
}: {
  allow?: ("user" | "admin" | "vendor")[];
  children: ReactNode;
}) {
  return <>{children}</>;
}

