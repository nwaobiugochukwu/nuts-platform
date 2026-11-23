"use client";

import { recordHistoryPop, recordNavigation } from "@/lib/navigation-history";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Records client-side navigation so Back links can return to the real previous page. */
export function NavigationHistoryTracker() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    // Browser back/forward fires popstate before the route change is committed.
    const onPop = () => recordHistoryPop();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    recordNavigation(search ? `${pathname}?${search}` : pathname);
  }, [pathname, search]);

  return null;
}
