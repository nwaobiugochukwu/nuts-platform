"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY_PREFIX = "nuts:scroll:";

/**
 * Production-grade scroll position restoration hook.
 *
 * Saves the current page's scroll position to sessionStorage as the user
 * scrolls, and restores it on mount (e.g. when navigating Back from a PDP).
 *
 * Uses `window.history.scrollRestoration = "manual"` to prevent the browser's
 * built-in scroll-restoration from racing with the client-side restore.
 *
 * Usage: call this hook once inside the page-level client component that wraps
 * the scrollable content (e.g. HomeProductShelves).
 */
export function useScrollRestoration() {
  const pathname = usePathname();
  const restoredRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const restoreCommitFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Let us manage scroll position — disable native browser restoration so
    // it doesn't snap back to top or conflict with our logic.
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const storageKey = STORAGE_KEY_PREFIX + pathname;

    // Restore once on mount (back-navigation lands here with a stale position)
    if (!restoredRef.current) {
      restoredRef.current = true;
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const targetY = parseInt(saved, 10);
        if (!Number.isNaN(targetY) && targetY > 0) {
          // Double rAF ensures the browser has committed the layout before we
          // scroll — single rAF can fire before paint on some browsers.
          restoreFrameRef.current = requestAnimationFrame(() => {
            restoreFrameRef.current = null;
            restoreCommitFrameRef.current = requestAnimationFrame(() => {
              restoreCommitFrameRef.current = null;
              window.scrollTo({ top: targetY, behavior: "instant" });
            });
          });
        }
      }
    }

    // Throttled scroll saver — write at most once per 150 ms to avoid
    // thrashing sessionStorage on every scroll event.
    const handleScroll = () => {
      if (saveTimerRef.current !== null) return;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        try {
          sessionStorage.setItem(storageKey, String(Math.round(window.scrollY)));
        } catch {
          // sessionStorage may be unavailable in some privacy modes — ignore.
        }
      }, 150);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = null;
      }
      if (restoreCommitFrameRef.current !== null) {
        cancelAnimationFrame(restoreCommitFrameRef.current);
        restoreCommitFrameRef.current = null;
      }
      // Home uses manual restoration for its saved shelf position. Restore the
      // browser default when leaving so later routes start at the top.
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "auto";
      }
    };
  }, [pathname]);
}

