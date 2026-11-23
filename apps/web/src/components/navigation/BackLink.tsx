"use client";

import Link from "@/components/navigation/AppLink";
import { cn } from "@/lib/util";
import { canGoBackInApp, describePath, previousPath } from "@/lib/navigation-history";
import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;

/**
 * "Back" that returns to where the user actually came from.
 *
 * Arrived from inside the app (a notification, search, list): goes back in
 * history and names the origin ("Back to notifications"). Arrived directly
 * (shared link, reload): links to `fallbackHref` with `fallbackLabel`. It is a
 * real link either way, so open-in-new-tab and long-press still work.
 */
export function BackLink({
  fallbackHref,
  fallbackLabel,
  className,
  icon = true,
  children,
}: {
  fallbackHref: string;
  fallbackLabel: string;
  className?: string;
  icon?: boolean;
  /** Overrides the computed label. */
  children?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Server and first client render use the fallback; the real origin is only
  // known on the client (avoids a hydration mismatch).
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => (canGoBackInApp(pathname) ? previousPath(pathname) : null),
    () => null,
  );
  const hasOrigin = origin !== null;
  const label = children ?? (hasOrigin ? `Back${describePath(origin) ? ` to ${describePath(origin)}` : ""}` : fallbackLabel);

  return (
    <Link
      href={hasOrigin ? origin : fallbackHref}
      onClick={(event) => {
        if (
          !hasOrigin ||
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        router.back();
      }}
      className={cn(
        "inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground sm:text-sm",
        className,
      )}
    >
      {icon && <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{label}</span>
    </Link>
  );
}
