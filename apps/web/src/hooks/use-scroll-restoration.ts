"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  RESTORE_GIVE_UP_MS,
  canReachOffset,
  decideRestore,
  wasReachedByTraversal,
} from "@/lib/scroll-restoration";

const STORAGE_KEY_PREFIX = "nuts:scroll:";

// Browser-wide state shared by every mount of the hook.
let lastPopstateAt: number | null = null;
let popstateListenerInstalled = false;
let documentHasMountedHook = false;

function installPopstateListener() {
  if (popstateListenerInstalled || typeof window === "undefined") return;
  popstateListenerInstalled = true;
  // Back/Forward fires popstate; links, the logo, menus and reloads do not.
  window.addEventListener("popstate", () => {
    lastPopstateAt = Date.now();
  });
}
installPopstateListener();

function navigationType(): string | null {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return entry?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * Scroll restoration for list-style pages (the home shelves).
 *
 * The saved position is restored ONLY when the shopper reached the page with
 * Back/Forward. A fresh visit (link, logo, menu, reload, new tab) starts at the
 * top and discards any older saved position, so the shopper never has to scroll
 * up before using the page. If the page never grows tall enough to reach the
 * saved spot, restoration is skipped rather than stranding the shopper midway.
 *
 * Call this once from the page-level client component that owns the content.
 */
export function useScrollRestoration() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storageKey = STORAGE_KEY_PREFIX + pathname;
    const isFirstMountOfDocument = !documentHasMountedHook;
    documentHasMountedHook = true;

    // Take over from the browser only while this page is mounted.
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(storageKey);
    } catch {
      saved = null;
    }

    const decision = decideRestore({
      saved,
      isTraversal: wasReachedByTraversal({
        now: Date.now(),
        lastPopstateAt,
        navigationType: navigationType(),
        isFirstMountOfDocument,
      }),
    });

    let restoreFrame: number | null = null;
    if (decision.action === "clear") {
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        // sessionStorage can be unavailable in private modes.
      }
    } else if (decision.action === "restore") {
      const startedAt = performance.now();
      const tryRestore = () => {
        restoreFrame = null;
        if (
          canReachOffset(
            document.documentElement.scrollHeight,
            window.innerHeight,
            decision.top,
          )
        ) {
          window.scrollTo({ top: decision.top, behavior: "instant" });
          return;
        }
        if (performance.now() - startedAt < RESTORE_GIVE_UP_MS) {
          restoreFrame = requestAnimationFrame(tryRestore);
        }
        // Otherwise give up quietly and stay at the top.
      };
      restoreFrame = requestAnimationFrame(tryRestore);
    }

    // Throttled saver: at most one write per 150 ms. Skip writes while a restore
    // is pending so the initial top-of-page position cannot overwrite the saved one.
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (restoreFrame !== null || saveTimer !== null) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
          sessionStorage.setItem(storageKey, String(Math.round(window.scrollY)));
        } catch {
          // ignore
        }
      }, 150);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (saveTimer !== null) clearTimeout(saveTimer);
      if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
      // Leaving: hand control back to the browser so other routes use their
      // normal behaviour. The position was already saved while scrolling; it is
      // not re-read here because the router may already have scrolled to the top.
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "auto";
      }
    };
  }, [pathname]);
}
