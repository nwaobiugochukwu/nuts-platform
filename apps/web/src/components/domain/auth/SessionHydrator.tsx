"use client";

import { useAuthStore } from "@/zustand/auth";
import { RecentHistoryClaim } from "@/components/domain/auth/RecentHistoryClaim";
import { useDiscountStore } from "@/zustand/discount";
import { useEffect } from "react";

/**
 * Initializes the authentication session on application mount.
 * Authenticates the user in-memory from HttpOnly cookies without re-querying on every page navigation.
 */
export function SessionHydrator({ children }: { children: React.ReactNode }) {
  const hydrateFromCookies = useAuthStore((state) => state.hydrateFromCookies);

  useEffect(() => {
    // Restore a claimed voucher after hydration (no SSR/client mismatch).
    useDiscountStore.getState().hydrate();
    void hydrateFromCookies();

    const handleOnline = () => {
      void hydrateFromCookies();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [hydrateFromCookies]);

  return (
    <>
      <RecentHistoryClaim />
      {children}
    </>
  );
}
